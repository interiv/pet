/**
 * AI 直连接令管理（教师自己操作，需要登录态）
 *
 * 令牌明文只在创建时返回一次；列表只展示前缀与最近使用时间。
 * 教师可随时吊销，令牌立即失效。
 */

const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { generateToken, hashToken, TOKEN_PREFIX } = require('../middleware/agentAuth');

router.use(authenticateToken);

function requireTeacher(req, res, next) {
  if (!['teacher', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: '只有教师或管理员可以管理 AI 直连接令' });
  }
  next();
}

router.get('/', authenticateToken, requireTeacher, (req, res) => {
  try {
    const tokens = db.prepare(`
      SELECT id, name, token_prefix, created_at, last_used_at, revoked_at
      FROM agent_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.userId);
    res.json({ tokens, prefix: TOKEN_PREFIX });
  } catch (error) {
    console.error('获取 AI 直连接令失败:', error);
    res.status(500).json({ error: '获取令牌失败' });
  }
});

router.post('/', authenticateToken, requireTeacher, (req, res) => {
  try {
    const userId = req.user.userId;
    // 同一老师最多 5 个有效令牌，避免发一堆忘在各处
    const active = db.prepare(`SELECT COUNT(*) AS c FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL`).get(userId);
    if (active.c >= 5) {
      return res.status(400).json({ error: '最多同时启用 5 个令牌，请先吊销不用的' });
    }

    const name = String(req.body?.name || '').trim().slice(0, 30) || '默认令牌';
    const token = generateToken();
    const result = db.prepare(`
      INSERT INTO agent_tokens (user_id, name, token_hash, token_prefix)
      VALUES (?, ?, ?, ?)
    `).run(userId, name, hashToken(token), `${token.slice(0, 8)}…${token.slice(-4)}`);

    res.json({
      message: '令牌已生成，请立刻复制保存（只显示这一次）',
      id: result.lastInsertRowid,
      name,
      token, // 明文只在创建时返回
      token_prefix: `${token.slice(0, 8)}…${token.slice(-4)}`,
    });
  } catch (error) {
    console.error('生成 AI 直连接令失败:', error);
    res.status(500).json({ error: '生成令牌失败' });
  }
});

router.delete('/:id', authenticateToken, requireTeacher, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare(`SELECT id FROM agent_tokens WHERE id = ? AND user_id = ?`).get(id, req.user.userId);
    if (!row) return res.status(404).json({ error: '令牌不存在' });
    db.prepare(`UPDATE agent_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(id);
    res.json({ message: '令牌已吊销，AI 将无法再使用' });
  } catch (error) {
    console.error('吊销令牌失败:', error);
    res.status(500).json({ error: '吊销失败' });
  }
});

module.exports = router;
