// 提示词分组：gen（由 config/prompts.js 拆分而来，内容未改动）
// 可用变量见各模板的 description 字段。

module.exports = {
  // ===== 生成作业：任务描述（按知识点 / 按详细要求 两种模式共用题型模板） =====
  gen_task_topic: {
    group: '生成作业',
    label: '任务描述（按知识点出题）',
    description: '生成作业时开头的"任务"句。可用变量：{grade_level} {effectiveTopic} {subject} {typeLabel} {difficulty}',
    default: `任务：为{grade_level}学生生成一份关于"{effectiveTopic}"的{subject}{typeLabel}作业，难度{difficulty}。`
  },

  gen_task_requirements: {
    group: '生成作业',
    label: '任务描述（按详细要求出题）',
    description: '教师填写了详细要求时的"任务"句。可用变量：{grade_level} {subject} {typeLabel} {difficulty} {requirements}',
    default: `任务：为{grade_level}学生生成一份{subject}{typeLabel}作业，难度{difficulty}。
教师提供了详细的作业要求，请严格遵循教师要求来设计题目（教师要求仅控制考查范围、题目侧重与风格，不得改变JSON返回格式和变体分组规则）：
"""
{requirements}
"""`
  },

  // ===== 生成作业：题型模板（按知识点 / 按详细要求 模式） =====

  gen_choice_single: {
    group: '生成作业',
    label: '单选题生成模板',
    description: '按知识点/详细要求出单选题。可用变量：{taskDesc} {actualCount} {count}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

{taskDesc}
要求生成{actualCount}道题目（每道题有A/B/C/D四个选项），同时为每道题生成：
- 正确答案（单选只有一个正确选项）
- 详细解析（解题思路和步骤）
- 解题分析过程
- 细粒度知识点标签（例："一元二次方程求根公式"、"三角函数诱导公式"，8-20字）

请严格按照以下JSON格式返回：
{"questions": [{"content": "题目内容", "options": ["选项A内容", "选项B内容", "选项C内容", "选项D内容"], "answer": "A", "explanation": "详细解析", "analysis": "解题步骤/思路", "knowledge_point": "细粒度知识点"}]}

要求：
1. {actualCount}道题中，每3道为一组变体（共{count}组），同一组变体考查相同知识点但数字/表述略有不同；同一组变体的knowledge_point必须相同
2. 不同组之间必须考查明显不同的知识点方向！严禁不同组考查相同或高度相似的知识点。例如第1组考查"一元二次方程求根公式"，第2组应考查"一元二次方程判别式"，第3组考查"一元二次方程根与系数关系"，而不是三组都考查求根公式
3. 确保所有答案都在options范围内
4. knowledge_point必须具体细致，不要写大类（例如不要只写"数学"、"代数"，而要写"一元一次方程解法"）
5. 同一组变体内部，题目之间必须有明显的数字、数值或具体情境差异，不能只是简单换几个字
6. 只返回JSON，不要任何其他内容`
  },

  gen_choice_multi: {
    group: '生成作业',
    label: '多选题生成模板',
    description: '按知识点/详细要求出多选题。可用变量：{taskDesc} {actualCount} {count}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

{taskDesc}
要求生成{actualCount}道多选题（每道题有A/B/C/D四个选项，可能有多个正确答案），同时生成详细解析。

请严格按照以下JSON格式返回：
{"questions": [{"content": "题目内容", "options": ["A","B","C","D"], "answer": ["A","C"], "explanation": "详细解析", "analysis": "解题步骤", "knowledge_point": "细粒度知识点"}]}

要求：
1. 每3道题为同一知识点的变体（共{count}组）；同一组变体的knowledge_point必须相同
2. 不同组之间必须考查明显不同的知识点方向！严禁不同组考查相同或高度相似的知识点
3. answer字段必须是数组格式
4. knowledge_point必须是8-20字的具体知识点，不要只写科目或大类
5. 同一组变体内部，题目之间必须有明显的数字、数值或具体情境差异
6. 只返回JSON，不要任何其他内容`
  },

  gen_judgment: {
    group: '生成作业',
    label: '判断题生成模板',
    description: '按知识点/详细要求出判断题。可用变量：{taskDesc} {actualCount} {count}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

{taskDesc}
要求生成{actualCount}道判断题，同时生成详细解析。

请严格按照以下JSON格式返回：
{"questions": [{"content": "判断题陈述内容", "answer": true, "explanation": "为什么对或错的解析", "analysis": "判断依据", "knowledge_point": "细粒度知识点"}]}

要求：
1. 每3道题为同一知识点的变体（共{count}组）；同一组变体的knowledge_point必须相同
2. 不同组之间必须考查明显不同的知识点方向！严禁不同组考查相同或高度相似的知识点
3. answer字段必须是布尔值true或false
4. knowledge_point必须是8-20字的具体知识点，不要只写科目或大类
5. 同一组变体内部，题目之间必须有明显的数字、数值或具体情境差异
6. 只返回JSON，不要任何其他内容`
  },

  gen_fill_blank: {
    group: '生成作业',
    label: '填空题生成模板',
    description: '按知识点/详细要求出填空题。可用变量：{taskDesc} {actualCount} {count}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

{taskDesc}
要求生成{actualCount}道填空题（用______表示需要填写的空位），同时生成详细解析。

请严格按照以下JSON格式返回：
{"questions": [{"content": "题目描述，需要填写的部分写成______", "answer": "应填入的内容", "explanation": "详细解析", "analysis": "解题步骤", "knowledge_point": "细粒度知识点"}]}

要求：
1. 每3道题为同一知识点的变体（共{count}组）；同一组变体的knowledge_point必须相同
2. 不同组之间必须考查明显不同的知识点方向！严禁不同组考查相同或高度相似的知识点
3. answer是填入空位的内容本身，不要用字母序号，不要出现选项
4. 若一道题有多个空位，answer中用英文逗号分隔多个答案，顺序与空位一致
5. knowledge_point必须是8-20字的具体知识点，不要只写科目或大类
6. 只返回JSON，不要任何其他内容`
  },

  gen_essay: {
    group: '生成作业',
    label: '简答题/作文生成模板',
    description: '按知识点/详细要求出主观题。可用变量：{taskDesc} {count}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

{taskDesc}
要求生成{count}道简答题/作文题，同时为每道题生成参考答案和评分标准。

请严格按照以下JSON格式返回：
{"questions": [{"content": "题目要求", "answer": "参考答案要点", "explanation": "评分标准和解析", "analysis": "答题思路指导", "knowledge_point": "细粒度知识点"}], "title": "建议的作业标题", "description": "建议的作业描述"}

要求：
1. 主观题不需要变体
2. knowledge_point必须是8-20字的具体知识点，不要只写科目或大类
3. 只返回JSON，不要任何其他内容`
  },

  // ===== 生成作业：粘贴题目模式 =====

  gen_paste_choice_single: {
    group: '粘贴题目整理',
    label: '粘贴整理·单选题模板',
    description: '老师粘贴原文后整理单选题。可用变量：{subject} {typeLabel} {question_type} {raw_text} {formatSample} {typeRules}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：老师粘贴了一段原始题目文本，文本格式可能不规范（可能包含题号、多余空行、答案与题目混排、缺少选项标号等）。请逐题解析、清洗并整理为标准JSON格式，不要遗漏原文中的任何一道题，也不要自行新增题目。

所有题目均为{subject}{typeLabel}（题型代码：{question_type}）。

老师粘贴的原始文本如下：
"""
{raw_text}
"""

请严格按照以下JSON格式返回：
{formatSample}

要求：
1. 保持每道题的原意，只做格式清理、错别字修正和表述规范化，不得改变题目考查内容
2. {typeRules}
3. 如原文答案缺失或无法确定，请根据题目自行推导出正确答案
4. 为每道题生成详细解析、解题分析过程和细粒度知识点标签（8-20字，具体细致，不要只写科目或大类）
5. topic字段为整理后的统一主题，title和description为建议的作业标题与描述
6. 只返回JSON，不要任何其他内容`
  },

  gen_paste_choice_multi: {
    group: '粘贴题目整理',
    label: '粘贴整理·多选题模板',
    description: '老师粘贴原文后整理多选题。可用变量：{subject} {typeLabel} {question_type} {raw_text} {formatSample} {typeRules}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：老师粘贴了一段原始题目文本，文本格式可能不规范（可能包含题号、多余空行、答案与题目混排、缺少选项标号等）。请逐题解析、清洗并整理为标准JSON格式，不要遗漏原文中的任何一道题，也不要自行新增题目。

所有题目均为{subject}{typeLabel}（题型代码：{question_type}）。

老师粘贴的原始文本如下：
"""
{raw_text}
"""

请严格按照以下JSON格式返回：
{formatSample}

要求：
1. 保持每道题的原意，只做格式清理、错别字修正和表述规范化，不得改变题目考查内容
2. {typeRules}
3. 如原文答案缺失或无法确定，请根据题目自行推导出正确答案
4. 为每道题生成详细解析、解题分析过程和细粒度知识点标签（8-20字，具体细致，不要只写科目或大类）
5. topic字段为整理后的统一主题，title和description为建议的作业标题与描述
6. 只返回JSON，不要任何其他内容`
  },

  gen_paste_judgment: {
    group: '粘贴题目整理',
    label: '粘贴整理·判断题模板',
    description: '老师粘贴原文后整理判断题。可用变量：{subject} {typeLabel} {question_type} {raw_text} {formatSample} {typeRules}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：老师粘贴了一段原始题目文本，文本格式可能不规范（可能包含题号、多余空行、答案与题目混排、缺少选项标号等）。请逐题解析、清洗并整理为标准JSON格式，不要遗漏原文中的任何一道题，也不要自行新增题目。

所有题目均为{subject}{typeLabel}（题型代码：{question_type}）。

老师粘贴的原始文本如下：
"""
{raw_text}
"""

请严格按照以下JSON格式返回：
{formatSample}

要求：
1. 保持每道题的原意，只做格式清理、错别字修正和表述规范化，不得改变题目考查内容
2. {typeRules}
3. 如原文答案缺失或无法确定，请根据题目自行推导出正确答案
4. 为每道题生成详细解析、解题分析过程和细粒度知识点标签（8-20字，具体细致，不要只写科目或大类）
5. topic字段为整理后的统一主题，title和description为建议的作业标题与描述
6. 只返回JSON，不要任何其他内容`
  },

  gen_paste_fill_blank: {
    group: '粘贴题目整理',
    label: '粘贴整理·填空题模板',
    description: '老师粘贴原文后整理填空题。可用变量：{subject} {typeLabel} {question_type} {raw_text} {formatSample} {typeRules}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：老师粘贴了一段原始题目文本，文本格式可能不规范（可能包含题号、多余空行、答案与题目混排等）。请逐题解析、清洗并整理为标准JSON格式，不要遗漏原文中的任何一道题，也不要自行新增题目。

所有题目均为{subject}{typeLabel}（题型代码：{question_type}）。

老师粘贴的原始文本如下：
"""
{raw_text}
"""

请严格按照以下JSON格式返回：
{formatSample}

要求：
1. 保持每道题的原意，只做格式清理、错别字修正和表述规范化，不得改变题目考查内容
2. 题干中需要学生填写的部分统一用______表示
3. {typeRules}
4. 如原文答案缺失或无法确定，请根据题目自行推导出正确答案
5. 为每道题生成详细解析、解题分析过程和细粒度知识点标签（8-20字，具体细致，不要只写科目或大类）
6. topic字段为整理后的统一主题，title和description为建议的作业标题与描述
7. 只返回JSON，不要任何其他内容`
  },

  gen_paste_essay: {
    group: '粘贴题目整理',
    label: '粘贴整理·简答题/作文模板',
    description: '老师粘贴原文后整理主观题。可用变量：{subject} {typeLabel} {question_type} {raw_text} {formatSample} {typeRules}',
    default: `你是一个JSON生成器。请只返回纯JSON，不要包含任何其他文字、解释或markdown格式。

任务：老师粘贴了一段原始题目文本，文本格式可能不规范（可能包含题号、多余空行、答案与题目混排等）。请逐题解析、清洗并整理为标准JSON格式，不要遗漏原文中的任何一道题，也不要自行新增题目。

所有题目均为{subject}{typeLabel}（题型代码：{question_type}）。

老师粘贴的原始文本如下：
"""
{raw_text}
"""

请严格按照以下JSON格式返回：
{formatSample}

要求：
1. 保持每道题的原意，只做格式清理、错别字修正和表述规范化，不得改变题目考查内容
2. {typeRules}
3. 如原文答案缺失或无法确定，请根据题目自行推导出参考答案要点
4. 为每道题生成评分标准、答题思路指导和细粒度知识点标签（8-20字，具体细致，不要只写科目或大类）
5. topic字段为整理后的统一主题，title和description为建议的作业标题与描述
6. 只返回JSON，不要任何其他内容`
  },

  // ===== 课堂做题：AI 快速出题 =====
};
