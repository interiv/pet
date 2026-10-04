// AI 助手（WorkBuddy / CodeBuddy 等）直连认证
//
// AI 用固定令牌代替「登录拿 JWT」：请求头 X-Agent-Token: <token>
// 令牌由教师在「课堂做题 → AI 工具录入 → 直连」里自己生成，可随时吊销。
// 服务端只存 sha256 摘要，明文只在生成时返回一次。

const crypto = require('crypto');
const { db } = require('../config/database');

const TOKEN_PREFIX = 'pt_';

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function generateToken() {
  return `${TOKEN_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

function extractToken(req) {
  const header = req.headers['x-agent-token'];
  if (header) return String(header).trim();
  const auth = req.headers['authorization'];
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return '';
}

/** 取令牌摘要对应的有效令牌记录（含用户信息），无效返回 null */
function findAgentToken(raw) {
  if (!raw) return null;
  const row = db.prepare(`
    SELECT t.id AS token_id, t.user_id, t.name AS token_name, t.last_used_at,
           u.id, u.username, u.real_name, u.role, u.status
    FROM agent_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.revoked_at IS NULL
  `).get(hashToken(raw));
  if (!row) return null;
  return {
    tokenId: row.token_id,
    tokenName: row.token_name,
    lastUsedAt: row.last_used_at,
    user: { id: row.id, username: row.username, real_name: row.real_name, role: row.role, status: row.status },
  };
}

/**
 * AI 助手鉴权中间件：只放行教师/管理员，且账号必须正常
 * 失败时返回可直接读懂的错误，方便 AI 自行纠正（例如令牌失效就提示重新生成）
 */
function authenticateAgent(req, res, next) {
  try {
    const raw = extractToken(req);
    if (!raw) {
      return res.status(401).json({
        error: '缺少 X-Agent-Token 请求头',
        hint: '请在「课堂做题 → 创建 → AI 工具录入 → 方式一：AI 直连」里复制令牌，并在请求头带上 X-Agent-Token: <令牌>',
      });
    }

    const found = findAgentToken(raw);
    if (!found) {
      return res.status(401).json({
        error: '令牌无效或已被吊销',
        hint: '请让老师在「AI 工具录入 → 方式一：AI 直连」里重新生成令牌',
      });
    }

    if (found.user.status !== 'active') {
      return res.status(403).json({ error: '该教师账号未激活或已停用，无法提交数据' });
    }
    if (!['teacher', 'admin'].includes(found.user.role)) {
      return res.status(403).json({ error: '只有教师或管理员可以使用 AI 直连接口' });
    }

    // 记录最近使用时间（5 分钟内不重复写，避免高频调用把库写满）
    const last = found.lastUsedAt ? new Date(found.lastUsedAt.replace(' ', 'T') + 'Z').getTime() : 0;
    if (Date.now() - last > 5 * 60 * 1000) {
      db.prepare(`UPDATE agent_tokens SET last_used_at = datetime('now') WHERE id = ?`).run(found.tokenId);
    }

    req.agent = found;
    next();
  } catch (error) {
    console.error('AI 直连鉴权失败:', error);
    res.status(500).json({ error: 'AI 直连鉴权失败' });
  }
}

module.exports = { authenticateAgent, generateToken, hashToken, TOKEN_PREFIX };
