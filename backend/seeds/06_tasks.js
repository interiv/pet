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

exports.seed = async function (knex) {
  await knex('tasks').del();
  await knex('tasks').insert(tasks);
};