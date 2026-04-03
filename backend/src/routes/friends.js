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

router.get('/search', authenticateToken, (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword || keyword.trim().length < 1) {
      return res.json({ users: [] });
    }
    const kw = `%${keyword.trim()}%`;
    const users = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.role, c.name as class_name
      FROM users u
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.id != ? AND u.username LIKE ? AND u.status = 'active'
      ORDER BY u.username
      LIMIT 20
    `).all(req.user.userId, kw);
    res.json({ users });
  } catch (error) {
    console.error('搜索用户错误:', error);
    res.status(500).json({ error: '搜索失败' });
  }
});

// 访问好友宠物（增加亲密度）
router.post('/visit', authenticateToken, (req, res) => {
  try {
    const { friend_id } = req.body;

    const friendship = db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.userId, friend_id);
    if (!friendship) {
      return res.status(400).json({ error: '不是好友关系' });
    }

    const lastVisit = friendship.last_interaction ? new Date(friendship.last_interaction) : null;
    const now = new Date();
    if (lastVisit && (now - lastVisit) < 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: '今天已经访问过该好友，明天再来吧' });
    }

    db.prepare('UPDATE friends SET friendship_level = friendship_level + 1, last_interaction = CURRENT_TIMESTAMP WHERE user_id = ? AND friend_id = ?').run(req.user.userId, friend_id);

    const pet = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.image_urls
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      WHERE p.user_id = ?
    `).get(friend_id);

    res.json({ message: '访问成功，亲密度+1', pet });
  } catch (error) {
    console.error('访问好友错误:', error);
    res.status(500).json({ error: '访问失败' });
  }
});

// 给好友赠送礼物
router.post('/gift', authenticateToken, (req, res) => {
  try {
    const { friend_id, item_id } = req.body;

    const friendship = db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.userId, friend_id);
    if (!friendship) {
      return res.status(400).json({ error: '不是好友关系' });
    }

    const userItem = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ? AND quantity > 0').get(req.user.userId, item_id);
    if (!userItem) {
      return res.status(400).json({ error: '没有该物品' });
    }

    const friendItem = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ?').get(friend_id, item_id);
    if (friendItem) {
      db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE user_id = ? AND item_id = ?').run(friend_id, item_id);
    } else {
      db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, 1)').run(friend_id, item_id);
    }

    db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?').run(req.user.userId, item_id);
    db.prepare('UPDATE friends SET friendship_level = friendship_level + 2, last_interaction = CURRENT_TIMESTAMP WHERE user_id = ? AND friend_id = ?').run(req.user.userId, friend_id);

    res.json({ message: '礼物赠送成功，亲密度+2' });
  } catch (error) {
    console.error('赠送礼物错误:', error);
    res.status(500).json({ error: '赠送失败' });
  }
});

// 好友对战（不消耗体力）
router.post('/friend-battle', authenticateToken, (req, res) => {
  try {
    const { friend_id } = req.body;

    const friendship = db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?').get(req.user.userId, friend_id);
    if (!friendship) {
      return res.status(400).json({ error: '不是好友关系' });
    }

    const myPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!myPet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const friendPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(friend_id);
    if (!friendPet) {
      return res.status(404).json({ error: '好友还没有宠物' });
    }

    const myPower = myPet.attack + myPet.defense + myPet.speed;
    const friendPower = friendPet.attack + friendPet.defense + friendPet.speed;
    const myWinChance = Math.max(0.1, Math.min(0.9, 0.5 + (myPower - friendPower) * 0.001));
    const winner = Math.random() < myWinChance ? myPet.id : friendPet.id;

    const expReward = 50;
    const goldReward = 30;

    if (winner === myPet.id) {
      db.prepare('UPDATE pets SET exp = exp + ?, win_count = win_count + 1, total_battles = total_battles + 1 WHERE id = ?').run(expReward * 2, myPet.id);
      db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(goldReward, req.user.userId);
    } else {
      db.prepare('UPDATE pets SET exp = exp + ? WHERE id = ?').run(expReward, myPet.id);
    }

    db.prepare('UPDATE friends SET friendship_level = friendship_level + 1, last_interaction = CURRENT_TIMESTAMP WHERE user_id = ? AND friend_id = ?').run(req.user.userId, friend_id);

    res.json({
      message: winner === myPet.id ? '胜利！' : '失败了...',
      winner: winner === myPet.id ? '我' : '好友',
      expReward: winner === myPet.id ? expReward * 2 : expReward,
      goldReward: winner === myPet.id ? goldReward : 0,
      myWinChance: Math.round(myWinChance * 100)
    });
  } catch (error) {
    console.error('好友对战错误:', error);
    res.status(500).json({ error: '好友对战失败' });
  }
});

// 删除好友
router.delete('/remove', authenticateToken, (req, res) => {
  try {
    const { friend_id } = req.body;

    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(req.user.userId, friend_id);
    db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(friend_id, req.user.userId);

    res.json({ message: '删除好友成功' });
  } catch (error) {
    console.error('删除好友错误:', error);
    res.status(500).json({ error: '删除好友失败' });
  }
});

module.exports = router;
