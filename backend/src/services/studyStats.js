/**
 * 「这道题作答完了」之后要落地的两处学习数据：
 *   1. 个人题库 personal_question_bank —— 做过的全部题目（含做对的），与错题本互补
 *   2. 知识点掌握度 knowledge_point_stats —— 按天按知识点累计正确率
 *
 * 【为什么抽出来】这两段原来只写在 routes/assignments.js 的「同步判分分支」里，
 * 于是任何走异步评阅的题（简答、作文，以及现在的填空题）都不会写这两张表：
 * 学生明明做了题，「个人题库」和「学习数据」里却查无此题，
 * 知识点掌握度也永远不涨。抽成公共服务后，规则判分和 AI 评阅共用同一套落地逻辑。
 */
const { db } = require('../config/database');
const { getChinaDate } = require('../config/timezone');

/** 表不存在（迁移未执行）时静默跳过，不影响主流程 */
let personalBankReady = null;
function personalBankAvailable() {
  // 不再永久缓存：迁移可能在本进程启动之后才执行完，
  // 一旦缓存成 false，个人题库会一直「永远为空」。
  if (personalBankReady === null) {
    personalBankReady = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='personal_question_bank'`).get();
  }
  return personalBankReady || !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='personal_question_bank'`).get();
}

/**
 * 个人题库 upsert。
 * @param {'online'|'paper'|'wrong_retry'|string} source 作答来源
 */
function upsertPersonalBank({ userId, questionId, assignmentId, assignmentType, answer, isCorrect, source }) {
  if (!personalBankAvailable() || !userId || !questionId) return;
  try {
    const q = db.prepare('SELECT subject, knowledge_point FROM question_bank WHERE id = ?').get(questionId);
    const existing = db.prepare('SELECT id FROM personal_question_bank WHERE user_id = ? AND question_id = ?')
      .get(userId, questionId);
    if (existing) {
      db.prepare(`
        UPDATE personal_question_bank
        SET last_answer = ?, is_correct = ?, attempt_count = attempt_count + 1,
            correct_count = correct_count + ?, assignment_id = ?, assignment_type = ?,
            source = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(String(answer || ''), isCorrect ? 1 : 0, isCorrect ? 1 : 0, assignmentId || null, assignmentType || null, source || 'online', existing.id);
    } else {
      db.prepare(`
        INSERT INTO personal_question_bank
          (user_id, question_id, assignment_id, assignment_type, subject, knowledge_point,
           first_answer, last_answer, is_correct, attempt_count, correct_count, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(userId, questionId, assignmentId || null, assignmentType || null,
        q?.subject || null, q?.knowledge_point || null,
        String(answer || ''), String(answer || ''), isCorrect ? 1 : 0, isCorrect ? 1 : 0, source || 'online');
    }
  } catch (e) {
    console.error('个人题库写入失败:', e.message);
  }
}

/**
 * 知识点掌握度：同一用户 / 同一知识点 / 同一天只留一行，累加作答与正确次数。
 * 题目没录知识点就直接跳过 —— 没有知识点的题不该污染任何知识点的掌握率。
 */
function recordKnowledgePoint({ userId, questionBankId, isCorrect }) {
  if (!userId || !questionBankId) return;
  try {
    const q = db.prepare('SELECT knowledge_point FROM question_bank WHERE id = ?').get(questionBankId);
    if (!q || !q.knowledge_point) return;
    const today = getChinaDate();
    const existing = db.prepare(
      'SELECT id FROM knowledge_point_stats WHERE user_id = ? AND knowledge_point = ? AND date = ?'
    ).get(userId, q.knowledge_point, today);

    if (existing) {
      db.prepare(`
        UPDATE knowledge_point_stats
        SET total_attempts = total_attempts + 1,
            correct_attempts = correct_attempts + ?,
            accuracy = ROUND(CAST(correct_attempts + ? AS REAL) / (total_attempts + 1) * 100, 2),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(isCorrect ? 1 : 0, isCorrect ? 1 : 0, existing.id);
    } else {
      db.prepare(`
        INSERT INTO knowledge_point_stats (user_id, knowledge_point, date, total_attempts, correct_attempts, accuracy)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(userId, q.knowledge_point, today, isCorrect ? 1 : 0, isCorrect ? 100 : 0);
    }
  } catch (error) {
    console.error('更新知识点统计失败:', error.message);
  }
}

/**
 * 一次作答的标准落地动作：个人题库 + 知识点掌握度。
 * 规则判分（提交即判）与 AI 评阅（判完再写）都走这里，口径一致。
 */
function recordQuestionResult({ userId, questionBankId, assignmentId, assignmentType, answer, isCorrect, source }) {
  upsertPersonalBank({ userId, questionId: questionBankId, assignmentId, assignmentType, answer, isCorrect, source });
  recordKnowledgePoint({ userId, questionBankId, isCorrect });
}

module.exports = { personalBankAvailable, upsertPersonalBank, recordKnowledgePoint, recordQuestionResult };
