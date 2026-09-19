// users 表增加 real_name（真实姓名）字段
// 背景：此前系统没有姓名字段，账号名（username）既当登录名又当姓名显示。
// 现在姓名与账号分离：账号可用于登录（AI 生成的拼音/英文），姓名用于展示。
// 已有数据不做回填（保持 NULL），显示时前端按 `real_name || username` 回退。

async function hasColumn(knex, table, column) {
  const rows = await knex.raw(`PRAGMA table_info(${table})`);
  const cols = Array.isArray(rows) ? rows : [];
  return cols.some((c) => c && c.name === column);
}

exports.up = async function (knex) {
  if (!(await hasColumn(knex, 'users', 'real_name'))) {
    await knex.raw(`ALTER TABLE users ADD COLUMN real_name TEXT`);
  }
};

exports.down = async function (knex) {
  if (await hasColumn(knex, 'users', 'real_name')) {
    await knex.raw(`ALTER TABLE users DROP COLUMN real_name`);
  }
};
