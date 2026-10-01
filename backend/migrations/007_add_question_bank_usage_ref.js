/**
 * question_bank 记录「本次题目属于哪一次 AI 生成」
 *
 * 背景：教师用 AI 生成题目后会先进预览页，觉得不满意就直接关掉弹窗，
 * 这一次并没有真的产出作业，但额度早已扣掉（正对着用户反馈的
 * 「没发布也算一次」）。
 *
 * 建立 question_bank ↔ token_usage 的关联后：
 *   1. 教师主动放弃时，可以精确定位到这一次生成的所有题目并撤销
 *   2. 启动时可以兜底清理「昨天及更早、且从未被任何作业引用」的孤儿题目并退还额度
 *   （直接关浏览器、掉线等前端来不及上报的场景）
 *
 * 历史数据没有关联信息，保持 NULL，不参与清理。
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('question_bank'))) return;

  if (!(await knex.schema.hasColumn('question_bank', 'generation_usage_id'))) {
    await knex.raw('ALTER TABLE question_bank ADD COLUMN generation_usage_id INTEGER');
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_qb_generation_usage ON question_bank(generation_usage_id)');
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('question_bank'))) return;
  if (await knex.schema.hasColumn('question_bank', 'generation_usage_id')) {
    await knex.raw('UPDATE question_bank SET generation_usage_id = NULL');
  }
};
