// 课堂做题：把存量题目的内嵌选项回填成结构化字段
//
// 背景：
// 课堂做题的客观题此前只能退回 AI 判分——题目表里既没有题型列也没有选项列，
// 而选项其实是内嵌在题干里的（例：「…作者是哪位唐代诗人？A.李白 B.李绅 C.杜甫 D.白居易」）。
//
// 新建课堂做题已会在入库时自动拆分（见 services/classroomQuiz.js 的
// splitInlineOptions），但改动之前建好的课堂做题不会自动补上，
// 老师要用上本地秒判就得重建题目，这不合理。
//
// 本迁移扫一遍存量题目：凡是能从题干里稳妥拆出选项、且已有标准答案的，
// 就补上 question_type 与 options，让这些课堂立刻受益。
//
// 判据与 splitInlineOptions 完全一致（字母从 A 连续递增、至少 2 个选项、
// 选项内容非空且不过长），识别不出来的一律不动，继续走原 AI 判分流程。
//
// 幂等：只处理 question_type IS NULL AND options IS NULL AND answer_text 非空的行，
// 重复执行不会重复改写，也不会碰人工填过题型的题。
// 只 require 纯函数模块：这里的判据必须与建题入库时用的完全一致。
// 刻意不 require config/database —— knex 已经开着数据库连接，
// 再开一个就会「database is locked」（better-sqlite3 同文件互斥）。
const { splitInlineOptions, inferTypeFromOptions } = require('../src/services/classroomQuestionText');

async function up(knex) {
  const rows = await knex.raw(`
    SELECT id, question_text, answer_text
    FROM classroom_quiz_questions
    WHERE question_type IS NULL
      AND options IS NULL
      AND answer_text IS NOT NULL
      AND TRIM(answer_text) <> ''
  `);

  let filled = 0;
  for (const r of rows) {
    const parsed = splitInlineOptions(r.question_text);
    if (!parsed) continue;
    await knex.raw(
      'UPDATE classroom_quiz_questions SET question_type = ?, options = ? WHERE id = ?',
      [inferTypeFromOptions(parsed.options), JSON.stringify(parsed.options), r.id]
    );
    filled++;
  }

  console.log('  扫描存量题: ' + rows.length + ' 道, 补全结构化: ' + filled +
    ' 道, 保持原样(走AI判分): ' + (rows.length - filled) + ' 道');
}

function down() {
  // 不回滚：题型/选项本身是从题干里拆出来的真实数据，
  // 回滚只会把这些题退回「客观题也要送 AI 判分」的状态
}

module.exports = { up, down };
