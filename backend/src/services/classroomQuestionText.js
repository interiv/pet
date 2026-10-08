/**
 * 课堂做题：题干文本解析（纯函数，不碰数据库）
 *
 * 这个文件刻意不require 任何数据库模块，因此可以被两处安全复用：
 *   1. services/classroomQuiz.js —— 建题入库时规整
 *   2. migrations/027_backfill_*.js —— 迁移脚本里回填存量题
 * 而数据库连接是互斥的：迁移里 knex 已经开着一个连接，
 * 如果这里再 require config/database，就会两个连接锁同一个 sqlite 文件（database is locked）。
 */

const MAX_OPTION_LEN = 500;

/**
 * 从题干纯文本里识别并拆出结构化选项。
 *
 * 为什么需要：客观题的选项并不总是单独存的——AI 出的题把选项内嵌在 content 里，
 * 老师手动录入、粘贴原文整理出来的题更常见（例：「…作者是谁？A.李白 B.李绅 C.杜甫 D.白居易」）。
 * 这些题如果不拆出选项，题型识别不出来，就只能退回 AI 判分，
 * 客观题本地秒判这条路等于没打开。
 *
 * 识别规则刻意保守：至少 2 个选项、字母必须从 A 开始连续递增、
 * 选项内容非空且不过长；任何一条不满足就返回 null（按简答处理）。
 * 宁可少认，也不能把简答题误判成选择题。
 *
 * @param {string} rawText
 * @returns {{stem: string, options: Array<{key: string, text: string}>}|null}
 */
function splitInlineOptions(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  // 选项标记：A. / A． / A、 / A) / A）/ A：，大写字母 + 分隔符。
  // 前置条件用「非字母数字」而不是「行首或空白」——真实题干里
  // 「…是谁？A.李白」这种 A 紧跟在标点后的情况最常见，
  // 要求前面必须有空白会漏掉它（于是只命中 B/C/D，连续性校验反而失败）。
  const marker = /(^|[^A-Za-z0-9])([A-Z])\s*[.．、）)]\s*/g;
  const hits = [];
  let m;
  while ((m = marker.exec(text)) !== null) {
    hits.push({
      key: m[2],
      // start 指向字母本身（不含前置字符），题干到这里为止
      start: m.index + m[1].length,
      contentStart: m.index + m[0].length,
    });
  }
  if (hits.length < 2) return null;

  // 字母必须从 A 开始连续递增，否则不是一组规整的 A/B/C/D 选项
  const expected = hits.map((_, i) => String.fromCharCode(65 + i)).join('');
  if (hits.map((h) => h.key).join('') !== expected) return null;

  // 每个选项的内容 = 到下一个标记之前（或题干末尾）
  const options = hits.map((h, i) => ({
    key: h.key,
    text: String(
      text.slice(h.contentStart, i + 1 < hits.length ? hits[i + 1].start : undefined) || ''
    ).trim(),
  }));
  if (options.some((o) => !o.text)) return null;
  if (options.some((o) => o.text.length > MAX_OPTION_LEN)) return null;

  // 去掉选项部分，得到干净的题干
  const stem = String(text.slice(0, hits[0].start) || '').trim();
  if (!stem) return null;

  return { stem, options };
}

/**
 * 判断一组选项是不是判断题（形如「正确 / 错误」两选项）。
 * 判断题在库里既可能带选项、也可能不带，这里按选项内容判定。
 */
function looksLikeJudgment(options) {
  if (!options || options.length !== 2) return false;
  const texts = options.map((o) => o.text.replace(/[。．.]$/, ''));
  const yes = ['对', '正确', '是', 'T', 'true', '√'];
  const no = ['错', '错误', '否', 'F', 'false', '×'];
  return (
    (yes.includes(texts[0]) && no.includes(texts[1])) ||
    (no.includes(texts[0]) && yes.includes(texts[1]))
  );
}

/**
 * 从题干与选项推断题型。判断题是「正确/错误」两选项，其余按单选处理。
 */
function inferTypeFromOptions(options) {
  return looksLikeJudgment(options) ? 'judgment' : 'choice_single';
}

module.exports = {
  splitInlineOptions,
  looksLikeJudgment,
  inferTypeFromOptions,
  MAX_OPTION_LEN,
};
