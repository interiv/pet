const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 获取物品列表
router.get('/', authenticateToken, (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM items ORDER BY price').all();
    res.json({ items });
  } catch (error) {
    console.error('获取物品列表错误:', error);
    res.status(500).json({ error: '获取物品列表失败' });
  }
});

// 购买物品
router.post('/buy', authenticateToken, (req, res) => {
  try {
    const { item_id, quantity = 1 } = req.body;

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
    if (!item) {
      return res.status(404).json({ error: '物品不存在' });
    }

    const totalCost = item.price * quantity;

    const user = db.prepare('SELECT gold FROM users WHERE id = ?').get(req.user.userId);
    if (!user || user.gold < totalCost) {
      return res.status(400).json({ error: '金币不足' });
    }

    db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(totalCost, req.user.userId);

    const existing = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ?').get(req.user.userId, item_id);
    
    if (existing) {
      db.prepare('UPDATE user_items SET quantity = quantity + ? WHERE user_id = ? AND item_id = ?').run(quantity, req.user.userId, item_id);
    } else {
      db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, ?)').run(req.user.userId, item_id, quantity);
    }

    res.json({
      message: '购买成功',
      item: item.name,
      quantity,
      totalCost
    });
  } catch (error) {
    console.error('购买物品错误:', error);
    res.status(500).json({ error: '购买失败' });
  }
});

// 获取用户物品
router.get('/my-items', authenticateToken, (req, res) => {
  try {
    const items = db.prepare(`
      SELECT ui.*, i.name, i.type, i.effect_type, i.effect_value, i.description, i.image_url
      FROM user_items ui
      JOIN items i ON ui.item_id = i.id
      WHERE ui.user_id = ? AND ui.quantity > 0
    `).all(req.user.userId);

    res.json({ items });
  } catch (error) {
    console.error('获取用户物品错误:', error);
    res.status(500).json({ error: '获取物品失败' });
  }
});

module.exports = router;
