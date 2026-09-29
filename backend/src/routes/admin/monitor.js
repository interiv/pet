const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const {
  USERNAME_MAX_LEN,
  AI_USERNAME_BATCH_SIZE,
  requireAdmin,
  purgeUserData,
  applyApplicationToClass,
  approveTeacherPendingApplications,
  checkDataPermission,
  cleanStudentNames,
  findDuplicateNames,
  sanitizeUsername,
  sanitizeSequencePrefix,
  isUsernameTaken,
  ensureUniqueUsername,
  randomPassword,
  parseJSONArray,
  generateUsernamesByAI,
  ensureSettingsTable,
} = require('./_shared');

router.get('/battles', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { class_id } = req.query;

    const perm = checkDataPermission('perm_battle_records', userId, userRole);
    if (!perm.allowed) {
      return res.status(403).json({ error: '无权查看战斗记录' });
    }

    let sql = `
      SELECT b.*,
        p1.user_id as challenger_id,
        p2.user_id as defender_id,
        COALESCE(u1.real_name, u1.username) as challenger_name,
        COALESCE(u2.real_name, u2.username) as defender_name,
        c.name as class_name
      FROM battles b
      JOIN pets p1 ON b.pet1_id = p1.id
      JOIN pets p2 ON b.pet2_id = p2.id
      JOIN users u1 ON p1.user_id = u1.id
      JOIN users u2 ON p2.user_id = u2.id
      LEFT JOIN classes c ON u1.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (perm.classIds !== null) {
      if (perm.classIds.length > 0) {
        const placeholders = perm.classIds.map(() => '?').join(',');
        sql += ` AND u1.class_id IN (${placeholders})`;
        params.push(...perm.classIds);
      } else {
        sql += ` AND 1=0`;
      }
    }

    if (class_id) {
      sql += ` AND u1.class_id = ?`;
      params.push(class_id);
    }

    sql += ` ORDER BY b.battle_date DESC LIMIT 100`;

    const battles = db.prepare(sql).all(...params);
    res.json({ battles });
  } catch (error) {
    console.error('获取战斗记录失败:', error);
    res.status(500).json({ error: '获取战斗记录失败' });
  }
});

router.get('/shop-records', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { class_id } = req.query;

    const perm = checkDataPermission('perm_purchase_records', userId, userRole);
    if (!perm.allowed) {
      return res.status(403).json({ error: '无权查看购买记录' });
    }

    let sql = `
      SELECT ui.*,
        COALESCE(u.real_name, u.username) as buyer_name,
        i.name as item_name,
        i.rarity,
        c.name as class_name
      FROM user_items ui
      JOIN users u ON ui.user_id = u.id
      JOIN items i ON ui.item_id = i.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (perm.classIds !== null) {
      if (perm.classIds.length > 0) {
        const placeholders = perm.classIds.map(() => '?').join(',');
        sql += ` AND u.class_id IN (${placeholders})`;
        params.push(...perm.classIds);
      } else {
        sql += ` AND 1=0`;
      }
    }

    if (class_id) {
      sql += ` AND u.class_id = ?`;
      params.push(class_id);
    }

    sql += ` ORDER BY ui.obtained_at DESC LIMIT 100`;

    const records = db.prepare(sql).all(...params);
    res.json({ records });
  } catch (error) {
    console.error('获取商店记录失败:', error);
    res.status(500).json({ error: '获取商店记录失败' });
  }
});

router.get('/token-usage/dashboard', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const { getChinaDate } = require('../config/timezone');
    const today = getChinaDate();

    const todayStats = db.prepare(`
      SELECT 
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as total_generations
      FROM token_usage WHERE date = ?
    `).get(today);

    const last7Days = db.prepare(`
      SELECT 
        date,
        SUM(prompt_tokens) as prompt_tokens,
        SUM(completion_tokens) as completion_tokens,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as generations,
        COUNT(DISTINCT user_id) as active_teachers
      FROM token_usage 
      WHERE date >= date(?, '-6 days')
      GROUP BY date 
      ORDER BY date ASC
    `).all(today);

    const topTeachers = db.prepare(`
      SELECT 
        tu.user_id,
        u.username,
        SUM(tu.total_tokens) as total_tokens,
        SUM(tu.prompt_tokens) as prompt_tokens,
        SUM(tu.completion_tokens) as completion_tokens,
        COUNT(*) as generations
      FROM token_usage tu
      JOIN users u ON tu.user_id = u.id
      WHERE tu.date = ?
      GROUP BY tu.user_id
      ORDER BY total_tokens DESC
      LIMIT 10
    `).all(today);

    const settings = db.prepare(`SELECT key, value FROM settings WHERE key IN ('daily_global_token_limit', 'daily_teacher_gen_limit', 'max_tokens_per_generation', 'max_questions_per_generation')`).all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = parseInt(s.value) || 0);

    res.json({
      today: todayStats,
      last7Days,
      topTeachers,
      settings: settingsMap,
      date: today
    });
  } catch (error) {
    console.error('获取Token看板失败:', error);
    res.status(500).json({ error: '获取Token看板失败' });
  }
});

router.get('/token-usage/records', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const { user_id, date, page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let sql = `
      SELECT tu.*, u.username
      FROM token_usage tu
      JOIN users u ON tu.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (user_id) {
      sql += ` AND tu.user_id = ?`;
      params.push(user_id);
    }
    if (date) {
      sql += ` AND tu.date = ?`;
      params.push(date);
    }

    const countResult = db.prepare(`SELECT COUNT(*) as total FROM token_usage tu JOIN users u ON tu.user_id = u.id WHERE 1=1${user_id ? ' AND tu.user_id = ?' : ''}${date ? ' AND tu.date = ?' : ''}`).get(...params);
    
    sql += ` ORDER BY tu.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(pageSize), offset);

    const records = db.prepare(sql).all(...params);

    res.json({
      records,
      total: countResult.total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取Token记录失败:', error);
    res.status(500).json({ error: '获取Token记录失败' });
  }
});

router.get('/token-usage/my-limit', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: '仅教师可查看' });
    }
    ensureSettingsTable();
    const { getChinaDate } = require('../config/timezone');
    const today = getChinaDate();

    const dailyLimit = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'daily_teacher_gen_limit'`).get()?.value || '5');
    const todayCount = db.prepare(`SELECT COUNT(*) as count FROM token_usage WHERE user_id = ? AND date = ?`).get(req.user.userId, today)?.count || 0;

    const globalTokenLimit = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'daily_global_token_limit'`).get()?.value || '2000000');
    const todayGlobalTokens = db.prepare(`SELECT COALESCE(SUM(completion_tokens), 0) as total FROM token_usage WHERE date = ?`).get(today)?.total || 0;

    res.json({
      daily_limit: dailyLimit,
      daily_used: todayCount,
      daily_remaining: Math.max(0, dailyLimit - todayCount),
      global_token_limit: globalTokenLimit,
      global_tokens_used: todayGlobalTokens,
      global_tokens_remaining: Math.max(0, globalTokenLimit - todayGlobalTokens),
      date: today
    });
  } catch (error) {
    console.error('查询生成限制失败:', error);
    res.status(500).json({ error: '查询生成限制失败' });
  }
});

module.exports = router;
