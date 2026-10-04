const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { checkAndAwardAchievement } = require('./achievements');
const { grantReward } = require('../services/rewards');
const { elementMultiplier } = require('../utils/elements');
const { getChinaDate } = require('../config/timezone');
const { requireFeature } = require('../middleware/featureFlags');
// 好友对战也是 PVP 的一种入口，必须跟着「宠物战斗」开关一起关
const battleOff = requireFeature('battle_enabled', { message: '宠物对战当前已关闭' });

// 好友对战每日上限（不消耗体力，必须限次，否则可无限刷经验与金币）
const DAILY_FRIEND_BATTLE_LIMIT = 5;

// 获取好友列表（只返回已通过的好友）
router.get('/list', authenticateToken, (req, res) => {
  try {
    const friends = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.avatar, f.friendship_level, f.last_interaction
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = ? AND f.status = 'active'
    `).all(req.user.userId);

    res.json({ friends });
  } catch (error) {
    console.error('获取好友列表错误:', error);
    res.status(500).json({ error: '获取好友列表失败' });
  }
});

// 获取待处理的好友请求
router.get('/pending-requests', authenticateToken, (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT fr.id, fr.sender_id, fr.created_at, u.username, u.real_name, u.avatar, u.role
      FROM friend_requests fr
      JOIN users u ON fr.sender_id = u.id
      WHERE fr.receiver_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(req.user.userId);

    res.json({ requests });
  } catch (error) {
    console.error('获取好友请求错误:', error);
    res.status(500).json({ error: '获取好友请求失败' });
  }
});

// 发送好友请求
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

    // 检查是否已经是好友
    const existingFriend = db.prepare("SELECT id FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'active'").get(req.user.userId, friend.id);
    if (existingFriend) {
      return res.status(400).json({ error: '已经是好友了' });
    }

    // 检查是否已有待处理的请求
    const existingRequest = db.prepare("SELECT id FROM friend_requests WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'").get(req.user.userId, friend.id);
    if (existingRequest) {
      return res.status(400).json({ error: '已发送好友请求，等待对方接受' });
    }

    // 检查对方是否已经发送过请求给我
    const reverseRequest = db.prepare("SELECT id FROM friend_requests WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'").get(friend.id, req.user.userId);
    if (reverseRequest) {
      // 自动接受对方的请求
      db.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(reverseRequest.id);
      
      // 创建双向好友关系
      db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'active')").run(req.user.userId, friend.id);
      db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'active')").run(friend.id, req.user.userId);
      
      // 发送通知
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
        VALUES (?, 'friend_accepted', '好友请求已通过', ?, 'friend', ?)
      `).run(friend.id, `${req.user.real_name || req.user.username} 通过了你的好友请求`, req.user.userId);
      
      // 成就检查
      try {
        const friendCount = db.prepare("SELECT COUNT(*) as c FROM friends WHERE user_id = ? AND status = 'active'").get(req.user.userId)?.c || 0;
        checkAndAwardAchievement(req.user.userId, 'add_friends', friendCount);
        const friendCount2 = db.prepare("SELECT COUNT(*) as c FROM friends WHERE user_id = ? AND status = 'active'").get(friend.id)?.c || 0;
        checkAndAwardAchievement(friend.id, 'add_friends', friendCount2);
      } catch (e) { console.error('成就检查失败:', e); }

      return res.json({ message: '好友添加成功' });
    }

    // 创建好友请求
    db.prepare(`
      INSERT OR IGNORE INTO friend_requests (sender_id, receiver_id, status)
      VALUES (?, ?, 'pending')
    `).run(req.user.userId, friend.id);

    // 发送通知
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
      VALUES (?, 'friend_request', '收到新的好友请求', ?, 'friend_request', ?)
    `).run(friend.id, `${req.user.real_name || req.user.username} 请求添加你为好友`, req.user.userId);

    res.json({ message: '好友请求已发送，等待对方接受' });
  } catch (error) {
    console.error('添加好友错误:', error);
    res.status(500).json({ error: '添加好友失败' });
  }
});

// 接受好友请求
router.post('/accept-request', authenticateToken, (req, res) => {
  try {
    const { request_id } = req.body;

    const request = db.prepare("SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = 'pending'").get(request_id, req.user.userId);
    if (!request) {
      return res.status(404).json({ error: '好友请求不存在' });
    }

    // 更新请求状态
    db.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(request_id);

    // 创建双向好友关系
    db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'active')").run(req.user.userId, request.sender_id);
    db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'active')").run(request.sender_id, req.user.userId);

    // 发送通知
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
      VALUES (?, 'friend_accepted', '好友请求已通过', ?, 'friend', ?)
    `).run(request.sender_id, `${req.user.real_name || req.user.username} 通过了你的好友请求`, req.user.userId);

    // 成就检查
    try {
      const friendCount = db.prepare("SELECT COUNT(*) as c FROM friends WHERE user_id = ? AND status = 'active'").get(req.user.userId)?.c || 0;
      checkAndAwardAchievement(req.user.userId, 'add_friends', friendCount);
      const friendCount2 = db.prepare("SELECT COUNT(*) as c FROM friends WHERE user_id = ? AND status = 'active'").get(request.sender_id)?.c || 0;
      checkAndAwardAchievement(request.sender_id, 'add_friends', friendCount2);
    } catch (e) { console.error('成就检查失败:', e); }

    res.json({ message: '已接受好友请求' });
  } catch (error) {
    console.error('接受好友请求错误:', error);
    res.status(500).json({ error: '接受好友请求失败' });
  }
});

// 拒绝好友请求
router.post('/reject-request', authenticateToken, (req, res) => {
  try {
    const { request_id } = req.body;

    const request = db.prepare("SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = 'pending'").get(request_id, req.user.userId);
    if (!request) {
      return res.status(404).json({ error: '好友请求不存在' });
    }

    // 更新请求状态
    db.prepare("UPDATE friend_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(request_id);

    res.json({ message: '已拒绝好友请求' });
  } catch (error) {
    console.error('拒绝好友请求错误:', error);
    res.status(500).json({ error: '拒绝好友请求失败' });
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
      SELECT u.id, u.username, u.real_name, u.avatar, u.role, c.name as class_name
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
router.post('/friend-battle', authenticateToken, battleOff, (req, res) => {
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
    if (myPet.status === 'unconscious') {
      return res.status(400).json({ error: '宠物已昏迷，无法战斗' });
    }

    const friendPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(friend_id);
    if (!friendPet) {
      return res.status(404).json({ error: '好友还没有宠物' });
    }
    if (friendPet.status === 'unconscious') {
      return res.status(400).json({ error: '好友的宠物已昏迷，无法战斗' });
    }

    // 每日次数上限（东八区自然日）：不消耗体力 + 必胜/必得奖励 = 无限刷，必须限次
    const today = getChinaDate();
    const todayBattles = db.prepare(
      "SELECT COUNT(*) as c FROM user_activities WHERE user_id = ? AND activity_type = 'friend_battle' AND DATE(created_at, '+8 hours') = ?"
    ).get(req.user.userId, today)?.c || 0;
    if (todayBattles >= DAILY_FRIEND_BATTLE_LIMIT) {
      return res.status(429).json({ error: `今日好友对战次数已达上限（${DAILY_FRIEND_BATTLE_LIMIT} 次），明天再来吧` });
    }

    const myPower = myPet.attack + myPet.defense + myPet.speed;
    const friendPower = friendPet.attack + friendPet.defense + friendPet.speed;

    // 属性克制同样影响好友对战的胜率评估（火→草→水→火，光↔暗）
    const myElement = db
      .prepare('SELECT ps.element_type AS e FROM pets p JOIN pet_species ps ON p.species_id = ps.id WHERE p.id = ?')
      .get(myPet.id)?.e || null;
    const friendElement = db
      .prepare('SELECT ps.element_type AS e FROM pets p JOIN pet_species ps ON p.species_id = ps.id WHERE p.id = ?')
      .get(friendPet.id)?.e || null;
    const elemBonus = (elementMultiplier(myElement, friendElement).multiplier - 1) * 0.25;

    const myWinChance = Math.max(0.1, Math.min(0.9, 0.5 + (myPower - friendPower) * 0.001 + elemBonus));
    const winner = Math.random() < myWinChance ? myPet.id : friendPet.id;

    const expReward = 50;
    const goldReward = 30;
    const myWin = winner === myPet.id;

    // 双方战绩都要记账：原先失败分支既不更新 win_count 也不更新 total_battles，
    // 且好友方宠物完全不更新，导致胜率统计失真
    let battleReward = null;
    if (myWin) {
      db.prepare('UPDATE pets SET win_count = win_count + 1, total_battles = total_battles + 1 WHERE id = ?').run(myPet.id);
      db.prepare('UPDATE pets SET total_battles = total_battles + 1 WHERE id = ?').run(friendPet.id);
      // 经验与金币走统一管道（内部负责升级判定、累计金币成就与流水）
      battleReward = grantReward(req.user.userId, {
        gold: goldReward,
        exp: expReward * 2,
        source: 'friend_battle',
        reason: '好友对战胜利',
      });
    } else {
      db.prepare('UPDATE pets SET total_battles = total_battles + 1 WHERE id = ?').run(myPet.id);
      db.prepare('UPDATE pets SET win_count = win_count + 1, total_battles = total_battles + 1 WHERE id = ?').run(friendPet.id);
      battleReward = grantReward(req.user.userId, {
        exp: expReward,
        source: 'friend_battle',
        reason: '好友对战参与奖励',
      });
    }

    // 记录对战流水，供每日上限统计
    db.prepare("INSERT INTO user_activities (user_id, activity_type, metadata) VALUES (?, 'friend_battle', ?)")
      .run(req.user.userId, JSON.stringify({ friend_id, win: myWin }));

    // 升级检查已由 grantReward 内部完成（原先缺失：经验涨了但宠物不升级）
    const levelUp = (battleReward && battleReward.levelUp) || { leveledUp: false };

    db.prepare('UPDATE friends SET friendship_level = friendship_level + 1, last_interaction = CURRENT_TIMESTAMP WHERE user_id = ? AND friend_id = ?').run(req.user.userId, friend_id);

    res.json({
      message: myWin ? '胜利！' : '失败了...',
      winner: myWin ? '我' : '好友',
      expReward: myWin ? expReward * 2 : expReward,
      goldReward: myWin ? goldReward : 0,
      myWinChance: Math.round(myWinChance * 100),
      remaining_today: Math.max(0, DAILY_FRIEND_BATTLE_LIMIT - todayBattles - 1),
      levelUp
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
