/**
 * 作业重做次数上限
 *
 * 背景：submissions.status = 'retry_available' 时学生可以无限次重做，
 * 每次重做只要分数提高就会补发金币差额，理论上可以一直刷到满分。
 * 这里给 assignments 增加 max_attempts，提交时校验 attempt_count 不得超过该上限。
 *
 * 存量作业沿用默认值 3，教师发布作业时可自行调整。
 */

exports.up = async function (knex) {
  const hasCol = await knex.schema.hasColumn('assignments', 'max_attempts');
  if (!hasCol) {
    await knex.raw('ALTER TABLE assignments ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3');
  }
};

exports.down = async function (knex) {
  // SQLite 老版本不支持 DROP COLUMN，这里仅把值归位为默认值，保证回滚不报错
  await knex.raw('UPDATE assignments SET max_attempts = 3');
};
