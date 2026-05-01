const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const conditionTypes = require('../config/achievementConditions');

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
};

// 检查并发放成就
function checkAndAwardAchievement(userId, achievementType, currentValue) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (user && (user.role === 'teacher' || user.role === 'admin')) return [];

  const allAchievements = db.prepare(
    "SELECT * FROM achievements WHERE json_extract(condition, '$.type') = ?"
  ).all(achievementType);

  const newAchievements = [];
  for (const ach of allAchievements) {
    const cond = JSON.parse(ach.condition);
    const thresholdKey = Object.keys(cond).find(k => k !== 'type');
    const threshold = cond[thresholdKey];

    if (currentValue >= threshold) {
      const existing = db.prepare(
        'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ?'
      ).get(userId, ach.id);
      if (existing) continue;

      db.prepare(
        'INSERT INTO user_achievements (user_id, achievement_id, completed_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
      ).run(userId, ach.id);

      try {
        db.prepare(
          "INSERT INTO notifications (user_id, type, title, content, source_type, source_id) VALUES (?, 'achievement', ?, ?, 'achievement', ?)"
        ).run(userId, '🎉 成就解锁！', `恭喜解锁成就「${ach.name}」！${ach.description}`, ach.id);
      } catch (notifErr) { console.error('成就通知创建失败:', notifErr); }

      if (ach.reward_type === 'gold') {
        db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?').run(ach.reward_value, ach.reward_value, userId);
      } else if (ach.reward_type === 'exp') {
        const pet = db.prepare('SELECT id FROM pets WHERE user_id = ?').get(userId);
        if (pet) {
          db.prepare('UPDATE pets SET exp = exp + ?, total_exp_earned = total_exp_earned + ? WHERE id = ?').run(ach.reward_value, ach.reward_value, pet.id);
        }
      } else if (ach.reward_type === 'item') {
        const existingItem = db.prepare(
          'SELECT id FROM user_items WHERE user_id = ? AND item_id = ?'
        ).get(userId, ach.reward_value);
        if (existingItem) {
          db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE user_id = ? AND item_id = ?')
            .run(userId, ach.reward_value);
        } else {
          db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, 1)')
            .run(userId, ach.reward_value);
        }
      }

      newAchievements.push(ach);
    }
  }

  return newAchievements;
}

// 获取条件类型列表（给前端动态表单用）
router.get('/condition-types', authenticateToken, (req, res) => {
  res.json({ types: conditionTypes });
});

// 获取成就列表
router.get('/list', authenticateToken, (req, res) => {
  try {
    const achievements = db.prepare('SELECT * FROM achievements ORDER BY sort_order, id').all();
    res.json({ achievements });
  } catch (error) {
    console.error('获取成就列表错误:', error);
    res.status(500).json({ error: '获取成就列表失败' });
  }
});

// 获取用户成就
router.get('/my-achievements', authenticateToken, (req, res) => {
  try {
    const achievements = db.prepare(`
      SELECT a.*, ua.completed_at
      FROM user_achievements ua
      JOIN achievements a ON ua.achievement_id = a.id
      WHERE ua.user_id = ?
    `).all(req.user.userId);

    res.json({ achievements });
  } catch (error) {
    console.error('获取用户成就错误:', error);
    res.status(500).json({ error: '获取成就失败' });
  }
});

// 手动检查成就（可在关键操作后调用）
router.post('/check', authenticateToken, (req, res) => {
  try {
    const { type, value } = req.body;
    const newAchievements = checkAndAwardAchievement(req.user.userId, type, value);
    res.json({
      message: newAchievements.length > 0 ? `解锁了 ${newAchievements.length} 个成就` : '没有新的成就',
      newAchievements
    });
  } catch (error) {
    console.error('检查成就错误:', error);
    res.status(500).json({ error: '检查成就失败' });
  }
});

// 获取所有成就及其完成状态
router.get('/status', authenticateToken, (req, res) => {
  try {
    const allAchievements = db.prepare('SELECT * FROM achievements ORDER BY sort_order, id').all();
    const completedAchievements = db.prepare(
      'SELECT achievement_id, completed_at FROM user_achievements WHERE user_id = ?'
    ).all(req.user.userId);
    const completedMap = {};
    completedAchievements.forEach(a => { completedMap[a.achievement_id] = a.completed_at; });

    const status = allAchievements.map(a => {
      const completed = !!completedMap[a.id];
      let progress = 0;
      try {
        const cond = JSON.parse(a.condition);
        const thresholdKey = Object.keys(cond).find(k => k !== 'type');
        const threshold = cond[thresholdKey] || 1;
        let currentValue = 0;
        switch (cond.type) {
          case 'submit_assignment':
            currentValue = db.prepare('SELECT COUNT(*) as c FROM submissions WHERE user_id = ?').get(req.user.userId)?.c || 0;
            break;
          case 'review_wrong':
            currentValue = db.prepare('SELECT COUNT(*) as c FROM wrong_questions WHERE user_id = ? AND reviewed = 1').get(req.user.userId)?.c || 0;
            break;
          case 'total_gold':
            currentValue = db.prepare('SELECT total_gold_earned FROM users WHERE id = ?').get(req.user.userId)?.total_gold_earned || 0;
            break;
          case 'login':
            currentValue = db.prepare('SELECT COUNT(DISTINCT date) as c FROM daily_tasks WHERE user_id = ?').get(req.user.userId)?.c || 0;
            break;
          case 'complete_daily_task':
            currentValue = db.prepare("SELECT COUNT(*) as c FROM daily_task_logs WHERE user_id = ? AND is_completed = 1").get(req.user.userId)?.c || 0;
            break;
          case 'add_friends':
            currentValue = db.prepare('SELECT COUNT(*) as c FROM friendships WHERE user_id = ? OR friend_id = ?').get(req.user.userId, req.user.userId)?.c || 0;
            break;
          case 'create_pet':
            currentValue = db.prepare('SELECT COUNT(*) as c FROM pets WHERE user_id = ?').get(req.user.userId)?.c || 0;
            break;
          case 'feed_pet':
            currentValue = db.prepare("SELECT COUNT(*) as c FROM gold_transactions WHERE user_id = ? AND reason LIKE '%投喂%'").get(req.user.userId)?.c || 0;
            break;
          case 'win_battle':
            currentValue = db.prepare("SELECT COUNT(*) as c FROM battle_results WHERE winner_id = ?").get(req.user.userId)?.c || 0;
            break;
          case 'lose_battle':
            currentValue = db.prepare("SELECT COUNT(*) as c FROM battle_results WHERE loser_id = ?").get(req.user.userId)?.c || 0;
            break;
          case 'perfect_score':
            currentValue = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE user_id = ? AND total_score = total_max_score").get(req.user.userId)?.c || 0;
            break;
          case 'high_score':
            const minScore = cond.score || 90;
            currentValue = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE user_id = ? AND total_score >= ?").get(req.user.userId, minScore)?.c || 0;
            break;
          case 'pet_level':
            currentValue = db.prepare('SELECT MAX(level) as lv FROM pets WHERE user_id = ?').get(req.user.userId)?.lv || 0;
            break;
          case 'total_exp':
            currentValue = db.prepare('SELECT COALESCE(SUM(total_exp_earned),0) as v FROM pets WHERE user_id = ?').get(req.user.userId)?.v || 0;
            break;
          case 'continuous_login':
            currentValue = db.prepare("SELECT MAX(streak_days) as d FROM daily_tasks WHERE user_id = ?").get(req.user.userId)?.d || 0;
            break;
          case 'collect_equipment':
            currentValue = db.prepare("SELECT COUNT(DISTINCT item_id) as c FROM user_items WHERE user_id = ?").get(req.user.userId)?.c || 0;
            break;
          case 'send_message':
            currentValue = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE sender_id = ?").get(req.user.userId)?.c || 0;
            break;
          case 'post_count':
          case 'forum_post':
            currentValue = db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id = ?").get(req.user.userId)?.c || 0;
            break;
          default:
            break;
        }
        progress = Math.min(Math.round((currentValue / threshold) * 100), completed ? 100 : 100);
      } catch (e) { /* ignore */ }
      return {
        ...a,
        completed,
        completed_at: completedMap[a.id] || null,
        progress: completed ? 100 : progress
      };
    });

    res.json({ achievements: status });
  } catch (error) {
    console.error('获取成就状态错误:', error);
    res.status(500).json({ error: '获取成就状态失败' });
  }
});

// ============ 管理员 CRUD ============

// 获取道具列表（供管理员选择奖励道具）
router.get('/admin/items', authenticateToken, requireAdmin, (req, res) => {
  try {
    const items = db.prepare('SELECT id, name, price FROM items ORDER BY id').all();
    res.json({ items });
  } catch (error) {
    console.error('获取道具列表错误:', error);
    res.status(500).json({ error: '获取道具列表失败' });
  }
});

// 创建成就
router.post('/admin', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, description, condition, reward_type, reward_value, category, icon, sort_order } = req.body;

    if (!name || !condition || !reward_type) {
      return res.status(400).json({ error: '名称、条件、奖励类型为必填' });
    }

    const condStr = typeof condition === 'string' ? condition : JSON.stringify(condition);

    const result = db.prepare(`
      INSERT INTO achievements (name, description, condition, reward_type, reward_value, category, icon, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      description || '',
      condStr,
      reward_type,
      reward_value || 0,
      category || 'special',
      icon || '🏆',
      sort_order || 0
    );

    const achievement = db.prepare('SELECT * FROM achievements WHERE id = ?').get(result.lastInsertRowid);
    res.json({ message: '成就创建成功', achievement });
  } catch (error) {
    console.error('创建成就错误:', error);
    res.status(500).json({ error: '创建成就失败' });
  }
});

// 更新成就
router.put('/admin/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, condition, reward_type, reward_value, category, icon, sort_order } = req.body;

    const existing = db.prepare('SELECT * FROM achievements WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '成就不存在' });
    }

    const condStr = condition ? (typeof condition === 'string' ? condition : JSON.stringify(condition)) : existing.condition;

    db.prepare(`
      UPDATE achievements SET name = ?, description = ?, condition = ?, reward_type = ?, reward_value = ?, category = ?, icon = ?, sort_order = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      condStr,
      reward_type || existing.reward_type,
      reward_value !== undefined ? reward_value : existing.reward_value,
      category || existing.category,
      icon || existing.icon,
      sort_order !== undefined ? sort_order : existing.sort_order,
      id
    );

    const achievement = db.prepare('SELECT * FROM achievements WHERE id = ?').get(id);
    res.json({ message: '成就更新成功', achievement });
  } catch (error) {
    console.error('更新成就错误:', error);
    res.status(500).json({ error: '更新成就失败' });
  }
});

// 删除成就
router.delete('/admin/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM achievements WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '成就不存在' });
    }

    db.prepare('DELETE FROM user_achievements WHERE achievement_id = ?').run(id);
    db.prepare('DELETE FROM achievements WHERE id = ?').run(id);

    res.json({ message: '成就删除成功' });
  } catch (error) {
    console.error('删除成就错误:', error);
    res.status(500).json({ error: '删除成就失败' });
  }
});

module.exports = router;
module.exports.checkAndAwardAchievement = checkAndAwardAchievement;
