const { db } = require('../config/database');

/**
 * 功能开关（feature flags）统一读取与拦截。
 *
 * 背景：本项目原先在「网站设置」里放了三个开关（开放注册 / 宠物战斗 / 道具商店），
 * 但既没有前端读取、也没有后端拦截，属于「只写不读」的死开关——关掉照样能用。
 * 本模块把开关真正接线，并给出唯一一份默认值清单。
 *
 * 注意：不要复用 routes/assignments.js 里的 getSystemSetting，那是 parseInt 版本，
 * 读 'false' 会得到 NaN，布尔开关必须走这里。
 */

/**
 * 全部开关及其默认值。
 * 这里同时是白名单：不在此表中的 key 不会经由 public 接口下发，前端也拿不到。
 *
 * 缺省一律为「开」：新增开关若忘配默认值，不应让升级后的线上功能突然消失。
 */
const DEFAULT_FLAGS = {
  // 注册与对外访问
  registration_enabled: 'true',    // 关闭后禁止自助注册 / 邀请码注册入班
  class_public_enabled: 'true',    // 关闭后班级主页 /c/:slug 与公开班级列表不对外可见

  // AI 能力（成本 + 可用性，LLM 出问题时的一键止血阀）
  ai_enabled: 'true',              // AI 总闸：出题/批改/报告/教练全部依赖它
  ai_paper_judge_enabled: 'true',  // AI 批改纸质作业（单张 + 批量扫描）
  paper_upload_enabled: 'true',    // 纸质作业拍照上传（与 AI 判分解耦）

  // 游戏化
  battle_enabled: 'true',          // PVP 对战
  boss_battle_enabled: 'true',     // BOSS 战（教师组织的全班活动，性质与 PVP 不同）
  shop_enabled: 'true',            // 道具商店
  equipment_shop_enabled: 'true',  // 装备商店
};

const FLAG_KEYS = Object.keys(DEFAULT_FLAGS);

/** 读取原始字符串；不存在返回 null。 */
function getFlagRaw(key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (e) {
    // settings 表尚未初始化时，不应让整个开关体系失效
    return null;
  }
}

/** 布尔化：只有显式的 false / 0 / off 视为关闭，其余（含缺失）按默认值处理。 */
function isFeatureEnabled(key, defaultVal = null) {
  const fallback = defaultVal !== null ? defaultVal : DEFAULT_FLAGS[key] !== 'false';
  const raw = getFlagRaw(key);
  if (raw === null) return fallback;
  return !(raw === 'false' || raw === '0' || raw === 'off');
}

/**
 * 生成拦截中间件，挂在需要开关控制的路由上即可。
 * 例：router.post('/start', authenticateToken, requireFeature('battle_enabled'), handler)
 */
function requireFeature(key, opts = {}) {
  const message = opts.message || '该功能当前已关闭';
  return (req, res, next) => {
    if (isFeatureEnabled(key)) return next();
    return res.status(opts.status || 403).json({ error: message });
  };
}

/**
 * 下发给前端的完整开关快照。
 * 缺失项按默认值补齐，否则前端用 === 'false' 判断时会把「没有这个 key」
 * 误判成关闭，而后端却按默认开启，两边对不上。
 */
function getPublicFlags() {
  const result = {};
  for (const key of FLAG_KEYS) {
    const raw = getFlagRaw(key);
    result[key] = raw === null ? DEFAULT_FLAGS[key] : raw;
  }
  return result;
}

/** 补齐缺失的开关行并纠正非法值，管理员打开设置页时调用一次即可。 */
function ensureFlags() {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const fix = db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value <> ? AND value <> ?');
  db.transaction(() => {
    for (const key of FLAG_KEYS) {
      insert.run(key, DEFAULT_FLAGS[key]);
      fix.run(DEFAULT_FLAGS[key], key, 'true', 'false');
    }
  })();
}

module.exports = { DEFAULT_FLAGS, FLAG_KEYS, isFeatureEnabled, requireFeature, getPublicFlags, ensureFlags };