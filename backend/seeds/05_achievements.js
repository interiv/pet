// 说明：本文件已改为「只补空表」模式（成就）。
const achievements = require('../scripts/achievementData');

exports.seed = async function (knex) {
  // 只补空表：表里已有数据说明这个站已经在用基础数据了，
  // 再删会触发外键约束（且会毁掉管理员在后台自定义的内容），因此直接跳过
  const existing = await knex('achievements').count({ c: '*' }).first();
  if (Number(existing && existing.c) > 0) {
    console.log('  · 成就（achievements）已有 ' + existing.c + ' 条，跳过');
    return;
  }
  await knex('achievements').insert(achievements);
};
