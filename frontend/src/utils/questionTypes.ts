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
 * 与后端 assignments.js、answerCheck.js 的判定保持一致。
 */
const SUBJECTIVE_TYPES = new Set(['essay', 'composition']);

/** 客观题：有标准答案，可自动判分 */
const OBJECTIVE_TYPES = new Set(['choice_single', 'choice_multi', 'judgment', 'fill_blank']);

/** 短中文标签；查不到就原样返回（不猜、不吞异常，调用方一眼能看出是脏数据） */
export function questionTypeLabel(type?: string | null): string {
  if (!type) return '';
  return TYPE_STYLE[type]?.label ?? type;
}

/** 完整中文名（带「题」字）；查不到退回短标签，再查不到原样返回 */
export function questionTypeFullName(type?: string | null): string {
  if (!type) return '';
  return TYPE_FULL_NAME[type] ?? questionTypeLabel(type);
}

/** Tag 颜色；查不到用 antd 默认色 */
export function questionTypeColor(type?: string | null): string {
  return (type && TYPE_STYLE[type]?.color) || 'default';
}

/** 是否主观题（essay / composition） */
export function isSubjectiveType(type?: string | null): boolean {
  return !!type && SUBJECTIVE_TYPES.has(type);
}

/** 是否客观题 */
export function isObjectiveType(type?: string | null): boolean {
  return !!type && OBJECTIVE_TYPES.has(type);
}

/** 去掉首尾空白并转小写，容忍用户手输 / 大小写不一致的题型 */
export function normalizeQuestionType(type?: string | null): string {
  return (type || '').trim().toLowerCase();
}
