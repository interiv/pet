// 班级申请增加 teacher_type 字段，用于区分教师的两种身份：
//   'head_teacher' = 申请担任班主任（审批通过后成为班主任）
//   'teacher'      = 申请以任课教师身份加入班级
//   NULL           = 学生申请（历史数据）
// 说明：原 role 字段有 CHECK(role IN ('student','teacher')) 约束，无法直接写入 head_teacher。

async function hasColumn(knex, table, column) {
  const rows = await knex.raw(`PRAGMA table_info(${table})`);
  const cols = Array.isArray(rows) ? rows : [];
  return cols.some((c) => c && c.name === column);
}

exports.up = async function (knex) {
  if (!(await hasColumn(knex, 'class_applications', 'teacher_type'))) {
    await knex.raw(`ALTER TABLE class_applications ADD COLUMN teacher_type TEXT`);
  }
};

exports.down = async function (knex) {
  if (await hasColumn(knex, 'class_applications', 'teacher_type')) {
    await knex.raw(`ALTER TABLE class_applications DROP COLUMN teacher_type`);
  }
};
