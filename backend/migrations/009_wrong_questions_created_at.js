/**
 * 修复：wrong_questions 缺少 created_at
 *
 * 问题：错题本前端 3 处渲染「错误时间」（WrongQuestions.tsx 的列表列、卡片、详情弹窗），
 * 但表里从来没有 created_at 列，页面上显示的是 Invalid Date；
 * 同时错题也无法做时间维度分析（何时新增的薄弱点、薄弱点是否消亡）。
 *
 * 做法：加列并用 question_answers 里的首次错误时间回填历史数据；
 * 后续 INSERT 统一写入当前时间（见 assignments.js 的 writeWrongQuestion 辅助函数）。
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('wrong_questions', (table) => {
    table.datetime('created_at').nullable();
  });

  // 回填：用该用户该题最早的一条错误作答时间作为错题产生时间
  await knex.raw(`
    UPDATE wrong_questions
    SET created_at = COALESCE((
      SELECT MIN(qa.answered_at)
      FROM question_answers qa
      JOIN submissions s ON s.id = qa.submission_id
      WHERE s.user_id = wrong_questions.user_id
        AND qa.question_bank_id = wrong_questions.question_id
        AND qa.is_correct = 0
    ), (SELECT s.submitted_at FROM submissions s
        WHERE s.user_id = wrong_questions.user_id
          AND s.assignment_id = wrong_questions.assignment_id), CURRENT_TIMESTAMP)
    WHERE created_at IS NULL
  `);

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_wq_user_created ON wrong_questions (user_id, created_at)`);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_wq_user_created`);
  await knex.schema.alterTable('wrong_questions', (table) => {
    table.dropColumn('created_at');
  });
};
