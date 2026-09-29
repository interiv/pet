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
    res.json({ teachers });
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
    const { username, password, email, real_name, class_id, class_ids, teacher_identity } = req.body;
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

    // 指定班级时的校验（支持多班级：任课教师可多选，班主任只能一个班）
    const identity = teacher_identity === 'head_teacher' ? 'head_teacher' : 'teacher';
    let targetClassIds = Array.isArray(class_ids) && class_ids.length > 0
      ? class_ids
      : (class_id ? [class_id] : []);
    targetClassIds = [...new Set(targetClassIds.map((v) => parseInt(v)).filter((n) => Number.isFinite(n)))];

    if (identity === 'head_teacher' && targetClassIds.length > 1) {
      return res.status(400).json({ error: '班主任只能分配一个班级' });
    }

    const targetClasses = [];
    for (const cid of targetClassIds) {
      const cls = db.prepare('SELECT id, name, head_teacher_id FROM classes WHERE id = ?').get(cid);
      if (!cls) {
        return res.status(400).json({ error: `班级 ID ${cid} 不存在` });
      }
      if (identity === 'head_teacher') {
        const hasHeadTeacher = cls.head_teacher_id
          || db.prepare(`SELECT 1 FROM class_teachers WHERE class_id = ? AND role = 'head_teacher'`).get(cid);
        if (hasHeadTeacher) {
          return res.status(400).json({ error: `班级「${cls.name}」已有班主任，无法再指定班主任` });
        }
      }
      targetClasses.push(cls);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // 创建账号 + 班级归属（同一事务）
    const createTeacher = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, email, real_name, role, status, created_at)
        VALUES (?, ?, ?, ?, 'teacher', 'active', datetime('now'))
      `).run(String(username).trim(), passwordHash, email || null, realName);

      const teacherId = result.lastInsertRowid;

      for (const cls of targetClasses) {
        if (identity === 'head_teacher') {
          db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'head_teacher')`)
            .run(cls.id, teacherId);
          db.prepare('UPDATE classes SET head_teacher_id = ? WHERE id = ?').run(teacherId, cls.id);
        } else {
          db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'teacher')`)
            .run(cls.id, teacherId);
        }
      }

      return teacherId;
    });

    const teacherId = createTeacher();

    const classNames = targetClasses.map((c) => c.name);
    res.json({
      message: targetClasses.length > 0
        ? `教师创建成功，已${identity === 'head_teacher' ? '设为班主任' : '加入'}：${classNames.map((n) => `「${n}」`).join('、')}`
        : '教师创建成功',
      teacher_id: teacherId,
      class_ids: targetClasses.map((c) => c.id),
      class_names: classNames,
      class_id: targetClasses.length === 1 ? targetClasses[0].id : null,
      teacher_identity: targetClasses.length > 0 ? identity : null
    });
  } catch (error) {
    console.error('创建教师失败:', error);
    res.status(500).json({ error: '创建教师失败' });
  }
});

router.put('/teachers/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, avatar, status, real_name } = req.body;
    
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
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: '教师信息更新成功' });
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
