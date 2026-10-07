const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { getChinaDate } = require('../../config/timezone');
const { getAIConfig, isAIConfigured, getAITimeoutMs } = require('../../config/ai');
const { PROMPTS, SETTING_PREFIX, getPrompt, fillTemplate } = require('../../config/prompts');
const {
  USERNAME_MAX_LEN,
  AI_USERNAME_BATCH_SIZE,
  requireAdmin,
  purgeUserData,
  applyApplicationToClass,
  approveTeacherPendingApplications,
  checkDataPermission,
  cleanStudentNames,
  findDuplicateNames,
  sanitizeUsername,
  sanitizeSequencePrefix,
  isUsernameTaken,
  ensureUniqueUsername,
  randomPassword,
  parseJSONArray,
  generateUsernamesByAI,
  ensureSettingsTable,
} = require('./_shared');
const { isValidSlug, generateClassSlug } = require('../../utils/slug');
const { countHeadTeachers, syncPrimaryHeadTeacher } = require('../../utils/headTeacher');

router.get('/classes', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    let classes;
    if (userRole === 'admin') {
      classes = db.prepare(`
        SELECT c.*, COALESCE(u.real_name, u.username) as teacher_name, s.name AS school_name,
          (SELECT COUNT(*) FROM users WHERE class_id = c.id AND role = 'student') as student_count,
          (SELECT COALESCE(SUM(exp), 0) FROM pets WHERE user_id IN (SELECT id FROM users WHERE class_id = c.id AND role = 'student')) as total_exp,
          (SELECT COALESCE(SUM(gold), 0) FROM users WHERE class_id = c.id AND role = 'student') as total_gold
        FROM classes c
        LEFT JOIN users u ON c.teacher_id = u.id
        LEFT JOIN schools s ON c.school_id = s.id
        ORDER BY c.created_at DESC
      `).all();
    } else {
      classes = db.prepare(`
        SELECT c.*, COALESCE(u.real_name, u.username) as teacher_name, s.name AS school_name,
          (SELECT COUNT(*) FROM users WHERE class_id = c.id AND role = 'student') as student_count,
          (SELECT COALESCE(SUM(exp), 0) FROM pets WHERE user_id IN (SELECT id FROM users WHERE class_id = c.id AND role = 'student')) as total_exp,
          (SELECT COALESCE(SUM(gold), 0) FROM users WHERE class_id = c.id AND role = 'student') as total_gold
        FROM classes c
        LEFT JOIN users u ON c.teacher_id = u.id
        LEFT JOIN schools s ON c.school_id = s.id
        INNER JOIN class_teachers ct ON c.id = ct.class_id
        WHERE ct.teacher_id = ?
        ORDER BY c.created_at DESC
      `).all(userId);
    }

    const classesWithTeachers = classes.map(cls => {
      const teachers = db.prepare(`
        SELECT ct.id as class_teacher_id, ct.role, ct.subject, u.id as teacher_id, u.username, u.real_name
        FROM class_teachers ct
        JOIN users u ON ct.teacher_id = u.id
        WHERE ct.class_id = ?
      `).all(cls.id);
      const headTeachers = teachers.filter((t) => t.role === 'head_teacher');
      return {
        ...cls,
        teachers,
        // 一个班可有多位班主任，这里显式给出（head_teacher_id 仅为兼容字段，指向主班主任）
        head_teachers: headTeachers,
        head_teacher_count: headTeachers.length,
      };
    });

    res.json({ classes: classesWithTeachers });
  } catch (error) {
    console.error('获取班级列表失败:', error);
    res.status(500).json({ error: '获取班级列表失败' });
  }
});

router.post('/classes/:id/teachers', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { teacher_id, role, subject } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const cls = db.prepare(`SELECT id, name FROM classes WHERE id = ?`).get(id);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }

    if (!teacher_id) {
      return res.status(400).json({ error: '请指定教师' });
    }

    if (userRole !== 'admin') {
      const myHeadTeacherClass = db.prepare(`SELECT id FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`).get(userId, id);
      if (!myHeadTeacherClass) {
        return res.status(403).json({ error: '只有班主任可以添加本班教师' });
      }
    }

    const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher' AND status = 'active'`).get(teacher_id);
    if (!teacher) {
      return res.status(400).json({ error: '指定的教师不存在或未激活' });
    }

    const existing = db.prepare(`SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ?`).get(id, teacher_id);
    if (existing) {
      return res.status(400).json({ error: '该教师已在班级中' });
    }

    const targetRole = role === 'head_teacher' ? 'head_teacher' : 'teacher';

    const addTeacher = db.transaction(() => {
      const targetSubject = String(subject ?? '').trim().slice(0, 20) || null;
      const result = db.prepare(`
        INSERT INTO class_teachers (class_id, teacher_id, role, subject)
        VALUES (?, ?, ?, ?)
      `).run(id, teacher_id, targetRole, targetSubject);

      // 关键：指定班主任时必须同步主班主任冗余字段，否则「我的班级」等依赖它的旧逻辑会失效
      if (targetRole === 'head_teacher') {
        syncPrimaryHeadTeacher(id);
      }
      return result;
    });

    const result = addTeacher();

    res.json({
      message: targetRole === 'head_teacher'
        ? `已将教师设为「${cls.name}」的班主任（该班现有 ${countHeadTeachers(id)} 位班主任）`
        : '教师已添加到班级',
      class_teacher_id: result.lastInsertRowid,
      head_teacher_count: countHeadTeachers(id),
    });
  } catch (error) {
    console.error('添加教师到班级失败:', error);
    res.status(500).json({ error: '添加教师到班级失败' });
  }
});

router.delete('/classes/:id/teachers/:teacherId', authenticateToken, (req, res) => {
  try {
    const { id, teacherId } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole !== 'admin') {
      const isHeadTeacher = db.prepare(
        `SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ? AND role = 'head_teacher'`
      ).get(id, userId);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任或管理员可以移除教师' });
      }
    }

    const targetRecord = db.prepare(
      `SELECT role FROM class_teachers WHERE class_id = ? AND teacher_id = ?`
    ).get(id, teacherId);
    if (!targetRecord) {
      return res.status(404).json({ error: '该教师不在班级中' });
    }
    if (targetRecord.role === 'head_teacher' && countHeadTeachers(id) <= 1) {
      // 一个班可以有多位班主任，但至少要保留一位，否则本班将无人可管理
      return res.status(400).json({ error: '该班至少需要保留一位班主任，请先添加其他班主任' });
    }

    const remove = db.transaction(() => {
      const result = db.prepare(`DELETE FROM class_teachers WHERE class_id = ? AND teacher_id = ?`).run(id, teacherId);
      if (result.changes > 0) syncPrimaryHeadTeacher(id);
      return result;
    });
    const result = remove();
    if (result.changes === 0) {
      return res.status(404).json({ error: '该教师不在班级中' });
    }

    res.json({
      message: '教师已从班级移除',
      head_teacher_count: countHeadTeachers(id),
    });
  } catch (error) {
    console.error('从班级移除教师失败:', error);
    res.status(500).json({ error: '从班级移除教师失败' });
  }
});

// 修改教师在某个班级中的身份（任课教师 <-> 班主任）
router.put('/classes/:id/teachers/:teacherId', authenticateToken, (req, res) => {
  try {
    const { id, teacherId } = req.params;
    const { role, subject } = req.body || {};
    const classId = parseInt(id, 10);
    const targetTeacherId = parseInt(teacherId, 10);
    const userRole = req.user.role;

    const cls = db.prepare(`SELECT id, name FROM classes WHERE id = ?`).get(classId);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }
    if (!Number.isFinite(targetTeacherId)) {
      return res.status(400).json({ error: '教师 ID 无效' });
    }

    // 改身份（含把教师升为班主任）是全局敏感操作，只有管理员能做。
    // 班主任只能增删本班任课教师，不能改动任何人的身份——否则可以把别人提成班主任来架空自己。
    if (userRole !== 'admin') {
      return res.status(403).json({ error: '只有管理员可以修改教师身份' });
    }

    const targetRole = role === 'head_teacher' ? 'head_teacher' : 'teacher';

    const current = db.prepare(
      `SELECT role FROM class_teachers WHERE class_id = ? AND teacher_id = ?`
    ).get(classId, targetTeacherId);
    if (!current) {
      return res.status(404).json({ error: '该教师不在班级中' });
    }

    // 设为班主任：支持多班主任，只需确认目标教师本身可担任班主任
    if (targetRole === 'head_teacher' && current.role !== 'head_teacher') {
      const teacher = db.prepare(`SELECT id, real_name, username, role, status FROM users WHERE id = ?`).get(targetTeacherId);
      if (!teacher || teacher.role !== 'teacher') {
        return res.status(400).json({ error: '指定的教师不存在' });
      }
      if (teacher.status !== 'active') {
        return res.status(400).json({ error: '该教师未激活，无法设为班主任' });
      }
    }

    const update = db.transaction(() => {
      // 科目：传了就覆盖（传空字符串表示清空），没传则保持原值
      if (subject !== undefined) {
        const targetSubject = String(subject ?? '').trim().slice(0, 20) || null;
        db.prepare('UPDATE class_teachers SET subject = ? WHERE class_id = ? AND teacher_id = ?')
          .run(targetSubject, classId, targetTeacherId);
      }
      db.prepare('UPDATE class_teachers SET role = ? WHERE class_id = ? AND teacher_id = ?')
        .run(targetRole, classId, targetTeacherId);

      // 冗余字段 classes.head_teacher_id（主班主任）必须同步，否则「我的班级」等依赖它的地方会失效
      syncPrimaryHeadTeacher(classId);
    });
    update();

    res.json({
      message: targetRole === 'head_teacher'
        ? `已将教师设为班级「${cls.name}」的班主任`
        : (countHeadTeachers(classId) > 0
          ? `已将教师改为班级「${cls.name}」的任课教师`
          : `已将教师改为班级「${cls.name}」的任课教师，该班已无班主任`),
      role: targetRole,
      head_teacher_count: countHeadTeachers(classId),
    });
  } catch (error) {
    console.error('修改班级教师身份失败:', error);
    res.status(500).json({ error: '修改教师身份失败' });
  }
});

router.get('/class-applications', authenticateToken, (req, res) => {
  try {
    const { class_id, status } = req.query;

    let sql = `
      SELECT ca.*, u.username, u.real_name, u.email, c.name as class_name
      FROM class_applications ca
      JOIN users u ON ca.user_id = u.id
      JOIN classes c ON ca.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // 权限检查：班主任只能查看本班申请
    if (req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`
        SELECT class_id FROM class_teachers WHERE teacher_id = ? AND role = 'head_teacher'
      `).all(req.user.userId);
      if (teacherClasses.length === 0) {
        return res.status(403).json({ error: '只有班主任才能审批申请' });
      }
      const classIds = teacherClasses.map(tc => tc.class_id);
      if (class_id) {
        if (!classIds.includes(parseInt(class_id))) {
          return res.status(403).json({ error: '只能查看本班的申请' });
        }
        sql += ` AND ca.class_id = ?`;
        params.push(parseInt(class_id));
      } else {
        sql += ` AND ca.class_id IN (${classIds.map(() => '?').join(',')})`;
        params.push(...classIds);
      }
    } else if (req.user.role === 'student') {
      return res.status(403).json({ error: '学生无法查看申请列表' });
    } else if (req.user.role === 'admin') {
      if (class_id) {
        sql += ` AND ca.class_id = ?`;
        params.push(parseInt(class_id));
      }
    }

    if (status) {
      sql += ` AND ca.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY ca.created_at DESC`;

    const applications = db.prepare(sql).all(...params);
    res.json({ applications });
  } catch (error) {
    console.error('获取申请列表失败:', error);
    res.status(500).json({ error: '获取申请列表失败' });
  }
});

router.put('/class-applications/:id/review', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: '无效的审批状态' });
    }

    // 获取申请信息
    const application = db.prepare(`
      SELECT ca.*, c.teacher_id as head_teacher_id
      FROM class_applications ca
      JOIN classes c ON ca.class_id = c.id
      WHERE ca.id = ?
    `).get(id);

    if (!application) {
      return res.status(404).json({ error: '申请不存在' });
    }

    // 权限检查：只有班主任或管理员可以审批
    if (req.user.role === 'teacher') {
      const isHeadTeacher = db.prepare(`
        SELECT id FROM class_teachers
        WHERE class_id = ? AND teacher_id = ? AND role = 'head_teacher'
      `).get(application.class_id, req.user.userId);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任才能审批申请' });
      }
    } else if (req.user.role === 'student') {
      return res.status(403).json({ error: '学生无法审批申请' });
    }

    // 审批：通过与拒绝都走统一的"申请落地"逻辑（内部含班主任唯一性等校验）
    const runApproval = db.transaction(() => {
      if (status === 'approved') {
        const result = applyApplicationToClass(application, req.user.userId);
        if (!result.ok) {
          throw new Error(result.reason);
        }
        return result;
      }
      db.prepare(`
        UPDATE class_applications
        SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, req.user.userId, id);
      return null;
    });

    let applied = null;
    try {
      applied = runApproval();
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    res.json({
      message: status === 'approved'
        ? `已批准申请${applied?.className ? `，已加入班级「${applied.className}」` : ''}`
        : '已拒绝申请',
    });
  } catch (error) {
    console.error('审批申请失败:', error);
    res.status(500).json({ error: '审批申请失败' });
  }
});

router.post('/classes', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, grade, teacher_id, school_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: '班级名称不能为空' });
    }

    if (teacher_id) {
      const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher' AND status = 'active'`).get(teacher_id);
      if (!teacher) {
        return res.status(400).json({ error: '指定的教师不存在或未激活' });
      }
    }

    if (!school_id) {
      return res.status(400).json({ error: '请选择所属学校' });
    }
    const school = db.prepare(`SELECT id FROM schools WHERE id = ?`).get(school_id);
    if (!school) {
      return res.status(400).json({ error: '指定的学校不存在' });
    }

    const result = db.prepare(`
      INSERT INTO classes (name, grade, slug, teacher_id, school_id, student_count, total_exp, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now'))
    `).run(
      name,
      grade || null,
      // 班级 slug 是学生进入工作台的唯一地址（/c/<slug>/app），不能为空
      generateClassSlug(name, (candidate) => !!db.prepare('SELECT 1 FROM classes WHERE slug = ?').get(candidate)),
      teacher_id || null,
      school_id
    );

    const classId = result.lastInsertRowid;

    // 指定了教师时同步建立班级归属关系，保证「谁是这个班的班主任」可追溯
    if (teacher_id) {
      db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'head_teacher')`)
        .run(classId, teacher_id);
      syncPrimaryHeadTeacher(classId);
    }

    res.json({ message: '班级创建成功', class_id: classId });
  } catch (error) {
    console.error('创建班级失败:', error);
    res.status(500).json({ error: '创建班级失败' });
  }
});

router.put('/classes/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, grade, teacher_id, description, is_public, cover_image, slug, school_id } = req.body;

    const cls = db.prepare(`SELECT id FROM classes WHERE id = ?`).get(id);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }

    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (grade !== undefined) { updates.push('grade = ?'); params.push(grade); }
    if (teacher_id !== undefined) {
      if (teacher_id) {
        const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher' AND status = 'active'`).get(teacher_id);
        if (!teacher) {
          return res.status(400).json({ error: '指定的教师不存在或未激活' });
        }
      }
      updates.push('teacher_id = ?');
      params.push(teacher_id || null);
    }
    if (description !== undefined) { updates.push('description = ?'); params.push(description || null); }
    if (is_public !== undefined) { updates.push('is_public = ?'); params.push(is_public ? 1 : 0); }
    if (cover_image !== undefined) { updates.push('cover_image = ?'); params.push(cover_image || null); }
    if (slug !== undefined) {
      const s = String(slug || '').trim();
      if (!isValidSlug(s)) {
        return res.status(400).json({ error: 'slug 需 3-64 位中文/字母/数字/连字符，且首尾为中文、字母或数字' });
      }
      const dup = db.prepare(`SELECT id FROM classes WHERE slug = ? AND id <> ?`).get(s, id);
      if (dup) return res.status(400).json({ error: '该 slug 已被占用' });
      updates.push('slug = ?'); params.push(s);
    }
    if (school_id !== undefined) {
      if (school_id) {
        const school = db.prepare(`SELECT id FROM schools WHERE id = ?`).get(school_id);
        if (!school) return res.status(400).json({ error: '指定的学校不存在' });
      }
      updates.push('school_id = ?'); params.push(school_id || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }

    params.push(id);
    db.prepare(`UPDATE classes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: '班级信息更新成功' });
  } catch (error) {
    console.error('更新班级信息失败:', error);
    res.status(500).json({ error: '更新班级信息失败' });
  }
});

router.delete('/classes/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    
    const cls = db.prepare(`SELECT id, student_count FROM classes WHERE id = ?`).get(id);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }
    
    if (cls.student_count > 0) {
      return res.status(400).json({ error: '班级中还有学生，无法删除' });
    }
    
    // 清理关联记录，避免外键约束失败
    db.prepare(`DELETE FROM class_applications WHERE class_id = ?`).run(id);
    db.prepare(`DELETE FROM class_teachers WHERE class_id = ?`).run(id);
    db.prepare(`DELETE FROM class_invitations WHERE class_id = ?`).run(id);
    db.prepare(`UPDATE users SET class_id = NULL WHERE class_id = ?`).run(id);
    db.prepare(`UPDATE classes SET teacher_id = NULL, head_teacher_id = NULL WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM classes WHERE id = ?`).run(id);
    res.json({ message: '班级已删除' });
  } catch (error) {
    console.error('删除班级失败:', error);
    res.status(500).json({ error: '删除班级失败' });
  }
});

router.get('/classes/:id/teacher-activity', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.id, 10);
    if (!classId) return res.status(400).json({ error: '班级 ID 无效' });
    const userId = req.user.userId;
    const userRole = req.user.role;

    // 权限检查：班主任或管理员
    if (userRole === 'teacher') {
      const isHeadTeacher = db.prepare(`
        SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'
      `).get(userId, classId);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '需要班主任权限' });
      }
    } else if (userRole !== 'admin') {
      return res.status(403).json({ error: '权限不足' });
    }

    // 班级基本信息
    const classInfo = db.prepare(`SELECT id, name, grade, student_count FROM classes WHERE id = ?`).get(classId);
    if (!classInfo) {
      return res.status(404).json({ error: '班级不存在' });
    }

    // 任课老师列表及其教学数据
    let teachers = [];
    try {
      teachers = db.prepare(`
        SELECT
          u.id as teacher_id,
          u.username,
          u.real_name,
          u.avatar,
          ct.role as class_role,
          COUNT(DISTINCT a.id) as total_assignments,
          COUNT(DISTINCT CASE WHEN a.created_at >= DATE('now', '-30 days', 'localtime') THEN a.id END) as recent_assignments,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id IN (SELECT id FROM assignments WHERE teacher_id = u.id AND class_id = ?)) as total_submissions,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id IN (SELECT id FROM assignments WHERE teacher_id = u.id AND class_id = ?) AND s.status = 'submitted' AND (s.teacher_score IS NULL OR s.review_status = 'pending')) as ungraded_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id IN (SELECT id FROM assignments WHERE teacher_id = u.id AND class_id = ?) AND s.submitted_at >= DATE('now', '-7 days', 'localtime')) as recent_submissions
        FROM class_teachers ct
        JOIN users u ON ct.teacher_id = u.id
        LEFT JOIN assignments a ON a.teacher_id = u.id AND a.class_id = ?
        WHERE ct.class_id = ? AND u.status = 'active'
        GROUP BY u.id
        ORDER BY total_assignments DESC
      `).all(classId, classId, classId, classId, classId);
    } catch (e) {
      console.error('获取任课老师数据失败:', e);
    }

    // 各科成绩对比
    let subjectStats = [];
    try {
      subjectStats = db.prepare(`
        SELECT
          a.subject,
          COUNT(DISTINCT a.id) as assignment_count,
          COUNT(DISTINCT s.user_id) as active_students,
          ROUND(AVG(CASE WHEN s.total_score IS NOT NULL AND s.total_max_score > 0 THEN s.total_score * 100.0 / s.total_max_score END), 1) as avg_accuracy,
          ROUND(AVG(CASE WHEN s.total_score IS NOT NULL THEN s.total_score END), 1) as avg_score
        FROM assignments a
        LEFT JOIN submissions s ON s.assignment_id = a.id
        WHERE a.class_id = ? AND a.subject IS NOT NULL AND a.subject != ''
        GROUP BY a.subject
        ORDER BY assignment_count DESC
      `).all(classId);
    } catch (e) { /* assignments/submissions may not exist */ }

    // 学生薄弱情况（正确率低于60%的知识点数）
    let strugglingStudents = [];
    try {
      strugglingStudents = db.prepare(`
        SELECT
          u.id as user_id,
          u.username,
          u.real_name,
          u.avatar,
          COUNT(DISTINCT CASE WHEN kps.accuracy < 60 THEN kps.knowledge_point END) as weak_kp_count,
          COUNT(DISTINCT kps.knowledge_point) as total_kp_count,
          ROUND(AVG(kps.accuracy), 1) as avg_accuracy
        FROM users u
        LEFT JOIN knowledge_point_stats kps ON kps.user_id = u.id AND kps.date >= DATE('now', '-30 days', 'localtime')
        WHERE u.role = 'student' AND u.class_id = ?
        GROUP BY u.id
        HAVING weak_kp_count > 0 OR total_kp_count = 0
        ORDER BY weak_kp_count DESC
        LIMIT 10
      `).all(classId);
    } catch (e) { /* knowledge_point_stats may not exist */ }

    // 不活跃学生（7天内无活动）
    let inactiveStudents = [];
    try {
      inactiveStudents = db.prepare(`
        SELECT u.id, u.username, u.real_name, u.avatar, u.last_login
        FROM users u
        WHERE u.role = 'student' AND u.class_id = ?
          AND (u.last_login IS NULL OR u.last_login < DATE('now', '-7 days', 'localtime'))
        ORDER BY u.last_login ASC
        LIMIT 10
      `).all(classId);
    } catch (e) { /* users may not have last_login */ }

    // 待处理入学申请
    let pendingApps = 0;
    try {
      pendingApps = db.prepare(`SELECT COUNT(*) as count FROM class_applications WHERE class_id = ? AND status = 'pending'`).get(classId).count;
    } catch (e) { /* class_applications may not exist */ }

    // 最近提交的作业（实时动态）
    let recentSubmissions = [];
    try {
      recentSubmissions = db.prepare(`
        SELECT s.id, s.total_score, s.total_max_score, s.submitted_at,
               COALESCE(u.real_name, u.username) as student_name,
               a.title as assignment_title, a.subject
        FROM submissions s
        JOIN users u ON s.user_id = u.id
        JOIN assignments a ON s.assignment_id = a.id
        WHERE a.class_id = ?
        ORDER BY s.submitted_at DESC
        LIMIT 10
      `).all(classId);
    } catch (e) { /* submissions may not exist */ }

    res.json({
      class_info: classInfo,
      teachers,
      subject_stats: subjectStats,
      struggling_students: strugglingStudents,
      inactive_students: inactiveStudents,
      pending_applications: pendingApps,
      recent_submissions: recentSubmissions
    });
  } catch (error) {
    console.error('获取班级教学数据失败:', error);
    res.status(500).json({ error: '获取班级教学数据失败' });
  }
});

module.exports = router;
