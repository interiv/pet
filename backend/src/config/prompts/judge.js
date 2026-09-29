// 提示词分组：judge（由 config/prompts.js 拆分而来，内容未改动）
// 可用变量见各模板的 description 字段。

module.exports = {
  review_subjective: {
    group: '作业评阅',
    label: '主观题AI评阅',
    description: '学生提交简答/作文后的自动评阅。可用变量：{subject} {question_content} {reference_answer} {student_answer}',
    default: `你是一个JSON生成器和评阅老师。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：请评阅以下{subject}主观题作答：

【题目】
{question_content}

【参考答案】
{reference_answer}

【学生作答】
{student_answer}

请严格按照以下JSON格式返回评分结果：
{"score": 分数(0-100), "feedback": "具体评价和建议（50字以内）", "key_points": ["得分点1", "得分点2"], "improvements": ["改进建议1"]}

要求：
1. score必须是0-100之间的数字
2. 只返回JSON，不要任何其他内容`
  },

  // ===== AI 学习教练 =====

  judge_classroom_answer: {
    group: '作业评阅',
    label: '课堂答题AI评判',
    description: '课堂口答后AI判断对错并打分。可用变量：{subject} {question_text} {reference_answer} {student_answer}',
    default: `你是一个JSON生成器和评阅老师。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：课堂口头答题评判。请判断学生的口头回答是否正确，并给出正确答案供全班对照。

【科目】{subject}
【题目】
{question_text}

【参考答案】
{reference_answer}

【学生回答】
{student_answer}

请严格按照以下JSON格式返回：
{"is_correct": true或false, "score": 0到100的整数, "comment": "一两句简短点评（先肯定亮点再指出问题，语气鼓励）", "correct_answer": "这道题的正确答案或要点"}

要求：
1. 口头回答允许表述不完整，意思对即可给高分
2. score参考：完全正确90-100，基本正确70-89，部分正确40-69，错误0-39
3. correct_answer必须给出：无论学生答对与否，都要给出简洁、标准的正确答案或要点，便于全班对照学习
4. 只返回JSON，不要任何其他内容`
  },

  // ===== 纸质作业 AI 识别评判 =====

  judge_paper_assignment: {
    group: '作业评阅',
    label: '纸质作业AI识别评判',
    description: '识别学生纸质作业照片并逐题判分（需配置支持图片输入的视觉模型）。可用变量：{subject} {question_list} {count} {image_count}',
    default: `你是一个JSON生成器和批改老师。用户提供了学生纸质作业的照片（共{image_count}张，按拍摄顺序排列），请识别学生手写作答，并逐题判分。

【科目】{subject}
【题目清单】（共{count}题，注意照片中题号与题目ID的对应）
{question_list}

请识别照片中每道题的学生作答，并严格按照以下JSON格式返回：
{"results": [{"question_id": 题目ID数字, "recognized_answer": "识别出的学生答案", "is_correct": true或false, "score": 0到100的整数（该题得分百分比）, "comment": "简短说明（10字以内）"}]}

要求：
1. results必须覆盖题目清单中的每一道题（question_id一一对应），不要遗漏；照片中无法识别或未作答的题，recognized_answer填"(未识别)"，is_correct为false，score为0
2. 客观题：学生答案与参考答案一致才判正确；多选题所含选项相同但顺序不同也算正确
3. 学生可能只写选项字母（如"A"）或√/×，注意与参考答案对应
4. 主观题（简答/作文）：意思正确、要点齐全即可给高分，score为该题得分百分比
5. 只返回JSON，不要任何其他内容`
  },

  // ===== 管理员：学生账号生成 =====
};
