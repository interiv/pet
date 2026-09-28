/**
 * AI 提示词注册表（统一入口）
 *
 * 系统中所有 AI 提示词都集中在这里定义默认值。
 * 管理员可在「后台管理 → AI设置 → 提示词设置」中查看/修改：
 *   - settings 表 key = `prompt_<key>`，有值且不等于默认值时生效
 *   - 留空 / 恢复默认 = 使用这里的默认模板
 *
 * 模板变量使用 {var} 形式（如 {subject}），运行时由 fillTemplate() 替换；
 * 未在 vars 中提供的 {xxx} 会原样保留，因此模板里的 JSON 花括号不受影响。
 *
 * 用法：
 *   const { getPrompt, fillTemplate } = require('../config/prompts');
 *   const prompt = fillTemplate(getPrompt('gen_choice_single'), { taskDesc, count, actualCount });
 */

const SETTING_PREFIX = 'prompt_';

const PROMPTS = {
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

  // ===== 主观题 AI 评阅 =====
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
  coach_learning_plan: {
    group: 'AI学习教练',
    label: '7天学习规划',
    description: '学生查看学习规划时生成。可用变量：{days} {total_cnt} {correct_cnt} {subject_summary} {weak_summary} {mastered_summary} {wrong_summary}',
    default: `你是一位富有耐心的AI学习教练，要为一位学生制定未来7天的个性化学习规划。请只返回纯JSON，不要任何额外文字或markdown。

【学生学情摘要】
- 最近{days}天累计作答：{total_cnt}题，答对{correct_cnt}题
- 各科目表现：{subject_summary}
- 薄弱知识点：{weak_summary}
- 已掌握知识点：{mastered_summary}
- 未复习错题样本：
{wrong_summary}

请输出结构化的7天学习规划，严格遵循以下JSON格式：
{
  "overview": "用2-3句话总结学生整体学情和规划核心目标",
  "priority_goals": ["核心目标1", "核心目标2", "核心目标3"],
  "daily_plan": [
    {"day": 1, "theme": "当日主题", "focus_points": ["知识点1", "知识点2"], "tasks": ["具体任务1", "具体任务2"], "estimated_minutes": 30},
    {"day": 2, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 3, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 4, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 5, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 6, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 7, "theme": "复盘测评", "focus_points": [], "tasks": [], "estimated_minutes": 30}
  ],
  "weekly_milestone": "第7天完成时应达到的可验证目标",
  "encouragement": "给学生一段温暖鼓励的话（50字以内）"
}

要求：
1. 前3天优先攻克薄弱知识点与未复习错题
2. 中间2-3天穿插巩固练习+相似题训练
3. 最后1-2天做综合复盘与自测
4. tasks要具体可执行（如"重做错题本前5题"、"做10道二次函数选择题"）
5. 不同day的focus_points不要完全重复
6. 只返回JSON，不要任何其它内容`
  },
  coach_diagnosis: {
    group: 'AI学习教练',
    label: '学情诊断报告',
    description: '学生查看诊断报告时生成。可用变量：{days} {total_cnt} {overall_accuracy} {subject_summary} {weak_summary} {mastered_summary} {wrong_total} {unreviewed_total}',
    default: `你是一位专业的AI学情诊断师。请基于学生学情生成一份结构化诊断报告。只返回纯JSON，不要任何额外文字。

【学生学情】
- 统计周期：最近{days}天
- 总答题量：{total_cnt}，整体正确率：{overall_accuracy}%
- 各科目：{subject_summary}
- 薄弱知识点：{weak_summary}
- 稳定掌握：{mastered_summary}
- 错题本共{wrong_total}题，未复习{unreviewed_total}题

请严格按照以下JSON格式返回：
{
  "overall_score": 75,
  "level": "良好",
  "strengths": ["优势点1", "优势点2"],
  "weaknesses": ["问题1", "问题2", "问题3"],
  "root_cause_analysis": "用50-120字分析薄弱点成因，如'选择题审题不细致'、'公式记忆模糊'等",
  "recommendations": [
    {"priority": "高", "action": "具体行动建议", "expected_effect": "预期效果"},
    {"priority": "中", "action": "...", "expected_effect": "..."},
    {"priority": "低", "action": "...", "expected_effect": "..."}
  ],
  "next_focus_points": ["下一阶段应重点突破的知识点1", "知识点2", "知识点3"],
  "summary": "用30-50字给出整体评价，温暖且建设性"
}

要求：
1. overall_score 0-100整数，level从"待提升/一般/良好/优秀/卓越"中选
2. strengths 至少1条；weaknesses 2-4条；recommendations 2-4条
3. 建议要具体可执行，避免空话套话
4. 只返回JSON`
  },

  // ===== 管理员：学生账号生成 =====
  admin_student_accounts: {
    group: '管理员工具',
    label: '学生账号批量生成',
    description: '管理员/班主任粘贴学生姓名后AI生成拼音账号。可用变量：{list_text}',
    default: `你是学校系统的账号生成助手。请为下列学生姓名分别生成一个登录账号（用户名）。

要求：
1. 账号使用姓名对应的汉语拼音，全部小写，只允许字母和数字，必须以字母开头，长度 4-20
2. 不要包含中文、空格、横线或其他特殊符号
3. 同一批内账号不能重复；遇到同名时用数字后缀区分（例如 zhangwei、zhangwei2）
4. 只输出严格 JSON 数组，不要任何解释、markdown 代码块或多余文字
5. 输出格式：[{"name":"张三","username":"zhangsan"}]

学生姓名：
{list_text}`
  }
};

/**
 * 读取提示词：settings 表有自定义值时返回自定义值，否则返回默认模板
 */
function getPrompt(key) {
  const def = PROMPTS[key];
  if (!def) return '';
  try {
    // 延迟 require，避免模块加载顺序问题
    const { db } = require('./database');
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_PREFIX + key);
    if (row && String(row.value).trim()) return String(row.value);
  } catch (e) {
    // settings 表可能尚未创建，忽略并使用默认值
  }
  return def.default;
}

/**
 * 用 vars 替换模板中的 {var} 占位符。
 * 只替换 vars 中提供的变量名，模板里其它花括号内容（如JSON样例）原样保留。
 */
function fillTemplate(template, vars) {
  let result = template || '';
  for (const [name, value] of Object.entries(vars || {})) {
    result = result.split('{' + name + '}').join(String(value === undefined || value === null ? '' : value));
  }
  return result;
}

module.exports = { PROMPTS, SETTING_PREFIX, getPrompt, fillTemplate };
