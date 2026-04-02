const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const { username, password, email, role = 'student', requested_class_id, requested_class_ids } = req.body;

    // 验证必填字段
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }

    // 检查用户名是否已存在
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(password, 10);

    // 确定要申请的班级
    let applyClassIds = [];
    if (role === 'student' && requested_class_id) {
      applyClassIds = [parseInt(requested_class_id)];
    } else if (role === 'teacher' && requested_class_ids && requested_class_ids.length > 0) {
      applyClassIds = requested_class_ids.map((id) => parseInt(id));
    }

    // 如果是学生或教师，需要有班级申请
    if ((role === 'student' || role === 'teacher') && applyClassIds.length === 0) {
      return res.status(400).json({ error: '请选择要加入的班级' });
    }

    // 验证班级是否存在
    for (const classId of applyClassIds) {
      const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId);
      if (!cls) {
        return res.status(400).json({ error: `班级 ID ${classId} 不存在` });
      }
    }

    // 默认状态：学生和教师都需要等待审批
    let status = 'pending_approval';

    // 插入新用户
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, email, role, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, passwordHash, email, role, status);

    const userId = result.lastInsertRowid;

    // 创建班级申请记录
    for (const classId of applyClassIds) {
      try {
        db.prepare(`
          INSERT INTO class_applications (user_id, class_id, role, status)
          VALUES (?, ?, ?, 'pending')
        `).run(userId, classId, role);
      } catch (e) {
        console.error('创建班级申请失败:', e);
      }
    }

    // 生成 JWT token
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const token = jwt.sign(
      { userId, username, role },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(201).json({
      message: role === 'teacher'
        ? '注册成功！您的教师账号正在等待班级班主任审批，请耐心等待。'
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

    // 验证必填字段
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码为必填项' });
    }

    // 查找用户
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 检查状态
    if (user.status === 'pending_approval') {
      return res.status(403).json({ error: '您的账号正在审核中，请联系管理员。' });
    } else if (user.status !== 'active') {
      return res.status(403).json({ error: '您的账号已被禁用或状态异常。' });
    }

    // 更新最后登录时间
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    // 宠物属性每小时变化处理（登录时计算离线时间）
    const myPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(user.id);
    if (myPet) {
      const lastLogin = user.last_login ? new Date(user.last_login).getTime() : Date.now() - 3600000;
      const hoursSinceLastLogin = Math.max(0, Math.floor((Date.now() - lastLogin) / (1000 * 60 * 60)));

      if (hoursSinceLastLogin > 0) {
        let newStamina = Math.min(100, myPet.stamina + hoursSinceLastLogin * 10);
        let newHunger = Math.max(0, myPet.hunger - hoursSinceLastLogin * 5);
        let newMood = myPet.mood;
        let newHealth = myPet.health;

        // 饱腹度低于30时，心情下降
        if (newHunger < 30) {
          newMood = Math.max(0, newMood - hoursSinceLastLogin * 3);
        }

        // 饱腹度为0或心情为0持续时，健康值下降
        if (newHunger === 0 || newMood === 0) {
          newHealth = Math.max(0, newHealth - hoursSinceLastLogin * 10);
        }

        // 更新宠物属性
        db.prepare(`
          UPDATE pets SET
            stamina = ?,
            hunger = ?,
            mood = ?,
            health = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newStamina, newHunger, newMood, newHealth, myPet.id);
      }
    }

    // 生成 JWT token
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: '登录成功',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        class_id: user.class_id,
        avatar: user.avatar
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
      SELECT id, username, email, role, class_id, avatar, created_at, last_login
      FROM users
      WHERE id = ?
    `).get(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({ user });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ error: '获取用户信息失败' });
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
