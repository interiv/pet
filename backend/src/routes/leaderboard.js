const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

function parseLimit(raw, def = 20, max = 100) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

// 等级排行榜（可按班级过滤）
router.get('/level', (req, res) => {
  try {
    const { class_id } = req.query;
    const limit = parseLimit(req.query.limit, 20);
    let sql = `
      SELECT p.*, ps.name as species_name, ps.image_urls, u.username as owner_name, u.class_id
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      WHERE u.role = 'student'
    `;
    const params = [];
    if (class_id) {
      sql += ` AND u.class_id = ?`;
      params.push(parseInt(class_id, 10));
    }
    sql += ` ORDER BY p.level DESC, p.exp DESC LIMIT ?`;
    params.push(limit);
    const leaderboard = db.prepare(sql).all(...params);
    res.json({ leaderboard });
  } catch (error) {
    console.error('获取等级排行榜错误:', error);
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

// 战斗胜率排行榜
router.get('/battle', authenticateToken, (req, res) => {
  try {
    const { class_id } = req.query;
    const limit = parseLimit(req.query.limit, 20);
    let sql = `
      SELECT p.*, 
             CAST(p.win_count AS FLOAT) / NULLIF(p.total_battles, 0) as win_rate,
             ps.name as species_name, ps.image_urls, u.username as owner_name, u.class_id
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      WHERE p.total_battles > 0 AND u.role = 'student'
    `;
    const params = [];
    if (class_id) {
      sql += ` AND u.class_id = ?`;
      params.push(parseInt(class_id, 10));
    }
    sql += ` ORDER BY win_rate DESC LIMIT ?`;
    params.push(limit);
    const leaderboard = db.prepare(sql).all(...params);
    res.json({ leaderboard });
  } catch (error) {
    console.error('获取战斗排行榜错误:', error);
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

// 作业完成度排行榜
router.get('/assignment', authenticateToken, (req, res) => {
  try {
    const { class_id } = req.query;
    const limit = parseLimit(req.query.limit, 20);
    let sql = `
      SELECT u.id, u.username, u.class_id,
             COUNT(s.id) as completed_count,
             AVG(s.exp_reward) as avg_exp
      FROM users u
      LEFT JOIN submissions s ON u.id = s.user_id AND (s.status = 'graded' OR s.review_status = 'completed')
      WHERE u.role = 'student'
    `;
    const params = [];
    if (class_id) {
      sql += ` AND u.class_id = ?`;
      params.push(parseInt(class_id, 10));
    }
    sql += ` GROUP BY u.id, u.username ORDER BY completed_count DESC, avg_exp DESC LIMIT ?`;
    params.push(limit);
    const leaderboard = db.prepare(sql).all(...params);
    res.json({ leaderboard });
  } catch (error) {
    console.error('获取作业排行榜错误:', error);
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

module.exports = router;
