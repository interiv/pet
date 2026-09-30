// 临时修复：重新写入被「清理数据」误删的基础配置（成就定义 / 每日任务定义 / 论坛板块）
const knex = require('knex')(require('../knexfile.js').production);

(async () => {
  try {
    await require('../seeds/05_achievements').seed(knex);
    console.log('achievements 已恢复');
    await require('../seeds/06_tasks').seed(knex);
    console.log('tasks 已恢复');
    await require('../seeds/07_forums').seed(knex);
    console.log('forums 已恢复');

    for (const t of ['achievements', 'tasks', 'forums']) {
      const r = await knex(t).count('* as n').first();
      console.log(`${t} = ${r.n}`);
    }
  } catch (e) {
    console.error('恢复失败:', e);
    process.exitCode = 1;
  } finally {
    await knex.destroy();
  }
})();
