/**
 * 课堂做题：客观题本地判分
 *
 * 课堂答题原先只有一条路——学生口头答 → 语音识别成字母 → 送给 AI 判分。
 * 单选/多选/判断本该是确定性判断，却每次要等十几秒、花 token，
 * 判出来还是「答对了给 95 分」这种含糊结果。
 *
 * 题目表补上题型（question_type）、结构化选项（options）、标准答案（answer_text）后，
 * 客观题就能在前端直接判：点一下立刻知道对错，不花token、不等待。
 * 判不出来一律返回 null，由调用方退回原有 AI 流程——宁可慢，也不能判错。
 */

export interface QuizOption {
  key: string;
  text: string;
}

export interface QuizQuestion {
  id: number;
  question_text: string;
  answer_text?: string | null;
  question_type?: string | null;
  /** JSON 字符串（落库形态），也兼容已经是数组 */
  options?: string | QuizOption[] | null;
  explanation?: string | null;
}

export type JudgeSource = 'local' | 'ai' | 'teacher';

export interface LocalJudgeResult {
  isCorrect: boolean;
  /** 0-100。本地判是确定性的，给满分或 0，不给 95 这种模糊分 */
  score: number;
  correctAnswer: string;
  studentAnswer: string;
  judgeSource: JudgeSource;
}

/** 可本地秒判的类型 */
export const LOCAL_JUDGE_TYPES = ['choice_single', 'choice_multi', 'judgment'];

/** 判断题的各种写法，统一归一 */
const TRUE_TOKENS = ['对', '正确', '√', 'T', 'TRUE', 'A', 'YES', '1'];
const FALSE_TOKENS = ['错', '错误', '×', 'X', 'F', 'FALSE', 'B', 'NO', '0'];

/** 该题能否本地秒判：客观题 + 有标准答案 + 有选项 */
export function isLocalJudgeable(q?: QuizQuestion | null): boolean {
  if (!q) return false;
  const t = q.question_type;
  if (!t || !LOCAL_JUDGE_TYPES.includes(t)) return false;
  // 没有标准答案就不本地判：宁可退回 AI 流程，也不能瞎判
  if (!String(q.answer_text ?? '').trim()) return false;
  return normalizeOptions(q.options).length > 0;
}

/** 解析选项，兼容 JSON 字符串、数组、{A:'文本'} 对象 */
export function normalizeOptions(raw: unknown): QuizOption[] {
  if (!raw) return [];
  let list: any = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];
    try {
      list = JSON.parse(text);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(list)) {
    if (list && typeof list === 'object') {
      list = Object.entries(list).map(([key, text]) => ({ key, text }));
    } else {
      return [];
    }
  }
  return list
    .filter((o: any) => o && (o.text ?? o.label))
    .map((o: any, i: number) => ({
      key: String(o.key ?? String.fromCharCode(65 + i)).trim().toUpperCase(),
      text: String(o.text ?? o.label ?? '').trim(),
    }));
}

/**
 * 答案归一化成「A」「ABD」这种可比对形式。
 * 标准答案和学生的选择都过一遍，这样「A,B」「A、B」「AB」「b」都判成相等，
 * 否则多选题会误判成错。
 */
export function normalizeAnswer(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  const upper = String(raw).toUpperCase();
  const letters = upper.match(/[A-Z]/g);
  if (letters && letters.length) {
    return [...new Set(letters)].sort().join('');
  }
  if (TRUE_TOKENS.includes(upper)) return 'T';
  if (FALSE_TOKENS.includes(upper)) return 'F';
  const num = upper.match(/\d+/g);
  if (num) return num.join(',');
  return upper.trim();
}

/** 判断题：把选项键映射成 T/F，好与归一化后的标准答案比较 */
function judgmentKeyToTF(key: string, options: QuizOption[]): string {
  const opt = options.find((o) => o.key === key);
  if (!opt) return '';
  const t = opt.text.trim();
  const up = t.toUpperCase();
  if (TRUE_TOKENS.includes(up) || TRUE_TOKENS.includes(t)) return 'T';
  if (FALSE_TOKENS.includes(up) || FALSE_TOKENS.includes(t)) return 'F';
  return normalizeAnswer(t);
}

/**
 * 本地判分。判不了返回 null，调用方退回 AI 流程。
 * @param picked 学生选中的选项键（多选可多个）
 */
export function judgeLocally(q: QuizQuestion, picked: string[]): LocalJudgeResult | null {
  if (!isLocalJudgeable(q)) return null;
  const options = normalizeOptions(q.options);
  if (!options.length) return null;

  const isMulti = q.question_type === 'choice_multi';
  const student = isMulti
    ? normalizeAnswer(picked)
    : (picked[0] ? String(picked[0]).toUpperCase() : '');

  if (q.question_type === 'judgment') {
    // 标准答案可能写「正确」也可能写选项键「A」，两种都归到 T/F 再比
    const rawKey = String(q.answer_text ?? '').trim();
    const expected = judgmentKeyToTF(rawKey, options) || normalizeAnswer(rawKey);
    if (expected === 'T' || expected === 'F') {
      const pickedTF = judgmentKeyToTF(student, options) || normalizeAnswer(student);
      const ok = !!pickedTF && pickedTF === expected;
      return {
        isCorrect: ok,
        score: ok ? 100 : 0,
        correctAnswer: expected === 'T' ? '正确' : '错误',
        studentAnswer: pickedTF === 'T' ? '正确' : pickedTF === 'F' ? '错误' : '',
        judgeSource: 'local',
      };
    }
    return null;
  }

  if (!student) return null; // 还没选
  const expected = normalizeAnswer(q.answer_text);
  if (!expected) return null;
  const isCorrect = student === expected;
  return {
    isCorrect,
    score: isCorrect ? 100 : 0,
    correctAnswer: expected,
    studentAnswer: student,
    judgeSource: 'local',
  };
}