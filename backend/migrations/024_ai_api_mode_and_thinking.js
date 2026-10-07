/**
 * AI 接口协议与思考模式配置
 *
 * 新增 settings 项：
 *   ai_api_mode           调用协议：chat（Chat Completions，默认）| responses（Responses API）
 *   ai_thinking_enabled   思考模式总开关，默认 false
 *   ai_thinking_effort    思考强度：low | medium | high（默认 medium）
 *   ai_thinking_budget    思考预算 token 数，0 = 不限制（默认 0）
 *   ai_thinking_summary   Responses API 的推理摘要：auto | concise | detailed（默认空 = 不请求）
 *
 * 为何默认关闭思考模式：
 * 思考会显著增加输出 token 与延迟，而本系统的 AI 出题链路要求严格的 JSON 输出，
 * 推理模型与 response_format 强约束的兼容性参差，默认打开容易拖慢并破坏原有行为，
 * 因此必须由管理员显式开启。
 *
 * 幂等：全部使用 INSERT OR IGNORE，重复执行不会覆盖管理员已改过的值。
 */
const KEYS = [
  // 调用协议。默认 chat，即保持改造前的行为，升级不会影响现有站点
  { key: 'ai_api_mode', value: 'chat' },
  { key: 'ai_thinking_enabled', value: 'false' },
  { key: 'ai_thinking_effort', value: 'medium' },
  { key: 'ai_thinking_budget', value: '0' },
  { key: 'ai_thinking_summary', value: '' },
];

exports.up = async function (knex) {
  // 历史库可能没有 settings 表（该表原先由运行时的 ensureSettingsTable 兜底创建），
  // 与 006 迁移保持一致地先判断存在性；即便这里跳过，运行时仍会用默认值兜底。
  if (!(await knex.schema.hasTable('settings'))) return;
  // 必须是对象数组：用 ['key','value'] 这样的数组会被 knex 当成 [columns, values] 形式
  await knex('settings').insert(KEYS).onConflict('key').ignore();
};

exports.down = async function () {
  // 不回滚：这些项被删掉会让已开启思考模式的站点静默退回旧行为
};