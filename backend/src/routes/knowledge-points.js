const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 获取知识点统计
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { date, days = 7 } = req.query;
    
    // 如果指定了日期，查询该日期的统计
    if (date) {
      const stats = db.prepare(`
        SELECT 
          knowledge_point,
          total_attempts,
          correct_attempts,
          accuracy
        FROM knowledge_point_stats
        WHERE user_id = ? AND date = ?
        ORDER BY total_attempts DESC
      `).all(userId, date);
      
      return res.json({
        date,
        stats,
        total_points: stats.length,
        avg_accuracy: stats.length > 0 
          ? (stats.reduce((sum, s) => sum + s.accuracy, 0) / stats.length).toFixed(2)
          : 0
      });
    }
    
    // 否则查询最近N天的统计
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const stats = db.prepare(`
      SELECT 
        knowledge_point,
        SUM(total_attempts) as total_attempts,
        SUM(correct_attempts) as correct_attempts,
        ROUND(CAST(SUM(correct_attempts) AS REAL) / SUM(total_attempts) * 100, 2) as accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      GROUP BY knowledge_point
      HAVING SUM(total_attempts) >= 3
      ORDER BY SUM(total_attempts) DESC
    `).all(userId, startDateStr);
    
    res.json({
      days,
      start_date: startDateStr,
      stats,
      total_points: stats.length,
      avg_accuracy: stats.length > 0 
        ? (stats.reduce((sum, s) => sum + s.accuracy, 0) / stats.length).toFixed(2)
        : 0
    });
  } catch (error) {
    console.error('获取知识点统计失败:', error);
    res.status(500).json({ error: '获取知识点统计失败' });
  }
});

// 获取知识点列表
router.get('/list', authenticateToken, (req, res) => {
  try {
    const knowledgePoints = db.prepare(`
      SELECT DISTINCT knowledge_point
      FROM knowledge_point_stats
      WHERE user_id = ?
      ORDER BY knowledge_point
    `).all(req.user.userId).map(row => row.knowledge_point);
    
    res.json({
      knowledge_points: knowledgePoints,
      total: knowledgePoints.length
    });
  } catch (error) {
    console.error('获取知识点列表失败:', error);
    res.status(500).json({ error: '获取知识点列表失败' });
  }
});

// 获取知识点热力图数据
router.get('/heatmap', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const heatmapData = db.prepare(`
      SELECT 
        date,
        knowledge_point,
        total_attempts,
        correct_attempts,
        accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      ORDER BY date, knowledge_point
    `).all(userId, startDateStr);
    
    // 转换为热力图格式
    const dates = [...new Set(heatmapData.map(d => d.date))].sort();
    const points = [...new Set(heatmapData.map(d => d.knowledge_point))].sort();
    
    const matrix = [];
    for (const point of points) {
      const row = { knowledge_point: point };
      for (const date of dates) {
        const record = heatmapData.find(d => d.date === date && d.knowledge_point === point);
        row[date] = record ? {
          attempts: record.total_attempts,
          accuracy: record.accuracy
        } : null;
      }
      matrix.push(row);
    }
    
    res.json({
      dates,
      knowledge_points: points,
      matrix,
      days
    });
  } catch (error) {
    console.error('获取热力图数据失败:', error);
    res.status(500).json({ error: '获取热力图数据失败' });
  }
});

// 获取薄弱知识点（正确率低于60%）
router.get('/weak-points', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { days = 7, threshold = 60 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const weakPoints = db.prepare(`
      SELECT 
        knowledge_point,
        SUM(total_attempts) as total_attempts,
        SUM(correct_attempts) as correct_attempts,
        ROUND(CAST(SUM(correct_attempts) AS REAL) / SUM(total_attempts) * 100, 2) as accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      GROUP BY knowledge_point
      HAVING SUM(total_attempts) >= 3 AND accuracy < ?
      ORDER BY accuracy ASC
    `).all(userId, startDateStr, threshold);
    
    res.json({
      weak_points: weakPoints,
      count: weakPoints.length,
      days,
      threshold
    });
  } catch (error) {
    console.error('获取薄弱知识点失败:', error);
    res.status(500).json({ error: '获取薄弱知识点失败' });
  }
});

module.exports = router;
