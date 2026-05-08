const tasks = [
  { type: 'daily', name: '每日签到', description: '每天登录游戏', condition: JSON.stringify({ type: 'login' }), reward: JSON.stringify({ type: 'gold', value: 50 }), reset_type: 'daily' },
  { type: 'daily', name: '完成作业', description: '完成1次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward: JSON.stringify({ type: 'exp', value: 100 }), reset_type: 'daily' },
  { type: 'daily', name: '进行战斗', description: '进行1次战斗', condition: JSON.stringify({ type: 'battle', count: 1 }), reward: JSON.stringify({ type: 'gold', value: 100 }), reset_type: 'daily' },
  { type: 'daily', name: '拜访好友', description: '拜访3位好友', condition: JSON.stringify({ type: 'visit_friends', count: 3 }), reward: JSON.stringify({ type: 'gold', value: 80 }), reset_type: 'daily' },
  { type: 'weekly', name: '周任务-作业', description: '完成5次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 5 }), reward: JSON.stringify({ type: 'item', value: 2 }), reset_type: 'weekly' },
  { type: 'weekly', name: '周任务-战斗', description: '战斗胜利10场', condition: JSON.stringify({ type: 'win_battle', count: 10 }), reward: JSON.stringify({ type: 'item', value: 3 }), reset_type: 'weekly' },
];

exports.seed = async function (knex) {
  await knex('tasks').del();
  await knex('tasks').insert(tasks);
};
