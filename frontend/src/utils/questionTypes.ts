/**
 * 题型（后端 question_bank.type / 作业 question_type）的唯一出口。
 *
 * 为什么要有这个文件：这些「英文代码 → 中文名」的映射原先在十来个文件里各抄一份
 * （printPaper、Assignments、QuestionBank、WrongQuestions、PaperRegister、PaperBatchRegister、
 * DataView、TokenDashboard、BossBattle…）。每加一个题型就要手动同步所有副本，
 * 漏一处就出事：兜底写法是 `表[type] || type`，查不到中文就把英文代码原样显示给用户。
 * composition（作文）当初就是这样漏了九处，只在 QuestionBank 补上了，
 * 于是用户在别的页面看到裸的 "composition"。新增题型请只改这里。
 *
 * 口径与后端保持一致，见 backend/src/routes/assignments.js 的 TYPE_LABELS：
 * essay（简答）与 composition（作文）同属主观题，由 AI 评阅、不自动判对错。
 */

type TypeStyle = { label: string; color: string };

/** 短标签：用于表格 Tag、筛选器等紧凑位置 */
const TYPE_STYLE: Record<string, TypeStyle> = {
  choice_single: { label: '单选', color: 'blue' },
  choice_multi: { label: '多选', color: 'geekblue' },
  judgment: { label: '判断', color: 'purple' },
  // 后端题型代码是 judgment，true_false 只是历史脏数据，保留兼容
  true_false: { label: '判断', color: 'purple' },
  fill_blank: { label: '填空', color: 'cyan' },
  essay: { label: '主观', color: 'orange' },
  composition: { label: '作文', color: 'magenta' },
  // 一次配置多种题型时后端记成 mixed，不是真实题型，只为展示不漏英文
  mixed: { label: '混合', color: 'default' },
};

/** 完整中文名：带「题」字，用于试卷抬头、打印卷面等正式场合 */
const TYPE_FULL_NAME: Record<string, string> = {
  choice_single: '单选题',
  choice_multi: '多选题',
  judgment: '判断题',
  // 与 TYPE_STYLE 保持同样的 key 集合，两张表任一新增都要同步补另一张
  true_false: '判断题',
  fill_blank: '填空题',
  essay: '简答题',
  composition: '作文题',
  mixed: '混合题型',
};

/**
 * 主观题：答案不唯一，由 AI 评阅或教师自评，不参与自动判对错。
 * 与后端 assignments.js 的 isObjectiveType 保持镜像（它是本表的取反集）。
 *
 * 【填空题为什么在这里】它曾经是客观题：服务端按逗号拆段逐空精确比对，
 * 于是「北京 上海」「北京、上海」「牛顿, 第一定律」全被判 0 分，
 * 而这些写法在老师和学生眼里都是对的。现在改为 AI 按语义判分，
 * 容忍分隔符、空格、顺序的差异；AI 不可用时后端会退回规则比对兜底。
 * 与后端 backend/src/routes/assignments.js 的 isObjectiveType 必须同步。
 */
const SUBJECTIVE_TYPES = new Set(['essay', 'composition', 'fill_blank']);

/** 客观题：有唯一标准答案，提交时即可规则判分、立刻出分 */
const OBJECTIVE_TYPES = new Set(['choice_single', 'choice_multi', 'judgment']);

/**
 * 错题本重做时需要「学生自评对错」的题型。
 *
 * 为什么不能直接用 isSubjectiveType：作文类自评是合理的（开放题没有唯一答案，
 * 判分本来就该由老师或学生本人来）；但填空题有标准答案，错题本重做走的是
 * 同步接口 POST /wrong/retry，直接与参考答案比对即可，让学生「自己给自己判对错」
 * 纯属多一道坎，还会让人以为系统不管对错。
 */
const SELF_MARK_TYPES = new Set(['essay', 'composition']);

/** 短中文标签；查不到就原样返回（不猜、不吞异常，调用方一眼能看出是脏数据） */
export function questionTypeLabel(type?: string | null): string {
  const t = normalizeQuestionType(type);
  if (!t) return '';
  return TYPE_STYLE[t]?.label ?? t;
}

/** 完整中文名（带「题」字）；查不到退回短标签，再查不到原样返回 */
export function questionTypeFullName(type?: string | null): string {
  const t = normalizeQuestionType(type);
  if (!t) return '';
  return TYPE_FULL_NAME[t] ?? questionTypeLabel(t);
}

/** Tag 颜色；查不到用 antd 默认色 */
export function questionTypeColor(type?: string | null): string {
  const t = normalizeQuestionType(type);
  return (t && TYPE_STYLE[t]?.color) || 'default';
}

/** 是否主观题（essay / composition / fill_blank） */
export function isSubjectiveType(type?: string | null): boolean {
  return SUBJECTIVE_TYPES.has(normalizeQuestionType(type));
}

/** 是否客观题（提交即可判分：单选 / 多选 / 判断） */
export function isObjectiveType(type?: string | null): boolean {
  return OBJECTIVE_TYPES.has(normalizeQuestionType(type));
}

/** 错题本重做时是否需要学生自评对错（作文类；填空题不需要，见 SELF_MARK_TYPES） */
export function needsSelfMarkRetry(type?: string | null): boolean {
  return SELF_MARK_TYPES.has(normalizeQuestionType(type));
}

/**
 * 是否填空题。
 *
 * 单独给一个出口，是因为「填空题有按空渲染的输入框、答案要按空拼接」这类分支
 * 散落在三四个组件里，各自写一遍 `type === 'fill_blank'` 又会漏掉归一化 ——
 * 题库里存成 'Fill_Blank' 时，控件就不渲染了。
 */
export function isFillBlankType(type?: string | null): boolean {
  return normalizeQuestionType(type) === 'fill_blank';
}

/**
 * 去掉首尾空白并转小写。
 *
 * 题库里存成 'Fill_Blank'、' composition ' 的历史脏数据（AI 出题、手工录入、
 * 旧版本代码都产生过），原先每个调用点各判一次 `t === 'xxx'`：一个都匹配不上，
 * 于是标签位置显示裸英文、不渲染输入框、提交时被报「题型无法作答，请联系老师」，
 * 师生都查不出是哪一环坏了。归一化收进下面这几个出口，所有调用点一次性受益。
 */
export function normalizeQuestionType(type?: string | null): string {
  return (type || '').trim().toLowerCase();
}
