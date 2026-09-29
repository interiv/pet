// 提示词分组：classroom（由 config/prompts.js 拆分而来，内容未改动）
// 可用变量见各模板的 description 字段。

module.exports = {
  gen_classroom: {
    group: '生成作业',
    label: '课堂快速出题',
    description: '课堂做题弹窗里的AI快速出题（口答/抢答题，不入题库）。可用变量：{grade_level} {topic} {subject} {typeLabel} {difficulty} {count}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：为{grade_level}学生生成{count}道适合课堂口答/抢答的{subject}{typeLabel}题目，围绕"{topic}"，难度{difficulty}。

请严格按照以下JSON格式返回：
{"questions": [{"content": "题目内容", "answer": "参考答案", "explanation": "简要解析（30字以内）"}]}

要求：
1. 题目要简短明了，适合课堂口头回答或抢答，题干不要冗长
2. answer为参考答案，仅供老师核对，不会展示给学生
3. 只返回JSON，不要任何其他内容`
  },


  gen_classroom_requirements: {
    group: '生成作业',
    label: '课堂快速出题·按详细要求',
    description: '课堂做题AI出题，教师写详细要求。可用变量：{grade_level} {requirements} {subject} {typeLabel} {difficulty} {count}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：为{grade_level}学生生成{count}道适合课堂口答/抢答的{subject}{typeLabel}题目，难度{difficulty}。
教师提供了详细的出题要求，请严格遵循教师要求来设计题目（教师要求仅控制考查范围与题目侧重，不得改变JSON返回格式）：
"""
{requirements}
"""

请严格按照以下JSON格式返回：
{"questions": [{"content": "题目内容", "answer": "参考答案", "explanation": "简要解析（30字以内）"}]}

要求：
1. 题目要简短明了，适合课堂口头回答或抢答，题干不要冗长
2. answer为参考答案，仅供老师核对，不会展示给学生
3. 只返回JSON，不要任何其他内容`
  },

  gen_classroom_paste: {
    group: '生成作业',
    label: '课堂快速出题·粘贴题目整理',
    description: '课堂做题AI出题，教师粘贴原文后整理。可用变量：{subject} {raw_text}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：老师粘贴了一段原始题目文本，格式可能不规范（可能包含题号、多余空行、答案与题目混排等）。请逐题解析、清洗并整理为适合课堂口答/抢答的{subject}题目，不要遗漏原文中的任何一道题，也不要自行新增题目。

老师粘贴的原始文本如下：
"""
{raw_text}
"""

请严格按照以下JSON格式返回：
{"questions": [{"content": "题目内容", "answer": "参考答案", "explanation": "简要解析（30字以内）"}]}

要求：
1. 保持每道题的原意，只做格式清理、错别字修正和表述规范化；若原题缺少答案，请根据题目推导
2. 题目要简短明了，适合课堂口头回答或抢答
3. answer为参考答案，仅供老师核对，不会展示给学生
4. 只返回JSON，不要任何其他内容`
  },

  // ===== 主观题 AI 评阅 =====
};
