/**
 * 课堂做题：题目附带 HTML 课件 + 参考答案
 *
 * 背景：课堂做题的题目原本只有纯文本题干。老师希望能给题目配一个可交互的
 *   HTML 课件（图示、动画、可点可拖的小实验），课堂上先投课件让学生操作、
 *   思考，再回到题目作答；AI 工具录入时也会把课件一并带过来。
 *
 * 变更：
 *   - classroom_quiz_questions.courseware_html  题目附带的 HTML 课件（可选，离线可用）
 *   - classroom_quiz_questions.answer_text      参考答案（可选，只给教师核对）
 *
 * 课件不是必须的：两个字段都允许为空，没有课件时课堂做题行为与之前完全一致。
 */

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
  await addColumn(knex, 'classroom_quiz_questions', 'courseware_html', 'TEXT');
  await addColumn(knex, 'classroom_quiz_questions', 'answer_text', 'TEXT');
};

exports.down = async function (knex) {
  for (const column of ['courseware_html', 'answer_text']) {
    if (await hasColumn(knex, 'classroom_quiz_questions', column)) {
      try {
        await knex.raw(`ALTER TABLE classroom_quiz_questions DROP COLUMN ${column}`);
      } catch (e) {
        // 老版本 SQLite 不支持 DROP COLUMN，忽略
      }
    }
  }
};
