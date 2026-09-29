/**
 * AI 提示词注册表（统一入口）
 *
 * 模板按用途分组到同目录的 gen.js / classroom.js / coach.js / judge.js / admin.js，
 * 这里合并后对外暴露，导出签名与拆分前完全一致：
 *   const { getPrompt, fillTemplate } = require('../config/prompts');
 */
const SETTING_PREFIX = 'prompt_';

const PROMPTS = {
  ...require('./gen'),
  ...require('./classroom'),
  ...require('./judge'),
  ...require('./coach'),
  ...require('./admin'),
};

/**
 * 读取提示词：settings 表有自定义值时返回自定义值，否则返回默认模板
 */
function getPrompt(key) {
  const def = PROMPTS[key];
  if (!def) return '';
  try {
    // 延迟 require，避免模块加载顺序问题
    const { db } = require('../database');
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

