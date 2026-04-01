const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足，需要管理员角色' });
  }
  next();
};

// 获取待审批的教师列表
router.get('/pending-teachers', authenticateToken, requireAdmin, (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT id, username, email, created_at, status 
      FROM users 
      WHERE role = 'teacher' AND status = 'pending_approval'
    `).all();
    res.json({ teachers });
  } catch (error) {
    console.error('获取待审批教师失败:', error);
    res.status(500).json({ error: '获取待审批教师失败' });
  }
});

// 审批教师注册
router.post('/approve-teacher', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { teacher_id, action } = req.body; // action: 'approve' or 'reject'
    
    if (action === 'approve') {
      db.prepare(`UPDATE users SET status = 'active' WHERE id = ? AND role = 'teacher'`).run(teacher_id);
      res.json({ message: '教师审批通过' });
    } else if (action === 'reject') {
      db.prepare(`DELETE FROM users WHERE id = ? AND role = 'teacher' AND status = 'pending_approval'`).run(teacher_id);
      res.json({ message: '教师注册已拒绝' });
    } else {
      res.status(400).json({ error: '无效的操作' });
    }
  } catch (error) {
    console.error('审批教师失败:', error);
    res.status(500).json({ error: '审批教师失败' });
  }
});

// 获取大模型设置
router.get('/settings/ai', authenticateToken, requireAdmin, (req, res) => {
  try {
    // Check if settings table exists
    const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`).get();
    if (!hasTable) {
      db.prepare(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `).run();
      // Insert default settings
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_model', 'gpt-3.5-turbo')`).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_api_key', '')`).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_base_url', 'https://api.openai.com/v1')`).run();
    }
    
    const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
    const result = {};
    settings.forEach(s => result[s.key] = s.value);
    res.json({ settings: result });
  } catch (error) {
    console.error('获取设置失败:', error);
    res.status(500).json({ error: '获取设置失败' });
  }
});

// 保存大模型设置
router.post('/settings/ai', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { ai_model, ai_api_key, ai_base_url } = req.body;
    
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      if (ai_model !== undefined) stmt.run('ai_model', ai_model);
      if (ai_api_key !== undefined) stmt.run('ai_api_key', ai_api_key);
      if (ai_base_url !== undefined) stmt.run('ai_base_url', ai_base_url);
    })();
    
    res.json({ message: '设置保存成功' });
  } catch (error) {
    console.error('保存设置失败:', error);
    res.status(500).json({ error: '保存设置失败' });
  }
});

module.exports = router;