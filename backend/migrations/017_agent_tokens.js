/**
 * AI 助手（WorkBuddy / CodeBuddy 等）直连令牌
 *
 * 背景：老师想让 AI 助手直接调用后端接口提交课堂做题题目（含 HTML 课件），
 *   而不是「AI 生成 → 老师复制粘贴」。为此给每个教师发一个长期令牌，
 *   AI 用 X-Agent-Token 请求头调用 /api/agent/* 即可代表该教师身份写入数据。
 *
 * 设计：
 *   - 令牌明文只在生成时返回一次，服务端只存 sha256 摘要，泄露库也无法还原令牌
 *   - token_prefix 仅用于界面识别（显示成 pt_1234…abcd）
 *   - 可随时吊销；删除账号时随 purgeUserData 一起清掉
 */

exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now')),
      last_used_at DATETIME,
      revoked_at DATETIME
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_agent_tokens_user ON agent_tokens(user_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_agent_tokens_hash ON agent_tokens(token_hash)`);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_agent_tokens_hash`);
  await knex.raw(`DROP INDEX IF EXISTS idx_agent_tokens_user`);
  await knex.raw(`DROP TABLE IF EXISTS agent_tokens`);
};
