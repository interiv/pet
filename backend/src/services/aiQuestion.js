/**
 * AI 出题公共能力：解析兜底 / 答案归一化 / 多轮重试补齐
 *
 * 为什么要单独抽出来：
 *   作业出题（assignments.js）和课堂出题（cards.js）原本各自实现了
 *   「一次 JSON.parse + 一条正则兜底」，因此共享同一批故障：
 *
 *   1. 模型输出 ```json 围栏、或在 JSON 前后加一段话 → 直接 500；
 *   2. 题量一大（尤其多选题 30 道，每题带 4 个选项+解析+知识点）
 *      输出被 max_tokens 截断 → JSON 不完整 → 直接 500；
 *      这正是「简答题容易成功、判断题多选题容易失败」的根因：
 *      简答题只生成 count 道且没有选项，输出量最小；
 *      判断/多选要生成 count×3 道（含变体），输出量最大。
 *   3. 判断题要求 answer 是布尔值、多选题要求 answer 是数组，
 *      模型偏偏爱写成 "正确"/"错误"、"AC"，落库后答案就不可用了。
 *
 * 本模块一次性解决上述三点：
 *   - extractJson：剥围栏 + 括号平衡扫描，被截断时抢救出已完整的题目对象
 *   - normalizeQuestion：按题型纠偏并校验，坏题就地剔除而不是整批失败
 *   - collectQuestions：失败自动重试（带纠偏指令），题量不足自动续写补齐
 */

const { normalizeJudgment } = require('../utils/answerCheck');
const { chatCompletion } = require('./aiClient');

// 服务端瞬时错误（429 / 5xx）最多重试到第几轮
const REQUEST_RETRY_LIMIT = 2;

// ---------------------------------------------------------------- JSON 解析

/** 去掉 markdown 代码块围栏（含只有开头、结尾被截断的情况） */
function stripFence(text) {
  let s = String(text || '').trim();
  const paired = s.match(/```(?:json|jsonc|JSON)?\s*([\s\S]*?)```/);
  if (paired) return paired[1].trim();
  const headOnly = s.match(/^```(?:json|jsonc)?\s*([\s\S]*)$/i);
  if (headOnly) return headOnly[1].replace(/```\s*$/, '').trim();
  return s;
}

/**
 * 从任意位置扫出所有「括号平衡」的对象片段，能正确跳过字符串内部的括号。
 * 用于 JSON 因被截断而语法非法时，把其中已经完整的题目对象抢救出来。
 */
function scanBalancedObjects(text, from = 0) {
  const pieces = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        pieces.push(text.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) break;
    }
  }
  return pieces;
}

/**
 * 尽可能从 AI 返回的任意文本里取出题目 JSON。
 * @returns {{ data: Object, rescued: boolean, salvage?: number }}
 */
function extractJson(raw) {
  const text = stripFence(raw);
  if (!text) throw new Error('AI 返回内容为空');

  // ① 标准情况（注意：有些模型会直接返回裸数组，这里统一包成 {questions: [...]}）
  try {
    const data = JSON.parse(text);
    return { data: Array.isArray(data) ? { questions: data } : data, rescued: false };
  } catch (_) { /* 继续兜底 */ }

  // ② 顶层就是数组（往往是被截断的半截数组）
  if (text.startsWith('[')) {
    const pieces = scanBalancedObjects(text, 0);
    if (pieces.length > 0) {
      return {
        data: { questions: JSON.parse(`[${pieces.join(',')}]`) },
        rescued: true,
        salvage: pieces.length,
      };
    }
  }

  // ③ 以 questions 数组为锚点，逐题抢救（兼容被截断的半截 JSON）
  const anchor = text.search(/"questions"\s*:/);
  if (anchor >= 0) {
    const arrStart = text.indexOf('[', anchor);
    if (arrStart >= 0) {
      const pieces = scanBalancedObjects(text, arrStart + 1);
      if (pieces.length > 0) {
        try {
          return {
            data: JSON.parse(`{"questions":[${pieces.join(',')}]}`),
            rescued: true,
            salvage: pieces.length,
          };
        } catch (_) { /* 继续兜底 */ }
      }
    }
  }

  // ④ 退化到最外层花括号
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return { data: JSON.parse(text.slice(first, last + 1)), rescued: true };
    } catch (_) { /* 继续兜底 */ }
  }

  throw new Error('AI 返回的内容不是合法 JSON');
}

// ------------------------------------------------------------ 答案归一化

function dedupeLetters(list) {
  return [...new Set(list)];
}

/** 把 "B" / "b" / "AC" / "A、C" / ["A","C"] / "答案：AC" 统一成 ['A','C'] */
function toOptionLetters(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return dedupeLetters(value.flatMap((v) => toOptionLetters(v)));
  const s = String(value).trim().toUpperCase();
  if (!s) return [];
  return dedupeLetters(s.replace(/[^A-H]/g, '').split(''));
}

/** 选项统一成字符串数组，并去掉多余的 "A." / "A、" 前缀（界面自己会渲染序号） */
function normalizeOptions(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (_) {
      list = list.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(list)) return null;
  const out = list
    .map((item) => {
      if (item === null || item === undefined) return '';
      if (typeof item === 'object') {
        const pick = item.text ?? item.value ?? item.content ?? item.option ?? item.label ?? '';
        return String(pick).trim();
      }
      return String(item).trim().replace(/^[A-H][.、)）:：]\s*/, '');
    })
    .filter(Boolean);
  return out.length >= 2 ? out : null;
}

/** 单选题答案纠偏：支持字母、数字下标、直接给出选项原文 */
function pickSingleLetter(answer, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const maxLetter = String.fromCharCode(65 + options.length - 1);
  const raw = String(answer ?? '').trim();

  const textHit = options.findIndex((o) => o.trim() === raw);
  if (textHit >= 0) return String.fromCharCode(65 + textHit);

  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= options.length) return String.fromCharCode(65 + n - 1);
    if (n >= 0 && n < options.length) return String.fromCharCode(65 + n);
  }

  const letters = toOptionLetters(answer).filter((l) => l <= maxLetter);
  return letters.length === 1 ? letters[0] : null;
}

/** 多选题答案纠偏：["A","C"] / "AC" / "A,C" / 选项原文数组 都能吃下 */
function pickMultiLetters(answer, options) {
  if (!Array.isArray(options) || options.length === 0) return [];
  const maxLetter = String.fromCharCode(65 + options.length - 1);
  const list = Array.isArray(answer) ? answer : [answer];
  const letters = [];

  for (const item of list) {
    const raw = String(item ?? '').trim();
    const textHit = options.findIndex((o) => o.trim() === raw);
    if (textHit >= 0) {
      letters.push(String.fromCharCode(65 + textHit));
      continue;
    }
    if (/^\d+$/.test(raw)) {
      const n = parseInt(raw, 10);
      if (n >= 1 && n <= options.length) { letters.push(String.fromCharCode(65 + n - 1)); continue; }
      if (n >= 0 && n < options.length) { letters.push(String.fromCharCode(65 + n)); continue; }
    }
    letters.push(...toOptionLetters(raw));
  }

  return dedupeLetters(letters).filter((l) => l <= maxLetter).sort();
}

/**
 * 按题型校验并纠偏一道题
 * @returns {{ok: true, question: Object} | {ok: false, reason: string}}
 */
function normalizeQuestion(raw, type) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const content = String(q.content ?? '').trim();
  if (content.length < 4) return { ok: false, reason: '题干为空或过短' };

  const options = normalizeOptions(q.options);
  const keep = {
    content,
    options,
    answer: null,
    explanation: String(q.explanation ?? '').trim(),
    analysis: String(q.analysis ?? '').trim(),
    hint: String(q.hint ?? '').trim(),
    knowledge_point: String(q.knowledge_point ?? '').trim(),
  };

  switch (type) {
    case 'judgment': {
      // 判断题极易被写成 "正确"/"错误"/"√"，统一归一成 true/false
      const n = normalizeJudgment(q.answer);
      if (n !== 'true' && n !== 'false') {
        return { ok: false, reason: `判断题答案不合法（收到：${JSON.stringify(q.answer)}）` };
      }
      return { ok: true, question: { ...keep, options: null, answer: n } };
    }

    case 'choice_multi': {
      if (!options) return { ok: false, reason: '多选题缺少有效选项' };
      const letters = pickMultiLetters(q.answer, options);
      if (letters.length < 2) {
        return { ok: false, reason: `多选题正确答案少于两项（收到：${JSON.stringify(q.answer)}）` };
      }
      return { ok: true, question: { ...keep, answer: letters.join(',') } };
    }

    case 'choice_single': {
      if (!options) return { ok: false, reason: '单选题缺少有效选项' };
      const letter = pickSingleLetter(q.answer, options);
      if (!letter) {
        return { ok: false, reason: `单选题答案不在选项范围内（收到：${JSON.stringify(q.answer)}）` };
      }
      return { ok: true, question: { ...keep, answer: letter } };
    }

    case 'fill_blank': {
      const ans = String(q.answer ?? '').trim();
      if (!ans) return { ok: false, reason: '填空题缺少答案' };
      return { ok: true, question: { ...keep, options: null, answer: ans } };
    }

    default: { // essay / composition
      const ans = String(q.answer ?? '').trim();
      if (!ans) return { ok: false, reason: '主观题缺少参考答案' };
      return { ok: true, question: { ...keep, options: null, answer: ans } };
    }
  }
}

// ------------------------------------------------------------ LLM 请求

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeRequestError(error) {
  if (error.code === 'ECONNABORTED') return 'AI请求超时，请稍后重试';
  if (error.code === 'ECONNREFUSED') return '无法连接到 AI 服务器，请检查配置';
  const status = error.response?.status;
  let detail = '';
  if (error.response?.data) {
    const d = error.response.data;
    detail = typeof d === 'string' ? d : JSON.stringify(d);
  }
  return `AI 接口返回错误（HTTP ${status || '未知'}）${detail ? '：' + detail.slice(0, 300) : ''}`;
}

/** 判断模型是否不支持 response_format 强约束，支持的话就不再自我降级重试 */
function looksUnsupportedParam(error) {
  const status = error.response?.status;
  const body = JSON.stringify(error.response?.data ?? '');
  const retryableStatus = status === 400 || status === 404 || status === 422;
  return retryableStatus && /response_format|unsupported|unrecognized|unknown parameter|not support/i.test(body);
}

async function chatOnce({ config, prompt, timeoutMs, maxTokens, useJsonObject, logger }) {
  // 统一走 aiClient：自动适配 chat / responses 两种协议、注入思考模式参数、
  // 并在模型不支持时自动降级重试。这里只负责把归一化后的结果转成内部结构。
  const reply = await chatCompletion({
    config,
    prompt,
    maxTokens,
    useJsonObject,
    timeoutMs,
    label: 'AI 出题',
    logger: logger || (() => {}),
  });

  return {
    content: reply.content || '',
    finishReason: reply.finishReason || '',
    usage: reply.usage || {},
  };
}

/** 拼一段「上次输出有什么问题、这次别再犯」的纠偏指令 */
function buildRepairNote(reason, tail, type) {
  const typeRule = {
    judgment: '4. 判断题的 answer 只能是布尔值 true 或 false，不要写成 "正确"/"错误" 之类的字符串；',
    choice_multi: '4. 多选题的 answer 必须是字母数组且至少两项，例如 ["A","C"]，不要写成 "AC" 字符串；',
    choice_single: '4. 单选题的 answer 必须是单个大写字母，例如 "C"；',
    fill_blank: '4. 填空题的 answer 是填空内容的字符串；',
  }[type] || '4. answer 字段要与该题型的约定完全一致；';

  return [
    '【重要修正】上一次的输出程序读不了，原因是：' + reason,
    '这次请务必遵守：',
    '1. 只输出一个 JSON 对象本身，不要用 ``` 代码块包裹，不要有任何前言、后记或注释；',
    '2. JSON 内部的换行与引号必须转义，不要输出会破坏 JSON 语法的尾随逗号；',
    '3. questions 数组里每一道题都要有 content 字段；',
    typeRule,
    tail ? `上一次返回内容的结尾片段供你参照：\n"""\n${tail}\n"""` : '',
  ].filter(Boolean).join('\n');
}

/** 把请求题量对齐到变体倍数（每 3 道一组变体时，必须是 3 的倍数） */
function alignToVariants(n, variants) {
  if (!variants || variants <= 1) return Math.max(1, n);
  const aligned = Math.floor(n / variants) * variants;
  return Math.max(variants, aligned);
}

/**
 * 多轮收集题目：解析失败自动重试、输出被截断自动抢救、题量不足自动续写补齐。
 *
 * @param {Object}   opts
 * @param {Object}   opts.config        AI 配置
 * @param {number}   opts.timeoutMs     单次请求超时
 * @param {number}   opts.maxTokens     单次请求的最大输出 token
 * @param {string}   opts.type          题型
 * @param {Function} opts.buildPrompt   (ask, note) => string   按本次要生成多少道来拼提示词
 * @param {number}   opts.target        目标题量（含变体）；传 0 表示由素材决定（粘贴整理模式）
 * @param {number}   opts.variants      每组变体数，1 表示无变体
 * @param {number}   opts.maxRounds     最多重试轮次
 * @param {Function} opts.onTokens      (usage) => void，累计 token 消耗
 * @param {Function} opts.logger        (msg) => void
 * @returns {Promise<{questions: Array, invalid: Array, rounds: Array, lastError: string}>}
 */
async function collectQuestions(opts) {
  const {
    config,
    timeoutMs,
    maxTokens,
    type,
    buildPrompt,
    normalize,
    target = 0,
    variants = 1,
    maxRounds = 3,
    onTokens,
    logger = () => {},
  } = opts;

  const toValidQuestion = normalize || normalizeQuestion;

  const collected = [];
  const invalid = [];
  const rounds = [];
  const usedTopics = [];
  const seenContent = new Set();

  let lastError = '';
  let lastPack = null;
  let repairNote = '';
  let useJsonObject = true;
  let jsonObjectDowngraded = false;
  let lastTruncated = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    const remaining = target > 0 ? target - collected.length : 0;
    if (target > 0 && remaining <= 0) break;

    // 上一轮被长度截断：这一轮减半，先保住拿得到一半
    let ask = remaining > 0
      ? (lastTruncated ? Math.max(variants, Math.ceil(remaining / 2)) : remaining)
      : 0;
    if (ask > 0) ask = alignToVariants(ask, variants);

    const notes = [repairNote];
    if (usedTopics.length > 0) {
      notes.push(`请避开这些已经出过的知识点，换别的方向：${usedTopics.slice(-40).join('、')}`);
    }
    const note = notes.filter(Boolean).join('\n');

    logger(`\n📤 第 ${round}/${maxRounds} 轮请求，本轮要求 ${ask || '不限'} 道题${lastTruncated ? '（上一轮被截断，已自动减量）' : ''}`);

    // ---------------- 发请求 ----------------
    let reply;
    try {
      reply = await chatOnce({ config, prompt: buildPrompt(ask, note), timeoutMs, maxTokens, useJsonObject });
    } catch (e) {
      if (useJsonObject && !jsonObjectDowngraded && looksUnsupportedParam(e)) {
        jsonObjectDowngraded = true;
        useJsonObject = false;
        round -= 1; // 原地重试同一轮
        logger('⚠️ 该模型不支持 response_format 强约束，已降级为普通 JSON 提示');
        continue;
      }
      lastError = describeRequestError(e);
      rounds.push({ round, ok: false, error: lastError });
      logger(`❌ 第 ${round} 轮请求失败：${lastError}`);
      // 只对服务端瞬时错误（429 / 5xx）重试一次。
      // 超时、连不上这类会让用户干等好几分钟的错误直接收手——额度本来就退还了，让用户可以立刻重来。
      const status = e.response?.status || 0;
      if (!(status === 429 || status >= 500) || round >= REQUEST_RETRY_LIMIT) break;
      await sleep(600);
      continue;
    }

    onTokens?.(reply.usage);
    lastTruncated = reply.finishReason === 'length';
    repairNote = '';

    if (lastTruncated) {
      logger('⚠️ 本轮输出被 max_tokens 截断，将抢救已生成的题目并在下一轮补齐');
    }

    // ---------------- 解析 ----------------
    let pack;
    try {
      const r = extractJson(reply.content);
      pack = r.data;
      lastPack = pack;
      if (r.rescued) {
        logger(`⚠️ JSON 结构不完整（从 ${reply.content.length} 字符中抢救出 ${r.salvage || '若干'} 道题目对象）`);
      } else {
        logger('✅ JSON 解析成功');
      }
    } catch (e) {
      lastError = e.message;
      repairNote = buildRepairNote(lastError, String(reply.content).slice(-300), type);
      rounds.push({ round, ok: false, error: lastError });
      logger(`❌ 第 ${round} 轮解析失败：${lastError}`);
      if (round === maxRounds) break;
      continue;
    }

    // ---------------- 逐题校验并纠偏 ----------------
    const rawList = Array.isArray(pack?.questions) ? pack.questions : [];
    const fresh = [];
    for (const raw of rawList) {
      const n = toValidQuestion(raw, type);
      if (!n.ok) {
        invalid.push({ content: String(raw?.content ?? '').slice(0, 60), reason: n.reason });
        continue;
      }
      const key = n.question.content.replace(/\s+/g, '').slice(0, 40);
      if (seenContent.has(key)) continue;
      seenContent.add(key);
      fresh.push(n.question);
      if (n.question.knowledge_point) usedTopics.push(n.question.knowledge_point);
    }

    collected.push(...fresh);
    // 模型偶尔会超量输出，超出目标的部分直接丢弃，避免题库里多出用不上的题
    if (target > 0 && collected.length > target) {
      logger(`ℹ️ 本轮超出目标题量，截断到 ${target} 道`);
      collected.length = target;
    }
    rounds.push({
      round,
      ok: true,
      asked: ask,
      got: rawList.length,
      valid: fresh.length,
      rejected: rawList.length - fresh.length,
      truncated: lastTruncated,
    });
    logger(`✅ 第 ${round} 轮拿到 ${rawList.length} 道，其中可用 ${fresh.length} 道${rawList.length !== fresh.length ? `，剔除 ${rawList.length - fresh.length} 道不合格题` : ''}`);

    // 粘贴整理模式：题量由素材决定，成功解析出内容就收工
    if (target <= 0) break;

    if (collected.length >= target) break;
    if (lastTruncated || collected.length === 0) continue;
  }

  return { questions: collected, invalid, rounds, lastError, lastPack };
}

module.exports = {
  extractJson,
  normalizeQuestion,
  normalizeOptions,
  collectQuestions,
  describeRequestError,
  buildRepairNote,
  alignToVariants,
};
