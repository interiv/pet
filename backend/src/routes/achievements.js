const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 检查并发放成就
function checkAndAwardAchievement(userId, achievementType, currentValue) {
  const achievements = db.prepare('SELECT * FROM achievements WHERE type = ? AND requirement <= ?').all(achievementType, currentValue);

  const newAchievements = [];
  for (const achievement of achievements) {
    const existing = db.prepare('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ?').get(userId, achievement.id);
    if (existing) continue;

    db.prepare('INSERT INTO user_achievements (user_id, achievement_id, completed_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(userId, achievement.id);

    if (achievement.reward_type === 'exp') {
      db.prepare('UPDATE pets SET exp = exp + ? WHERE user_id = ?').run(achievement.reward_value, userId);
    } else if (achievement.reward_type === 'gold') {
      db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(achievement.reward_value, userId);
    }

    newAchievements.push(achievement);
  }

  return newAchievements;
}

// 获取成就列表
router.get('/list', authenticateToken, (req, res) => {
  try {
    const achievements = db.prepare('SELECT * FROM achievements').all();
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
    const allAchievements = db.prepare('SELECT * FROM achievements').all();
    const completedAchievements = db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?').all(req.user.userId);
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

module.exports = router;
