// 课堂做题：题目结构化 + 答题记录标注判分来源
//
// 背景：classroom_quiz_questions 此前只有 question_text 一段纯文本，
// 题型、选项、讲解都没有。于是课堂答题只能走「学生口头答 → 语音识别成字母 → 送 AI 判分」，
// 客观题本该是确定性的对错判断，却每次要等 AI 十几秒、花 token，判出来还是「答对给 95 分」。
//
// 本迁移补齐本地判分所需的三样数据：
//   question_type  题型（choice_single / choice_multi / judgment / fill_blank / essay）
//   options        结构化选项，JSON 数组 [{"key":"A","text":"..."}]
//   explanation    题目讲解。本地判分只能告诉对错，「为什么错」靠它——
//                  没有它，客观题改本地判之后体验会退化成干巴巴一个「错」字。
//
// 兼容性：全部可空，历史行保持 NULL。前端对 question_type 为空的题目
// 按简答处理、走原有 AI 判分流程，行为不变。
//
// classroom_quiz_answers.judged_by 区分判分来源（local / ai / teacher）：
// 原来的 judged_by_ai 是 0/1 布尔，只能表达「是不是 AI 判的」，
// 分不清「老师手工录入」和「本地秒判」。本字段补上这个区分，
// judged_by_ai 保留不动，新记录两个字段一起写，老代码不受影响。
exports.up = async function (knex) {
  // SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，knex 保证只执行一次
  await knex.raw('ALTER TABLE classroom_quiz_questions ADD COLUMN question_type TEXT');
  await knex.raw('ALTER TABLE classroom_quiz_questions ADD COLUMN options TEXT');
  await knex.raw('ALTER TABLE classroom_quiz_questions ADD COLUMN explanation TEXT');
  await knex.raw('ALTER TABLE classroom_quiz_answers ADD COLUMN judged_by TEXT');

  // 判分来源不建 CHECK 约束，与项目里其他「来源」字段的做法一致，
  // 避免以后加新来源又要改表。给个索引方便按来源统计。
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_classroom_quiz_answers_judged_by
    ON classroom_quiz_answers (judged_by)
  `);
};

exports.down = async function () {
  // 不回滚：新增的都是可空列，回滚会丢掉已录入的题型/选项/讲解数据
};