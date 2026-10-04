// 教师的任教科目：
//   - class_teachers.subject       教师在这个班教哪门课（一行一条任教关系各带一个科目）
//   - class_applications.subject   教师注册申请时填写的任教科目，审批通过后带入 class_teachers
//
// 说明：科目是自由文本（各校课程不尽相同），只做长度约束，不做白名单。
//       留空表示该教师在班内不固定科目，布置作业/课堂做题时由教师手动选择。

async function hasColumn(knex, table, column) {
  const rows = await knex.raw(`PRAGMA table_info(${table})`);
  const cols = Array.isArray(rows) ? rows : [];
  return cols.some((c) => c && c.name === column);
}

async function addColumn(knex, table, column, ddl) {
  if (!(await hasColumn(knex, table, column))) {
    await knex.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

exports.up = async function (knex) {
  await addColumn(knex, 'class_teachers', 'subject', 'TEXT');
  await addColumn(knex, 'class_applications', 'subject', 'TEXT');
};

exports.down = async function (knex) {
  for (const [table, column] of [
    ['class_teachers', 'subject'],
    ['class_applications', 'subject'],
  ]) {
    if (await hasColumn(knex, table, column)) {
      try {
        await knex.raw(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      } catch (e) {
        // 老版本 SQLite 不支持 DROP COLUMN，忽略
      }
    }
  }
};
