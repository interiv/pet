/**
 * token_usage 增加「生成结果」状态字段
 *
 * 背景：AI 出题的每日额度是按 token_usage 的行数来数的，
 * 而这行记录在 LLM 一返回时就 INSERT，早于 JSON 解析和题目入库。
 * 于是——AI 输出了 markdown 围栏/前言说明、或因长度限制被截断、
 * 或返回空数组时，用户看到的是 500 报错，但这一次已经被扣掉了。
 *
 * 新增 status：
 *   pending  进行中（计入额度，用于防止并发重复领取额度）
 *   ok       真正生成成功（计入额度）
 *   failed   流程失败（**退还额度**；token 消耗仍留档，管理员看板照常统计成本）
 *
 * 历史数据一律视为 ok，保持原有计数口径不变。
 */
exports.up = async function (knex) {
  // 教师每日 AI 出题次数：默认值原先是 5，实测偏紧（尤其数学/语文一天要出几套卷时）。
  // 这里把「仍是出厂值 5」的部署抬到 20；管理员手动设过的值保持不动。
  if (await knex.schema.hasTable('settings')) {
    await knex.raw(`
      UPDATE settings
         SET value = '20'
       WHERE key = 'daily_teacher_gen_limit'
         AND value = '5'
    `);
  }
  await knex.raw("INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_gen_max_rounds', '3')");

  if (!(await knex.schema.hasTable('token_usage'))) return;

  if (!(await knex.schema.hasColumn('token_usage', 'status'))) {
    await knex.raw("ALTER TABLE token_usage ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'");
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_token_usage_status ON token_usage(status)');
};

exports.down = async function (knex) {
  // SQLite 老版本不支持 DROP COLUMN，这里仅把值归位，保证回滚不报错
  if (!(await knex.schema.hasTable('token_usage'))) return;
  if (await knex.schema.hasColumn('token_usage', 'status')) {
    await knex.raw("UPDATE token_usage SET status = 'ok'");
  }
};
