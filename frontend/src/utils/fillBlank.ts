/**
 * 填空题「空位」与「答案」的唯一口径。
 *
 * 起因（两个真实问题）：
 *
 * 1) 一题多空只有一个输入框。学生要自己数「第几个逗号对应第几个空」，
 *    题干里明明画着两个横线，界面上却只有一个框，填错顺序、漏填一个都很难自查。
 *    本模块提供 splitContentByBlanks，把题干按空位切开，交给 UI 在每个空位原位插入输入框。
 *
 * 2) 多空答案用逗号分隔后，后端原来拿「整串 trim + 小写 + 全等」比对
 *    （见 backend/src/utils/answerCheck.js）。于是「北京，上海」「北京、上海」
 *    「牛顿, 第一定律」全被判错——学生主观上确实做完了，系统说没做对。
 *    现在统一成：按空拆段 → 逐段 trim → 去空白 → 小写 → 逐空全等。
 *
 * 注意：本模块只负责「怎么切、怎么拼」，不判对错。
 * 判对错必须走 backend/src/utils/answerCheck.js，前后端口径靠下面的
 * splitFillBlankAnswer 与后端 normalizeFillBlank 保持一致，改一处必须同步另一处。
 */

/**
 * 空位占位符。AI 出题约定用 6 个半角下划线（backend/src/config/prompts/gen.js），
 * 但历史题库里还有 2 个 / 3 个 / 4 个下划线、全角下划线，以及纸质试卷常见的
 * 「全角括号内留空」写法，这里一并识别。
 *
 * 不匹配普通成对括号：语文/英语题干里「（ ）」这类括号可能只是标点，
 * 误判成空位会凭空多出一个输入框，比漏识别更难解释。
 */
const BLANK_PATTERN = /_{2,}|＿+|【\s*】|（\s*）/g;

export interface SplitBlanksResult {
  /** 按空位切开的题干片段，长度恒为 空数 + 1；无空位时长度为 1 */
  parts: string[];
  /** 空位数量 */
  blankCount: number;
}

/**
 * 按空位把题干切开，供 UI 在每个空位原位插入输入框。
 *
 * 返回的 parts[0] 是第一个空之前的文字，parts[i] 是第 i 个空（i 从 1 开始）
 * 与第 i+1 个空之间的文字。UI 渲染成：parts[0] + 输入框1 + parts[1] + 输入框2 + ...
 */
export const splitContentByBlanks = (content?: string | null): SplitBlanksResult => {
  const text = String(content ?? '');
  if (!text) return { parts: [''], blankCount: 0 };

  const parts: string[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let count = 0;
  BLANK_PATTERN.lastIndex = 0;
  while ((match = BLANK_PATTERN.exec(text)) !== null) {
    parts.push(text.slice(last, match.index));
    last = match.index + match[0].length;
    count++;
  }
  parts.push(text.slice(last));

  // blankCount 取「匹配到的空位数」，不能取 parts.length - 1：
  // 相邻的两个空位（如 "＿＿＿" 拆成半角+全角，或题干以空位开头）中间片段为空串，
  // 按 parts.length 反推会把首位的空位算丢，导致题目明明有一个空却渲染不出输入框，
  // 学生看到的就是「界面找不到框，提交却说没作答」。
  return { parts, blankCount: count };
};

/** 题干里能识别出几个空；识别不出（历史脏数据 / AI 没生成占位符）返回 0 */
export const countBlanks = (content?: string | null): number => splitContentByBlanks(content).blankCount;

/**
 * 把「逗号分隔的整串答案」拆成「每个空一段」。
 *
 * 拆分符只认逗号类标点，**不按空白拆**：
 * 答案本身就可能含空格或英文词组（"New York"、"3 14"），按空白拆会把一个答案劈成两个空。
 * 多余的空白在归一化阶段去掉，所以 "牛顿, 第一定律" 和 "牛顿,第一定律" 判为一致。
 */
export const splitFillBlankAnswer = (answer: unknown): string[] => {
  const raw = Array.isArray(answer) ? answer.join(',') : String(answer == null ? '' : answer);
  return raw
    .split(/[,，、;；]+/)
    .map(s => s.trim())
    .filter(s => s !== '');
};

/**
 * 每一空归一化后的样子，用于逐空比对。
 * 去内部空白 + 转小写，让 "New York" / "new york" / "NEWYORK" 视为同一个答案。
 */
export const normalizeBlankValue = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[\s　]/g, '').toLowerCase();

/** 把按空存好的答案数组拼成后端约定的整串（英文逗号分隔） */
export const joinFillBlankAnswers = (values: unknown[]): string =>
  values.map(v => String(v == null ? '' : v).trim()).filter(v => v !== '').join(',');

/**
 * 这道填空题算不算「已作答」：每个空都必须填了非空白内容。
 *
 * 空数不一致（题干有 3 个空、只填了 2 个）同样算没做完，提交时点名提醒，
 * 而不是提交后被判错——「说没做完」和「说做错了」在学生眼里是两件事。
 */
export const isFillBlankAnswered = (values: unknown, blankCount: number): boolean => {
  const list = Array.isArray(values) ? values : splitFillBlankAnswer(values);
  if (blankCount > 0) {
    if (list.length < blankCount) return false;
    return list.slice(0, blankCount).every(v => normalizeBlankValue(v) !== '');
  }
  return list.some(v => normalizeBlankValue(v) !== '');
};

/**
 * 把 studentAnswers 里存的填空题答案规范成「按空对齐的数组」，长度恒为 blankCount。
 *
 * studentAnswers 里可能躺着三种形态：历史遗留的逗号整串、数组、undefined。
 * 渲染前统一走这里，UI 就可以放心按 blankCount 个输入框取值。
 */
export const toBlankValueArray = (value: unknown, blankCount: number): string[] => {
  if (blankCount <= 0) return Array.isArray(value) ? value.map(v => String(v ?? '')) : [String(value ?? '')];
  const list = Array.isArray(value)
    ? value.map(v => String(v ?? ''))
    : splitFillBlankAnswer(value);
  const out: string[] = [];
  for (let i = 0; i < blankCount; i++) out.push(list[i] ?? '');
  return out;
};