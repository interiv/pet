const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const conditionTypes = require('../config/achievementConditions');

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
};

// 检查并发放成就
function checkAndAwardAchievement(userId, achievementType, currentValue) {
  const allAchievements = db.prepare(
    "SELECT * FROM achievements WHERE json_extract(condition, '$.type') = ?"
  ).all(achievementType);

  const newAchievements = [];
  for (const ach of allAchievements) {
    const cond = JSON.parse(ach.condition);
    const thresholdKey = Object.keys(cond).find(k => k !== 'type');
    const threshold = cond[thresholdKey];

    if (currentValue >= threshold) {
      const existing = db.prepare(
        'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ?'
      ).get(userId, ach.id);
      if (existing) continue;

      db.prepare(
        'INSERT INTO user_achievements (user_id, achievement_id, completed_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      ).run(userId, ach.id);

      if (ach.reward_type === 'gold') {
        db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(ach.reward_value, userId);
      } else if (ach.reward_type === 'exp') {
        const pet = db.prepare('SELECT id FROM pets WHERE user_id = ?').get(userId);
        if (pet) {
          db.prepare('UPDATE pets SET exp = exp + ? WHERE id = ?').run(ach.reward_value, pet.id);
        }
      } else if (ach.reward_type === 'item') {
        const existingItem = db.prepare(
          'SELECT id FROM user_items WHERE user_id = ? AND item_id = ?'
        ).get(userId, ach.reward_value);
        if (existingItem) {
          db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE user_id = ? AND item_id = ?')
            .run(userId, ach.reward_value);
        } else {
          db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, 1)')
            .run(userId, ach.reward_value);
        }
      }

      newAchievements.push(ach);
    }
  }

  return newAchievements;
}

// 获取条件类型列表（给前端动态表单用）
router.get('/condition-types', authenticateToken, (req, res) => {
  res.json({ types: conditionTypes });
});

// 获取成就列表
router.get('/list', authenticateToken, (req, res) => {
  try {
    const achievements = db.prepare('SELECT * FROM achievements ORDER BY sort_order, id').all();
    res.json({ achievements });
  } catch (error) {
    console.error('获取成就列表错误:', error);
    res.status(500).json({ error: '获取成就列表失败' });
  }
});

// 获取用户成就
router.get('/my-achievements', authenticateToken, (req, res) => {
  try {
    const achievements = db.prepare(`
      SELECT a.*, ua.completed_at
      FROM user_achievements ua
      JOIN achievements a ON ua.achievement_id = a.id
      WHERE ua.user_id = ?
    `).all(req.user.userId);

    res.json({ achievements });
  } catch (error) {
    console.error('获取用户成就错误:', error);
    res.status(500).json({ error: '获取成就失败' });
  }
});

// 手动检查成就（可在关键操作后调用）
router.post('/check', authenticateToken, (req, res) => {
  try {
    const { type, value } = req.body;
    const newAchievements = checkAndAwardAchievement(req.user.userId, type, value);
    res.json({
      message: newAchievements.length > 0 ? `解锁了 ${newAchievements.length} 个成就` : '没有新的成就',
      newAchievements
    });
  } catch (error) {
    console.error('检查成就错误:', error);
    res.status(500).json({ error: '检查成就失败' });
  }
});

// 获取所有成就及其完成状态
router.get('/status', authenticateToken, (req, res) => {
  try {
    const allAchievements = db.prepare('SELECT * FROM achievements ORDER BY sort_order, id').all();
    const completedAchievements = db.prepare(
      'SELECT achievement_id FROM user_achievements WHERE user_id = ?'
    ).all(req.user.userId);
    const completedIds = completedAchievements.map(a => a.achievement_id);

    const status = allAchievements.map(a => ({
      ...a,
      completed: completedIds.includes(a.id)
    }));

    res.json({ achievements: status });
  } catch (error) {
    console.error('获取成就状态错误:', error);
    res.status(500).json({ error: '获取成就状态失败' });
  }
});

// ============ 管理员 CRUD ============

// 获取道具列表（供管理员选择奖励道具）
router.get('/admin/items', authenticateToken, requireAdmin, (req, res) => {
  try {
    const items = db.prepare('SELECT id, name, price FROM items ORDER BY id').all();
    res.json({ items });
  } catch (error) {
    console.error('获取道具列表错误:', error);
    res.status(500).json({ error: '获取道具列表失败' });
  }
});

// 创建成就
router.post('/admin', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, description, condition, reward_type, reward_value, category, icon, sort_order } = req.body;

    if (!name || !condition || !reward_type) {
      return res.status(400).json({ error: '名称、条件、奖励类型为必填' });
    }

    const condStr = typeof condition === 'string' ? condition : JSON.stringify(condition);

    const result = db.prepare(`
      INSERT INTO achievements (name, description, condition, reward_type, reward_value, category, icon, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      description || '',
      condStr,
      reward_type,
      reward_value || 0,
      category || 'special',
      icon || '🏆',
      sort_order || 0
    );

    const achievement = db.prepare('SELECT * FROM achievements WHERE id = ?').get(result.lastInsertRowid);
    res.json({ message: '成就创建成功', achievement });
  } catch (error) {
    console.error('创建成就错误:', error);
    res.status(500).json({ error: '创建成就失败' });
  }
});

// 更新成就
router.put('/admin/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, condition, reward_type, reward_value, category, icon, sort_order } = req.body;

    const existing = db.prepare('SELECT * FROM achievements WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '成就不存在' });
    }

    const condStr = condition ? (typeof condition === 'string' ? condition : JSON.stringify(condition)) : existing.condition;

    db.prepare(`
      UPDATE achievements SET name = ?, description = ?, condition = ?, reward_type = ?, reward_value = ?, category = ?, icon = ?, sort_order = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      condStr,
      reward_type || existing.reward_type,
      reward_value !== undefined ? reward_value : existing.reward_value,
      category || existing.category,
      icon || existing.icon,
      sort_order !== undefined ? sort_order : existing.sort_order,
      id
    );

    const achievement = db.prepare('SELECT * FROM achievements WHERE id = ?').get(id);
    res.json({ message: '成就更新成功', achievement });
  } catch (error) {
    console.error('更新成就错误:', error);
    res.status(500).json({ error: '更新成就失败' });
  }
});

// 删除成就
router.delete('/admin/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM achievements WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '成就不存在' });
    }

    db.prepare('DELETE FROM user_achievements WHERE achievement_id = ?').run(id);
    db.prepare('DELETE FROM achievements WHERE id = ?').run(id);

    res.json({ message: '成就删除成功' });
  } catch (error) {
    console.error('删除成就错误:', error);
    res.status(500).json({ error: '删除成就失败' });
  }
});

module.exports = router;
module.exports.checkAndAwardAchievement = checkAndAwardAchievement;
