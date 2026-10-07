const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { getChinaDate } = require('../../config/timezone');
const { getAIConfig, isAIConfigured, getAITimeoutMs } = require('../../config/ai');
const { PROMPTS, SETTING_PREFIX, getPrompt, fillTemplate } = require('../../config/prompts');
const { syncPrimaryHeadTeacher } = require('../../utils/headTeacher');
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

/**
 * 归一化科目：去空格、限长，空值转 NULL
 * 科目是自由文本（学校可能有地方课程），不做白名单限制，只做长度约束。
 */
function normalizeSubject(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return s.slice(0, 20);
}

/**
 * 校验并归一化「任教关系列表」：[{ class_id, role, subject }]
 * 规则：
 *  - 同一个班级只能出现一次（自动去重，保留第一条）
 *  - 班主任支持多对多：一名教师可以同时担任多个班级的班主任，一个班级也可以有多位班主任
 * @returns {{ assignments: {classId:number, role:'teacher'|'head_teacher', subject:string|null}[], classes: any[] }}
 * @throws {Error} 校验失败时抛出，message 为可直接展示给管理员的提示
 */
function resolveTeachingAssignments(rawAssignments) {
  const list = Array.isArray(rawAssignments) ? rawAssignments : [];
  const seen = new Set();
  const assignments = [];

  for (const item of list) {
    const classId = parseInt(item && (item.class_id ?? item.classId), 10);
    if (!Number.isFinite(classId)) continue;
    if (seen.has(classId)) continue;
    seen.add(classId);
    assignments.push({
      classId,
      role: item.role === 'head_teacher' ? 'head_teacher' : 'teacher',
      subject: normalizeSubject(item && (item.subject ?? item.subject_name)),
    });
  }

  const classes = [];
  for (const a of assignments) {
    const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(a.classId);
    if (!cls) throw new Error(`班级 ID ${a.classId} 不存在`);
    classes.push(cls);
  }

  return { assignments, classes };
}

/**
 * 覆盖式同步教师的班级归属：先清空旧归属，再按新设置重建
 * （class_teachers 上有 UNIQUE(class_id, teacher_id)，删除后重建最直接）
 */
function syncTeacherClasses(teacherId, assignments) {
  // 记录原先担任班主任的班级，删除归属后需要重新同步主班主任冗余字段
  const affectedClassIds = db.prepare(
    `SELECT DISTINCT class_id FROM class_teachers WHERE teacher_id = ? AND role = 'head_teacher'`
  ).all(teacherId).map((r) => r.class_id);

  db.prepare('DELETE FROM class_teachers WHERE teacher_id = ?').run(teacherId);

  for (const a of assignments) {
    db.prepare('INSERT INTO class_teachers (class_id, teacher_id, role, subject) VALUES (?, ?, ?, ?)')
      .run(a.classId, teacherId, a.role, a.subject || null);
  }

  // classes.head_teacher_id 是「主班主任」冗余字段，删改班主任后必须重算
  const touched = new Set([...affectedClassIds, ...assignments.map((a) => a.classId)]);
  for (const classId of touched) syncPrimaryHeadTeacher(classId);
}

/** 把任教关系列表拼成可读文案 */
function describeAssignments(assignments, classes) {
  const parts = assignments.map((a) => {
    const cls = classes.find((c) => c.id === a.classId);
    const roleText = a.role === 'head_teacher' ? '班主任' : '课教师';
    return `「${cls ? cls.name : a.classId}」任${roleText}${a.subject ? `（${a.subject}）` : ''}`;
  });
  return parts.length > 0 ? parts.join('、') : '未分配任何班级';
}

router.get('/teachers', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权访问教师列表' });
    }
    const { status, search } = req.query;
    let sql = `SELECT id, username, real_name, email, avatar, created_at, last_login, status FROM users WHERE role = 'teacher'`;
    const params = [];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (search) {
      sql += ` AND (username LIKE ? OR email LIKE ? OR real_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY created_at DESC`;

    const teachers = db.prepare(sql).all(...params);

    //附带每个教师所在的班级与身份（班主任 / 任课教师），供列表展示与编辑
    const classStmt = db.prepare(`
      SELECT c.id, c.name, c.slug, c.grade, ct.role, ct.subject
      FROM class_teachers ct JOIN classes c ON ct.class_id = c.id
      WHERE ct.teacher_id = ?
      ORDER BY CASE ct.role WHEN 'head_teacher' THEN 0 ELSE 1 END, c.created_at DESC
    `);
    const withClasses = teachers.map((t) => {
      const classes = classStmt.all(t.id);
      return {
        ...t,
        classes,
        class_ids: classes.map((c) => c.id),
        // 只要在任意班级担任班主任，身份即为班主任（可同时是多个班的班主任）
        teacher_identity: classes.some((c) => c.role === 'head_teacher') ? 'head_teacher' : 'teacher',
        // 明确列出该教师担任班主任的班级，便于前端展示与筛选
        head_class_ids: classes.filter((c) => c.role === 'head_teacher').map((c) => c.id),
      };
    });

    res.json({ teachers: withClasses });
  } catch (error) {
    console.error('获取教师列表失败:', error);
    res.status(500).json({ error: '获取教师列表失败' });
  }
});

router.get('/pending-teachers', authenticateToken, requireAdmin, (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT id, username, real_name, email, created_at, status 
      FROM users 
      WHERE role = 'teacher' AND status = 'pending_approval'
    `).all();
    res.json({ teachers });
  } catch (error) {
    console.error('获取待审批教师失败:', error);
    res.status(500).json({ error: '获取待审批教师失败' });
  }
});

router.post('/approve-teacher', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { teacher_id, action } = req.body;

    const teacher = db.prepare(`SELECT id, username, real_name FROM users WHERE id = ? AND role = 'teacher'`).get(teacher_id);
    if (!teacher) {
      return res.status(404).json({ error: '教师不存在' });
    }

    if (action === 'approve') {
      const run = db.transaction(() => {
        db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(teacher_id);
        return approveTeacherPendingApplications(teacher_id, req.user.userId);
      });
      const { applied, skipped } = run();

      const parts = [`教师 ${teacher.real_name || teacher.username} 审批通过`];
      if (applied.length > 0) parts.push(`已加入班级：${applied.join('、')}`);
      if (skipped.length > 0) parts.push(`未处理的申请：${skipped.join('；')}`);
      if (applied.length === 0 && skipped.length === 0) parts.push('该教师没有待处理的班级申请');

      res.json({ message: parts.join('，'), applied_classes: applied, skipped });
    } else if (action === 'reject') {
      purgeUserData(teacher_id);
      res.json({ message: '教师注册已拒绝（账号及其申请数据已删除）' });
    } else {
      res.status(400).json({ error: '无效的操作' });
    }
  } catch (error) {
    console.error('审批教师失败:', error);
    res.status(500).json({ error: '审批教师失败' });
  }
});

router.post('/teachers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, email, real_name, class_id, class_ids, teacher_identity, assignments, subject } = req.body;
    // 真实姓名：与登录账号分离（可空，兼容旧版前端）
    const realName = String(real_name || '').trim() || null;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }
    if (String(username).trim().length < 3) {
      return res.status(400).json({ error: '用户名至少 3 个字符' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: '密码至少 6 个字符' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(String(username).trim());
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 指定班级时的校验（支持多班级：班主任与任课教师都可同时带多个班）
    const identity = teacher_identity === 'head_teacher' ? 'head_teacher' : 'teacher';
    const rawClassIds = Array.isArray(class_ids) && class_ids.length > 0
      ? class_ids
      : (class_id ? [class_id] : []);

    // 一行一条任教关系（班级 + 身份 + 科目）优先；没有时退回旧的「班级 + 单一身份」写法
    const rawAssignments = Array.isArray(assignments)
      ? assignments
      : rawClassIds.map((cid) => ({ class_id: cid, role: identity, subject: normalizeSubject(subject) }));

    let resolved;
    try {
      resolved = resolveTeachingAssignments(rawAssignments);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const { assignments: resolvedAssignments, classes: targetClasses } = resolved;

    const passwordHash = await bcrypt.hash(password, 10);

    // 创建账号 + 班级归属（同一事务）
    const createTeacher = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, email, real_name, role, status, created_at)
        VALUES (?, ?, ?, ?, 'teacher', 'active', datetime('now'))
      `).run(String(username).trim(), passwordHash, email || null, realName);

      const teacherId = result.lastInsertRowid;
      syncTeacherClasses(teacherId, resolvedAssignments);
      return teacherId;
    });

    const teacherId = createTeacher();

    const classNames = targetClasses.map((c) => c.name);
    res.json({
      message: resolvedAssignments.length > 0
        ? `教师创建成功，${describeAssignments(resolvedAssignments, targetClasses)}`
        : '教师创建成功',
      teacher_id: teacherId,
      class_ids: resolvedAssignments.map((a) => a.classId),
      class_names: classNames,
      class_id: resolvedAssignments.length === 1 ? resolvedAssignments[0].classId : null,
      teacher_identity: resolvedAssignments.length > 0
        ? (resolvedAssignments.find((a) => a.role === 'head_teacher') ? 'head_teacher' : 'teacher')
        : null
    });
  } catch (error) {
    console.error('创建教师失败:', error);
    res.status(500).json({ error: '创建教师失败' });
  }
});

router.put('/teachers/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, avatar, status, real_name, password, class_id, class_ids, teacher_identity, assignments } = req.body;

    const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher'`).get(id);
    if (!teacher) {
      return res.status(404).json({ error: '教师不存在' });
    }

    const updates = [];
    const params = [];
    if (username !== undefined) {
      const uname = String(username || '').trim();
      if (!uname) {
        return res.status(400).json({ error: '用户名不能为空' });
      }
      // 改名时校验重名（忽略大小写，排除自己）
      const dup = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?').get(uname, id);
      if (dup) {
        return res.status(400).json({ error: '用户名已存在' });
      }
      updates.push('username = ?'); params.push(uname);
    }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    // 真实姓名（与登录账号分离）：传空字符串表示清空
    if (real_name !== undefined) { updates.push('real_name = ?'); params.push(String(real_name || '').trim() || null); }
    // 重置密码（可选）：与学生编辑一致，留空表示不修改
    let passwordChanged = false;
    if (password !== undefined && password !== null && String(password).trim() !== '') {
      const pwd = String(password).trim();
      if (pwd.length < 6) {
        return res.status(400).json({ error: '密码至少 6 位' });
      }
      updates.push('password_hash = ?'); params.push(bcrypt.hashSync(pwd, 10));
      passwordChanged = true;
    }

    // 班级归属 + 身份：覆盖式保存（前端按「一行一条任教关系」提交 assignments）
    const wantsClassUpdate = assignments !== undefined || class_ids !== undefined || class_id !== undefined || teacher_identity !== undefined;
    let resolved = null;
    if (wantsClassUpdate) {
      let raw;
      if (Array.isArray(assignments)) {
        raw = assignments;
      } else {
        // 兼容旧调用方式：class_ids + 单一 teacher_identity（尽量保留已设科目）
        const existingRows = db.prepare('SELECT class_id, role, subject FROM class_teachers WHERE teacher_id = ?').all(id);
        const rawClassIds = class_ids !== undefined
          ? class_ids
          : (class_id !== undefined
            ? (class_id ? [class_id] : [])
            : existingRows.map((r) => r.class_id));

        let identity = teacher_identity;
        if (identity === undefined) {
          const current = db.prepare(`SELECT 1 FROM class_teachers WHERE teacher_id = ? AND role = 'head_teacher'`).get(id);
          identity = current ? 'head_teacher' : 'teacher';
        }
        raw = (Array.isArray(rawClassIds) ? rawClassIds : []).map((cid) => {
          const keep = existingRows.find((r) => Number(r.class_id) === Number(cid));
          return { class_id: cid, role: identity, subject: keep ? keep.subject : undefined };
        });
      }

      try {
        resolved = resolveTeachingAssignments(raw);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }

    if (updates.length === 0 && !resolved) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }

    const save = db.transaction(() => {
      if (updates.length > 0) {
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params, id);
      }
      if (resolved) {
        syncTeacherClasses(id, resolved.assignments);
      }
    });
    save();

    const parts = [];
    if (updates.length > 0 || resolved) parts.push('教师信息更新成功');
    if (passwordChanged) parts.push('密码已重置');
    if (resolved) parts.push(describeAssignments(resolved.assignments, resolved.classes));

    res.json({
      message: parts.join('，'),
      class_ids: resolved ? resolved.assignments.map((a) => a.classId) : undefined,
      teacher_identity: resolved && resolved.assignments.length > 0
        ? (resolved.assignments.find((a) => a.role === 'head_teacher') ? 'head_teacher' : 'teacher')
        : undefined,
    });
  } catch (error) {
    console.error('更新教师信息失败:', error);
    res.status(500).json({ error: '更新教师信息失败' });
  }
});

router.delete('/teachers/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    
    const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher'`).get(id);
    if (!teacher) {
      return res.status(404).json({ error: '教师不存在' });
    }
    
    if (action === 'disable') {
      db.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).run(id);
      res.json({ message: '教师已被禁用' });
    } else if (action === 'delete') {
      purgeUserData(id);
      res.json({ message: '教师已删除' });
    } else {
      res.status(400).json({ error: '无效的操作' });
    }
  } catch (error) {
    console.error('删除/禁用教师失败:', error);
    res.status(500).json({ error: '删除/禁用教师失败' });
  }
});

module.exports = router;
