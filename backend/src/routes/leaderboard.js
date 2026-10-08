const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 胜率榜最小场次门槛（低于该场次不进入排名）
const MIN_BATTLES_FOR_RANK = 5;

function parseLimit(raw, def = 20, max = 100) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

// ===== 公开榜（免登录，供首页展示）=====
//
// 为什么要单独一个接口：/level 这类榜单要登录（见文件头注释——原先无鉴权，
// 未登录就能拉全站学生真名，属于安全问题）。但首页是给访客看的，
// 结果访客看到的排行榜永远是空的（401 → 数组为空 → 区块不渲染）。
//
// 脱敏口径（公开接口必须守住的红线）：
//   出 owner_name / username —— 学生真名绝不外泄；
//   出 gold                 —— 精确金币容易引发攀比与骚扰，只出等级；
//   出 class_name / school_name —— 让访客知道这是哪个学校哪个班，
//                              这正是首页想展示的「学校/班级」信息。
// 只保留宠物昵称（学生自己起的宠物名，不等于本人真名）、物种、等级、学校班级。
router.get('/public', (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 10, 50);
    const rows = db
      .prepare(
        `SELECT p.name AS pet_name, p.level, p.image_id,
                ps.name AS species_name, ps.image_urls,
                c.name AS class_name, c.grade,
                s.name AS school_name, s.theme_color AS school_theme
         FROM pets p
         JOIN pet_species ps ON p.species_id = ps.id
   JOIN users u ON p.user_id = u.id
        LEFT JOIN classes c ON u.class_id = c.id
         LEFT JOIN schools s ON c.school_id = s.id
      WHERE u.role = 'student'
     ORDER BY p.level DESC, p.exp DESC
         LIMIT ?`
      )
      .all(limit);
    res.json({ leaderboard: rows });
  } catch (error) {
    console.error('获取公开排行榜错误:', error);
    res.status(500).json({ error: '获取排行榜失败' });
  }
});

// 等级排行榜（可按班级过滤）
// 需要登录：原实现无鉴权，未登录即可拉取全站学生的真实姓名
router.get('/level', authenticateToken, (req, res) => {
  try {
    const { class_id } = req.query;
    const limit = parseLimit(req.query.limit, 20);
    let sql = `
      SELECT p.*, ps.name as species_name, ps.image_urls, COALESCE(u.real_name, u.username) as owner_name, u.class_id
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
             ps.name as species_name, ps.image_urls, COALESCE(u.real_name, u.username) as owner_name, u.class_id
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
    // 最小场次门槛：原先 1 战 1 胜即可登顶，榜首没有参考价值
    sql += ` AND p.total_battles >= ${MIN_BATTLES_FOR_RANK}`;
    sql += ` ORDER BY win_rate DESC, p.total_battles DESC LIMIT ?`;
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
      SELECT u.id, u.username, u.real_name, u.class_id,
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
