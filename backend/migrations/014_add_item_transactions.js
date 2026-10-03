/**
 * 新增：物品 / 装备 / 技能 变动流水表
 *
 * 背景：原先只有 gold_transactions（金币流水），道具、装备的获得与消耗
 *   完全没有记录，学生端做不了「我的资产明细」。
 *
 * 设计要点：
 *   - ref_type 区分对象类型：item（道具）/ equipment（装备）/ skill（技能）
 *   - change 用 +1 / -1 表示获得 / 消耗，便于直接求和算当前持有量
 *   - 只追加不修改，退款/消耗也记一条负数，保证可追溯
 *   - 历史数据分批回填（SQLite 复合 SELECT 上限 500 条，必须分批）
 */
const BATCH = 200;

async function insertInBatches(knex, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await knex('item_transactions').insert(rows.slice(i, i + BATCH));
  }
}

exports.up = async function (knex) {
  await knex.schema.createTable('item_transactions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable();
    table.string('ref_type').notNullable().defaultTo('item');
    table.integer('ref_id').nullable();
    table.string('name').defaultTo('');
    table.integer('change').notNullable().defaultTo(0);
    table.string('reason').defaultTo('');
    table.string('source').defaultTo('');
    table.datetime('created_at').defaultTo(knex.fn.now());
    table.index(['user_id', 'id'], 'idx_item_tx_user');
    table.index(['user_id', 'ref_type'], 'idx_item_tx_user_type');
  });

  // 历史回填：道具/装备表只有当前持有量，只能记一条快照，来源标记 legacy
  if (await knex.schema.hasTable('user_items')) {
    const items = await knex('user_items').select('user_id', 'item_id', 'quantity').where('quantity', '>', 0);
    await insertInBatches(knex, items.map((r) => ({
      user_id: r.user_id,
      ref_type: 'item',
      ref_id: r.item_id,
      name: '',
      change: Number(r.quantity),
      reason: '历史持有（数据回填）',
      source: 'legacy',
    })));
  }

  if (await knex.schema.hasTable('user_equipment')) {
    const rows = await knex('user_equipment').select('user_id', 'equipment_id');
    await insertInBatches(knex, rows.map((r) => ({
      user_id: r.user_id,
      ref_type: 'equipment',
      ref_id: r.equipment_id,
      name: '',
      change: 1,
      reason: '历史持有（数据回填）',
      source: 'legacy',
    })));
  }

  const total = await knex('item_transactions').count({ c: '*' }).first();
  console.log('  ✓ 物品流水表已创建，回填历史 ' + (total ? total.c : 0) + ' 条');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('item_transactions');
};
