const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ==================== 通知系统 ====================

// 获取通知列表
router.get('/', authenticateToken, (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const userId = req.user.userId;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT n.*
      FROM notifications n
      WHERE n.user_id = ?
    `;
    const params = [userId];

    if (type && type !== 'all') {
      sql += ` AND n.type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY n.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const notifications = db.prepare(sql).all(...params);

    res.json({ notifications });
  } catch (error) {
    console.error('获取通知列表失败:', error);
    res.status(500).json({ error: '获取通知列表失败' });
  }
});

// 获取未读通知数量
router.get('/unread-count', authenticateToken, (req, res) => {
  try {
    const count = db.prepare(`
      SELECT COUNT(*) as cnt FROM notifications
      WHERE user_id = ? AND is_read = 0
    `).get(req.user.userId);

    // 按类型分组统计
    const byType = db.prepare(`
      SELECT type, COUNT(*) as cnt FROM notifications
      WHERE user_id = ? AND is_read = 0
      GROUP BY type
    `).all(req.user.userId);

    res.json({
      total: count.cnt,
      by_type: byType.reduce((acc, row) => ({ ...acc, [row.type]: row.cnt }), {})
    });
  } catch (error) {
    console.error('获取未读数量失败:', error);
    res.status(500).json({ error: '获取未读数量失败' });
  }
});

// 标记为已读（单条）
router.put('/:id/read', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;

    const notif = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, req.user.userId);
    if (!notif) return res.status(404).json({ error: '通知不存在' });

    db.prepare('UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    res.json({ message: '已标记为已读' });
  } catch (error) {
    console.error('标记已读失败:', error);
    res.status(500).json({ error: '标记已读失败' });
  }
});

// 全部标记为已读
router.put('/read-all', authenticateToken, (req, res) => {
  try {
    db.prepare(`
      UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND is_read = 0
    `).run(req.user.userId);

    res.json({ message: '全部标记为已读' });
  } catch (error) {
    console.error('全部标为已读失败:', error);
    res.status(500).json({ error: '操作失败' });
  }
});

// 删除通知
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(id, req.user.userId);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除通知失败:', error);
    res.status(500).json({ error: '删除通知失败' });
  }
});

// 清空所有已读通知
router.delete('/clear-read', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM notifications WHERE user_id = ? AND is_read = 1').run(req.user.userId);
    res.json({ message: '已清空已读通知' });
  } catch (error) {
    console.error('清空通知失败:', error);
    res.status(500).json({ error: '清空通知失败' });
  }
});

module.exports = router;
