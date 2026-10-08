/**
 * 课堂做题：题干文本解析（纯函数）
 *
 * 与后端 backend/src/services/classroomQuestionText.js 是同一套判据，
 * 两边必须保持一致：后端在建题入库时拆一次，控制台再拆一次做兜底
 * （库里改动之前建的题options 列是空的，只能在前端认）。
 *
 * 改动时请同步改两边，否则会出现「入库时判成简答、控制台却判成客观题」这类不一致。
 */

const MAX_OPTION_LEN = 500;

export interface InlineOption { key: string; text: string; }

/**
 * 从题干纯文本里识别并拆出结构化选项。
 *
 * 识别规则刻意保守：至少 2 个选项、字母必须从 A 开始连续递增、
 * 选项内容非空且不过长；任何一条不满足就返回 null（按简答处理）。
 * 宁可少认，也不能把简答题误判成选择题。
 */
export function splitInlineOptions(rawText?: string | null): { stem: string; options: InlineOption[] } | null {
  const text = String(rawText || '').trim();
  if (!text) return null;

  // 选项标记：A. / A． / A、 / A) / A）/ A：，大写字母 + 分隔符。
  // 前置条件用「非字母数字」而不是「行首或空白」——真实题干里
  // 「…是谁？A.李白」这种 A 紧跟标点的情况最常见，
  // 要求前面有空白会漏掉它（于是只命中 B/C/D，连续性校验反而失败）。
  const marker = /(^|[^A-Za-z0-9])([A-Z])\s*[.．、）)]\s*/g;
  const hits: { key: string; start: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(text)) !== null) {
    hits.push({
      key: m[2],
      start: m.index + m[1].length,
      contentStart: m.index + m[0].length,
    });
  }
  if (hits.length < 2) return null;

  // 字母必须从 A 开始连续递增
  const expected = hits.map((_, i) => String.fromCharCode(65 + i)).join('');
  if (hits.map((h) => h.key).join('') !== expected) return null;

  const options: InlineOption[] = hits.map((h, i) => ({
    key: h.key,
    text: String(
      text.slice(h.contentStart, i + 1 < hits.length ? hits[i + 1].start : undefined) || ''
    ).trim(),
  }));
  if (options.some((o) => !o.text)) return null;
  if (options.some((o) => o.text.length > MAX_OPTION_LEN)) return null;

  const stem = String(text.slice(0, hits[0].start) || '').trim();
  if (!stem) return null;

  return { stem, options };
}

/** 判断一组选项是不是判断题（形如「正确 / 错误」两选项） */
export function looksLikeJudgment(options?: InlineOption[] | null): boolean {
  if (!options || options.length !== 2) return false;
  const texts = options.map((o) => o.text.replace(/[。．.]$/, ''));
  const yes = ['对', '正确', '是', 'T', 'true', '√'];
  const no = ['错', '错误', '否', 'F', 'false', '×'];
  return (
    (yes.includes(texts[0]) && no.includes(texts[1])) ||
    (no.includes(texts[0]) && yes.includes(texts[1]))
  );
}

/** 从选项推断题型：判断题是「正确/错误」两选项，其余按单选 */
export function inferTypeFromOptions(options?: InlineOption[] | null): 'judgment' | 'choice_single' {
  return looksLikeJudgment(options) ? 'judgment' : 'choice_single';
}
