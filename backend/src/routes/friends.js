const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 获取好友列表
router.get('/list', authenticateToken, (req, res) => {
  try {
    const friends = db.prepare(`
      SELECT u.id, u.username, u.avatar, f.friendship_level, f.last_interaction
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = ?
    `).all(req.user.userId);

    res.json({ friends });
  } catch (error) {
    console.error('获取好友列表错误:', error);
    res.status(500).json({ error: '获取好友列表失败' });
  }
});

// 添加好友
router.post('/add', authenticateToken, (req, res) => {
  try {
    const { friend_username } = req.body;

    const friend = db.prepare('SELECT id FROM users WHERE username = ?').get(friend_username);
    if (!friend) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (friend.id === req.user.userId) {
      return res.status(400).json({ error: '不能添加自己为好友' });
    }

    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)').run(req.user.userId, friend.id);
    db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)').run(friend.id, req.user.userId);

    res.json({ message: '好友添加成功' });
  } catch (error) {
    console.error('添加好友错误:', error);
    res.status(500).json({ error: '添加好友失败' });
  }
});

module.exports = router;
