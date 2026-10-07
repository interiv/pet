/**
 * 客观题判分工具（全项目统一口径）
 *
 * 背景：原先两处各自实现且不一致——
 *   - assignments.js 的判断题只认 'true' / 'false' 等字面量
 *   - boss-battles.js 额外做了 正确/对/1/A 的规范化
 * 题库里若把判断题答案存成「正确 / 错误」，作业判定就会全部误判为错。
 * 提交作业、教师改答案重算、BOSS 战答题三处现在统一走这里。
 */

// 判断题答案归一化：兼容 true/false、yes/no、A/B、正确/错误、对/错、1/0
function normalizeJudgment(ans) {
  const s = String(ans == null ? '' : ans).trim().toLowerCase();
  if (['true', 'yes', 'y', 'a', '正确', '对', '是', '1', '√', 't'].includes(s)) return 'true';
  if (['false', 'no', 'n', 'b', '错误', '错', '否', '0', '×', 'x', 'f'].includes(s)) return 'false';
  return s;
}

// 多选题答案归一化：先去掉分隔符再按字符拆分，兼容 "AC"、"A,C"、"['A','C']" 三种写法
function normalizeMulti(ans) {
  const raw = Array.isArray(ans) ? ans.join(',') : String(ans == null ? '' : ans);
  return raw
    .toUpperCase()
    .replace(/[,，\s|、]+/g, '')
    .split('')
    .filter((ch) => /[A-Z0-9]/.test(ch))
    .sort();
}

// 填空题答案归一化：按「空」拆段后逐段清理。
//
// 原实现是整串 trim + 小写 + 全等，于是「一题多空」几乎必错：
// 学生写「北京，上海」「北京、上海」「牛顿, 第一定律」，标准答案是「北京,上海」
// （教师端 placeholder 里就写着带空格的示例），整串不等一律判错——
// 学生主观上确实做完了，系统却说做错了，课后自然来问「我明明填了」。
//
// 现在规则：
//   1. 只按逗号类标点拆段，**不按空白拆**：答案本身可能含空格或英文词组
//      （"New York"），按空白拆会把一个答案劈成两个空。
//   2. 去掉多余空段（学生写成「北京，」不该被判成两空）。
//   3. 段内去全部空白 + 转小写：让「New York」「new york」「NEWYORK」视为同一答案。
//   4. 空数必须一致，且逐空相等；不一致即错。
//    与前端 frontend/src/utils/fillBlank.ts 的 splitFillBlankAnswer 保持同一口径。
function normalizeFillBlank(ans) {
  const raw = Array.isArray(ans) ? ans.join(',') : String(ans == null ? '' : ans);
  return raw
    .split(/[,，、;；]+/)
    .map(s => s.replace(/[\s　]/g, '').toLowerCase())
    .filter(s => s !== '');
}

/**
 * 判断单题作答是否正确
 * @param {string} type  题目类型：choice_single / choice_multi / judgment / fill_blank
 * @param {*} studentAnswer 学生作答
 * @param {*} correctAnswer 标准答案
 * @returns {boolean}
 */
function isAnswerCorrect(type, studentAnswer, correctAnswer) {
  const ca = correctAnswer == null ? '' : correctAnswer;
  const sa = studentAnswer == null ? '' : studentAnswer;

  if (type === 'fill_blank') {
    const list = normalizeFillBlank(sa);
    const std = normalizeFillBlank(ca);
    // 标准答案为空一律判错：题库没录答案却让学生「做对」，会污染正确率统计
    return std.length > 0
      && list.length === std.length
      && std.every((s, i) => list[i] === s);
  }

  if (type === 'choice_single') {
    return String(sa).trim().toLowerCase() === String(ca).trim().toLowerCase();
  }

  if (type === 'choice_multi') {
    const correctSet = normalizeMulti(ca);
    const answerSet = normalizeMulti(sa);
    return correctSet.length > 0
      && correctSet.length === answerSet.length
      && correctSet.every((a) => answerSet.includes(a));
  }

  if (type === 'judgment') {
    return normalizeJudgment(sa) === normalizeJudgment(ca);
  }

  // 主观题（essay / composition）不在此判定
  return false;
}

module.exports = { isAnswerCorrect, normalizeJudgment, normalizeMulti, normalizeFillBlank };
