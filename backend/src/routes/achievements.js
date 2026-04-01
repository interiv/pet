const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

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

module.exports = router;
