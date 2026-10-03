// 说明：本文件已改为「只补空表」模式（每日任务模板）。
/**
 * 每日任务种子数据
 * 任务类型与 src/routes/daily-tasks.js 中的硬编码任务保持一致。
 */
const tasks = [
  { type: 'daily', name: '每日登录', description: '每天登录游戏', condition: JSON.stringify({ type: 'login' }), reward: JSON.stringify({ type: 'gold', value: 50 }), reset_type: 'daily' },
  { type: 'daily', name: '完成作业', description: '完成1次作业', condition: JSON.stringify({ type: 'complete_assignment', count: 1 }), reward: JSON.stringify({ type: 'exp', value: 100 }), reset_type: 'daily' },
  { type: 'daily', name: '投喂宠物', description: '投喂宠物1次', condition: JSON.stringify({ type: 'feed_pet', count: 1 }), reward: JSON.stringify({ type: 'gold', value: 50 }), reset_type: 'daily' },
  { type: 'daily', name: '正确率达标', description: '作业正确率达到80%', condition: JSON.stringify({ type: 'correct_rate', rate: 80 }), reward: JSON.stringify({ type: 'exp', value: 150 }), reset_type: 'daily' },
  { type: 'daily', name: '复习错题', description: '复习3道错题', condition: JSON.stringify({ type: 'review_weak_point', count: 3 }), reward: JSON.stringify({ type: 'gold', value: 60 }), reset_type: 'daily' },
];

module.exports.tasks = tasks;

exports.seed = async function (knex) {
  // 只补空表：表里已有数据说明这个站已经在用基础数据了，
  // 再删会触发外键约束（且会毁掉管理员在后台自定义的内容），因此直接跳过
  const existing = await knex('tasks').count({ c: '*' }).first();
  if (Number(existing && existing.c) > 0) {
    console.log('  · 每日任务模板（tasks）已有 ' + existing.c + ' 条，跳过');
    return;
  }
  await knex('tasks').insert(tasks);
};