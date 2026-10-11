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

  // 批量版：一次评阅整份作业的所有主观题。
  // 相比逐题调用，耗时从「题数 × 单轮往返」降到「1 轮往返」，
  // 且同一份评分标准横向对比，不会出现同批题标准飘移。
  review_subjective_batch: {
    group: '作业评阅',
    label: 'AI评阅（简答/作文/填空）',
    description: '一次评阅一份作业里的全部主观题（含填空题）。可用变量：{subject} {count} {questions_text}',
    default: `你是一个JSON生成器和评阅老师。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：请一次性评阅以下 {count} 道{subject}主观题（可能包含简答、作文、填空题）。

{questions_text}

请严格按照以下JSON格式返回，results 的顺序与题目顺序一致，每一项的 question_id 必须原样回填：
{"results":[{"question_id": 题目id, "score": 分数(0-100), "feedback": "具体评价和建议（50字以内）", "key_points": ["得分点1"], "improvements": ["改进建议1"]}]}

要求：
1. results 的长度必须等于 {count}，不能漏题
2. question_id 必须使用题目里给出的 id，不要重新编号
3. score 必须是 0-100 之间的数字
4. 同一份答案要按统一标准评分，不要各题标准不一致
5. 填空题按「意思是否正确」打分，不要做字符串比对：分隔符不同（逗号、顿号、空格）、顺序不同、大小写不同、多余标点，都不算错；每一空都对给满分，漏空或写错才扣分
6. 简答/作文按要点齐全程度打分，意思对即可给高分
7. 学生完全没作答时给 0 分，不要因为题目简单就给分
8. 只返回 JSON，不要任何其他内容`,
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

  // ===== 课堂答题：AI 答疑（只讲解，不判分）=====

  explain_classroom_answer: {
    group: '作业评阅',
    label: '课堂答题AI答疑',
    description: '学生答完题后追问「为什么」「怎么做」，AI 针对题目与作答讲解。可用变量：{subject} {question_text} {reference_answer} {student_answer} {student_question}',
    default: `你是 classroom 里的答疑老师。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：学生做了一道题，回答之后还有疑问，请针对他的疑问讲解清楚。

【科目】{subject}
【题目】
{question_text}

【参考答案】
{reference_answer}

【学生作答】
{student_answer}

【学生的疑问】
{student_question}

请严格按照以下JSON格式返回：
{"explanation": "针对学生疑问的讲解（150字以内，口语化，能直接念给学生听）", "key_point": "这道题最关键的一个点（30字以内）"}

要求：
1. explanation 要直接回应学生的疑问，不要重复念一遍题目
2. 学生答对了就讲清楚「为什么这么做」，答错了就点出他卡在哪一步
3. 只返回JSON，不要任何其他内容`
  },

  // ===== 纸质作业 AI 识别 =====

  /**
   * 与 judge_paper_batch 同理：**只识别，不判分**。
   * 为什么这么拆、判分归谁，见 judge_paper_batch 上方的说明。
   */
  judge_paper_assignment: {
    group: '作业评阅',
    label: '纸质作业AI识别',
    description: '识别学生纸质作业照片并逐题转写作答内容（需配置支持图片输入的视觉模型）。本步骤不判分，对错由系统另行处理。可用变量：{subject} {question_list} {count} {image_count}',
    default: `你是一个JSON生成器和卷面识别助手。用户提供了学生纸质作业的照片（共{image_count}张，按拍摄顺序排列），请识别学生手写作答。

【科目】{subject}
【题目清单】（共{count}题，注意照片中题号与题目ID的对应）
{question_list}

请严格按照以下JSON格式返回：
{"results": [{"question_id": 题目ID数字, "recognized_answer": "读出的学生作答"}]}

要求：
1. results必须覆盖题目清单中的每一道题（question_id一一对应），不要遗漏；卷面上完全没写的题，recognized_answer填"(未作答)"，写了但看不清的填"(未识别)"
2. **只输出 recognized_answer，不要输出 is_correct、score、comment 任何判分字段**。对错和分数由系统用标准答案自动比对，你给出的会被丢弃
3. 单选/多选题：把学生勾选或圈画的**内容**换算成**选项字母**（清单里已给出每个字母对应的内容）；学生直接写了字母就照抄
4. 判断题：学生写"√""对""A""T"或"×""错""B""F"都照原样填
5. 填空题：按顺序逐空转写，**用英文逗号分隔**（学生原本用顿号、空格的也统一改成逗号）；几个空就要几段，不要合并、不要遗漏
6. 简答/作文：原样转写学生写的文字，不要概括、不要纠错、不要替他改错别字
7. 只返回JSON，不要任何其他内容`
  },

  // ===== 批量纸质作业识别（多张试卷自动分人）=====

  /**
   * 纸质卷识别：**AI 只负责读出学生写了什么，不判分**。
   *
   * 【为什么把判分从识别里摘出去】
   * 判分要分两种，用的判据完全不同：
   *   - 客观题有唯一答案，后端拿标准答案一比对就行（answerCheck.isAnswerCorrect）。
   *     这类题交给视觉模型判是纯亏：它会把 C 看成 G、把 AB 看成 A8，
   *     判错了还照样落库，而规则比对是纯字符串运算，100% 准、零成本、老师可复现。
   *   - 主观题（填空/简答/作文）才需要 AI 判语义对不对，那一步在 routes/paperScan.js
   *     里用 reviewOneQuestion 单独发起，走纯文本模型，不必再背一遍图片。
   *
   * 所以这个 prompt 里**一个参考答案都不下发**，连题干也按需要给：
   * 客观题只给选项（把学生圈的内容换算成字母要用），主观题只给题干（纸质卷上没有题干，
   * 读不出内容）。清单怎么拼见 routes/paperScan.js 的 buildQuestionLine。
   */
  judge_paper_batch: {
    group: '作业评阅',
    label: '批量纸质作业AI识别（自动分人）',
    description: '一次上传多张学生纸质作业照片，识别每份卷面的姓名并逐题转写作答内容（需视觉模型）。本步骤不判分，对错由系统另行处理。可用变量：{subject} {question_list} {count} {image_count} {name_list}',
    default: `你是一个JSON生成器和卷面识别助手。用户提供了多位学生的纸质作业照片（共{image_count}张，按拍摄顺序排列，每张照片通常对应一位学生的完整试卷，也可能一位学生占多张）。请先识别每张试卷卷首/页眉处的学生姓名，再逐题读出学生的作答内容。

【科目】{subject}
【题目清单】（共{count}题，注意照片中题号与题目ID的对应）
{question_list}
【本班学生名单】（用于校正姓名识别，请优先匹配名单中的姓名）
{name_list}

请按学生分组，严格按照以下JSON格式返回：
{"papers": [{"student_name": "学生真实姓名", "image_indexes": [该学生试卷所在的照片序号，从0开始], "results": [{"question_id": 题目ID数字, "recognized_answer": "读出的学生作答"}]}]}

要求：
1. 每位学生一个 papers 元素，不要合并多人；同一人的多张照片合并到同一个元素的 image_indexes 中
2. results必须覆盖题目清单中的每一道题；卷面上完全没写的题，recognized_answer填"(未作答)"；写了但看不清的填"(未识别)"
3. 若卷面姓名无法识别，student_name填"(未识别)"，仍需返回该题作答，交由老师手动指派学生
4. **只输出 recognized_answer，不要输出 is_correct、score、comment 任何判分字段**。对错和分数由系统用标准答案自动比对，你给出的会被丢弃
5. 单选/多选题：把学生勾选或圈画的**内容**换算成**选项字母**（清单里已给出每个字母对应的内容，例如圈了"北京"就填"B"）；学生直接写了字母就照抄
6. 判断题：学生写"√""对""A""T"或"×""错""B""F"都照原样填
7. 填空题：按顺序逐空转写，**用英文逗号分隔**（学生原本用顿号、空格的也统一改成逗号）；几个空就要几段，不要合并、不要遗漏、不要替学生把没写的空补上
8. 简答/作文：原样转写学生写的文字，不要概括、不要纠错、不要替他改错别字；写得太潦草就填"(未识别)"，不要猜
9. 只返回JSON，不要任何其他内容`
  },

  // ===== 管理员：学生账号生成 =====
};
