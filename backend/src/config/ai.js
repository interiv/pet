/**
 * AI 配置读取（统一入口）
 *
 * 优先级：数据库 settings 表的 ai_* 项（管理员在「AI设置」里配置）
 *         > 环境变量 AI_API_KEY / AI_BASE_URL / AI_MODEL（.env fallback）
 *
 * 用法：
 *   const { getAIConfig, isAIConfigured } = require('../config/ai');
 *   const config = getAIConfig();
 *   if (!isAIConfigured(config)) { ...提示管理员未配置... }
 */

function getAIConfig() {
  const config = {};
  try {
    // 延迟 require，避免模块加载顺序问题
    const { db } = require('./database');
    const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
    rows.forEach((r) => { config[r.key] = r.value; });
  } catch (e) {
    // settings 表可能尚未创建，忽略并走环境变量
  }

  if (!config.ai_api_key && process.env.AI_API_KEY) config.ai_api_key = process.env.AI_API_KEY;
  if (!config.ai_base_url && process.env.AI_BASE_URL) config.ai_base_url = process.env.AI_BASE_URL;
  if (!config.ai_model && process.env.AI_MODEL) config.ai_model = process.env.AI_MODEL;

  return config;
}

// 三项配置齐全才算"AI 可用"
function isAIConfigured(config) {
  const c = config || getAIConfig();
  return Boolean(c.ai_api_key && c.ai_base_url && c.ai_model);
}

// AI 超时（秒 → 毫秒），默认 300 秒
function getAITimeoutMs(config) {
  const c = config || getAIConfig();
  return (parseInt(c.ai_timeout) || 300) * 1000;
}

module.exports = { getAIConfig, isAIConfigured, getAITimeoutMs };
