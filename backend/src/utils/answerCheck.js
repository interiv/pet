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

  if (type === 'choice_single' || type === 'fill_blank') {
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

module.exports = { isAnswerCorrect, normalizeJudgment, normalizeMulti };
