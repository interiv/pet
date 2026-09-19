// 系统数据管理接口（仅管理员）
//   GET    /api/admin/system/status      系统状态：迁移情况 + 基础数据 + 演示数据
//   POST   /api/admin/system/migrate     立即执行数据库迁移
//   POST   /api/admin/system/demo-data   导入演示数据（幂等）
//   DELETE /api/admin/system/demo-data   清除演示数据（只删 demo_ 数据）
//   POST   /api/admin/system/reset       重置为全新系统（危险，需确认词）
const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { runMigrations, getStatus, createKnex, resetDatabase } = require('../config/migrate');
const { importDemoData, clearDemoData, getDemoStats } = require('../services/demoData');

const RESET_CONFIRM = '重置';

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足，需要管理员角色' });
  }
  next();
};

// 安全统计（表不存在时返回 0）
const safeCount = (table) => {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } catch (e) {
    return 0;
  }
};

// ==================== 系统状态 ====================
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
  const knex = createKnex();
  try {
    const [done, pendingList] = await knex.migrate.list();
    const pending = (pendingList || []).map((m) => (typeof m === 'string' ? m : m.file || m.name || String(m)));

    res.json({
      migration: {
        ...getStatus(),
        completed: (done || []).length,
        pendingCount: pending.length,
        pending,
        upToDate: pending.length === 0,
      },
      baseData: {
        pet_species: safeCount('pet_species'),
        items: safeCount('items'),
        equipment: safeCount('equipment'),
        skills: safeCount('skills'),
        achievements: safeCount('achievements'),
        tasks: safeCount('tasks'),
        forums: safeCount('forums'),
      },
      counts: {
        users: safeCount('users'),
        classes: safeCount('classes'),
        schools: safeCount('schools'),
        pets: safeCount('pets'),
        assignments: safeCount('assignments'),
      },
      demo: await getDemoStats(knex),
      // 当前公告内容（前端据此决定"是否同时更新公告"的默认勾选状态）
      notices: {
        site_announcement: db.prepare(`SELECT value FROM settings WHERE key = 'site_announcement'`).get()?.value || '',
        home_notice: db.prepare(`SELECT value FROM settings WHERE key = 'home_notice'`).get()?.value || '',
      },
      resetConfirmWord: RESET_CONFIRM,
    });
  } catch (error) {
    console.error('获取系统状态失败:', error);
    res.status(500).json({ error: '获取系统状态失败: ' + error.message });
  } finally {
    await knex.destroy();
  }
});

// ==================== 立即执行迁移 ====================
router.post('/migrate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await runMigrations();
    const message = !result.ok
      ? `迁移失败：${result.error}`
      : (result.applied && result.applied.length
        ? `已执行 ${result.applied.length} 个迁移：${result.applied.join(', ')}`
        : '数据库结构已是最新，无需迁移');
    res.json({ ...result, message });
  } catch (error) {
    console.error('执行迁移失败:', error);
    res.status(500).json({ error: '执行迁移失败: ' + error.message });
  }
});

// ==================== 导入演示数据 ====================
router.post('/demo-data', authenticateToken, requireAdmin, async (req, res) => {
  const knex = createKnex();
  try {
    // updateNotices：是否用演示账号信息替换「全局公告」和「首页公告」
    const updateNotices = !!(req.body && req.body.updateNotices);
    const result = await importDemoData(knex, { updateNotices });
    const created = result.created || [];
    res.json({
      message: created.length
        ? `演示数据导入完成：新建 ${created.join('、')}`
        : '演示数据已存在，无需重复导入',
      ...result,
    });
  } catch (error) {
    console.error('导入演示数据失败:', error);
    res.status(500).json({ error: '导入演示数据失败: ' + error.message });
  } finally {
    await knex.destroy();
  }
});

// ==================== 清除演示数据 ====================
router.delete('/demo-data', authenticateToken, requireAdmin, async (req, res) => {
  const knex = createKnex();
  try {
    const result = await clearDemoData(knex);
    res.json(result);
  } catch (error) {
    console.error('清除演示数据失败:', error);
    res.status(500).json({ error: '清除演示数据失败: ' + error.message });
  } finally {
    await knex.destroy();
  }
});

// ==================== 重置为全新系统（危险）====================
router.post('/reset', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (String(confirm || '').trim() !== RESET_CONFIRM) {
      return res.status(400).json({ error: `请输入确认词「${RESET_CONFIRM}」后再执行` });
    }

    await resetDatabase();

    res.json({
      message: `系统已重置为全新状态：所有数据已清空，基础数据已重新初始化。请使用 admin / 111111 重新登录。`,
      hint: '建议登录后立即修改管理员密码',
    });
  } catch (error) {
    console.error('重置系统失败:', error);
    res.status(500).json({ error: '重置系统失败: ' + error.message });
  }
});

module.exports = router;
