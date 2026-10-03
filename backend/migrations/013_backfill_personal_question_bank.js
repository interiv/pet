/**
 * 修复：学生「个人题库」永远是空的
 *
 * 问题：
 * - personal_question_bank 只在「走路由提交作业 / 错题重做 / 纸质登记」时才 upsert
 *   （routes/assignments.js 的 upsertPersonalBank）。
 * - 但导入演示数据、历史补录等直接写 question_answers 的路径都不会写这张表，
 *   导致表里一条数据都没有：错题本能看到题，个人题库却空空如也。
 *
 * 做法：从已有 question_answers 回填（按用户+题目聚合，保留首/末次作答与正确次数）。
 *      幂等：ON CONFLICT DO NOTHING，可重复执行。
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('personal_question_bank');
  if (!hasTable) {
    console.log('  · personal_question_bank 表不存在，跳过回填');
    return;
  }
  if (!(await knex.schema.hasTable('question_answers'))) {
    console.log('  · question_answers 表不存在，跳过回填');
    return;
  }

  const info = await knex.raw([
    'INSERT INTO personal_question_bank',
    '  (user_id, question_id, assignment_id, assignment_type, subject, knowledge_point,',
    '   first_answer, last_answer, is_correct, attempt_count, correct_count, source, created_at, updated_at)',
    'SELECT',
    '  s.user_id, qa.question_bank_id, s.assignment_id, a.assignment_type, qb.subject, qb.knowledge_point,',
    "  (SELECT qa2.student_answer FROM question_answers qa2 JOIN submissions s2 ON s2.id = qa2.submission_id",
    "    WHERE s2.user_id = s.user_id AND qa2.question_bank_id = qa.question_bank_id",
    "    ORDER BY qa2.answered_at ASC, qa2.id ASC LIMIT 1),",
    "  (SELECT qa3.student_answer FROM question_answers qa3 JOIN submissions s3 ON s3.id = qa3.submission_id",
    "    WHERE s3.user_id = s.user_id AND qa3.question_bank_id = qa.question_bank_id",
    "    ORDER BY qa3.answered_at DESC, qa3.id DESC LIMIT 1),",
    '  MAX(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END),',
    '  COUNT(*),',
    '  SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END),',
    "  'online', MIN(qa.answered_at), MAX(qa.answered_at)",
    'FROM question_answers qa',
    'JOIN submissions s ON s.id = qa.submission_id',
    'LEFT JOIN assignments a ON a.id = s.assignment_id',
    'LEFT JOIN question_bank qb ON qb.id = qa.question_bank_id',
    'WHERE qa.question_bank_id IS NOT NULL',
    'GROUP BY s.user_id, qa.question_bank_id',
    'ON CONFLICT(user_id, question_id) DO NOTHING',
  ].join('\n'));

  const total = await knex('personal_question_bank').count({ c: '*' }).first();
  console.log('  ✓ 个人题库回填完成，当前共 ' + (total ? total.c : 0) + ' 条');
  if (info) console.log('  · 本次写入 ' + (Array.isArray(info) ? info.length : (info.changes || 0)) + ' 条');
};

exports.down = async function () {
  // 不回滚：个人题库是用户学习数据，删掉不可恢复
};
