/**
 * AI 调用适配层
 *
 * 分工：
 *   OpenAI 官方 SDK —— 负责 HTTP、连接池、协议序列化、内置重试、错误规范化
 *   本文件         —— 只负责 SDK 不管的「业务差异」：
 *                      1. 按后台配置在 chat / responses 两种协议间切换
 *                      2. usage 字段归一化（Responses 用 input/output tokens，
 *                         而 token_usage 表按 prompt/completion tokens 记账）
 *                      3. 多模态 content 块在两种协议下的类型转换
 *                      4. 参数降级链（SDK 不会自动摘掉模型不认识的参数）
 *
 * 关于第 4 点：第三方兼容服务（本项目对接的是各家 OpenAI 兼容网关）经常不认
 * response_format / reasoning_effort 等参数，SDK 只会原样发出去并抛错。
 * 因此仍需按「先摘输出增强（思考、JSON 约束），最后才动长度参数名」的顺序
 * 逐级重试，保证能拿到尽可能结构化的结果。
 *
 * 降级只在「明确是参数不被支持」时发生；鉴权失败、超时、限流等一律原样抛出，
 * 避免把真实故障掩盖成「换个参数再试」的假象。
 */
const OpenAI = require('openai');

// ------------------------------------------------------------ 配置读取

/** 读取 API 模式，缺省 chat（保持改造前的行为） */
function resolveApiMode(config) {
  const mode = String((config && config.ai_api_mode) || '').trim().toLowerCase();
  return mode === 'responses' ? 'responses' : 'chat';
}

/**
 * 思考模式是否开启。
 * 默认关闭 —— 思考会显著增加输出 token 与延迟，而出题等场景要求严格 JSON 输出，
 * 推理模型与 JSON 强约束的兼容性参差，默认打开反而容易拖慢并破坏原有行为。
 */
function isThinkingEnabled(config) {
  const v = String((config && config.ai_thinking_enabled) ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** 思考强度：low / medium / high（对齐 OpenAI reasoning_effort 的取值） */
function resolveThinkingEffort(config) {
  const v = String((config && config.ai_thinking_effort) || '').trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(v) ? v : 'medium';
}

/** 思考预算 token 数（部分兼容服务的 thinking_budget），0 表示不限制 */
function resolveThinkingBudget(config) {
  const n = parseInt((config && config.ai_thinking_budget) ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ------------------------------------------------------------ SDK 客户端

/**
 * 按配置缓存 SDK 实例。
 * 不缓存的话每次调用都会新建客户端，连接池与 keep-alive 全部失效；
 * 站点只有极少数 AI 配置，缓存键不会无节制增长。
 */
const clientCache = new Map();

function getClient(config, timeoutMs) {
  const baseURL = String(config.ai_base_url || '').replace(/\/+$/, '');
  const key = `${config.ai_api_key}::${baseURL}::${timeoutMs || 0}`;
  const cached = clientCache.get(key);
  if (cached) return cached;

  const client = new OpenAI({
    apiKey: config.ai_api_key,
    baseURL,
    timeout: timeoutMs || 300000,
    // 重试收敛在本文件的降级链里统一控制，避免与各调用点自己的重试逻辑叠加
    maxRetries: 0,
  });
  clientCache.set(key, client);
  // 只保留最近若干个配置，防止动态改配置导致缓存无限增长
  if (clientCache.size > 8) {
    clientCache.delete(clientCache.keys().next().value);
  }
  return client;
}

// ------------------------------------------------------------ 响应归一化

/**
 * usage 归一化：Responses API 用 input_tokens / output_tokens，
 * 而 token_usage 表与各处统计都按 prompt_tokens / completion_tokens 记账，
 * 在这里抹平差异，上层统计逻辑就完全不用区分协议。
 * 另外把 reasoning token 单独提出来，便于日志观察思考模式的实际开销。
 */
function normalizeUsage(raw) {
  const u = raw || {};
  const promptTokens = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
  const completionTokens = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
  const reasoningTokens = Number(
    u.completion_tokens_details?.reasoning_tokens
    ?? u.output_tokens_details?.reasoning_tokens
    ?? 0
  ) || 0;
  return {
    ...u,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: Number(u.total_tokens ?? (promptTokens + completionTokens)) || 0,
    reasoning_tokens: reasoningTokens,
  };
}

/**
 * 从 Responses 结果里取文本。
 * 优先用 SDK 的 output_text 便捷字段，没有再遍历 output 数组兜底
 * （部分兼容服务只返回 output，不给 output_text）。
 */
function extractResponsesText(data) {
  if (!data) return { content: '', finishReason: '' };
  let direct = '';
  if (typeof data.output_text === 'string') direct = data.output_text;
  else if (data.output_text && typeof data.output_text === 'object' && typeof data.output_text.value === 'string') {
    direct = data.output_text.value;
  }
  if (direct) return { content: direct, finishReason: '' };

  const parts = [];
  for (const item of data.output || []) {
    if (item.type !== 'message' && item.role !== 'assistant') continue;
    for (const block of item.content || []) {
      if (block.type === 'output_text' && typeof block.text === 'string') parts.push(block.text);
    }
  }
  // 长度截断在 Responses 里体现为 status=incomplete
  const finishReason = (data.status === 'incomplete' || (data.incomplete_details && data.incomplete_details.reason))
    ? 'length'
    : (data.status || '');
  return { content: parts.join(''), finishReason };
}

// ------------------------------------------------------------ 请求体构造

/**
 * Chat Completions 的思考参数。
 * OpenAI 标准写法是 reasoning_effort；而部分兼容服务（含不少国产模型）
 * 识别的是 enable_thinking + thinking_budget。两者无法在事前确定谁支持，
 * 交给降级链处理，这里两个都带上（不认识的服务会忽略未知字段）。
 */
function chatThinkingFields(config) {
  if (!isThinkingEnabled(config)) return {};
  const fields = {
    reasoning_effort: resolveThinkingEffort(config),
    enable_thinking: true,
  };
  const budget = resolveThinkingBudget(config);
  if (budget > 0) fields.thinking_budget = budget;
  return fields;
}

/** Responses API 的思考参数 */
function responsesThinkingFields(config) {
  if (!isThinkingEnabled(config)) return {};
  const reasoning = { effort: resolveThinkingEffort(config) };
  const summary = String((config && config.ai_thinking_summary) || '').trim().toLowerCase();
  if (['auto', 'concise', 'detailed'].includes(summary)) reasoning.summary = summary;
  return { reasoning };
}

/**
 * 把 Chat 的多模态 content 数组转换成 Responses 的块类型。
 * image_url -> input_image，text -> input_text。
 */
function convertContentBlocks(content) {
  if (!Array.isArray(content)) return content;
  return content.map((block) => {
    if (!block || typeof block !== 'object') return block;
    if (block.type === 'image_url') {
      // Chat: { type:'image_url', image_url:{ url } } -> Responses: { type:'input_image', image_url: url }
      const url = block.image_url && typeof block.image_url === 'object'
        ? block.image_url.url
        : block.image_url;
      return { type: 'input_image', image_url: url };
    }
    if (block.type === 'text') {
      return { type: 'input_text', text: block.text };
    }
    return block;
  });
}

/**
 * 候选请求体链：从「功能最全」到「最小可用」逐级降级。
 * 每一项是一次独立的 SDK 调用参数对象。
 */
function buildChatCandidates({ model, messages, maxTokens, useJsonObject, config }) {
  const thinking = chatThinkingFields(config);
  const base = { model, messages };
  const withLimit = (b) => (maxTokens ? { ...b, max_tokens: maxTokens } : b);
  const withJson = (b) => (useJsonObject ? { ...b, response_format: { type: 'json_object' } } : b);

  const candidates = [];
  candidates.push({ body: { ...base, ...withLimit(thinking), ...withJson(thinking) } });
  // 去掉思考参数
  if (Object.keys(thinking).length > 0) candidates.push({ body: withJson(withLimit(base)) });
  // 去掉 JSON 强约束
  if (useJsonObject) candidates.push({ body: withLimit(base) });
  // 换用 OpenAI 新推理模型要求的参数名
  if (maxTokens) candidates.push({ body: { ...base, max_completion_tokens: maxTokens } });
  // 最小请求
  candidates.push({ body: base });
  return candidates;
}

function buildResponsesCandidates({ model, messages, maxTokens, useJsonObject, config }) {
  const base = {
    model,
    input: messages.map((m) => ({ role: m.role, content: convertContentBlocks(m.content) })),
  };
  const thinking = responsesThinkingFields(config);
  const withLimit = (b) => (maxTokens ? { ...b, max_output_tokens: maxTokens } : b);
  const withJson = (b) => (useJsonObject ? { ...b, text: { format: { type: 'json_object' } } } : b);

  const candidates = [];
  candidates.push({ body: { ...base, ...withLimit(thinking), ...withJson(thinking) } });
  if (Object.keys(thinking).length > 0) candidates.push({ body: withJson(withLimit(base)) });
  if (useJsonObject) candidates.push({ body: withLimit(base) });
  candidates.push({ body: base });
  return candidates;
}

// ------------------------------------------------------------ 错误处理

/**
 * 判断错误是否为「参数不被支持」而非「真的调用失败」。
 * SDK 已把错误规范化，这里直接看 status 与响应体，不必自己解析 axios 错误。
 */
function isUnsupportedParamError(error) {
  const status = error && error.status;
  if (![400, 404, 405, 422].includes(status)) return false;
  let body = '';
  try {
    body = JSON.stringify(error.error || error.body || error.message || '');
  } catch (e) {
    body = String(error.message || '');
  }
  return /unsupported|unrecognized|unknown[_ ]parameter|not support|invalid[_ ]?(request|parameter|argument)|does not support|unknown field/i.test(body);
}

/** 把 SDK 错误转成本系统面向用户的中文提示 */
function describeError(error) {
  if (error && error.code === 'ECONNABORTED') return 'AI 请求超时，请稍后重试';
  if (error && error.code === 'ECONNREFUSED') return '无法连接到 AI 服务器，请检查配置';
  const status = error && error.status;
  const detail = String((error && (error.message || (error.error && error.error.message))) || '')
    .slice(0, 300);
  return `AI 接口返回错误（HTTP ${status || '未知'}）${detail ? '：' + detail : ''}`;
}

// ------------------------------------------------------------ 主入口

/**
 * 发起一次 AI 请求（自动在 chat / responses 两种协议间选择并归一化响应）
 *
 * @param {Object} opts
 * @param {Object} opts.config        getAIConfig() 的返回值
 * @param {string} [opts.prompt]      便捷写法：等价于 messages=[{role:'user',content:prompt}]
 * @param {Array}  [opts.messages]    多轮 / 多模态消息体（会优先于 prompt）
 * @param {string} [opts.model]       覆盖 config.ai_model（如视觉模型）
 * @param {number} [opts.maxTokens]   输出上限，两种协议下会自动换成各自的参数名
 * @param {boolean}[opts.useJsonObject] 是否强约束 JSON 输出
 * @param {number} [opts.timeoutMs]   超时毫秒
 * @param {string} [opts.label]       仅用于日志的场景名
 * @returns {Promise<{content:string, finishReason:string, usage:object, apiMode:string, degraded:boolean}>}
 */
async function chatCompletion(opts) {
  const {
    config,
    prompt,
    messages: inputMessages,
    model: modelOverride,
    maxTokens,
    useJsonObject,
    timeoutMs,
    logger = () => {},
    label = '',
  } = opts || {};

  if (!config || !config.ai_api_key || !config.ai_base_url) {
    throw new Error('AI 未配置完整，请到「AI 设置」补齐 API 地址与密钥');
  }

  const model = modelOverride || config.ai_model;
  if (!model) throw new Error('未配置大模型名称');

  const messages = inputMessages && inputMessages.length > 0
    ? inputMessages
    : [{ role: 'user', content: String(prompt ?? '') }];

  const apiMode = resolveApiMode(config);
  const client = getClient(config, timeoutMs);
  const build = apiMode === 'responses' ? buildResponsesCandidates : buildChatCandidates;
  const candidates = build({ model, messages, maxTokens, useJsonObject, config });

  let lastError = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const { body } = candidates[i];
    try {
      let result;
      if (apiMode === 'responses') {
        result = await client.responses.create(body);
      } else {
        result = await client.chat.completions.create(body);
      }

      const extracted = apiMode === 'responses'
        ? extractResponsesText(result)
        : {
          content: (result.choices && result.choices[0] && result.choices[0].message
            && result.choices[0].message.content) || '',
          finishReason: (result.choices && result.choices[0] && result.choices[0].finish_reason) || '',
        };
      const usage = normalizeUsage(result.usage);

      if (i > 0) {
        logger(`[ai]「${label || 'AI 请求'}」第 ${i + 1} 次尝试才成功，已自动降级参数（该模型可能不支持部分参数）`);
      }
      if (usage.reasoning_tokens > 0) {
        logger(`[ai]「${label || 'AI 请求'}」思考模式消耗 reasoning tokens：${usage.reasoning_tokens}`);
      }

      return {
        content: extracted.content,
        finishReason: extracted.finishReason,
        usage,
        apiMode,
        degraded: i > 0,
      };
    } catch (error) {
      lastError = error;
      const canDegrade = i < candidates.length - 1 && isUnsupportedParamError(error);
      if (!canDegrade) break;
      logger(`[ai]「${label || 'AI 请求'}」参数不被支持，自动降级重试：${describeError(error).slice(0, 160)}`);
    }
  }

  const err = new Error(describeError(lastError));
  err.status = lastError && lastError.status;
  err.cause = lastError;
  throw err;
}

module.exports = {
  chatCompletion,
  // 以下导出供测试与特殊场景复用
  resolveApiMode,
  isThinkingEnabled,
  resolveThinkingEffort,
  resolveThinkingBudget,
  normalizeUsage,
  extractResponsesText,
  convertContentBlocks,
  isUnsupportedParamError,
};