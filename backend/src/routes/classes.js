const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const crypto = require('crypto');

// 生成推荐码
function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

router.get('/public-list', (req, res) => {
  try {
    const classes = db.prepare(`
      SELECT c.id, c.name, c.grade, c.slug, c.school_id,
        s.name AS school_name,
        (SELECT COUNT(*) FROM users WHERE class_id = c.id AND role = 'student') as student_count
      FROM classes c
      LEFT JOIN schools s ON c.school_id = s.id
      WHERE COALESCE(c.is_public, 1) = 1
      ORDER BY c.created_at DESC
    `).all();
    res.json({ classes });
  } catch (error) {
    console.error('获取公开班级列表失败:', error);
    res.status(500).json({ error: '获取班级列表失败' });
  }
});

// 通过 slug 获取班级公开主页信息（未登录也可访问，若 is_public=0 则 404）
router.get('/by-slug/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const cls = db.prepare(`
      SELECT c.id, c.name, c.grade, c.slug, c.description, c.cover_image,
             c.is_public, c.school_id, c.created_at, c.head_teacher_id,
             s.name AS school_name, s.theme_color AS school_theme,
             u.username AS head_teacher_name, u.avatar AS head_teacher_avatar,
             (SELECT COUNT(*) FROM users WHERE class_id = c.id AND role = 'student') AS student_count,
             (SELECT COUNT(*) FROM class_teachers WHERE class_id = c.id) AS teacher_count
      FROM classes c
      LEFT JOIN schools s ON c.school_id = s.id
      LEFT JOIN users u ON c.head_teacher_id = u.id
      WHERE c.slug = ?
    `).get(slug);

    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (!cls.is_public) return res.status(404).json({ error: '班级不存在或未公开' });

    // 公开 BOSS 进度（如有）
    const activeBoss = db.prepare(`
      SELECT id, boss_name, boss_icon, boss_max_hp, started_at
      FROM boss_battles WHERE class_id = ? AND status = 'active' LIMIT 1
    `).get(cls.id);
    let bossProgress = null;
    if (activeBoss) {
      const totalDamage = db.prepare(`
        SELECT COALESCE(SUM(damage_dealt), 0) AS total FROM boss_battle_participants WHERE boss_battle_id = ?
      `).get(activeBoss.id).total || 0;
      bossProgress = {
        ...activeBoss,
        total_damage: totalDamage,
        progress: Math.min(100, Math.round((totalDamage / activeBoss.boss_max_hp) * 100))
      };
    }

    // 一个有效的公开邀请码（若存在）
    const publicInvite = db.prepare(`
      SELECT invitation_code FROM class_invitations
      WHERE class_id = ? AND is_active = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        AND (max_uses IS NULL OR used_count < max_uses)
      ORDER BY created_at DESC LIMIT 1
    `).get(cls.id);

    res.json({
      class: cls,
      active_boss: bossProgress,
      public_invitation_code: publicInvite ? publicInvite.invitation_code : null
    });
  } catch (error) {
    console.error('获取班级公开主页失败:', error);
    res.status(500).json({ error: '获取班级公开主页失败' });
  }
});

// 班级主页聚合数据（登录 + 本班成员可用）
router.get('/:id/home-summary', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.id, 10);
    if (!classId) return res.status(400).json({ error: '班级 ID 无效' });

    // 权限：班级成员或管理员
    if (req.user.role !== 'admin') {
      const asStudent = db.prepare(`SELECT 1 FROM users WHERE id = ? AND class_id = ?`).get(req.user.userId, classId);
      const asTeacher = db.prepare(`SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`).get(req.user.userId, classId);
      if (!asStudent && !asTeacher) {
        return res.status(403).json({ error: '无权访问该班级' });
      }
    }

    const cls = db.prepare(`
      SELECT c.id, c.name, c.grade, c.slug, c.description, c.cover_image, c.is_public,
             c.school_id, u.username AS head_teacher_name, u.id AS head_teacher_id,
             s.name AS school_name, s.theme_color AS school_theme
      FROM classes c
      LEFT JOIN users u ON c.head_teacher_id = u.id
      LEFT JOIN schools s ON c.school_id = s.id
      WHERE c.id = ?
    `).get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    const studentCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE class_id = ? AND role = 'student'`).get(classId).c;
    const teachers = db.prepare(`
      SELECT u.id, u.username, u.avatar, ct.role
      FROM class_teachers ct JOIN users u ON ct.teacher_id = u.id
      WHERE ct.class_id = ?
      ORDER BY CASE ct.role WHEN 'head_teacher' THEN 0 ELSE 1 END, ct.created_at ASC
    `).all(classId);

    // Top10 班级等级榜
    const topPets = db.prepare(`
      SELECT p.id, p.name, p.level, p.exp, ps.name AS species_name, ps.image_urls,
             u.username AS owner_name, u.id AS user_id
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      WHERE u.class_id = ? AND u.role = 'student'
      ORDER BY p.level DESC, p.exp DESC
      LIMIT 10
    `).all(classId);

    // 最新公告
    let announcements = [];
    try {
      announcements = db.prepare(`
        SELECT id, title, content, priority, created_at
        FROM announcements WHERE class_id = ?
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY priority DESC, created_at DESC LIMIT 5
      `).all(classId);
    } catch (e) { /* 表或字段不存在时容错 */ }

    // 当前 BOSS
    let activeBoss = null;
    try {
      activeBoss = db.prepare(`
        SELECT id, boss_name, boss_icon, boss_max_hp, boss_level, knowledge_point, started_at, expires_at
        FROM boss_battles WHERE class_id = ? AND status = 'active' LIMIT 1
      `).get(classId);
      if (activeBoss) {
        const totalDamage = db.prepare(`
          SELECT COALESCE(SUM(damage_dealt), 0) AS total FROM boss_battle_participants WHERE boss_battle_id = ?
        `).get(activeBoss.id).total || 0;
        activeBoss.total_damage = totalDamage;
        activeBoss.progress = Math.min(100, Math.round((totalDamage / activeBoss.boss_max_hp) * 100));
      }
    } catch (e) { /* 容错 */ }

    // 最新动态
    let recentPosts = [];
    try {
      recentPosts = db.prepare(`
        SELECT p.id, p.content, p.created_at, u.username, u.avatar
        FROM posts p JOIN users u ON p.user_id = u.id
        WHERE p.class_id = ?
        ORDER BY p.created_at DESC LIMIT 5
      `).all(classId);
    } catch (e) { /* 容错 */ }

    res.json({
      class: cls,
      student_count: studentCount,
      teachers,
      top_pets: topPets,
      announcements,
      active_boss: activeBoss,
      recent_posts: recentPosts
    });
  } catch (error) {
    console.error('获取班级主页聚合失败:', error);
    res.status(500).json({ error: '获取班级主页数据失败' });
  }
});

// 班主任自定义 slug（班级短标识）
router.put('/:id/slug', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.id, 10);
    if (!classId) return res.status(400).json({ error: '班级 ID 无效' });
    const { slug } = req.body || {};
    const s = String(slug || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{2,31}$/i.test(s)) {
      return res.status(400).json({ error: 'slug 需 3-32 位字母/数字/连字符，且首字符为字母或数字' });
    }
    if (req.user.role !== 'admin') {
      const row = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
      ).get(req.user.userId, classId);
      if (!row) return res.status(403).json({ error: '仅班主任可修改班级标识' });
    }
    const exists = db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId);
    if (!exists) return res.status(404).json({ error: '班级不存在' });
    const dup = db.prepare(`SELECT id FROM classes WHERE slug = ? AND id <> ?`).get(s, classId);
    if (dup) return res.status(400).json({ error: '该 slug 已被占用' });
    db.prepare(`UPDATE classes SET slug = ? WHERE id = ?`).run(s, classId);
    res.json({ message: '班级标识更新成功', slug: s });
  } catch (error) {
    console.error('更新班级 slug 失败:', error);
    res.status(500).json({ error: '更新班级标识失败' });
  }
});

// 班级基础设置（班主任可改）：description、cover_image、is_public
router.put('/:id/settings', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.id, 10);
    if (!classId) return res.status(400).json({ error: '班级 ID 无效' });
    if (req.user.role !== 'admin') {
      const row = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
      ).get(req.user.userId, classId);
      if (!row) return res.status(403).json({ error: '仅班主任可修改班级设置' });
    }
    const { description, cover_image, is_public } = req.body || {};
    const fields = [];
    const values = [];
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (cover_image !== undefined) { fields.push('cover_image = ?'); values.push(cover_image); }
    if (is_public !== undefined) { fields.push('is_public = ?'); values.push(is_public ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ error: '没有要更新的字段' });
    values.push(classId);
    db.prepare(`UPDATE classes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ message: '更新成功' });
  } catch (error) {
    console.error('更新班级设置失败:', error);
    res.status(500).json({ error: '更新班级设置失败' });
  }
});

// 教师创建班级（自动成为班主任）
router.post('/create', authenticateToken, (req, res) => {
  try {
    const { name, grade } = req.body;
    const teacherId = req.user.userId;
    const userRole = req.user.role;

    // 验证权限：只有教师可以创建班级
    if (userRole !== 'teacher' && userRole !== 'admin') {
      return res.status(403).json({ error: '只有教师可以创建班级' });
    }

    if (!name) {
      return res.status(400).json({ error: '班级名称不能为空' });
    }

    // 检查教师是否已经是某个班级的班主任
    const existingHeadTeacher = db.prepare(
      'SELECT id FROM classes WHERE head_teacher_id = ?'
    ).get(teacherId);

    if (existingHeadTeacher) {
      return res.status(400).json({ 
        error: '您已经是另一个班级的班主任，无法创建更多班级' 
      });
    }

    // 创建班级，教师自动成为班主任
    const result = db.prepare(`
      INSERT INTO classes (name, grade, head_teacher_id, student_count, total_exp, created_at)
      VALUES (?, ?, ?, 0, 0, datetime('now'))
    `).run(name, grade || null, teacherId);

    const classId = result.lastInsertRowid;

    // 将教师添加到 class_teachers 表
    db.prepare(`
      INSERT INTO class_teachers (class_id, teacher_id, role)
      VALUES (?, ?, 'head_teacher')
    `).run(classId, teacherId);

    // 自动生成一个推荐码
    const inviteCode = generateInviteCode();
    db.prepare(`
      INSERT INTO class_invitations (class_id, invitation_code, created_by, role_filter, is_active)
      VALUES (?, ?, ?, 'any', 1)
    `).run(classId, inviteCode, teacherId);

    res.json({ 
      message: '班级创建成功', 
      class_id: classId,
      invitation_code: inviteCode,
      invitation_link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/register?invite=${inviteCode}`
    });
  } catch (error) {
    console.error('创建班级失败:', error);
    res.status(500).json({ error: '创建班级失败' });
  }
});

// 生成邀请码
router.post('/:classId/invitations', authenticateToken, (req, res) => {
  try {
    const { classId } = req.params;
    const { role_filter, max_uses, expires_at } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // 验证班级是否存在
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }

    // 验证权限：只有班主任或管理员可以生成邀请码
    if (userRole !== 'admin') {
      const isHeadTeacher = db.prepare(
        `SELECT 1 FROM class_teachers WHERE class_id = ? AND teacher_id = ? AND role = 'head_teacher'`
      ).get(classId, userId);

      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任可以生成邀请码' });
      }
    }

    // 生成邀请码
    const inviteCode = generateInviteCode();
    
    const result = db.prepare(`
      INSERT INTO class_invitations (class_id, invitation_code, created_by, role_filter, max_uses, expires_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(classId, inviteCode, userId, role_filter || 'any', max_uses || null, expires_at || null);

    res.json({ 
      message: '邀请码生成成功',
      invitation_code: inviteCode,
      invitation_id: result.lastInsertRowid
    });
  } catch (error) {
    console.error('生成邀请码失败:', error);
    res.status(500).json({ error: '生成邀请码失败' });
  }
});

// 获取班级的邀请码列表
router.get('/:classId/invitations', authenticateToken, (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // 验证班级是否存在
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }

    // 验证权限：只有班主任、班级教师或管理员可以查看
    if (userRole !== 'admin') {
      const isTeacher = db.prepare(
        'SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ?'
      ).get(classId, userId);

      if (!isTeacher) {
        return res.status(403).json({ error: '无权查看该班级的邀请码' });
      }
    }

    const invitations = db.prepare(`
      SELECT * FROM class_invitations 
      WHERE class_id = ? 
      ORDER BY created_at DESC
    `).all(classId);

    res.json({ invitations });
  } catch (error) {
    console.error('获取邀请码列表失败:', error);
    res.status(500).json({ error: '获取邀请码列表失败' });
  }
});

// 禁用/启用邀请码
router.put('/invitations/:invitationId/toggle', authenticateToken, (req, res) => {
  try {
    const { invitationId } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const invitation = db.prepare(
      'SELECT * FROM class_invitations WHERE id = ?'
    ).get(invitationId);

    if (!invitation) {
      return res.status(404).json({ error: '邀请码不存在' });
    }

    // 验证权限
    if (userRole !== 'admin') {
      const isHeadTeacher = db.prepare(
        `SELECT 1 FROM class_teachers WHERE class_id = ? AND teacher_id = ? AND role = 'head_teacher'`
      ).get(invitation.class_id, userId);

      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任可以管理邀请码' });
      }
    }

    const newStatus = invitation.is_active ? 0 : 1;
    db.prepare(
      'UPDATE class_invitations SET is_active = ? WHERE id = ?'
    ).run(newStatus, invitationId);

    res.json({ 
      message: newStatus ? '邀请码已启用' : '邀请码已禁用',
      is_active: newStatus
    });
  } catch (error) {
    console.error('更新邀请码状态失败:', error);
    res.status(500).json({ error: '更新邀请码状态失败' });
  }
});

// 验证邀请码
router.post('/invitations/validate', (req, res) => {
  try {
    const { invitation_code } = req.body;

    if (!invitation_code) {
      return res.status(400).json({ error: '请提供邀请码' });
    }

    const invitation = db.prepare(`
      SELECT ci.*, c.name as class_name, c.grade, u.username as creator_name
      FROM class_invitations ci
      JOIN classes c ON ci.class_id = c.id
      JOIN users u ON ci.created_by = u.id
      WHERE ci.invitation_code = ?
    `).get(invitation_code);

    if (!invitation) {
      return res.status(404).json({ error: '邀请码不存在' });
    }

    // 检查是否启用
    if (!invitation.is_active) {
      return res.status(400).json({ error: '该邀请码已禁用' });
    }

    // 检查是否过期
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ error: '该邀请码已过期' });
    }

    // 检查使用次数
    if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
      return res.status(400).json({ error: '该邀请码已达到使用次数上限' });
    }

    res.json({
      valid: true,
      class_id: invitation.class_id,
      class_name: invitation.class_name,
      grade: invitation.grade,
      role_filter: invitation.role_filter,
      creator_name: invitation.creator_name
    });
  } catch (error) {
    console.error('验证邀请码失败:', error);
    res.status(500).json({ error: '验证邀请码失败' });
  }
});

// 通过邀请码注册（新用户）
router.post('/register-with-invite', async (req, res) => {
  try {
    const { username, password, email, role, invitation_code } = req.body;

    // 验证必填字段
    if (!username || !password || !invitation_code) {
      return res.status(400).json({ error: '用户名、密码和邀请码为必填项' });
    }

    // 检查用户名是否已存在
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 验证邀请码
    const invitation = db.prepare(`
      SELECT * FROM class_invitations 
      WHERE invitation_code = ? AND is_active = 1
    `).get(invitation_code);

    if (!invitation) {
      return res.status(400).json({ error: '邀请码无效' });
    }

    // 检查是否过期
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ error: '邀请码已过期' });
    }

    // 检查使用次数
    if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
      return res.status(400).json({ error: '邀请码已达到使用次数上限' });
    }

    // 检查角色限制
    if (invitation.role_filter !== 'any' && role !== invitation.role_filter) {
      return res.status(400).json({ 
        error: `该邀请码仅适用于${invitation.role_filter === 'student' ? '学生' : '教师'}` 
      });
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(password, 10);

    // 插入新用户
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, email, role, class_id, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(username, passwordHash, email, role || 'student', invitation.class_id);

    const userId = result.lastInsertRowid;

    // 如果是学生，更新班级学生数
    if (role === 'student') {
      db.prepare(
        'UPDATE classes SET student_count = student_count + 1 WHERE id = ?'
      ).run(invitation.class_id);
    }

    // 如果是教师，添加到 class_teachers 表
    if (role === 'teacher') {
      db.prepare(`
        INSERT INTO class_teachers (class_id, teacher_id, role)
        VALUES (?, ?, 'teacher')
      `).run(invitation.class_id, userId);
    }

    // 更新邀请码使用次数
    db.prepare(
      'UPDATE class_invitations SET used_count = used_count + 1 WHERE id = ?'
    ).run(invitation.id);

    // 生成 JWT token
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const token = jwt.sign(
      { userId, username, role: role || 'student' },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: '注册成功并已加入班级',
      token,
      user: {
        id: userId,
        username,
        email,
        role: role || 'student',
        class_id: invitation.class_id
      }
    });
  } catch (error) {
    console.error('邀请注册失败:', error);
    res.status(500).json({ error: '注册失败' });
  }
});

// 已注册用户通过邀请码加入班级
router.post('/join-with-invite', authenticateToken, (req, res) => {
  try {
    const { invitation_code } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (!invitation_code) {
      return res.status(400).json({ error: '请提供邀请码' });
    }

    // 验证邀请码
    const invitation = db.prepare(`
      SELECT * FROM class_invitations 
      WHERE invitation_code = ? AND is_active = 1
    `).get(invitation_code);

    if (!invitation) {
      return res.status(400).json({ error: '邀请码无效' });
    }

    // 检查是否过期
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return res.status(400).json({ error: '邀请码已过期' });
    }

    // 检查使用次数
    if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
      return res.status(400).json({ error: '邀请码已达到使用次数上限' });
    }

    // 检查角色限制
    if (invitation.role_filter !== 'any' && userRole !== invitation.role_filter) {
      return res.status(400).json({ 
        error: `该邀请码仅适用于${invitation.role_filter === 'student' ? '学生' : '教师'}` 
      });
    }

    // 检查用户是否已经在班级中
    const user = db.prepare('SELECT class_id FROM users WHERE id = ?').get(userId);
    if (user.class_id === invitation.class_id) {
      return res.status(400).json({ error: '您已经在该班级中' });
    }

    // 更新用户的班级
    db.prepare(
      'UPDATE users SET class_id = ? WHERE id = ?'
    ).run(invitation.class_id, userId);

    // 如果是学生，更新班级学生数
    if (userRole === 'student' && (!user.class_id || user.class_id === 0)) {
      db.prepare(
        'UPDATE classes SET student_count = student_count + 1 WHERE id = ?'
      ).run(invitation.class_id);
    }

    // 如果是教师，添加到 class_teachers 表
    if (userRole === 'teacher') {
      const existingTeacher = db.prepare(
        'SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ?'
      ).get(invitation.class_id, userId);

      if (!existingTeacher) {
        db.prepare(`
          INSERT INTO class_teachers (class_id, teacher_id, role)
          VALUES (?, ?, 'teacher')
        `).run(invitation.class_id, userId);
      }
    }

    // 更新邀请码使用次数
    db.prepare(
      'UPDATE class_invitations SET used_count = used_count + 1 WHERE id = ?'
    ).run(invitation.id);

    res.json({
      message: '成功加入班级',
      class_id: invitation.class_id
    });
  } catch (error) {
    console.error('加入班级失败:', error);
    res.status(500).json({ error: '加入班级失败' });
  }
});

// 获取教师作为班主任的班级
router.get('/my-class', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole !== 'teacher' && userRole !== 'admin') {
      return res.status(403).json({ error: '只有教师可以访问' });
    }

    const cls = db.prepare(`
      SELECT c.*, u.username as head_teacher_name
      FROM classes c
      LEFT JOIN users u ON c.head_teacher_id = u.id
      WHERE c.head_teacher_id = ?
    `).get(userId);

    if (!cls) {
      return res.json({ class: null });
    }

    res.json({ class: cls });
  } catch (error) {
    console.error('获取班级信息失败:', error);
    res.status(500).json({ error: '获取班级信息失败' });
  }
});

module.exports = router;
