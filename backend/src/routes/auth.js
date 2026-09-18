const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { checkAndAwardAchievement } = require('./achievements');
const { getChinaDate } = require('../config/timezone');

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const { username, password, email, role = 'student', requested_class_id, requested_class_ids, teacher_type } = req.body;

    // 用户名统一去掉首尾空格，避免 " abc" 与 "abc" 被当作两个账号
    const uname = String(username || '').trim();

    // 验证必填字段
    if (!uname || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }

    // 检查用户名是否已存在（忽略大小写，避免出现 Admin / admin 这类仿冒账号）
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(uname);
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(password, 10);

    // 教师类型的两种身份：班主任（head_teacher）/ 任课教师（teacher）
    const isTeacher = role === 'teacher';
    const applyAs = isTeacher ? (teacher_type === 'teacher' ? 'teacher' : 'head_teacher') : 'student';

    // 确定要申请的班级（班主任用单选 requested_class_id，任课教师用多选 requested_class_ids）
    let applyClassIds = [];
    if (role === 'student' && requested_class_id) {
      applyClassIds = [parseInt(requested_class_id)];
    } else if (isTeacher) {
      const rawIds = Array.isArray(requested_class_ids) && requested_class_ids.length > 0
        ? requested_class_ids
        : (requested_class_id ? [requested_class_id] : []);
      applyClassIds = rawIds.map((id) => parseInt(id)).filter((n) => Number.isFinite(n));
    }
    // 去重，避免重复班级触发 class_applications 的唯一约束
    applyClassIds = [...new Set(applyClassIds)];

    // 学生、教师都必须选择要加入的班级
    if ((role === 'student' || isTeacher) && applyClassIds.length === 0) {
      return res.status(400).json({ error: '请选择要加入的班级' });
    }

    // 班主任只能申请一个班级（成为班主任后如需加入其他班级，由管理员在后台操作）
    if (applyAs === 'head_teacher' && applyClassIds.length > 1) {
      return res.status(400).json({ error: '班主任只能选择一个班级' });
    }

    // 验证班级是否存在；班主任只能申请尚无班主任的班级
    const classesWithHeadTeacher = [];
    for (const classId of applyClassIds) {
      const cls = db.prepare('SELECT id, name, head_teacher_id FROM classes WHERE id = ?').get(classId);
      if (!cls) {
        return res.status(400).json({ error: `班级 ID ${classId} 不存在` });
      }
      if (applyAs === 'head_teacher') {
        const hasHeadTeacher = cls.head_teacher_id
          || db.prepare(`SELECT 1 FROM class_teachers WHERE class_id = ? AND role = 'head_teacher'`).get(classId);
        if (hasHeadTeacher) {
          classesWithHeadTeacher.push(cls.name);
        }
      }
    }

    if (classesWithHeadTeacher.length > 0) {
      return res.status(400).json({
        error: `以下班级已有班主任，无法作为班主任加入：${classesWithHeadTeacher.join('、')}`
      });
    }

    // 所有注册申请都需要等待班主任/管理员审批
    const status = 'pending_approval';

    // 创建用户 + 班级申请（同一事务：任一步失败则整体回滚，避免"账号已建但申请缺失"）
    const createUserWithApplications = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, email, role, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(uname, passwordHash, email, role, status);

      const newUserId = result.lastInsertRowid;

      for (const classId of applyClassIds) {
        // role 受 CHECK 约束只能是 student/teacher，教师身份另存 teacher_type
        db.prepare(`
          INSERT INTO class_applications (user_id, class_id, role, teacher_type, status)
          VALUES (?, ?, ?, ?, 'pending')
        `).run(newUserId, classId, isTeacher ? 'teacher' : 'student', isTeacher ? applyAs : null);
      }

      return newUserId;
    });

    const userId = createUserWithApplications();

    // 给对应班级的教师发送申请通知（通知失败不影响注册结果）
    for (const classId of applyClassIds) {
      try {
        const classTeachers = db.prepare(`
          SELECT teacher_id FROM class_teachers WHERE class_id = ?
        `).all(classId);

        const className = db.prepare('SELECT name FROM classes WHERE id = ?').get(classId)?.name || '未知班级';

        for (const teacher of classTeachers) {
          const title = applyAs === 'head_teacher' ? '新教师申请担任班主任'
            : applyAs === 'teacher' ? '新教师申请加入班级'
            : '新学生申请加入班级';
          const content = applyAs === 'head_teacher'
            ? `${uname} 申请担任班级「${className}」的班主任，请前往审批。`
            : `${uname} 申请加入你的班级「${className}」，请前往审批。`;
          db.prepare(`
            INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
            VALUES (?, 'class_join_request', ?, ?, 'class_application', ?)
          `).run(teacher.teacher_id, title, content, userId);
        }
      } catch (e) {
        console.error('发送申请通知失败:', e);
      }
    }

    // 生成 JWT token
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const token = jwt.sign(
      { userId, username: uname, role },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(201).json({
      message: applyAs === 'head_teacher'
        ? '注册成功！您的班主任申请正在等待审批，审批通过后您将成为该班级的班主任。'
        : applyAs === 'teacher'
          ? '注册成功！您的教师账号正在等待审批，审批通过后即可加入所选班级。'
          : '注册成功！您的账号正在等待班级班主任审批，请耐心等待。',
      pending: true
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: '注册失败' });
  }
});

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 登录时同样去掉首尾空格，并忽略大小写（与注册时的查重规则一致）
    const uname = String(username || '').trim();

    // 验证必填字段
    if (!uname || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }

    // 查找用户
    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(uname);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 删除密码哈希，防止泄露到前端
    delete user.password_hash;

    // 检查状态
    if (user.status === 'pending_approval') {
      return res.status(403).json({ error: '您的账号正在审核中，请联系管理员。' });
    } else if (user.status !== 'active') {
      return res.status(403).json({ error: '您的账号已被禁用或状态异常。' });
    }

    // 更新最后登录时间
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    // 成就检查
    try {
      const loginDays = db.prepare('SELECT COUNT(DISTINCT date) as c FROM daily_tasks WHERE user_id = ?').get(user.id)?.c || 0;
      checkAndAwardAchievement(user.id, 'login', loginDays + 1);
      const today = getChinaDate();
      const dailyTask = db.prepare('SELECT streak_days FROM daily_tasks WHERE user_id = ? AND date = ?').get(user.id, today);
      if (dailyTask && dailyTask.streak_days > 0) {
        checkAndAwardAchievement(user.id, 'continuous_login', dailyTask.streak_days);
      }
      const petCount = db.prepare('SELECT COUNT(*) as c FROM pets WHERE user_id = ?').get(user.id)?.c || 0;
      if (petCount > 0) {
        checkAndAwardAchievement(user.id, 'create_pet', petCount);
      }
    } catch (e) { console.error('成就检查失败:', e); }

    // 获取班级slug
    const classInfo = db.prepare('SELECT slug FROM classes WHERE id = ?').get(user.class_id);

    // 宠物属性每小时变化处理（登录时计算离线时间）
    const myPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(user.id);
    if (myPet) {
      if (user.last_login) {
        const lastLogin = new Date(user.last_login).getTime();
        const hoursSinceLastLogin = Math.max(0, Math.floor((Date.now() - lastLogin) / (1000 * 60 * 60)));
        const daysSinceLastLogin = Math.floor(hoursSinceLastLogin / 24);

        if (hoursSinceLastLogin > 0) {
          let newStamina = Math.min(100, myPet.stamina + hoursSinceLastLogin * 10);
          let newHunger = Math.max(0, myPet.hunger - hoursSinceLastLogin * 2);
          let newMood = myPet.mood;
          let newHealth = myPet.health;

          if (daysSinceLastLogin > 0) {
            newHunger = Math.max(0, newHunger - daysSinceLastLogin * 5);
            newMood = Math.max(0, newMood - daysSinceLastLogin * 5);
          }

          if (newHunger < 30) {
            newMood = Math.max(0, newMood - hoursSinceLastLogin * 1);
          }

          if (newHunger === 0 || newMood === 0) {
            newHealth = Math.max(0, newHealth - hoursSinceLastLogin * 2);
          }

          // 状态异常标记
          let statusDebuff = false;
          if (newHunger < 30 || newMood < 30) {
            statusDebuff = true;
          }

          // 更新宠物属性
          db.prepare(`
            UPDATE pets SET
              stamina = ?,
              hunger = ?,
              mood = ?,
              health = ?,
              status = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(newStamina, newHunger, newMood, newHealth, (newHunger <= 0 || newHealth <= 0) ? 'unconscious' : myPet.status, myPet.id);

          // 返回状态衰减信息给前端
          myPet.status_debuff = statusDebuff;
          myPet.days_offline = daysSinceLastLogin;
        }
      }
    }

    // 生成 JWT token
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // 教师：获取其所在的班级列表
    let teacher_classes = [];
    if (user.role === 'teacher' || user.role === 'admin') {
      teacher_classes = db.prepare(`
        SELECT c.id, c.name, c.slug, c.grade, ct.role AS class_role
        FROM class_teachers ct JOIN classes c ON ct.class_id = c.id
        WHERE ct.teacher_id = ?
        ORDER BY c.created_at DESC
      `).all(user.id);
    }

    res.json({
      message: '登录成功',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        class_id: user.class_id,
        class_slug: classInfo?.slug || null,
        status: user.status,
        avatar: user.avatar,
        gold: user.gold || 0,
        teacher_classes
      }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '登录失败' });
  }
});

// 获取当前用户信息
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT u.id, u.username, u.email, u.role, u.class_id, u.avatar, u.created_at, u.last_login,
             u.gold, u.total_gold_earned,
             c.slug AS class_slug, c.name AS class_name, c.school_id,
             s.name AS school_name, s.theme_color AS school_theme
      FROM users u
      LEFT JOIN classes c ON u.class_id = c.id
      LEFT JOIN schools s ON c.school_id = s.id
      WHERE u.id = ?
    `).get(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 教师：一同返回其所在的班级列表（便于前端跳转到所属班级）
    let teacher_classes = [];
    if (user.role === 'teacher' || user.role === 'admin') {
      teacher_classes = db.prepare(`
        SELECT c.id, c.name, c.slug, c.grade, ct.role AS class_role
        FROM class_teachers ct JOIN classes c ON ct.class_id = c.id
        WHERE ct.teacher_id = ?
        ORDER BY c.created_at DESC
      `).all(req.user.userId);
    }

    res.json({ user: { ...user, teacher_classes } });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// 审批进度查询（无需登录：仅返回状态与班级名）
router.get('/approval-status', (req, res) => {
  try {
    const { username } = req.query;
    const uname = String(username || '').trim();
    if (!uname) return res.status(400).json({ error: '请提供用户名' });
    const user = db.prepare(`SELECT id, status FROM users WHERE username = ? COLLATE NOCASE`).get(uname);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const apps = db.prepare(`
      SELECT ca.status, ca.role, ca.teacher_type, ca.created_at, ca.reviewed_at, c.name AS class_name
      FROM class_applications ca LEFT JOIN classes c ON ca.class_id = c.id
      WHERE ca.user_id = ?
      ORDER BY ca.created_at DESC
    `).all(user.id);
    res.json({ status: user.status, applications: apps });
  } catch (error) {
    console.error('获取审批状态失败:', error);
    res.status(500).json({ error: '获取审批状态失败' });
  }
});

// 更新用户信息
router.put('/me', authenticateToken, (req, res) => {
  try {
    const { email, avatar } = req.body;
    const updates = [];
    const values = [];

    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email);
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?');
      values.push(avatar);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }

    values.push(req.user.userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ message: '更新成功' });
  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 修改密码
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '请填写当前密码和新密码' });
    }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.userId);
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: '当前密码错误' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, req.user.userId);

    res.json({ message: '密码修改成功' });
  } catch (error) {
    console.error('修改密码错误:', error);
    res.status(500).json({ error: '修改密码失败' });
  }
});

module.exports = router;
