/**
 * AI 生成额度记账
 *
 * 背景：原先「今天还能生成几次」是拿 token_usage 表的行数来数的，
 * 而这行记录是在 LLM 一返回时就 INSERT 的，早于 JSON 解析和写库。
 * 结果就是 AI 返回了一段 markdown 围栏、前言说明、或者因长度限制被截断时，
 * 用户看到的是 500 报错，但这一次已经被算进了每日额度。
 *
 * 现在改为按 status 记账：
 *   pending  已领取额度、尚未出结果（计入额度，防止并发重复领取）
 *   ok       真正拿到可用题目（计入额度）
 *   failed   流程失败（退还额度，但 token 消耗仍留档供管理员核算成本）
 *
 * 用法：
 *   const usageId = beginUsage(userId, date, { model, subject, topic, question_type, count });
 *   try {
 *     ...干活，过程中累加 usageTokens...
 *     settleUsage(usageId, 'ok', { ...usageTokens, question_count, duration });
 *   } catch (e) {
 *     settleUsage(usageId, 'failed', { ...usageTokens, duration });
 *     throw e;
 *   }
 *
 * settleUsage 只会改写仍处于 pending 的记录，因此重复调用是安全的：
 * 成功之后再调 failed 不会把 ok 冲掉。
 */

const STATUS = {
  PENDING: 'pending',
  OK: 'ok',
  FAILED: 'failed',
};

// pending 记录的有效窗口：超过这个时长仍停在 pending，说明进程崩了，自动作废
const PENDING_TTL_MINUTES = 30;

let columnChecked = false;

function ensureStatusColumn() {
  if (columnChecked) return;
  columnChecked = true;
  try {
    // 延迟 require，避免模块加载顺序问题
    const { db } = require('../config/database');
    const cols = db.prepare(`PRAGMA table_info(token_usage)`).all();
    if (!cols.some((c) => c.name === 'status')) {
      db.prepare(`ALTER TABLE token_usage ADD COLUMN status TEXT NOT NULL DEFAULT '${STATUS.OK}'`).run();
      console.log('✅ token_usage 已补充 status 列');
    }
  } catch (e) {
    // 表还不存在（迁移未跑）或库只读时忽略，走原有计数口径
    console.warn('⚠️ 检查 token_usage.status 列失败，将按原有口径统计:', e.message);
  }
}

/**
 * 领取一次额度（在任何失败Case之前调用，失败时务必 settle 成 failed）
 * @returns {number} token_usage 记录 id
 */
function beginUsage(userId, date, meta = {}) {
  ensureStatusColumn();
  const { db } = require('../config/database');
  const info = db
    .prepare(`
      INSERT INTO token_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens,
                               model, subject, topic, question_type, question_count, duration_ms, status)
      VALUES (?, ?, 0, 0, 0, ?, ?, ?, ?, ?, 0, '${STATUS.PENDING}')
    `)
    .run(
      userId,
      date,
      String(meta.model || ''),
      String(meta.subject || ''),
      String(meta.topic || ''),
      String(meta.question_type || ''),
      Number(meta.count || 0)
    );
  return info.lastInsertRowid;
}

/**
 * 结算一次额度。只会改写 pending 记录，重复调用安全。
 */
function settleUsage(usageId, status, tokens = {}) {
  if (!usageId) return;
  try {
    const { db } = require('../config/database');
    db.prepare(`
      UPDATE token_usage
         SET prompt_tokens = ?,
             completion_tokens = ?,
             total_tokens = ?,
             question_count = ?,
             duration_ms = ?,
             status = ?
       WHERE id = ? AND status = '${STATUS.PENDING}'
    `).run(
      Number(tokens.prompt || 0),
      Number(tokens.completion || 0),
      Number(tokens.total || 0),
      Number(tokens.question_count || 0),
      Number(tokens.duration || 0),
      status,
      usageId
    );
  } catch (e) {
    console.error('⚠️ 结算用量记录失败:', e.message);
  }
}

/**
 * 当日已消耗额度
 * 说明：pending 计入额度（防并发），但超过 TTL 仍停在 pending 的僵尸记录自动作废。
 */
function countBilledUsage(userId, date) {
  ensureStatusColumn();
  const { db } = require('../config/database');
  try {
    const row = db
      .prepare(`
        SELECT COUNT(*) as count
          FROM token_usage
         WHERE user_id = ? AND date = ?
           AND ( status = '${STATUS.OK}'
                 OR (status = '${STATUS.PENDING}' AND created_at > datetime('now', ?)) )
      `)
      .get(userId, date, `-${PENDING_TTL_MINUTES} minutes`);
    return row?.count || 0;
  } catch (e) {
    // 老库没有 status 列，退回原口径
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM token_usage WHERE user_id = ? AND date = ?`)
      .get(userId, date);
    return row?.count || 0;
  }
}

/** 当日被退还的失败次数（仅用于展示） */
function countFailedUsage(userId, date) {
  ensureStatusColumn();
  const { db } = require('../config/database');
  try {
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM token_usage WHERE user_id = ? AND date = ? AND status = ?`)
      .get(userId, date, STATUS.FAILED);
    return row?.count || 0;
  } catch (e) {
    return 0;
  }
}

/**
 * 直接把一次已结算的记录作废（退还额度）。
 * 用于「生成了但教师最终没发布」的场景——此时记录已是 ok，settleUsage 动不了。
 */
function markFailed(usageId) {
  const { db } = require('../config/database');
  return db
    .prepare(`UPDATE token_usage SET status = ? WHERE id = ? AND status <> ?`)
    .run(STATUS.FAILED, usageId, STATUS.FAILED).changes > 0;
}

/** 该次生成里，已经被作业/答题/BOSS战引用过的题目数量 */
function countReferencedQuestions(usageId) {
  const { db } = require('../config/database');
  const row = db.prepare(`
    SELECT COUNT(DISTINCT qb.id) as count
      FROM question_bank qb
     WHERE qb.generation_usage_id = ?
       AND (
            EXISTS (SELECT 1 FROM assignment_questions aq WHERE aq.question_bank_id = qb.id)
         OR EXISTS (SELECT 1 FROM question_answers qa WHERE qa.question_bank_id = qb.id)
         OR EXISTS (SELECT 1 FROM boss_battle_questions bq WHERE bq.question_id = qb.id)
         OR EXISTS (SELECT 1 FROM boss_battle_answers ba WHERE ba.question_id = qb.id)
       )
  `).get(usageId);
  return row?.count || 0;
}

/** 删除该次生成里尚未被任何作业/答题/BOSS战引用的题目，返回删除行数 */
function deleteUnusedQuestions(usageId) {
  const { db } = require('../config/database');
  return db.prepare(`
    DELETE FROM question_bank
     WHERE generation_usage_id = ?
       AND source = 'ai'
       AND id NOT IN (SELECT question_bank_id FROM assignment_questions)
       AND id NOT IN (SELECT question_bank_id FROM question_answers)
       AND id NOT IN (SELECT question_id FROM boss_battle_questions)
       AND id NOT IN (SELECT question_id FROM boss_battle_answers)
  `).run(usageId).changes;
}

/**
 * 启动兜底：清理「生成了但从未发布」的记录并退还额度。
 *
 * 教师点了生成、预览完觉得不行，直接关掉标签页 / 断网时，前端根本来不及上报撤销。
 * 这里在启动时统一处理：只看昨天及更早的生成（今天的可能还在预览页里编辑），
 * 并且要求所有相关题目都没有被任何作业引用过，避免误删。
 *
 * @returns {{refunded: number, deleted: number}}
 */
function sweepOrphanGenerations() {
  ensureStatusColumn();
  const { db } = require('../config/database');
  try {
    const today = require('../config/timezone').getChinaDate();
    const rows = db.prepare(`
      SELECT id FROM token_usage
       WHERE status = '${STATUS.OK}'
         AND date < ?
         AND EXISTS (SELECT 1 FROM question_bank WHERE generation_usage_id = token_usage.id)
         AND NOT EXISTS (
              SELECT 1 FROM question_bank qb
                JOIN assignment_questions aq ON aq.question_bank_id = qb.id
               WHERE qb.generation_usage_id = token_usage.id
         )
       LIMIT 2000
    `).all(today);

    let refunded = 0;
    let deleted = 0;
    for (const r of rows) {
      try {
        if (countReferencedQuestions(r.id) > 0) continue;
        deleted += deleteUnusedQuestions(r.id);
        if (markFailed(r.id)) refunded += 1;
      } catch (e) {
        console.warn(`⚠️ 清理生成记录 ${r.id} 失败:`, e.message);
      }
    }
    if (refunded > 0) {
      console.log(`🧹 启动时清理未发布生成：退还 ${refunded} 次额度，删除 ${deleted} 道孤儿题目`);
    }
    return { refunded, deleted };
  } catch (e) {
    console.warn('⚠️ 清理未发布生成时出错（不影响启动）:', e.message);
    return { refunded: 0, deleted: 0 };
  }
}

module.exports = {
  STATUS,
  beginUsage,
  settleUsage,
  markFailed,
  countBilledUsage,
  countFailedUsage,
  countReferencedQuestions,
  deleteUnusedQuestions,
  sweepOrphanGenerations,
  ensureStatusColumn,
};
