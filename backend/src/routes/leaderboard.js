const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 等级排行榜
router.get('/level', (req, res) => {
  try {
    const leaderboard = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.image_urls, u.username as owner_name
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      ORDER BY p.level DESC, p.exp DESC
      LIMIT 10
    `).all();

    res.json({ leaderboard });
  } catch (error) {
    console.error('获取等级排行榜错误:', error);
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

// 战斗胜率排行榜
router.get('/battle', authenticateToken, (req, res) => {
  try {
    const leaderboard = db.prepare(`
      SELECT p.*, 
             CAST(p.win_count AS FLOAT) / NULLIF(p.total_battles, 0) as win_rate,
             ps.name as species_name, ps.image_urls, u.username as owner_name
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      WHERE p.total_battles > 0
      ORDER BY win_rate DESC
      LIMIT 10
    `).all();

    res.json({ leaderboard });
  } catch (error) {
    console.error('获取战斗排行榜错误:', error);
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

// 作业完成度排行榜
router.get('/assignment', authenticateToken, (req, res) => {
  try {
    const leaderboard = db.prepare(`
      SELECT u.id, u.username, 
             COUNT(s.id) as completed_count,
             AVG(s.exp_reward) as avg_exp
      FROM users u
      LEFT JOIN submissions s ON u.id = s.user_id AND s.status = 'graded'
      WHERE u.role = 'student'
      GROUP BY u.id, u.username
      ORDER BY completed_count DESC, avg_exp DESC
      LIMIT 10
    `).all();

    res.json({ leaderboard });
  } catch (error) {
    console.error('获取作业排行榜错误:', error);
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

module.exports = router;
