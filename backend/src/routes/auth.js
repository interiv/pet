const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { checkAndAwardAchievement } = require('./achievements');
const { notifyClassApplication } = require('../services/joinNotify');
const { getChinaDate } = require('../config/timezone');
const { isFeatureEnabled } = require('../middleware/featureFlags');

// 关闭「开放注册」后的统一提示。放在最前面判断，避免任何人
// （包括校外人员、脚本）继续提交注册申请并触发给班主任的通知。
const REGISTRATION_CLOSED = { error: '本站当前未开放注册，请联系班主任或管理员开通账号' };

// 用户注册
router.post('/register', async (req, res) => {
  try {
    if (!isFeatureEnabled('registration_enabled')) {
      return res.status(403).json(REGISTRATION_CLOSED);
    }
    const { username, password, email, real_name, role = 'student', requested_class_id, requested_class_ids, teacher_type, assignments } = req.body;

    // 用户名统一去掉首尾空格，避免 " abc" 与 "abc" 被当作两个账号
    const uname = String(username || '').trim();
    // 真实姓名：与登录账号分离（可空，兼容尚未升级的旧版前端）
    const realName = String(real_name || '').trim() || null;

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

    // 科目：自由文本，去空格后限长 20（留空 = 该教师在该班不固定科目）
    const normalizeSubject = (raw) => {
      const s = String(raw ?? '').trim();
      return s ? s.slice(0, 20) : null;
    };

    // 一行一条任教关系：[{ class_id, role: 'head_teacher' | 'teacher', subject }]
    // 教师注册页与管理员后台都用同一种结构，审批通过后原样落到 class_teachers
    let applyRows = [];
    if (isTeacher) {
      if (Array.isArray(assignments) && assignments.length > 0) {
        const seen = new Set();
        for (const row of assignments) {
          const classId = parseInt(row && (row.class_id ?? row.classId), 10);
          if (!Number.isFinite(classId) || seen.has(classId)) continue;
          seen.add(classId);
          applyRows.push({
            classId,
            role: row.role === 'head_teacher' ? 'head_teacher' : 'teacher',
            subject: normalizeSubject(row && (row.subject ?? row.subject_name)),
          });
        }
      } else {
        // 兼容旧写法：单一 teacher_type + requested_class_id / requested_class_ids
        const rawIds = Array.isArray(requested_class_ids) && requested_class_ids.length > 0
          ? requested_class_ids
          : (requested_class_id ? [requested_class_id] : []);
        const identity = teacher_type === 'teacher' ? 'teacher' : 'head_teacher';
        applyRows = rawIds
          .map((id) => parseInt(id))
          .filter((n) => Number.isFinite(n))
          .map((classId) => ({ classId, role: identity, subject: null }));
      }
    } else if (requested_class_id) {
      const classId = parseInt(requested_class_id);
      if (Number.isFinite(classId)) applyRows = [{ classId, role: 'student', subject: null }];
    }

    const applyAs = applyRows.some((r) => r.role === 'head_teacher') ? 'head_teacher'
      : (isTeacher ? 'teacher' : 'student');

    // 学生、教师都必须选择要加入的班级
    if ((role === 'student' || isTeacher) && applyRows.length === 0) {
      return res.status(400).json({ error: '请选择要加入的班级' });
    }

    // 班主任只能申请一个班级（成为班主任后如需加入其他班级，由管理员在后台操作）
    if (applyRows.filter((r) => r.role === 'head_teacher').length > 1) {
      return res.status(400).json({ error: '班主任只能选择一个班级' });
    }

    // 验证班级是否存在；班主任只能申请尚无班主任的班级
    const classesWithHeadTeacher = [];
    for (const row of applyRows) {
      const cls = db.prepare('SELECT id, name, head_teacher_id FROM classes WHERE id = ?').get(row.classId);
      if (!cls) {
        return res.status(400).json({ error: `班级 ID ${row.classId} 不存在` });
      }
      if (row.role === 'head_teacher') {
        const hasHeadTeacher = cls.head_teacher_id
          || db.prepare(`SELECT 1 FROM class_teachers WHERE class_id = ? AND role = 'head_teacher'`).get(row.classId);
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
        INSERT INTO users (username, password_hash, email, real_name, role, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uname, passwordHash, email, realName, role, status);

      const newUserId = result.lastInsertRowid;

      for (const row of applyRows) {
        // role 受 CHECK 约束只能是 student/teacher，教师身份另存 teacher_type，科目另存 subject
        db.prepare(`
          INSERT INTO class_applications (user_id, class_id, role, teacher_type, subject, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(newUserId, row.classId, isTeacher ? 'teacher' : 'student', isTeacher ? row.role : null, row.subject);
      }

      return newUserId;
    });

    const userId = createUserWithApplications();

    // 通知收件人已按分级处理：只通知该班班主任；无班主任时通知管理员兜底
    for (const { classId, role: rowRole, subject } of applyRows) {
      try {
        notifyClassApplication({
          classId,
          applicantId: userId,
          applicantName: uname,
          role: isTeacher ? 'teacher' : 'student',
          teacherType: isTeacher ? rowRole : undefined,
          subject,
        });
      } catch (e) {
        console.error('发送申请通知失败:', e);
      }
    }

    // 注意：注册后账号处于 pending_approval，即使签发 token 也会被认证中间件 403 拦截，
    // 因此这里不再生成 token（原实现生成后从未返回，属死代码）。

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
      // 口径说明：这里统计的是「有活跃记录的去重天数」（登录天数），不是登录次数。
      // 必须与 achievements.js /status 中 login 进度的算法保持一致，否则会出现
      // 进度条显示 100% 但成就未解锁（或反之）。
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
    // ct.subject 必须带上：前端登录后直接用本响应的 user 填充 store（不会立刻再调 /me），
    // 漏掉它会导致「留作业/课堂做题」的默认科目永远为空，要按 F5 刷新才恢复。
    let teacher_classes = [];
    if (user.role === 'teacher' || user.role === 'admin') {
      teacher_classes = db.prepare(`
        SELECT c.id, c.name, c.slug, c.grade, ct.role AS class_role, ct.subject
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
        real_name: user.real_name,
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
      SELECT u.id, u.username, u.real_name, u.email, u.role, u.class_id, u.avatar, u.created_at, u.last_login,
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
        SELECT c.id, c.name, c.slug, c.grade, ct.role AS class_role, ct.subject
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
      SELECT ca.status, ca.role, ca.teacher_type, ca.subject, ca.created_at, ca.reviewed_at, c.name AS class_name
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

/**
 * 教师自助维护「任教科目」（仅限已有任教关系的班级）。
 *
 * 为什么科目可以直接改、而任教班级要审批：
 *   - 科目只是「我教什么」的自我描述，不授予任何权限，改错了不会造成越权；
 *     而且它正是「留作业默认科目」的数据来源，不让老师填就永远是空的。
 *   - 任教班级决定权限边界（能看到学生名单、进班级群、被通知申请等），
 *     必须由该班班主任或管理员点头，所以走 class_applications 审批流。
 */
router.put('/me/teaching-subject', authenticateToken, (req, res) => {
  try {
    if (!['teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: '仅教师可维护任教科目' });
    }
    const userId = req.user.userId;
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];

    const rows = db.prepare(
      `SELECT ct.class_id, ct.role, c.name FROM class_teachers ct
       JOIN classes c ON c.id = ct.class_id WHERE ct.teacher_id = ?`
    ).all(userId);
    const classMap = new Map(rows.map((r) => [Number(r.class_id), r]));

    const stmt = db.prepare('UPDATE class_teachers SET subject = ? WHERE teacher_id = ? AND class_id = ?');
    let changed = 0;
    db.transaction(() => {
      for (const u of updates) {
        const classId = parseInt(u?.class_id, 10);
        if (!classId || !classMap.has(classId)) continue; // 只能改自己已在的班
        const subject = String(u?.subject ?? '').trim().slice(0, 20) || null;
        stmt.run(subject, userId, classId);
        changed += 1;
      }
    })();

    res.json({ message: '任教科目已更新', updated: changed });
  } catch (error) {
    console.error('更新任教科目错误:', error);
    res.status(500).json({ error: '更新任教科目失败' });
  }
});

/**
 * 教师申请加入某个班级任教（申请班主任 / 管理员审批）。
 * 直接写入 class_applications，审批通过后由既有的 applyApplicationToClass 落地，
 * 不新增第二套申请表。
 */
router.post('/me/join-class-request', authenticateToken, (req, res) => {
  try {
    if (!['teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: '仅教师可提交任教申请' });
    }
    const userId = req.user.userId;
    const classId = parseInt(req.body?.class_id, 10);
    const subject = String(req.body?.subject ?? '').trim().slice(0, 20) || null;
    const wantHeadTeacher = req.body?.teacher_type === 'head_teacher';

    if (!Number.isFinite(classId)) return res.status(400).json({ error: '请选择要加入的班级' });

    const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    const already = db.prepare('SELECT role FROM class_teachers WHERE teacher_id = ? AND class_id = ?').get(userId, classId);
    if (already) return res.status(400).json({ error: '你已经在该班任教了' });

    const pending = db.prepare(
      `SELECT id FROM class_applications WHERE user_id = ? AND class_id = ? AND role = 'teacher' AND status = 'pending'`
    ).get(userId, classId);
    if (pending) return res.status(400).json({ error: '你已提交过该班级的任教申请，请等待审批' });

    // 一个班只能有一位班主任，已有人时不能申请班主任身份
    if (wantHeadTeacher) {
      const hasHead = db.prepare(
        `SELECT 1 FROM class_teachers WHERE class_id = ? AND role = 'head_teacher'`
      ).get(classId);
      if (hasHead) return res.status(400).json({ error: '该班已有班主任，只能以任课教师身份申请' });
    }

    const user = db.prepare('SELECT username, real_name, status FROM users WHERE id = ?').get(userId);
    const applicantName = user?.real_name || user?.username || '某教师';

    db.prepare(`
      INSERT INTO class_applications (user_id, class_id, role, teacher_type, subject, status)
      VALUES (?, ?, 'teacher', ?, ?, 'pending')
    `).run(userId, classId, wantHeadTeacher ? 'head_teacher' : 'teacher', subject);

    // 通知该班班主任；没有班主任时兜底通知管理员（与注册申请同一套规则）
    try {
      notifyClassApplication({
        classId,
        applicantId: userId,
        applicantName,
        role: 'teacher',
        teacherType: wantHeadTeacher ? 'head_teacher' : 'teacher',
        subject,
      });
    } catch (e) {
      console.error('发送任教申请通知失败:', e);
    }

    res.json({ message: `已提交加入「${cls.name}」的任教申请，等待班主任审批` });
  } catch (error) {
    console.error('提交任教申请错误:', error);
    res.status(500).json({ error: '提交申请失败' });
  }
});

/** 教师可申请加入的班级列表（公开班级 + 自己尚未加入的） */
router.get('/me/teachable-classes', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const rows = db.prepare(`
      SELECT c.id, c.name, c.grade,
        (SELECT ct2.role FROM class_teachers ct2 WHERE ct2.class_id = c.id AND ct2.teacher_id = ?) AS my_role,
        EXISTS(SELECT 1 FROM class_teachers ct3 WHERE ct3.class_id = c.id AND ct3.role = 'head_teacher') AS has_head_teacher
      FROM classes c
      WHERE COALESCE(c.is_public, 1) = 1
      ORDER BY c.created_at DESC
    `).all(userId);
    res.json({
      classes: rows
        .filter((r) => r.my_role !== 'head_teacher')
        .map((r) => ({ id: r.id, name: r.name, grade: r.grade, joined: !!r.my_role, has_head_teacher: !!r.has_head_teacher })),
    });
  } catch (error) {
    console.error('获取可申请班级失败:', error);
    res.status(500).json({ error: '获取班级列表失败' });
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
