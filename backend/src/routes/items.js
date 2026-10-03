const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { recordItemChange, recordGoldChange } = require('../services/rewards');

/**
 * 有实际消费入口的道具类型。
 * 其余类型（shield / buff_* / luck / double_exp / rename）目前没有任何地方会扣减它们，
 * 学生买了只能砸在手里（最贵的 1000 金币），因此商店不再出售。
 * 已购买的存量不受影响，等对应玩法实装后再放开。
 */
const SELLABLE_EFFECT_TYPES = [
  'hunger', 'mood', 'health', 'stamina', 'exp',
  'attack', 'defense', 'speed', 'reincarnate',
];

// 获取物品列表（商店货架）
router.get('/', authenticateToken, (req, res) => {
  try {
    const placeholders = SELLABLE_EFFECT_TYPES.map(() => '?').join(',');
    const items = db
      .prepare(`SELECT * FROM items WHERE effect_type IN (${placeholders}) ORDER BY price`)
      .all(...SELLABLE_EFFECT_TYPES);
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

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return res.status(400).json({ error: '购买数量必须为1-99的整数' });
    }

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
    if (!item) {
      return res.status(404).json({ error: '物品不存在' });
    }

    // 与货架保持一致：没有消费入口的道具不允许购买（绕过列表直接 POST 也不行）
    if (!SELLABLE_EFFECT_TYPES.includes(item.effect_type)) {
      return res.status(400).json({ error: '该道具暂未开放' });
    }

    const totalCost = item.price * quantity;

    const user = db.prepare('SELECT gold FROM users WHERE id = ?').get(req.user.userId);
    if (!user || user.gold < totalCost) {
      return res.status(400).json({ error: '金币不足' });
    }

    // 扣金币与入背包必须同生同死：原先无事务，入背包失败会导致金币白白扣掉
    db.transaction(() => {
      db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(totalCost, req.user.userId);
      // 商店消费要记流水，否则学生端「资产明细」看不到支出
      recordGoldChange(req.user.userId, -totalCost, `购买${item.name} x${quantity}`, 'shop');

      const existing = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ?').get(req.user.userId, item_id);

      if (existing) {
        db.prepare('UPDATE user_items SET quantity = quantity + ? WHERE user_id = ? AND item_id = ?').run(quantity, req.user.userId, item_id);
      } else {
        db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, ?)').run(req.user.userId, item_id, quantity);
      }
      recordItemChange(req.user.userId, {
        refType: 'item', refId: item_id, name: item.name,
        quantity, reason: `商店购买（-${totalCost} 金币）`, source: 'shop',
      });
    })();

    const updatedItems = db.prepare(`
      SELECT ui.*, i.name, i.type, i.effect_type, i.effect_value, i.description, i.image_url
      FROM user_items ui
      JOIN items i ON ui.item_id = i.id
      WHERE ui.user_id = ? AND ui.quantity > 0
    `).all(req.user.userId);

    res.json({
      message: '购买成功',
      item: item.name,
      quantity,
      totalCost,
      items: updatedItems
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
