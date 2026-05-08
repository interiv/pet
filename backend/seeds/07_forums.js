const forums = [
  { name: '综合讨论', description: '自由讨论区', icon: '💬', sort_order: 1 },
  { name: '学习交流', description: '学习心得分享', icon: '📚', sort_order: 2 },
  { name: '宠物攻略', description: '宠物养成技巧', icon: '🐾', sort_order: 3 },
  { name: '建议反馈', description: '产品建议与Bug反馈', icon: '💡', sort_order: 4 },
];

exports.seed = async function (knex) {
  await knex('forums').del();
  await knex('forums').insert(forums);
};
