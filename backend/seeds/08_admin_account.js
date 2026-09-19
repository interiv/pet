// 初始化：创建管理员账号 + 默认系统设置
// 设计要点：
//   1) 幂等：已存在就跳过，可反复执行
//   2) 安全：绝不删除任何已有数据（历史上的演示账号/班级已移出初始化流程，
//      演示数据改为在管理后台「系统数据」页签一键导入）
const bcrypt = require('bcryptjs');

const DEFAULT_PASSWORD = '111111';

// 默认系统设置（AI 相关，管理后台可覆盖）
const DEFAULT_SETTINGS = [
  { key: 'ai_model', value: 'gpt-3.5-turbo' },
  { key: 'ai_base_url', value: 'https://api.openai.com/v1' },
  { key: 'ai_report_interval_days', value: '3' },
  { key: 'max_tokens_per_generation', value: '18000' },
  { key: 'daily_teacher_gen_limit', value: '5' },
  { key: 'daily_global_token_limit', value: '2000000' },
  { key: 'max_questions_per_generation', value: '20' },
];

exports.seed = async function (knex) {
  // ---- 管理员账号 ----
  const existingAdmin = await knex('users').where('username', 'admin').first();
  if (existingAdmin) {
    console.log('  管理员账号 admin 已存在，跳过');
  } else {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await knex('users').insert({
      username: 'admin',
      password_hash: passwordHash,
      email: 'admin@school.com',
      role: 'admin',
      status: 'active',
    });
    console.log(`  ✓ 已创建管理员账号：admin / ${DEFAULT_PASSWORD}（请登录后尽快修改密码）`);
  }

  // ---- 默认系统设置 ----
  let created = 0;
  for (const item of DEFAULT_SETTINGS) {
    const exists = await knex('settings').where('key', item.key).first();
    if (!exists) {
      await knex('settings').insert(item);
      created++;
    }
  }
  console.log(created > 0 ? `  ✓ 写入默认系统设置 ${created} 项` : '  默认系统设置已存在，跳过');
};
