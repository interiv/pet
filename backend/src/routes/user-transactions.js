/**
 * 学生端「我的资产明细」：金币 + 物品/装备/技能 合并流水
 *
 * 背景：原先只有 gold_transactions（金币流水），商店消费、装备买卖、技能升级
 *   等扣款都没写流水；物品/装备更是完全没有流水表。学生在右上角点金币时
 *   只能看到一个总数，看不到明细。
 *
 * GET /users/me/transactions?type=all|gold|item&page=1&pageSize=20
 */
const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const hasTable = (name) => !!db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
).get(name);

const SOURCE_LABEL = {
  assignment: '作业', homework: '作业', battle: '对战', boss_battle: 'BOSS 挑战',
  card: '卡片兑换', card_redeem: '卡片兑换', shop: '商店',
  sell_equipment: '出售装备', upgrade_equipment: '强化装备', upgrade_skill: '技能升级',
  daily_task: '每日任务', achievement: '成就', friend: '好友赠礼',
  feed_pet: '投喂宠物', revive_pet: '复活宠物', rebirth_pet: '宠物转生',
  create_pet: '创建宠物', admin: '管理员调整', legacy: '历史数据',
  classroom_quiz: '课堂答题', manual: '手动调整',
};

const REF_TYPE_LABEL = { item: '道具', equipment: '装备', skill: '技能' };

router.get('/me/transactions', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const type = String(req.query.type || 'all');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));

    const rows = [];

    if ((type === 'all' || type === 'gold') && hasTable('gold_transactions')) {
      const goldRows = db.prepare(
        `SELECT id, gold_change AS amount, reason, source, created_at
           FROM gold_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 300`
      ).all(userId);
      for (const r of goldRows) {
        rows.push({
          kind: 'gold', kindLabel: '金币', amount: r.amount,
          reason: r.reason || '', source: r.source || '',
          sourceLabel: SOURCE_LABEL[r.source] || r.source || '其他',
          created_at: r.created_at,
        });
      }
    }

    if ((type === 'all' || type === 'item') && hasTable('item_transactions')) {
      const itemRows = db.prepare(
        `SELECT id, ref_type, ref_id, name, change, reason, source, created_at
           FROM item_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 300`
      ).all(userId);
      for (const r of itemRows) {
        rows.push({
          kind: r.ref_type || 'item', kindLabel: REF_TYPE_LABEL[r.ref_type] || '道具',
          name: r.name || (r.ref_id ? '#' + r.ref_id : ''), amount: r.change,
          reason: r.reason || '', source: r.source || '',
          sourceLabel: SOURCE_LABEL[r.source] || r.source || '其他',
          created_at: r.created_at,
        });
      }
    }

    rows.sort((a, b) => {
      const ta = String(a.created_at || '');
      const tb = String(b.created_at || '');
      if (ta === tb) return 0;
      return ta < tb ? 1 : -1;
    });

    const user = db.prepare('SELECT gold, total_gold_earned FROM users WHERE id = ?').get(userId) || {};
    const total = rows.length;
    const start = (page - 1) * pageSize;

    res.json({
      transactions: rows.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      summary: {
        gold: user.gold || 0,
        totalGoldEarned: user.total_gold_earned || 0,
        goldIn: rows.filter((r) => r.kind === 'gold' && r.amount > 0).reduce((s, r) => s + r.amount, 0),
        goldOut: Math.abs(rows.filter((r) => r.kind === 'gold' && r.amount < 0).reduce((s, r) => s + r.amount, 0)),
        itemIn: rows.filter((r) => r.kind === 'item' && r.amount > 0).reduce((s, r) => s + r.amount, 0),
        itemOut: Math.abs(rows.filter((r) => r.kind === 'item' && r.amount < 0).reduce((s, r) => s + r.amount, 0)),
      },
    });
  } catch (error) {
    console.error('获取资产明细失败:', error);
    res.status(500).json({ error: '获取资产明细失败' });
  }
});

module.exports = router;
