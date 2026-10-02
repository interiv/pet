/**
 * 学生端改进：答题耗时 + 错题重做记录
 *
 * 1. question_answers.duration_ms
 *    全库此前没有任何「学生答题耗时」数据，导致无法回答「谁在假学」
 *    「正确率与速度的关系」这类问题。token_usage.duration_ms 是 LLM 耗时且主体是教师，不能用。
 *    存量行无法回填，置 NULL 表示未知，统计时需忽略 NULL。
 *
 * 2. wrong_question_attempts
 *    错题本原先只能「标记已复习」（不产生作答记录），无法证明真的掌握了；
 *    且答对的错题会被直接 DELETE，历史丢失。新表保留每一次重做记录。
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('question_answers', (table) => {
    table.integer('duration_ms').nullable();
  });

  await knex.schema.createTable('wrong_question_attempts', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable();
    table.integer('wrong_question_id').nullable();     // 已被移除的错题也保留记录
    table.integer('question_id').notNullable();
    table.text('answer').nullable();
    table.integer('is_correct').notNullable().default(0);
    table.integer('duration_ms').nullable();
    table.string('mode', 20).notNullable().default('redo');  // redo 重做 / self_check 主观题自评
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('question_id').references('question_bank.id').onDelete('CASCADE');
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_wqa_user ON wrong_question_attempts (user_id, question_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_wqa_created ON wrong_question_attempts (user_id, created_at DESC)');
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_wqa_user');
  await knex.raw('DROP INDEX IF EXISTS idx_wqa_created');
  await knex.schema.dropTableIfExists('wrong_question_attempts');
  await knex.schema.alterTable('question_answers', (table) => {
    table.dropColumn('duration_ms');
  });
};
