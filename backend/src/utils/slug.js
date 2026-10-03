const crypto = require('crypto');

/**
 * 班级 slug 规则：
 * 1) 允许中文、字母、数字、连字符（中文名直接保留，如「演示1班-720a2b」）
 * 2) 3-64 位，首尾必须是中文/字母/数字
 *
 * 说明：slug 会出现在班级主页地址 /c/<slug> 与学生工作台跳转里，
 * 必须与 generateClassSlug 的输出格式保持一致，否则管理员在后台
 * 「编辑班级」保存会被自己的校验规则拦下。
 */
const SLUG_PATTERN = /^[\u4e00-\u9fffa-z0-9][\u4e00-\u9fffa-z0-9-]{1,62}[\u4e00-\u9fffa-z0-9]$/i;

function isValidSlug(slug) {
  return SLUG_PATTERN.test(String(slug || '').trim());
}

/**
 * 生成班级 slug：基于班级名 + 随机后缀（保证唯一）
 * @param {string} name 班级名称
 * @param {(candidate: string) => boolean} [existQuery] 可选的额外判重回调
 */
function generateClassSlug(name, existQuery) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fffa-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'class';

  for (let i = 0; i < 10; i += 1) {
    const candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    if (!existQuery || !existQuery(candidate)) {
      return candidate;
    }
  }
  // 极端情况下（连续撞名）用更长的随机串兜底
  return `${base}-${crypto.randomBytes(8).toString('hex')}`;
}

module.exports = { SLUG_PATTERN, isValidSlug, generateClassSlug };
