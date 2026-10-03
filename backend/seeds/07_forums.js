// 说明：本文件已改为「只补空表」模式（论坛板块）。
const forums = [
  { name: '综合讨论', description: '自由讨论区', icon: '💬', sort_order: 1 },
  { name: '学习交流', description: '学习心得分享', icon: '📚', sort_order: 2 },
  { name: '宠物攻略', description: '宠物养成技巧', icon: '🐾', sort_order: 3 },
  { name: '建议反馈', description: '产品建议与Bug反馈', icon: '💡', sort_order: 4 },
];

module.exports.forums = forums;

exports.seed = async function (knex) {
  // 只补空表：表里已有数据说明这个站已经在用基础数据了，
  // 再删会触发外键约束（且会毁掉管理员在后台自定义的内容），因此直接跳过
  const existing = await knex('forums').count({ c: '*' }).first();
  if (Number(existing && existing.c) > 0) {
    console.log('  · 论坛板块（forums）已有 ' + existing.c + ' 条，跳过');
    return;
  }
  await knex('forums').insert(forums);
};
