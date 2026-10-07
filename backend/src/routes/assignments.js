const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { checkLevelUp } = require('./pets');
const { grantReward } = require('../services/rewards');
// 主观题 AI 评阅（含图片识别）：逻辑在服务里，便于独立测试
const subjectiveReview = require('../services/subjectiveReview');
const { updateTaskProgress } = require('./daily-tasks');
const { checkAndAwardAchievement } = require('./achievements');
const { getChinaDate, getChinaDateOf } = require('../config/timezone');
const { getPrompt, fillTemplate } = require('../config/prompts');
const { getAIConfig } = require('../config/ai');
const { isAnswerCorrect } = require('../utils/answerCheck');
const { collectQuestions, normalizeQuestion } = require('../services/aiQuestion');
const { beginUsage, settleUsage, countBilledUsage, markFailed, countReferencedQuestions, deleteUnusedQuestions } = require('../services/aiUsage');
const { genTaskManager } = require('../services/genTaskManager');
const { requireFeature, isFeatureEnabled } = require('../middleware/featureFlags');

/**
 * 功能开关守卫：
 *   aiOff      —— AI 总闸。LLM 出故障、被滥用，或只想省 token 时，一键停掉全部 AI 能力。
 *   aiJudgeOff —— AI 批改纸质作业（含批量扫描）。单独拆出来是因为它会把学生作业照片
 *                 发给外部模型，属隐私敏感项，需要能独立关闭。
 *   paperUpOff —— 纸质作业拍照上传。与 AI 判分解耦，便于关掉上传但保留手动登记。
 */
const aiOff = requireFeature('ai_enabled', { message: 'AI 功能当前已关闭，请联系管理员' });
const aiJudgeOff = requireFeature('ai_paper_judge_enabled', { message: 'AI 批改当前已关闭，可改用手动登记' });
const paperUpOff = requireFeature('paper_upload_enabled', { message: '拍照上传当前已关闭，可改用手动登记' });

const path = require('path');
const fs = require('fs');

try {
  const duplicateGroups = db.prepare(`
    SELECT variant_group_id, COUNT(DISTINCT subject || type) as group_count
    FROM question_bank
    WHERE variant_group_id IS NOT NULL
    GROUP BY variant_group_id
    HAVING group_count > 1
  `).all();
  
  if (duplicateGroups.length > 0) {
    const maxGroupId = db.prepare('SELECT MAX(variant_group_id) as max_id FROM question_bank').get();
    let nextGroupId = (maxGroupId?.max_id || 0) + 1;
    
    for (const dg of duplicateGroups) {
      const questionsInGroup = db.prepare(`
        SELECT id, subject, type FROM question_bank WHERE variant_group_id = ?
      `).all(dg.variant_group_id);
      
      const subjectTypeMap = {};
      for (const q of questionsInGroup) {
        const key = `${q.subject}_${q.type}`;
        if (!subjectTypeMap[key]) subjectTypeMap[key] = [];
        subjectTypeMap[key].push(q.id);
      }
      
      const keys = Object.keys(subjectTypeMap);
      for (let i = 1; i < keys.length; i++) {
        const ids = subjectTypeMap[keys[i]];
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`UPDATE question_bank SET variant_group_id = ? WHERE id IN (${placeholders})`).run(nextGroupId, ...ids);
        nextGroupId++;
      }
    }
    console.log(`已修复 ${duplicateGroups.length} 个重复的 variant_group_id`);
  }
} catch (e) {
  console.log('variant_group_id 修复检查跳过:', e.message);
}
const multer = require('multer');

// 上传目录放在 data/ 下，而不是项目根的 uploads/。
// 原因：Docker 部署只挂了 ./data:/app/data，而 uploads/ 既没进镜像也没挂卷——
// 容器一重建，uploads 里已上传的文件会全部消失，但数据库里的记录还在，
// 结果就是「记录说文件在，实际读不到」，纸质作业识别会集体失败。
// data/ 目录本来就用于放数据库（已挂载卷），放这里天然跟着持久化。
const uploadsDir = path.join(__dirname, '../../data/uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  // 目录建不出来时不能把整个服务拖垮：先记警告，等真正上传时再报错
  console.warn('[uploads] 目录创建失败，上传功能将不可用:', e.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('仅支持图片格式(jpg/png/gif/webp)'));
    }
  }
});

/**
 * 作答照片：原图 + 缩略图一次传完。
 *
 * 分成两次请求会出现「原图到了、缩略图没到」的半成品状态，预览只能拉原图。
 * thumb 是可选字段：老前端、或缩略图生成失败时只有 file，接口会回退用原图。
 */
const uploadAnswerImages = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumb', maxCount: 1 },
]);

/**
 * 学生个人题库：每次作答（线上提交 / 纸质登记）逐题 upsert。
 * 与错题本的区别：错题本只留做错的题，个人库保留做过的全部题目。
 * 表不存在时（迁移未执行）静默跳过，不影响主流程。
 */
let personalBankReady = null;
function personalBankAvailable() {
  // 不再永久缓存：迁移可能在本进程启动之后才执行完，
  // 一旦缓存成 false，个人题库会一直"永远为空"。
  if (personalBankReady === null) {
    personalBankReady = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='personal_question_bank'`).get();
  }
  return personalBankReady || !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='personal_question_bank'`).get();
}

function upsertPersonalBank({ userId, questionId, assignmentId, assignmentType, answer, isCorrect, source }) {
  if (!personalBankAvailable() || !userId || !questionId) return;
  try {
    const q = db.prepare('SELECT subject, knowledge_point FROM question_bank WHERE id = ?').get(questionId);
    const existing = db.prepare('SELECT id FROM personal_question_bank WHERE user_id = ? AND question_id = ?')
      .get(userId, questionId);
    if (existing) {
      db.prepare(`
        UPDATE personal_question_bank
        SET last_answer = ?, is_correct = ?, attempt_count = attempt_count + 1,
            correct_count = correct_count + ?, assignment_id = ?, assignment_type = ?,
            source = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(String(answer || ''), isCorrect ? 1 : 0, isCorrect ? 1 : 0, assignmentId || null, assignmentType || null, source || 'online', existing.id);
    } else {
      db.prepare(`
        INSERT INTO personal_question_bank
          (user_id, question_id, assignment_id, assignment_type, subject, knowledge_point,
           first_answer, last_answer, is_correct, attempt_count, correct_count, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(userId, questionId, assignmentId || null, assignmentType || null,
        q?.subject || null, q?.knowledge_point || null,
        String(answer || ''), String(answer || ''), isCorrect ? 1 : 0, isCorrect ? 1 : 0, source || 'online');
    }
  } catch (e) {
    console.error('个人题库写入失败:', e.message);
  }
}

/**
 * 写入/更新错题本。所有错题来源（线上提交、错题重做、主观题评阅、纸质登记、教师改判）
 * 都必须走这里，保证 created_at 一定被写入——错题本 UI 的「错误时间」列依赖它，
 * 漏写会让整列显示 Invalid Date（009 迁移补的历史列）。
 */
function writeWrongQuestion({ userId, assignmentId, questionId, wrongAnswer, correctAnswer, analysis, increment = true }) {
  const existing = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
    .get(userId, questionId);
  if (existing) {
    if (increment) {
      db.prepare(`UPDATE wrong_questions
        SET wrong_count = wrong_count + 1, wrong_answer = ?, correct_answer = ?,
            analysis = COALESCE(NULLIF(?, ''), analysis), reviewed = 0
        WHERE id = ?`)
        .run(String(wrongAnswer || ''), String(correctAnswer || ''), String(analysis || ''), existing.id);
    }
    return existing.id;
  }
  const r = db.prepare(`
    INSERT OR IGNORE INTO wrong_questions
      (user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed, wrong_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)
  `).run(userId, assignmentId, questionId, String(wrongAnswer || ''), String(correctAnswer || ''),
    String(analysis || ''), new Date().toISOString());
  return r.lastInsertRowid;
}

function isObjectiveType(type) {
  return ['choice_single', 'choice_multi', 'judgment', 'fill_blank'].includes(type);
}

/** 取出重做题的完整字段，并解析 options（提交接口与 GET 接口都要用） */
function loadRetryQuestionById(questionId) {
  const q = db.prepare(`
    SELECT id, type, content, options, answer, explanation, analysis, variant_index,
           difficulty, knowledge_point, subject, topic, variant_group_id
    FROM question_bank WHERE id = ?
  `).get(questionId);
  if (!q) return null;
  if (q.options) {
    try { q.options = JSON.parse(q.options); } catch (e) {}
  }
  return q;
}

/**
 * 为一道错题挑出「重做时该做哪道题」。提交接口与 GET /:id/retry-questions 必须共用。
 *
 * 一个变体组只出一道重做题（一个变体组对应一道作业原题）。退回顺序三级，
 * **每一级都必须落在提交白名单 allowedIds 里**，否则学生把界面上的题全做完了，
 * 提交时仍会被 400「只能重做上次答错的题目」拦下：
 *   1. 组内尚未作答过的变体 —— 真正的「新题」，白名单里的首选
 *   2. 这道错题本身       —— 组内变体全做过时的次选
 *   3. 该组对应的作业原题  —— 错题本身是组内变体、且它不在作业题表里时的兜底
 *
 * 【本函数修掉的线上问题】无变体组的错题从前根本不会进重做列表。
 * 原实现在两个分支里都写成 `if (!isCorrect && q.variant_group_id)` 才 push，
 * 而手输/粘贴/题库选题/纸质登记来的填空题 variant_group_id 一律为 NULL，于是：
 *   a) 错题全是填空题 → hasWrongQuestions 恒为 false，提交状态直接置 completed，
 *      学生永远拿不到重做入口，错题就永久留在错题本里；
 *   b) 错题里混了填空题 → 状态是 retry_available，重做弹窗却只有变体题，
 *      而覆盖校验要求「重做全部错题」，学生把弹窗里的空全填满也必然撞上
 *      400「请完成全部错题的重做后再提交」。
 * 第 2 级就是给这类题用的：没有变体组时，重做题就是错题本身（它在白名单里）。
 *
 * @param {number} questionId 这道错题的 question_bank_id
 * @param {number|null} variantGroupId 该题的 variant_group_id（无变体组传 null）
 * @param {Set<number>} attemptedIds 本次提交已作答过的题（含本次刚提交的）
 * @param {(qid:number, grp:number|null)=>number|null} resolveOriginalId 折算回作业原题
 * @returns {object|null} 可直接下发给学生端的重做题（含 answer）
 */
function pickRetryQuestion(questionId, variantGroupId, attemptedIds, resolveOriginalId) {
  if (variantGroupId != null) {
    const variants = db.prepare(`
      SELECT id FROM question_bank WHERE variant_group_id = ? ORDER BY variant_index, id
    `).all(variantGroupId);
    const unusedVariant = variants.find(v => !attemptedIds.has(v.id));
    if (unusedVariant) {
      const picked = loadRetryQuestionById(unusedVariant.id);
      if (picked) return picked;
    }
  }

  // 第 2 级：错题本身。无变体组的填空题永远走这里
  const itself = loadRetryQuestionById(questionId);
  if (itself) return itself;

  // 第 3 级：折算回作业原题
  const originalId = resolveOriginalId(questionId, variantGroupId);
  if (originalId != null && originalId !== questionId) {
    return loadRetryQuestionById(originalId);
  }
  return null;
}

// 题型中文映射
const typeLabels = {
  choice_single: '单选题',
  choice_multi: '多选题',
  judgment: '判断题',
  fill_blank: '填空题',
  essay: '简答题',
  composition: '作文'
};

function getSystemSetting(key, defaultVal) {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    return row ? parseInt(row.value) : defaultVal;
  } catch {
    return defaultVal;
  }
}

// 每位教师每日 AI 生成次数的兜底值。真实值取自 settings.daily_teacher_gen_limit，
// 管理员可在「管理后台 → AI 设置」中随时调整，无需改代码。
const DEFAULT_DAILY_GEN_LIMIT = 20;

// 题型 → 提示词模板。原先 fill_blank / composition 没有模板，
// 走完 if/else 后 prompt 仍是空字符串，却照样发起 LLM 调用并记一次用量，
// 结果是「必定失败，还扣次数」。这里一次性补齐映射。
const GEN_PROMPT_KEYS = {
  choice_single: 'gen_choice_single',
  choice_multi: 'gen_choice_multi',
  judgment: 'gen_judgment',
  fill_blank: 'gen_fill_blank',
  essay: 'gen_essay',
  composition: 'gen_essay',
};

// 粘贴整理模式对应的模板
const PASTE_PROMPT_KEYS = {
  choice_single: 'gen_paste_choice_single',
  choice_multi: 'gen_paste_choice_multi',
  judgment: 'gen_paste_judgment',
  fill_blank: 'gen_paste_fill_blank',
  essay: 'gen_paste_essay',
  composition: 'gen_paste_essay',
};

/**
 * 金币奖励统一算法：基础分 + 连对 Combo + 全对奖励。
 *
 * 提交作业（POST /:id/submit）与教师改答案后的重算（PATCH /questions/:id）
 * 必须共用这一套公式——原先两处各自实现且重算处漏掉了 Combo / 满分奖励，
 * 导致老师一改答案，学生的金币就被倒扣。
 *
 * @param {number} totalScore   百分制总分 0-100
 * @param {number} questionCount 作业题目总数
 * @param {Array<{is_correct:boolean}>} results 逐题结果（按题目顺序）
 * @param {number} maxExp       作业金币上限
 */
function calcGoldReward(totalScore, questionCount, results, maxExp) {
  const list = Array.isArray(results) ? results : [];
  const base = Math.floor((totalScore / 100) * (maxExp || 30));

  let bestStreak = 0;
  let streak = 0;
  for (const r of list) {
    if (r.is_correct) {
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
  }

  let combo = 0;
  if (bestStreak >= 10) combo = 20;
  else if (bestStreak >= 5) combo = 10;
  else if (bestStreak >= 3) combo = 5;

  const correctCount = list.filter(r => r.is_correct).length;
  const perfect = (questionCount >= 3 && correctCount === questionCount) ? 15 : 0;

  return { gold: base + combo + perfect, base, combo, perfect, bestStreak, correctCount };
}

/**
 * AI 出题的核心执行逻辑（同步跑完整个流程，把结果写进 res）。
 *
 * 独立成函数是为了让两种调用方式复用同一份逻辑：
 *   1) 异步模式（POST /generate 走这条）：包一层「伪响应」在后台跑，前端轮询进度
 *   2) 需要同步返回的场景
 *
 * hooks.onProgress 用于回报题型级进度，只在异步模式传入。
 */
async function runGenerateLogic(req, res, hooks = {}) {
  const onProgress = typeof hooks.onProgress === 'function' ? hooks.onProgress : () => {};
  // 额度记录句柄提升到函数作用域：流程失败时要在catch 里把它退还
  let usageId = 0;
  let usageStartedAt = 0;
  try {
    // token_usage 表由 004 号迁移创建，不再在请求时动态建表
    const { subject, topic, difficulty = 'medium', question_type, count = 10, grade_level = '', mode = 'topic', requirements = '', raw_text = '', type_specs } = req.body;
    
    console.log('\n========== AI 生成作业请求 ==========');
    console.log('📥 请求参数:', JSON.stringify({ mode, subject, topic, difficulty, question_type, count, grade_level, type_specs: Array.isArray(type_specs) ? type_specs.length : 0, requirements_len: String(requirements || '').length, raw_text_len: String(raw_text || '').length }, null, 2));
    console.log('👤 用户ID:', req.user.userId, '| 角色:', req.user.role);
    
    // 生成模式：topic=按知识点主题(原有) | requirements=按教师详细要求 | paste=粘贴题目AI整理
    const genMode = ['topic', 'requirements', 'paste'].includes(mode) ? mode : 'topic';
    const isPasteMode = genMode === 'paste';
    const isRequirementsMode = genMode === 'requirements';

    if (!subject) {
      console.log('❌ 参数验证失败');
      return res.status(400).json({ error: '请填写科目' });
    }
    if (genMode === 'topic' && !topic) {
      return res.status(400).json({ error: '请填写知识点主题' });
    }
    if (isRequirementsMode && !String(requirements || '').trim()) {
      return res.status(400).json({ error: '请填写详细的作业要求' });
    }
    if (isPasteMode && !String(raw_text || '').trim()) {
      return res.status(400).json({ error: '请粘贴题目内容' });
    }

    /**
     * 出题规格：前端可以用加号一次配置多行「题型 + 数量 + 难度」，
     * 逐行生成后合并成一份作业（一次点击只扣一次生成额度）。
     * 粘贴整理模式的题量与题型都由素材决定：
     *   - 指定了题型 → 按该题型整理（保留原有行为）
     *   - 没指定题型 → 交给 AI 逐题自动判断（老师通常只是把现成题目粘进来）
     */
    const allowAutoDetect = isPasteMode && !question_type;
    const rawSpecs = (!isPasteMode && Array.isArray(type_specs) && type_specs.length > 0)
      ? type_specs
      : [{ question_type, count, difficulty }];

    const specs = [];
    if (allowAutoDetect) {
      specs.push({ question_type: null, count: 0, difficulty: 'medium' });
    } else {
    for (const raw of rawSpecs) {
      const t = raw && (raw.question_type || raw.type);
      // 提前挡掉没有对应提示词模板的题型，避免带着空 prompt 去打 LLM 还白扣一次额度
      if (!t || !GEN_PROMPT_KEYS[t]) {
        console.log('⚠️ 跳过不支持的题型:', t);
        continue;
      }
      const specDifficulty = ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : difficulty;
      const specCount = Math.max(1, parseInt(raw.count, 10) || count || 10);
      // 同一题型重复出现时只保留第一行，避免同样的题白生成一遍
      if (specs.some((s) => s.question_type === t)) continue;
      specs.push({ question_type: t, count: specCount, difficulty: specDifficulty });
    }
    }
    if (specs.length === 0) {
      return res.status(400).json({ error: allowAutoDetect ? '请先粘贴题目内容' : '请至少选择一种支持的题型' });
    }

    const maxQuestionsPerGen = getSystemSetting('max_questions_per_generation', 20);
    const totalRequested = specs.reduce((sum, s) => sum + s.count, 0);
    if (specs.some((s) => s.count > maxQuestionsPerGen)) {
      return res.status(400).json({ error: `单个题型最多生成 ${maxQuestionsPerGen} 道题目` });
    }
    if (totalRequested > maxQuestionsPerGen * 2) {
      return res.status(400).json({ error: `一次最多生成 ${maxQuestionsPerGen * 2} 道题目，请减少题型或数量` });
    }

    const { getChinaDate, getChinaDateOf } = require('../config/timezone');
    const today = getChinaDate();

    const dailyTeacherLimit = getSystemSetting('daily_teacher_gen_limit', DEFAULT_DAILY_GEN_LIMIT);
    const todayTeacherCount = countBilledUsage(req.user.userId, today);
    if (todayTeacherCount >= dailyTeacherLimit) {
      return res.status(429).json({ error: `今日生成次数已达上限（${dailyTeacherLimit}次），请明日0点后再试` });
    }

    const dailyGlobalTokenLimit = getSystemSetting('daily_global_token_limit', 2000000);
    const todayGlobalTokens = db.prepare(`SELECT COALESCE(SUM(completion_tokens), 0) as total FROM token_usage WHERE date = ?`).get(today)?.total || 0;
    if (todayGlobalTokens >= dailyGlobalTokenLimit) {
      return res.status(429).json({ error: '今日网站Token用量已达上限，请联系管理员或明日再试' });
    }

    const config = getAIConfig();
    if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
      console.log('❌ AI 配置未完成');
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }

    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;

    console.log('🔧 AI 配置:', {
      base_url: config.ai_base_url,
      model: config.ai_model,
      api_key: config.ai_api_key ? `${config.ai_api_key.slice(0, 8)}...${config.ai_api_key.slice(-4)}` : '未配置',
      timeout: timeoutMs / 1000 + '秒'
    });

    const maxTokensPerGen = getSystemSetting('max_tokens_per_generation', 18000);
    const maxRounds = Math.max(1, getSystemSetting('ai_gen_max_rounds', 3));

    usageStartedAt = Date.now();

    // 先领取一次额度。后续只要没走到 res.json()，就一定会在 settle 时把它退还，
    // 因此「AI 失败/解析失败/返回空题」都不会再占用每日生成次数。
    // 多个题型规格合并成一次生成：只扣当天的生成次数一次。
    usageId = beginUsage(req.user.userId, today, {
      model: config.ai_model,
      subject,
      topic: topic || (isRequirementsMode ? String(requirements).trim().slice(0, 30) : `${subject}练习`),
      question_type: specs.length === 1 ? specs[0].question_type : 'mixed',
      count: totalRequested,
    });
    const usageTokens = { prompt: 0, completion: 0, total: 0 };

    /**
     * 按单个「题型 + 数量 + 难度」规格跑一轮完整的多轮补齐生成。
     * 每种题型各自用各自的提示词与变体步长，返回归一化后的题目，交由调用方合并入库。
     */
    const runSpecGeneration = async (spec) => {
      const specType = spec.question_type;
      const specCount = spec.count;
      const specDifficulty = spec.difficulty;
      // 自动判型模式下没有预设题型，标签只用于日志与标题兜底
      const specTypeLabel = specType ? (typeLabels[specType] || specType) : '混合题型';
      // 每组变体数：客观题 3 道一组（学生做错时给相似新题），主观题/粘贴整理不做变体
      const specVariantStep = isPasteMode || !isObjectiveType(specType) ? 1 : 3;
      // 目标题量（含变体）。粘贴整理模式由素材决定，传 0 表示不限制。
      const specTargetCount = isPasteMode ? 0 : specCount * specVariantStep;
      const specEffectiveTopic = topic || (isRequirementsMode ? String(requirements).trim().slice(0, 30) : `${subject}${specTypeLabel}练习`);

      const specTaskDesc = fillTemplate(
        getPrompt(isRequirementsMode ? 'gen_task_requirements' : 'gen_task_topic'),
        { grade_level, effectiveTopic: specEffectiveTopic, subject, typeLabel: specTypeLabel, difficulty: specDifficulty, requirements }
      );

      let specPasteVars = null;
      let specPasteKey = '';
      if (isPasteMode) {
        let formatSample = '';
        let typeRules = '';
        if (!specType) {
          // ===== 自动判型 =====
          // 老师只是把现成题目粘进来，并不事先归类；这里让 AI 逐题判断题型，
          // 校验阶段再按每题自带的 type 分派到对应口径（见 specNormalize）。
          specPasteKey = 'gen_paste_auto';
          formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"type":"choice_single","content":"题目内容","options":["选项A内容","选项B内容","选项C内容","选项D内容"],"answer":"A","explanation":"详细解析","analysis":"解题步骤/思路","knowledge_point":"细粒度知识点"}]}`;
          typeRules = '每道题都必须给出 type 字段，且 type 与 answer/options 的格式严格对应';
        } else if (specType === 'choice_single') {
          formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目内容","options":["选项A内容","选项B内容","选项C内容","选项D内容"],"answer":"A","explanation":"详细解析","analysis":"解题步骤/思路","knowledge_point":"细粒度知识点"}]}`;
          typeRules = 'answer为单个正确选项字母（如"A"）；若原题缺少选项，请根据题意补全A/B/C/D四个选项；若选项数量不足四个，保持原有选项数量即可';
        } else if (specType === 'choice_multi') {
          formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目内容","options":["选项A内容","选项B内容","选项C内容","选项D内容"],"answer":["A","C"],"explanation":"详细解析","analysis":"解题步骤","knowledge_point":"细粒度知识点"}]}`;
          typeRules = 'answer必须是由正确选项字母组成的数组（如["A","C"]）；若原题缺少选项，请根据题意补全选项';
        } else if (specType === 'judgment') {
          formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"判断题陈述内容","answer":true,"explanation":"为什么对或错的解析","analysis":"判断依据","knowledge_point":"细粒度知识点"}]}`;
          typeRules = 'answer必须是布尔值true或false，判断题不需要options字段';
        } else if (specType === 'fill_blank') {
          formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"含空位的题目（用______表示要填的部分）","answer":"应填入的内容","explanation":"详细解析","analysis":"解题步骤","knowledge_point":"细粒度知识点"}]}`;
          typeRules = 'answer是填入空位的内容字符串（多个空用英文逗号分隔），填空题不需要options字段';
        } else {
          formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目要求","answer":"参考答案要点","explanation":"评分标准和解析","analysis":"答题思路指导","knowledge_point":"细粒度知识点"}]}`;
          typeRules = 'answer为参考答案要点，主观题不需要options字段';
        }
        specPasteVars = { subject, typeLabel: specTypeLabel, question_type: specType || 'auto', raw_text, formatSample, typeRules };
        if (!specType) {
          specPasteKey = 'gen_paste_auto';
        } else {
          specPasteKey = PASTE_PROMPT_KEYS[specType] || 'gen_paste_essay';
        }
      }

      /**
       * 自动判型模式的逐题校验：模型会给每道题带 type 字段，
       * 这里按它判定的题型分派到标准校验口径，答案格式不对照样剔除。
       */
      const specNormalize = specType
        ? null
        : (raw) => {
            const judged = String(raw?.type || raw?.question_type || '').trim();
            if (!GEN_PROMPT_KEYS[judged]) {
              return { ok: false, reason: `AI 未能判断题型（收到：${judged || '空'}）` };
            }
            const res = normalizeQuestion(raw, judged);
            if (!res.ok) return res;
            // 把判定结果带出去，入库时按真实题型写 question_bank.type
            return { ok: true, question: { ...res.question, type: judged } };
          };

      /**
       * 按本轮实际要生成的题量拼提示词。
       * 「一次性要 30 道题」是判断题/多选题失败的主因——输出量过大会被模型
       * 自身的长度上限截断。现在改成多轮：先要满量，拿不全就自动接着补齐。
       */
      const specBuildPrompt = (ask, note) => {
        let base;
        if (isPasteMode) {
          base = fillTemplate(getPrompt(specPasteKey), specPasteVars);
        } else {
          const key = GEN_PROMPT_KEYS[specType];
          const want = ask || specTargetCount || specCount * 3;
          base = fillTemplate(getPrompt(key), {
            taskDesc: specTaskDesc,
            actualCount: want,
            count: Math.max(1, Math.round(want / specVariantStep)),
          });
        }
        return note ? `${base}\n\n${note}` : base;
      };

      console.log(`\n📤 [${specTypeLabel}${specType ? ` × ${specCount} 道` : ''} · 难度 ${specDifficulty}] 发送请求到 LLM 服务器...`);
      console.log('🎯 目标地址:', `${config.ai_base_url}/${String(config.ai_api_mode || '').toLowerCase() === 'responses' ? 'responses' : 'chat/completions'}`);
      console.log('🤖 使用模型:', config.ai_model);
      console.log('📝 首轮 Prompt 长度:', specBuildPrompt(specTargetCount || 0, '').length, '字符');
      console.log('⏱️ 超时设置:', timeoutMs / 1000, '秒');

      const result = await collectQuestions({
        config,
        timeoutMs,
        maxTokens: maxTokensPerGen,
        type: specType,
        normalize: specNormalize,
        target: specTargetCount,
        variants: specVariantStep,
        maxRounds,
        buildPrompt: specBuildPrompt,
        onTokens: (u) => {
          usageTokens.prompt += u.prompt_tokens || 0;
          usageTokens.completion += u.completion_tokens || 0;
          usageTokens.total += u.total_tokens || 0;
        },
        logger: (m) => console.log(m),
      });

      return {
        spec,
        typeLabel: specTypeLabel,
        noVariants: specVariantStep === 1,
        variantStep: specVariantStep,
        effectiveTopic: specEffectiveTopic,
        questions: result.questions,
        parsed: result.lastPack || {},
        rejectedCount: result.invalid.length,
        rounds: result.rounds.length,
      };
    };

    // 逐个规格生成：某个题型失败不影响其它题型，最后统一合并入库
    // 这里用受限并发而非逐个串行：串行时总耗时是每种题型的累加（实测 5 种题型要 250s+），
    // 无论前端 300s 还是 Nginx 默认 60s 都扛不住。并发后总耗时约等于「最慢的那一批」。
    // 并发数走设置项，避免一次性打满 AI 服务商触发限流。
    const genConcurrency = Math.max(1, Math.min(8, parseInt(getSystemSetting('ai_gen_concurrency', 3), 10) || 3));
    const specResults = [];
    const failedSpecs = [];

    const runOneSpec = async (spec) => {
      const specLabel = (spec.question_type ? (typeLabels[spec.question_type] || spec.question_type) : 'AI 自动判型');
      const doneBefore = specResults.length + failedSpecs.length;
      onProgress({ phase: 'spec_start', label: specLabel, done: doneBefore, total: specs.length });
      try {
        const one = await runSpecGeneration(spec);
        if (one && one.questions.length > 0) {
          specResults.push(one);
        } else {
          failedSpecs.push(spec);
        }
      } catch (specErr) {
        console.error(`❌ 题型 ${typeLabels[spec.question_type] || spec.question_type} 生成失败:`, specErr.message);
        failedSpecs.push(spec);
      }
      onProgress({ phase: 'spec_done', label: specLabel, done: specResults.length + failedSpecs.length, total: specs.length });
    };

    if (specs.length === 1) {
      await runOneSpec(specs[0]);
    } else {
      const queue = [...specs];
      const workerCount = Math.min(genConcurrency, queue.length);
      console.log(`\n⚙️ 共 ${specs.length} 种题型，并发 ${workerCount} 个同时生成`);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
          await runOneSpec(queue.shift());
        }
      }));
    }

    // 并发下完成顺序是随机的，按用户配置的题型顺序排回去，预览里的题型顺序才稳定
    const specOrder = new Map(specs.map((s, i) => [s.question_type, i]));
    specResults.sort((a, b) => (specOrder.get(a.spec.question_type) ?? 0) - (specOrder.get(b.spec.question_type) ?? 0));

    const elapsed = ((Date.now() - usageStartedAt) / 1000).toFixed(2);
    console.log('\n⏱️ 总耗时:', elapsed, '秒 | 成功规格:', specResults.length, '/', specs.length);
    console.log('📊 Token 使用: prompt=' + usageTokens.prompt + ', completion=' + usageTokens.completion + ', total=' + usageTokens.total);

    if (usageTokens.completion > 0) {
      const updatedGlobalTokens = db.prepare(`SELECT COALESCE(SUM(completion_tokens), 0) as total FROM token_usage WHERE date = ?`).get(today)?.total || 0;
      if (updatedGlobalTokens > dailyGlobalTokenLimit) {
        console.log('⚠️ 生成完成后，全局Token已超限，本次结果仍返回，但后续生成将被阻止');
      }
    }

    console.log('\n📊 最终结果:');
    for (const r of specResults) {
      console.log(`  - ${r.typeLabel}（难度 ${r.spec.difficulty}）有效题目 ${r.questions.length} 道 / 目标 ${isPasteMode ? '由素材决定' : r.spec.count}，剔除不合格 ${r.rejectedCount} 道`);
    }
    if (failedSpecs.length > 0) {
      console.log('  - ⚠️ 未产出题目的题型:', failedSpecs.map((s) => typeLabels[s.question_type] || s.question_type).join('、'));
    }

    if (specResults.length === 0) {
      console.log('❌ AI未能生成有效题目，本次额度已退还');
      settleUsage(usageId, 'failed', { ...usageTokens, duration: Date.now() - usageStartedAt });
      return res.status(500).json({
        error: 'AI 生成失败，本次未消耗生成次数，请稍后重试',
        quota_refunded: true,
      });
    }

    const maxGroupId = db.prepare('SELECT MAX(variant_group_id) as max_id FROM question_bank').get();
    let variantGroupId = (maxGroupId?.max_id || 0) + 1;
    const processedQuestions = [];

    // 逐规格写入，变体分组按规格各自连续编号；startIdx 记录该规格在 insertedIds 中的起点，
    // 后面拼装预览数据时按段切片即可
    for (const r of specResults) {
      r.startIdx = processedQuestions.length;
      const specType = r.spec.question_type;
      for (let i = 0; i < r.questions.length; i++) {
        // 题目已在上游完成校验与答案归一化：answer 一定是与题型匹配的字符串
        const q = r.questions[i];
        const answerStr = String(q.answer ?? '');
        // 自动判型模式下，题型由 AI 逐题判定并带在 q.type 上
        const rowType = specType || q.type;

        processedQuestions.push({
          subject,
          topic: r.effectiveTopic,
          difficulty: r.spec.difficulty,
          type: rowType,
          content: q.content,
          options: q.options ? JSON.stringify(q.options) : null,
          answer: answerStr,
          explanation: q.explanation || '',
          analysis: q.analysis || '',
          hint: q.hint || '',
          knowledge_point: (q.knowledge_point && String(q.knowledge_point).trim()) || r.effectiveTopic,
          variant_group_id: r.noVariants ? null : variantGroupId,
          variant_index: r.noVariants ? 0 : (i % r.variantStep),
          source: 'ai',
          created_by: req.user.userId
        });

        if (!r.noVariants && (i + 1) % r.variantStep === 0) {
          variantGroupId++;
        }
      }
    }

    const insertQ = db.prepare(`
      INSERT INTO question_bank (subject, topic, difficulty, type, content, options, answer, explanation, analysis, hint, knowledge_point, variant_group_id, variant_index, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    console.log('\n💾 正在将题目保存到数据库...');
    const transaction = db.transaction((qs) => {
      const ids = [];
      for (const q of qs) {
        const result = insertQ.run(
          q.subject, q.topic, q.difficulty, q.type, q.content,
          q.options, q.answer, q.explanation, q.analysis, q.hint,
          q.knowledge_point,
          q.variant_group_id, q.variant_index, q.source, q.created_by
        );
        ids.push(result.lastInsertRowid);
      }
      return ids;
    });

    const insertedIds = transaction(processedQuestions);
    console.log('✅ 数据库写入成功，共', insertedIds.length, '条记录');

    // 题目归属到这一次生成，便于教师放弃未发布内容时精确撤销、并退还额度
    try {
      const link = db.prepare('UPDATE question_bank SET generation_usage_id = ? WHERE id = ?');
      db.transaction(() => { insertedIds.forEach((id) => link.run(usageId, id)); })();
    } catch (linkErr) {
      console.warn('⚠️ 题目关联生成记录失败:', linkErr.message);
    }

    const displayQuestions = [];
    let requestedCount = 0;
    let shortfall = 0;
    let rejectedCount = 0;

    for (const r of specResults) {
      const specIds = insertedIds.slice(r.startIdx, r.startIdx + r.questions.length);
      const toDisplay = (idx) => ({
        tempId: specIds[idx],
        content: r.questions[idx].content,
        options: r.questions[idx].options ? (typeof r.questions[idx].options === 'string' ? JSON.parse(r.questions[idx].options) : r.questions[idx].options) : null,
        answer: r.questions[idx].answer !== undefined ? (Array.isArray(r.questions[idx].answer) ? r.questions[idx].answer.join(',') : String(r.questions[idx].answer)) : '',
        explanation: r.questions[idx].explanation || '',
        // 自动判型模式下用 AI 判定的真实题型，否则回落到该规格的题型
        type: r.spec.question_type || r.questions[idx].type,
        knowledge_point: processedQuestions[r.startIdx + idx]?.knowledge_point || r.effectiveTopic
      });

      rejectedCount += r.rejectedCount;

      if (r.noVariants) {
        specIds.forEach((_id, idx) => {
          displayQuestions.push({ ...toDisplay(idx), hasVariants: false });
        });
        requestedCount += r.questions.length;
      } else {
        // 多轮补齐后实际题量可能少于目标数量，这里按真实生成的组数组织变体，避免下标越界
        const availableGroups = Math.min(r.spec.count, Math.floor(specIds.length / r.variantStep));
        if (availableGroups === 0) {
          // 连一组变体都没凑齐，退化成普通列表展示，别把已经生成的题白白丢掉
          specIds.forEach((_id, idx) => {
            displayQuestions.push({ ...toDisplay(idx), hasVariants: false });
          });
        }
        for (let g = 0; g < availableGroups; g++) {
          const baseIdx = g * r.variantStep;
          const groupIds = [];
          const variants = [];
          for (let v = 0; v < r.variantStep; v++) {
            const vIdx = baseIdx + v;
            if (vIdx >= specIds.length) break;
            groupIds.push(specIds[vIdx]);
            if (v > 0) variants.push(toDisplay(vIdx));
          }
          displayQuestions.push({ ...toDisplay(baseIdx), variantIds: groupIds, hasVariants: true, variants });
        }
        requestedCount += r.spec.count;
        shortfall += Math.max(0, r.spec.count - (availableGroups || specIds.length));
      }
    }

    console.log('\n📤 返回结果给客户端...');
    console.log('========================================\n');
    onProgress({ phase: 'saving', label: '正在写入题库', done: specs.length, total: specs.length });

    settleUsage(usageId, 'ok', {
      ...usageTokens,
      question_count: insertedIds.length,
      duration: Date.now() - usageStartedAt
    });

    const resultCount = displayQuestions.length;
    const primary = specResults[0];
    const combinedTypeLabel = specResults.map((r) => r.typeLabel).join('+');
    const failedTypeLabels = failedSpecs.map((s) => typeLabels[s.question_type] || s.question_type);

    res.json({
      message: '生成成功',
      title: primary.parsed.title || `${primary.effectiveTopic} - ${combinedTypeLabel}练习`,
      description: primary.parsed.description || `共${resultCount}道${primary.effectiveTopic}相关${combinedTypeLabel}题目`,
      subject,
      // 多题型混合时用 mixed 占位：提交接口会把它当主观题处理，整份走AI 评阅，
      // 避免客观题被按单一题型的口径判分。作业详情里按题型标签展示。
      // 自动判型模式下同样记为 mixed（题目本身已按各自真实题型入库）。
      question_type: specResults.length === 1 && primary.spec.question_type
        ? primary.spec.question_type
        : 'mixed',
      // 自动判型时把AI 实际判定的题型分布回传，便于前端展示
      question_types: allowAutoDetect
        ? [...new Set(specResults.flatMap((r) => r.questions.map((q) => q.type)).filter(Boolean))]
        : specResults.map((r) => r.spec.question_type),
      spec_summary: specResults.map((r) => ({ question_type: r.spec.question_type, type_label: r.typeLabel, difficulty: r.spec.difficulty, requested: isPasteMode ? r.questions.length : r.spec.count, generated: r.questions.length })),
      question_count: resultCount,
      requested_count: requestedCount,
      shortfall,
      rejected_count: rejectedCount,
      total_generated: insertedIds.length,
      // 部分题型没出题时如实告知，避免老师以为是自己配置错了
      ...(failedTypeLabels.length > 0 ? { warning: `以下题型本次未生成出有效题目：${failedTypeLabels.join('、')}` } : {}),
      // 教师未发布而退出时，前端凭这个 id 撤销本次生成并退还额度
      usage_id: usageId,
      questions: displayQuestions,
      allQuestionIds: insertedIds
    });

  } catch (error) {
    console.error('\n❌ AI 生成作业错误:', error.message);
    if (error.response) {
      console.error('📡 LLM 服务器响应状态:', error.response.status);
      console.error('📡 LLM 服务器响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('========================================\n');

    // 走到这里说明本次生成没有产出可用题目，把额度退还给用户
    settleUsage(usageId, 'failed', { duration: usageStartedAt ? Date.now() - usageStartedAt : 0 });

    if (error.code === 'ECONNABORTED') {
      return res.status(500).json({ error: 'AI请求超时，请稍后重试（本次未消耗生成次数）', quota_refunded: true });
    }
    if (error.code === 'ECONNREFUSED') {
      return res.status(500).json({ error: '无法连接到 AI 服务器，请检查配置（本次未消耗生成次数）', quota_refunded: true });
    }
    res.status(500).json({
      error: ('AI 生成作业失败: ' + (error.message || '未知错误')) + '（本次未消耗生成次数）',
      quota_refunded: true
    });
  }
}

// ============================================================
//异步生成：立即返回 task_id，前端轮询进度
//
// 为什么需要：多题型出题实测要 250 秒以上，而 Nginx 的 proxy_read_timeout
// 默认只有 60 秒，长连接会被网关切断（504）。改成「提交 + 轮询」后，
// 每个 HTTP 请求都在 1 秒内返回，网关永远不会介入。
// 同一份生成逻辑通过 runGenerateLogic 复用，不存在两套代码。
// ============================================================

/**
 * 伪响应对象与异步任务提交都走公共工具，避免多处重复实现。
 */
const { startAsyncTask, handleTaskQuery } = require('../utils/asyncTask');

router.post('/generate', authenticateToken, authorizeRole('teacher', 'admin'), aiOff, (req, res) => {
  const title = req.body.topic || String(req.body.requirements || '').slice(0, 30) || 'AI 出题';
  return startAsyncTask(res, {
    userId: req.user.userId,
    kind: 'question_gen',
    title,
    subject: req.body.subject || '',
    runningMsg: '已开始生成，请稍候',
  }, (fakeRes, onProgress) =>
    runGenerateLogic(req, fakeRes, { onProgress })
  );
});

// 轮询进度
router.get('/generate/:taskId', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  handleTaskQuery(req, res);
});

// 撤销一次「生成了但没有发布」的 AI 出题：删除未被使用的题目并把额度退还
router.post('/generate/abandon/:usageId', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const usageId = parseInt(req.params.usageId, 10);
    if (!usageId) return res.status(400).json({ error: '参数错误' });

    const row = db.prepare('SELECT id, user_id, date, status FROM token_usage WHERE id = ?').get(usageId);
    if (!row) return res.status(404).json({ error: '未找到该次生成记录' });
    if (row.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: '只能撤销自己的生成记录' });
    }
    if (row.status === 'failed') {
      return res.json({ message: '该次生成已经退还过了', refunded: 0, deleted: 0 });
    }

    // 已经拿这些题目去发布过作业，就不能再退
    if (countReferencedQuestions(usageId) > 0) {
      return res.status(400).json({ error: '本次生成的题目已被作业引用，不能撤销' });
    }

    const deleted = deleteUnusedQuestions(usageId);
    markFailed(usageId);

    console.log(`↩️ 教师 ${req.user.userId} 撤销生成 ${usageId}：删除 ${deleted} 道未使用题目，退还 1 次额度`);
    res.json({ message: '已撤销本次生成，未发布的内容不计入次数', refunded: 1, deleted });
  } catch (error) {
    console.error('撤销 AI 生成失败:', error.message);
    res.status(500).json({ error: '撤销失败: ' + (error.message || '未知错误') });
  }
});

// 更新题目（教师/管理员预览阶段调整）
router.patch('/questions/:id', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const qid = parseInt(req.params.id);
    const existing = db.prepare('SELECT id, variant_group_id, type, answer as old_answer FROM question_bank WHERE id = ?').get(qid);
    if (!existing) return res.status(404).json({ error: '题目不存在' });

    if (req.user.role === 'teacher') {
      // 必须遍历全部引用该题的作业：原先只取第一条匹配记录，只要有一条属于自己就放行，存在越权编辑他人题目
      const assignmentQs = db.prepare('SELECT a.teacher_id FROM assignment_questions aq JOIN assignments a ON aq.assignment_id = a.id WHERE aq.question_bank_id = ?').all(qid);
      if (assignmentQs.some(row => row.teacher_id !== req.user.userId)) {
        return res.status(403).json({ error: '只能编辑自己发布的作业题目' });
      }
    }

    const { content, options, answer, explanation, analysis, knowledge_point, difficulty, hint, sync_group } = req.body;
    const fields = [];
    const values = [];
    if (content !== undefined) { fields.push('content = ?'); values.push(content); }
    if (options !== undefined) { fields.push('options = ?'); values.push(options ? JSON.stringify(options) : null); }
    let newAnswerStr = null;
    if (answer !== undefined) {
      newAnswerStr = Array.isArray(answer) ? answer.join(',') : typeof answer === 'boolean' ? (answer ? 'true' : 'false') : String(answer);
      fields.push('answer = ?'); values.push(newAnswerStr);
    }
    if (explanation !== undefined) { fields.push('explanation = ?'); values.push(explanation); }
    if (analysis !== undefined) { fields.push('analysis = ?'); values.push(analysis); }
    if (knowledge_point !== undefined) { fields.push('knowledge_point = ?'); values.push(knowledge_point); }
    if (difficulty !== undefined) { fields.push('difficulty = ?'); values.push(difficulty); }
    if (hint !== undefined) { fields.push('hint = ?'); values.push(hint); }
    if (fields.length === 0) return res.json({ message: '无更新' });

    values.push(qid);
    db.prepare(`UPDATE question_bank SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // 同步同一变体组内的知识点与难度（避免学生重做时版本不一致）
    if (sync_group && existing.variant_group_id && (knowledge_point !== undefined || difficulty !== undefined)) {
      const groupFields = [];
      const groupValues = [];
      if (knowledge_point !== undefined) { groupFields.push('knowledge_point = ?'); groupValues.push(knowledge_point); }
      if (difficulty !== undefined) { groupFields.push('difficulty = ?'); groupValues.push(difficulty); }
      groupValues.push(existing.variant_group_id);
      db.prepare(`UPDATE question_bank SET ${groupFields.join(', ')} WHERE variant_group_id = ?`).run(...groupValues);
    }

    // 答案变更时，自动重算所有作答记录、错题本、提交分数，并通知受影响学生
    if (newAnswerStr !== null && newAnswerStr !== existing.old_answer) {
      const affectedAnswers = db.prepare(`
        SELECT qa.id, qa.submission_id, qa.student_answer, qa.is_correct, qa.score, qa.max_score,
               s.user_id, s.assignment_id, s.id as sub_id
        FROM question_answers qa
        JOIN submissions s ON qa.submission_id = s.id
        WHERE qa.question_bank_id = ?
      `).all(qid);

      const updatedQuestion = db.prepare('SELECT type, answer FROM question_bank WHERE id = ?').get(qid);
      const notifiedUsers = new Set();

      for (const qa of affectedAnswers) {
        const ua = qa.student_answer;
        // 主观题无法自动重判，跳过；客观题走统一判分口径
        if (!['choice_single', 'choice_multi', 'judgment', 'fill_blank'].includes(updatedQuestion.type)) {
          continue;
        }
        const newCorrect = isAnswerCorrect(updatedQuestion.type, ua, updatedQuestion.answer);

        const wasCorrect = qa.is_correct === 1;
        if (wasCorrect === newCorrect) continue;

        const newScore = newCorrect ? qa.max_score : 0;
        db.prepare('UPDATE question_answers SET is_correct = ?, score = ? WHERE id = ?')
          .run(newCorrect ? 1 : 0, newScore, qa.id);

        // 更新错题本
        if (wasCorrect && !newCorrect) {
          writeWrongQuestion({
            userId: qa.user_id, assignmentId: qa.assignment_id, questionId: qid,
            wrongAnswer: ua, correctAnswer: updatedQuestion.answer, analysis: '',
          });
        } else if (!wasCorrect && newCorrect) {
          db.prepare('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?')
            .run(qa.user_id, qid);
        }

        // 重新计算该提交的总分
        // 同一题可能存在多轮重做记录，只取每题最近一次作答，避免重复计分
        const attemptRows = db.prepare(
          'SELECT id, question_bank_id, attempt_number, score, max_score, is_correct FROM question_answers WHERE submission_id = ? ORDER BY attempt_number ASC'
        ).all(qa.submission_id);
        const latestByQ = new Map();
        for (const r of attemptRows) latestByQ.set(r.question_bank_id, r);
        const allQA = [...latestByQ.values()];

        const rawScore = allQA.reduce((sum, a) => sum + (a.score || 0), 0);
        const maxTotal = allQA.reduce((sum, a) => sum + (a.max_score || 0), 0);
        // 用真实满分归一化到百分制；maxTotal 为 0（异常数据）时退回 0 分，避免除零得到 NaN
        const totalScore = maxTotal > 0 ? Math.round((rawScore / maxTotal) * 100) : 0;

        const assignmentInfo = db.prepare('SELECT max_exp FROM assignments WHERE id = ?').get(qa.assignment_id);
        const maxExp = assignmentInfo?.max_exp || 30;
        const assignmentQuestionCount = db.prepare('SELECT COUNT(*) as c FROM assignment_questions WHERE assignment_id = ?').get(qa.assignment_id)?.c || allQA.length;
        // 与提交时共用同一套公式，保证 Combo / 满分奖励不会被算丢
        const newGoldReward = calcGoldReward(
          totalScore,
          assignmentQuestionCount,
          allQA.map(a => ({ is_correct: a.is_correct === 1 })),
          maxExp
        ).gold;
        const oldGold = db.prepare('SELECT gold_reward FROM submissions WHERE id = ?').get(qa.submission_id)?.gold_reward || 0;
        const goldDiff = newGoldReward - oldGold;

        db.prepare('UPDATE submissions SET total_score = ?, gold_reward = ? WHERE id = ?')
          .run(totalScore, newGoldReward, qa.submission_id);

        // 走统一管道：正向发放与负向扣回都经它处理
        // （total_gold_earned 是生涯累计，管道内只累加不因扣减回退）
        if (goldDiff !== 0) {
          grantReward(qa.user_id, {
            gold: goldDiff,
            source: 'assignment_regrade',
            reason: `作业答案更正，金币调整 ${goldDiff > 0 ? '+' : ''}${goldDiff}`,
          });
        }

        // 通知受影响的学生
        if (!notifiedUsers.has(qa.user_id)) {
          notifiedUsers.add(qa.user_id);
          const direction = wasCorrect && !newCorrect ? '变更为错误' : '变更为正确';
          const assignmentTitle = db.prepare('SELECT title FROM assignments WHERE id = ?').get(qa.assignment_id)?.title || '作业';
          db.prepare(`
            INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
            VALUES (?, 'answer_changed', '题目答案已更正', ?, 'assignment', ?)
          `).run(qa.user_id, `「${assignmentTitle}」中有一道题目的标准答案被老师修改，你的作答结果${direction}，请查看最新成绩`, qa.assignment_id);
        }
      }
    }

    const updated = db.prepare('SELECT * FROM question_bank WHERE id = ?').get(qid);
    if (updated.options) { try { updated.options = JSON.parse(updated.options); } catch(e) {} }
    res.json({ message: '更新成功', question: updated });
  } catch (error) {
    console.error('更新题目错误:', error);
    res.status(500).json({ error: '更新题目失败: ' + error.message });
  }
});

router.post('/', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { title, description, subject, question_type, max_exp, due_date, class_id, question_ids, ai_config, max_attempts, assignment_type } = req.body;

    if (!title || !subject || !question_type || !due_date) {
      return res.status(400).json({ error: '请填写必要信息' });
    }

    // 作业类型：preview 预习 / homework 作业 / review 复习，缺省 homework
    const aType = ['preview', 'homework', 'review'].includes(assignment_type) ? assignment_type : 'homework';

    // 重做次数上限：允许 1-10 次，缺省沿用表默认值 3
    let attempts = Number(max_attempts);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
      attempts = 3;
    }

    let targetClassId = class_id;
    if (!targetClassId && req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ? LIMIT 1`).all(req.user.userId);
      if (teacherClasses.length > 0) {
        targetClassId = teacherClasses[0].class_id;
      }
    }

    // 校验：非管理员教师仅能为所属班级创建作业
    if (targetClassId && req.user.role !== 'admin') {
      const belongs = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(req.user.userId, targetClassId);
      if (!belongs) {
        return res.status(403).json({ error: '无权为该班级创建作业' });
      }
    }
    if (!targetClassId) {
      return res.status(400).json({ error: '请选择作业所属班级' });
    }

    const result = db.prepare(`
      INSERT INTO assignments (teacher_id, title, description, subject, question_type, max_exp, due_date, ai_config, class_id, max_attempts, assignment_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.userId, title, description, subject, question_type, max_exp, new Date(due_date).toISOString(), JSON.stringify(ai_config || {}), targetClassId, attempts, aType);

    const assignmentId = result.lastInsertRowid;

    if (question_ids && question_ids.length > 0) {
      const insertAQ = db.prepare(`
        INSERT INTO assignment_questions (assignment_id, question_bank_id, sort_order)
        VALUES (?, ?, ?)
      `);
      const insertTransaction = db.transaction((ids) => {
        ids.forEach((qid, idx) => {
          insertAQ.run(assignmentId, qid, idx + 1);
        });
      });
      insertTransaction(question_ids);

      db.prepare(`UPDATE question_bank SET usage_count = usage_count + 1 WHERE id IN (${question_ids.map(() => '?').join(',')})`).run(...question_ids);
    }

    res.status(201).json({
      message: '作业创建成功',
      assignment: {
        id: assignmentId,
        title,
        subject,
        question_type,
        max_exp,
        due_date,
        class_id: targetClassId,
        max_attempts: attempts,
        assignment_type: aType,
        question_count: question_ids ? question_ids.length : 0
      }
    });
  } catch (error) {
    console.error('创建作业错误:', error);
    res.status(500).json({ error: '创建作业失败: ' + error.message });
  }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    let assignments;
    const { class_id, subject, date_from, date_to, assignment_type } = req.query;
    const typeFilter = ['preview', 'homework', 'review'].includes(assignment_type) ? assignment_type : null;

    if (req.user.role === 'admin') {
      let sql = `
        SELECT a.*, COALESCE(u.real_name, u.username) as teacher_name, c.name as class_name,
          (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count,
          (SELECT COUNT(*) FROM users WHERE class_id = a.class_id AND role = 'student' AND status = 'active') as class_student_count,
          (SELECT COUNT(DISTINCT user_id) FROM submissions WHERE assignment_id = a.id) as submitted_count
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classes c ON a.class_id = c.id
        WHERE 1=1
      `;
      const params = [];
      if (class_id) { sql += ` AND a.class_id = ?`; params.push(class_id); }
      if (subject) { sql += ` AND a.subject = ?`; params.push(subject); }
      if (typeFilter) { sql += ` AND a.assignment_type = ?`; params.push(typeFilter); }
      if (date_from) { sql += ` AND a.created_at >= ?`; params.push(date_from); }
      if (date_to) { sql += ` AND a.created_at <= ?`; params.push(date_to + ' 23:59:59'); }
      sql += ` ORDER BY a.created_at DESC`;
      assignments = db.prepare(sql).all(...params);
    } else if (req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`SELECT class_id, role FROM class_teachers WHERE teacher_id = ?`).all(req.user.userId);
      const headTeacherClassIds = teacherClasses.filter(tc => tc.role === 'head_teacher').map(tc => tc.class_id);
      const allClassIds = teacherClasses.map(tc => tc.class_id);
      if (allClassIds.length === 0) return res.json({ assignments: [] });
      // 跨教师作业可见性由后台开关控制，默认关闭
      const crossTeacherVisible = isFeatureEnabled('cross_teacher_homework_visible');

      let sql = `
        SELECT a.*, COALESCE(u.real_name, u.username) as teacher_name, c.name as class_name,
          (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count,
          (SELECT COUNT(*) FROM users WHERE class_id = a.class_id AND role = 'student' AND status = 'active') as class_student_count,
          (SELECT COUNT(DISTINCT user_id) FROM submissions WHERE assignment_id = a.id) as submitted_count
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classes c ON a.class_id = c.id
        WHERE a.status != 'cancelled'
      `;
      const params = [];

      if (class_id) {
        sql += ` AND a.class_id = ?`;
        params.push(class_id);
        // 非班主任默认只看自己布置的；开启「跨教师作业可见」后同班全部可见。
        // 班主任无论如何都能看本班全部（教学统筹需要）。
        if (!headTeacherClassIds.includes(parseInt(class_id)) && !crossTeacherVisible) {
          sql += ` AND a.teacher_id = ?`;
          params.push(req.user.userId);
        }
      } else if (crossTeacherVisible) {
        const placeholders = allClassIds.map(() => '?').join(',');
        sql += ` AND a.class_id IN (${placeholders})`;
        params.push(...allClassIds);
      } else {
        const headPlaceholders = headTeacherClassIds.map(() => '?').join(',');
        const allPlaceholders = allClassIds.map(() => '?').join(',');
        sql += ` AND ((a.class_id IN (${headPlaceholders})) OR (a.class_id IN (${allPlaceholders}) AND a.teacher_id = ?))`;
        params.push(...headTeacherClassIds, ...allClassIds, req.user.userId);
      }

      if (subject) { sql += ` AND a.subject = ?`; params.push(subject); }
      if (typeFilter) { sql += ` AND a.assignment_type = ?`; params.push(typeFilter); }
      if (date_from) { sql += ` AND a.created_at >= ?`; params.push(date_from); }
      if (date_to) { sql += ` AND a.created_at <= ?`; params.push(date_to + ' 23:59:59'); }
      sql += ` ORDER BY a.created_at DESC`;
      assignments = db.prepare(sql).all(...params);
    } else {
      const student = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
      if (!student || !student.class_id) return res.json({ assignments: [] });

      let studentSql = `
        SELECT a.*, COALESCE(u.real_name, u.username) as teacher_name, c.name as class_name,
          (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count,
          (SELECT COUNT(*) FROM users WHERE class_id = a.class_id AND role = 'student' AND status = 'active') as class_student_count,
          (SELECT COUNT(DISTINCT user_id) FROM submissions WHERE assignment_id = a.id) as submitted_count,
          (SELECT id FROM submissions WHERE assignment_id = a.id AND user_id = ? LIMIT 1) as my_submission_id,
          (SELECT status FROM submissions WHERE assignment_id = a.id AND user_id = ? ORDER BY id DESC LIMIT 1) as my_submission_status,
          (SELECT MAX(total_score) FROM submissions WHERE assignment_id = a.id AND user_id = ?) as my_score,
          (SELECT SUM(gold_reward) FROM submissions WHERE assignment_id = a.id AND user_id = ?) as my_gold_reward,
          -- AI 判分状态：学生端要靠它区分「已提交待评阅」与「已判完」。
          -- 缺这两个字段时前端拿到 null 分数，会把正在评阅的作业显示成「需努力 0分」。
          (SELECT review_status FROM submissions WHERE assignment_id = a.id AND user_id = ? ORDER BY id DESC LIMIT 1) as my_review_status,
          (SELECT graded_at FROM submissions WHERE assignment_id = a.id AND user_id = ? ORDER BY id DESC LIMIT 1) as my_graded_at,
          (SELECT MIN(qa.answered_at) FROM question_answers qa
             JOIN submissions s ON s.id = qa.submission_id
            WHERE s.assignment_id = a.id AND s.user_id = ?) as my_first_answered_at,
          (SELECT MAX(qa.answered_at) FROM question_answers qa
             JOIN submissions s ON s.id = qa.submission_id
            WHERE s.assignment_id = a.id AND s.user_id = ?) as my_last_answered_at,
          (SELECT SUM(COALESCE(qa.duration_ms, 0)) FROM question_answers qa
             JOIN submissions s ON s.id = qa.submission_id
            WHERE s.assignment_id = a.id AND s.user_id = ?) as my_duration_ms
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classes c ON a.class_id = c.id
        WHERE a.class_id = ? AND a.status != 'cancelled'
      `;
      const studentParams = [
        // 顺序必须与studentSql 里的 ? 逐一对应：
        // submitted_count(无参数) 之后的 7 个子查询各要1 个 user_id
        req.user.userId, // my_submission_id
        req.user.userId, // my_submission_status
        req.user.userId, // my_score
        req.user.userId, // my_gold_reward
        req.user.userId, // my_review_status
        req.user.userId, // my_graded_at
        req.user.userId, // my_first_answered_at
        req.user.userId, // my_last_answered_at
        req.user.userId, // my_duration_ms
        student.class_id,
      ];
      if (typeFilter) { studentSql += ` AND a.assignment_type = ?`; studentParams.push(typeFilter); }
      studentSql += ` ORDER BY a.created_at DESC`;
      assignments = db.prepare(studentSql).all(...studentParams);
    }

    res.json({ assignments });
  } catch (error) {
    console.error('获取作业列表错误:', error);
    res.status(500).json({ error: '获取作业列表失败' });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const assignment = db.prepare(`
      SELECT a.*, COALESCE(u.real_name, u.username) as teacher_name, c.name as class_name
      FROM assignments a
      JOIN users u ON a.teacher_id = u.id
      LEFT JOIN classes c ON a.class_id = c.id
      WHERE a.id = ?
    `).get(req.params.id);

    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    if (req.user.role === 'student') {
      const student = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
      if (!student || student.class_id !== assignment.class_id) {
        return res.status(403).json({ error: '无法访问此作业' });
      }
    } else if (req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(req.user.userId);
      const classIds = teacherClasses.map(tc => tc.class_id);
      if (!classIds.includes(assignment.class_id)) {
        return res.status(403).json({ error: '无法访问此作业' });
      }
      // 该作业不是本人布置、且本人也不是该班班主任时，只有开启了
      // 「跨教师作业可见」才允许查看题目详情（与列表接口口径保持一致，防止用直链绕过）
      const isHeadTeacher = teacherClasses.some(
        (tc) => tc.class_id === assignment.class_id && tc.role === 'head_teacher'
      );
      if (assignment.teacher_id !== req.user.userId && !isHeadTeacher && !isFeatureEnabled('cross_teacher_homework_visible')) {
        return res.status(403).json({ error: '该作业由其他老师布置，未开启跨教师作业可见' });
      }
    }

    const isStudent = req.user.role === 'student';
    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.options, qb.hint,
             ${isStudent ? 'NULL as answer, NULL as explanation, NULL as analysis' : 'qb.answer, qb.explanation, qb.analysis'},
             aq.sort_order, qb.variant_group_id, qb.difficulty, qb.knowledge_point, qb.subject, qb.topic
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);

    for (const q of questions) {
      if (q.options) {
        try { q.options = JSON.parse(q.options); } catch(e) {}
      }
    }

    if (!isStudent) {
      for (const q of questions) {
        if (q.variant_group_id) {
          const variants = db.prepare(`
            SELECT id, type, content, options, answer, explanation, analysis, variant_index, difficulty, knowledge_point
            FROM question_bank
            WHERE variant_group_id = ? AND variant_index > 0
            ORDER BY variant_index
          `).all(q.variant_group_id);
          for (const v of variants) {
            if (v.options) {
              try { v.options = JSON.parse(v.options); } catch(e) {}
            }
          }
          q.variants = variants;
        } else {
          q.variants = [];
        }
      }
    }

    res.json({
      assignment: { ...assignment, questions }
    });
  } catch (error) {
    console.error('获取作业详情错误:', error);
    res.status(500).json({ error: '获取作业详情失败' });
  }
});

router.get('/:id/retry-questions', authenticateToken, (req, res) => {
  try {
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const submission = db.prepare('SELECT id, status, attempt_count FROM submissions WHERE assignment_id = ? AND user_id = ?')
      .get(req.params.id, req.user.userId);
    if (!submission || submission.status !== 'retry_available') {
      return res.status(400).json({ error: '当前无法重做错题' });
    }

    // 必须按 attempt_number 取最近一轮的结果。
    // question_answers 是每轮追加写的，同一道题会留下 N 条记录；这里原先只按
    // is_correct = 0 过滤，于是重做时早已在上一轮做对的题，会因为第一轮的
    // is_correct = 0 被再次判成错题。学生照着界面把这些题重做完提交，
    // 却会被 submit 的白名单拦成「只能重做上次答错的题目」。
    // 提交侧（POST /:id/submit）是用 latestByQ 取最近一轮的，两端口径必须一致。
    const latestAttempt = db.prepare(
      'SELECT MAX(attempt_number) as n FROM question_answers WHERE submission_id = ?'
    ).get(submission.id)?.n;

    const wrongRows = db.prepare(`
      SELECT qa.question_bank_id, qb.variant_group_id
      FROM question_answers qa
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      WHERE qa.submission_id = ? AND qa.is_correct = 0 AND qa.attempt_number = ?
    `).all(submission.id, latestAttempt);

    // 已作答过的题（全部轮次）：用来挑「组内还没做过的变体」
    const attemptedIds = db.prepare(`
      SELECT DISTINCT question_bank_id FROM question_answers WHERE submission_id = ?
    `).all(submission.id).map(r => r.question_bank_id);

    // 作业原题映射，与提交侧（POST /:id/submit）的 resolveOriginalId 同一套口径：
// 变体题要能折算回它所属的作业原题，重做才谈得上「覆盖全部错题」。
    const assignmentQs = db.prepare(`
      SELECT qb.id, qb.variant_group_id FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
    `).all(req.params.id);
    const assignmentQIds = new Set(assignmentQs.map(q => q.id));
    const originalByGroup = new Map();
    for (const q of assignmentQs) {
      if (q.variant_group_id != null && !originalByGroup.has(q.variant_group_id)) {
        originalByGroup.set(q.variant_group_id, q.id);
      }
    }
    const resolveOriginalId = (qid, grp) =>
      assignmentQIds.has(qid) ? qid : (grp != null ? (originalByGroup.get(grp) ?? null) : null);

    // 挑选逻辑统一走 pickRetryQuestion，与 POST /:id/submit 返回的重做列表同一套口径。
    // 两处各写一份正是「列表里有几道题、重做却要求做更多道题」的根源。
    const attemptedSet = new Set(attemptedIds);
    const retryQuestions = [];
    const handledGroups = new Set();
    for (const row of wrongRows) {
      const groupKey = row.variant_group_id != null
        ? `g${row.variant_group_id}`
        : `q${row.question_bank_id}`;
      if (handledGroups.has(groupKey)) continue;
      handledGroups.add(groupKey);

      const retryQuestion = pickRetryQuestion(
        row.question_bank_id, row.variant_group_id ?? null, attemptedSet, resolveOriginalId
      );
      if (retryQuestion) {
        retryQuestion.original_question_id =
          resolveOriginalId(row.question_bank_id, row.variant_group_id) ?? row.question_bank_id;
        retryQuestions.push(retryQuestion);
      }
    }

    res.json({ retry_questions: retryQuestions, assignment_id: parseInt(req.params.id) });
  } catch (error) {
    console.error('获取重做错题错误:', error);
    res.status(500).json({ error: '获取重做错题失败' });
  }
});

router.post('/:id/submit', authenticateToken, async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: '请提交有效的答案' });
    }

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });
    if (assignment.status === 'cancelled') return res.status(400).json({ error: '该作业已被取消，无法提交' });
    // 截止时间校验（原先完全没有校验，作业过期后仍可无限提交）
    if (assignment.due_date && new Date() > new Date(assignment.due_date)) {
      return res.status(400).json({ error: '作业已过截止时间，无法提交' });
    }

    const student = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
    if (!student || student.class_id !== assignment.class_id) {
      return res.status(403).json({ error: '无法提交此作业' });
    }

    const existingSubmission = db.prepare('SELECT id, status, attempt_count FROM submissions WHERE assignment_id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (existingSubmission && existingSubmission.status !== 'retry_available') {
      return res.status(400).json({ error: '已经提交过作业' });
    }

    // 重做次数上限：原先 retry_available 只要还有错题就能无限重做，
    // 每次分数提高还会补发金币差额，等于可以一直刷到满分。
    const maxAttempts = Number(assignment.max_attempts) > 0 ? Number(assignment.max_attempts) : 3;
    if (existingSubmission && existingSubmission.attempt_count >= maxAttempts) {
      return res.status(400).json({
        error: `重做次数已用完（上限 ${maxAttempts} 次）`,
        attempt_count: existingSubmission.attempt_count,
        max_attempts: maxAttempts,
      });
    }

    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.options, qb.answer, qb.explanation, qb.analysis, qb.variant_group_id, qb.knowledge_point
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);

    const isObj = isObjectiveType(assignment.question_type);
    const submissionId = existingSubmission ? existingSubmission.id : null;
    const isRetry = !!submissionId;

    // 每题作答耗时（毫秒）：前端作答时逐题计时并随答案一起提交。
    // 用于识别「长时间无响应只蒙答案」的情况，存量数据为 NULL 需忽略。
    const durationOf = (qid) => {
      const raw = (answers || []).find((a) => Number(a.question_id) === Number(qid))?.duration_ms;
      const n = parseInt(raw);
      // 只接受合理区间：0.5 秒 ~ 30 分钟
      return Number.isFinite(n) && n >= 500 && n <= 1800000 ? n : null;
    };

    // 重做模式专用：待重做的原始题目数、以及「本次作答题目 id → 本作业原始题目 id」的映射
    let retryWrongOriginalCount = 0;
    let originalOfRetry = {};

    if (isObj) {
      const results = [];
      let correctCount = 0;
      let wrongQuestions = [];

      if (isRetry) {
        // ============ 重做合法性校验 ============
        // 原实现只校验 question_id 是正整数，学生可用任意简单题替换错题；
        // 且 totalQuestionCount 取 answers.length，只提交 1 道会的题即可拿满分。
        // 这里白名单收敛为「最近一次作答仍答错的题 + 其变体组内未做过的变体」，并要求全部覆盖。

        const attemptRows = db.prepare(`
          SELECT qa.question_bank_id, qa.attempt_number, qa.is_correct, qb.variant_group_id
          FROM question_answers qa
          JOIN question_bank qb ON qa.question_bank_id = qb.id
          WHERE qa.submission_id = ?
        `).all(submissionId);

        // 同一题可能有多轮作答记录，只取最近一次的结果，避免历史错误作答被反复计入
        const latestByQ = new Map();
        for (const r of attemptRows) {
          const prev = latestByQ.get(r.question_bank_id);
          if (!prev || r.attempt_number > prev.attempt_number) latestByQ.set(r.question_bank_id, r);
        }

        // 本作业题目 id 集合；变体组 → 原始题目 id（用于把变体题折算回作业维度）
        const assignmentQIds = new Set(questions.map(q => q.id));
        const originalByGroup = new Map();
        for (const q of questions) {
          if (q.variant_group_id) originalByGroup.set(q.variant_group_id, q.id);
        }
        const resolveOriginalId = (qid, variantGroupId) =>
          assignmentQIds.has(qid) ? qid : (variantGroupId ? (originalByGroup.get(variantGroupId) || null) : null);

        const wrongOriginalIds = new Set();
        for (const r of latestByQ.values()) {
          if (r.is_correct === 1) continue;
          const oid = resolveOriginalId(r.question_bank_id, r.variant_group_id);
          if (oid != null) wrongOriginalIds.add(oid);
        }
        retryWrongOriginalCount = wrongOriginalIds.size;

        // 允许提交的题目 = 错题本体 + 该错题变体组内尚未作答过的变体
        const attemptedIds = new Set(attemptRows.map(r => r.question_bank_id));
        const allowedIds = new Set();
        const variantsByGroup = new Map();
        for (const oid of wrongOriginalIds) {
          allowedIds.add(oid);
          const grp = questions.find(q => q.id === oid)?.variant_group_id;
          if (!grp) continue;
          if (!variantsByGroup.has(grp)) {
            variantsByGroup.set(grp, db.prepare('SELECT id FROM question_bank WHERE variant_group_id = ?').all(grp));
          }
          for (const v of variantsByGroup.get(grp)) {
            if (!attemptedIds.has(v.id)) allowedIds.add(v.id);
          }
        }

        const submittedIds = [...new Set(answers.map(a => parseInt(a.question_id, 10)).filter(n => Number.isInteger(n)))];
        if (submittedIds.length === 0) {
          return res.status(400).json({ error: '请提交有效的答案' });
        }
        const illegalIds = submittedIds.filter(id => !allowedIds.has(id));
        if (illegalIds.length > 0) {
          return res.status(400).json({ error: '只能重做上次答错的题目' });
        }

        // 必须覆盖全部错题，否则可只挑会做的题提交来刷高分。
        //
        // 折算变体题时必须能拿到它自己的 variant_group_id：上面 attemptRows 只含
        // 「做过的题」，questions 只含「作业原题」，两者都查不到这道刚提交的组内新变体，
        // 于是 resolveOriginalId 返回 null，这道题折算不回任何原题 —— 覆盖校验永远差一条，
        // 学生把界面上所有题都做完了仍被拦成「请完成全部错题的重做后再提交」。
        // 所以先把这批提交题的 variant_group_id 查出来，原查询顺延到后面复用。
        const retryQuestionIds = submittedIds;
        const retryQuestions = db.prepare(`
            SELECT id, type, content, options, answer, explanation, analysis, variant_group_id, knowledge_point
            FROM question_bank WHERE id IN (${retryQuestionIds.map(() => '?').join(',')})
          `).all(...retryQuestionIds);
        const variantGroupOfSubmitted = new Map(retryQuestions.map(rq => [rq.id, rq.variant_group_id]));

        const coveredOriginals = new Set();
        for (const id of submittedIds) {
          const row = attemptRows.find(r => r.question_bank_id === id);
          const grp = variantGroupOfSubmitted.get(id)
            ?? row?.variant_group_id
            ?? questions.find(q => q.id === id)?.variant_group_id
            ?? null;
          const oid = resolveOriginalId(id, grp);
          if (oid != null) coveredOriginals.add(oid);
        }
        if ([...wrongOriginalIds].some(oid => !coveredOriginals.has(oid))) {
          return res.status(400).json({ error: '请完成全部错题的重做后再提交' });
        }

        const retryQuestionMap = {};
        for (const rq of retryQuestions) {
          retryQuestionMap[rq.id] = rq;
          const oid = resolveOriginalId(rq.id, rq.variant_group_id);
          if (oid != null) originalOfRetry[rq.id] = oid;
        }

        for (const ans of answers) {
          const q = retryQuestionMap[ans.question_id];
          if (!q) continue;

          const userAnswer = ans.answer;
          // 统一判分口径（原先此处不认「正确/错误」等中文答案写法）
          const isCorrect = isAnswerCorrect(q.type, userAnswer, q.answer);

          // 重做分支不在此处累加 correctCount，改在分支结束后统一按「作业全部题目」维度计算
          results.push({
            question_id: q.id,
            question_content: q.content,
            user_answer: userAnswer,
            correct_answer: q.answer,
            is_correct: isCorrect,
            score: isCorrect ? (100 / questions.length) : 0,
            duration_ms: durationOf(q.id),
            explanation: q.explanation,
            analysis: q.analysis
          });

          if (!isCorrect) {
            // attemptedIds 每次重新查：同一份作业会提交多轮，
            // 固定成第一次查询的结果会让「本轮刚做过的变体」被当成新题再发一次
            const attemptedThisRound = new Set(db.prepare(`
              SELECT DISTINCT question_bank_id FROM question_answers WHERE submission_id = ?
            `).all(submissionId).map(r => r.question_bank_id));
            attemptedThisRound.add(q.id);

            const retryQuestion = pickRetryQuestion(q.id, q.variant_group_id ?? null, attemptedThisRound, resolveOriginalId);
            if (retryQuestion) {
              wrongQuestions.push({
                original_question_id: resolveOriginalId(q.id, q.variant_group_id ?? null) ?? q.id,
                retry_question: retryQuestion
              });
            }
          }

          if (!isCorrect) {
            let existingWQ = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
              .get(req.user.userId, q.id);
            if (!existingWQ && q.variant_group_id) {
              const siblingIds = db.prepare('SELECT id FROM question_bank WHERE variant_group_id = ?').all(q.variant_group_id).map(r => r.id);
              for (const sid of siblingIds) {
                const sib = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
                  .get(req.user.userId, sid);
                if (sib) { existingWQ = sib; break; }
              }
            }
            if (existingWQ) {
              db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count + 1, wrong_answer = ?, correct_answer = ?, reviewed = 0 WHERE id = ?')
                .run(String(userAnswer), q.answer, existingWQ.id);
            } else {
              writeWrongQuestion({
                userId: req.user.userId, assignmentId: req.params.id, questionId: q.id,
                wrongAnswer: userAnswer, correctAnswer: q.answer, analysis: q.analysis,
              });
            }
          } else {
            const idsToDelete = [q.id];
            if (q.variant_group_id) {
              const siblingIds = db.prepare('SELECT id FROM question_bank WHERE variant_group_id = ?').all(q.variant_group_id).map(r => r.id);
              idsToDelete.push(...siblingIds);
            }
            for (const did of idsToDelete) {
              db.prepare('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?')
                .run(req.user.userId, did);
            }
          }
        }
      } else {

      // 首次提交分支：挑重做题需要的两个只跟「作业题目表」有关的量，
// 提到循环外算一次即可（放在循环里会每题重算一遍变体组映射）
const qidsOfAssignment = new Set(questions.map(q => q.id));
// 首次提交时「已作答过的题」= 本次提交的全部题。用于挑组内还没做过的变体。
const firstRoundAttemptedIds = new Set(
  answers.map(a => parseInt(a.question_id, 10)).filter(n => Number.isInteger(n))
);
const assignmentOriginalResolver = (qid, grp) => {
  if (qidsOfAssignment.has(qid)) return qid;
  if (grp == null) return null;
  for (const item of questions) {
    if (item.variant_group_id != null && item.variant_group_id === grp) return item.id;
  }
  return null;
};

// 提交的 question_id 一律按数字取。
// 原先这里用严格相等 `a.question_id === q.id`，客户端若传字符串 id（表单序列化、
// 老版本 App、不同端字段类型不一致都会发生），答案就找不到、被当成 undefined，
// 于是判错、也不入库 —— 现象同样是「填空题我明明填了，却算我错/说没做」。
const answerByQId = new Map();
for (const a of answers) {
  const qid = parseInt(a.question_id, 10);
  if (Number.isInteger(qid) && !answerByQId.has(qid)) answerByQId.set(qid, a.answer);
}

for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const userAnswer = answerByQId.get(q.id);
        // 统一判分口径（原先此处不认「正确/错误」等中文答案写法）
        const isCorrect = isAnswerCorrect(q.type, userAnswer, q.answer);

        if (isCorrect) correctCount++;

        results.push({
          question_id: q.id,
          question_content: q.content,
          user_answer: userAnswer,
          correct_answer: q.answer,
          is_correct: isCorrect,
          score: isCorrect ? (100 / questions.length) : 0,
          duration_ms: durationOf(q.id),
          explanation: q.explanation,
          analysis: q.analysis
        });

        // 错题本：首次提交时答错必须入库。
        // 原实现漏了这一步，只有「带变体题的重做」路径会写错题本，
        // 导致学生第一次作业做错的题永远不会出现在错题本里。
        if (isCorrect) {
          // 与重做路径保持一致：做对了就不再是错题
          db.prepare('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?')
            .run(req.user.userId, q.id);
        } else {
          writeWrongQuestion({
            userId: req.user.userId, assignmentId: req.params.id, questionId: q.id,
            wrongAnswer: userAnswer, correctAnswer: q.answer, analysis: q.analysis || q.explanation || '',
          });
        }

        if (!isCorrect) {
          // 同上：无变体组的错题（填空题为主）也必须进重做列表，
          // 否则学生没有重做入口、错题永久留在错题本里
          const retryQuestion = pickRetryQuestion(
            q.id, q.variant_group_id ?? null, firstRoundAttemptedIds, assignmentOriginalResolver
          );
          if (retryQuestion) {
            wrongQuestions.push({
              original_question_id: q.id,
              retry_question: retryQuestion
            });
          }
        }
      }
      } // end of else (non-retry)

      // 重做分支统一折算回「作业全部题目」维度：
      // 未重做的题（上次已答对）保持正确，重做的题以本次结果为准。
      if (isRetry) {
        const newlyCorrect = new Set();
        for (const r of results) {
          if (r.is_correct && originalOfRetry[r.question_id] != null) {
            newlyCorrect.add(originalOfRetry[r.question_id]);
          }
        }
        correctCount = Math.max(0, questions.length - retryWrongOriginalCount) + newlyCorrect.size;
      }

      // 分母恒为作业题目总数（原先重做时取 answers.length，可只提交 1 道题刷满分）
      const totalQuestionCount = questions.length;
      if (totalQuestionCount === 0) {
        return res.status(400).json({ error: '该作业没有题目，无法提交' });
      }
      const totalScore = Math.round((correctCount / totalQuestionCount) * 100);

      // 改用与「教师改答案重算」共用的统一公式，保证两处口径一致
      const reward = calcGoldReward(totalScore, totalQuestionCount, results, assignment.max_exp);
      const baseGoldReward = reward.base;
      const comboBonus = reward.combo;
      const perfectBonus = reward.perfect;
      const bestStreak = reward.bestStreak;
      const goldReward = reward.gold;
      const comboLabel = comboBonus > 0
        ? (bestStreak >= 10 ? `🔥 ${bestStreak} 连对！额外 +${comboBonus} 金币`
          : bestStreak >= 5 ? `⚡ ${bestStreak} 连对！额外 +${comboBonus} 金币`
            : `✨ ${bestStreak} 连对！额外 +${comboBonus} 金币`)
        : null;
      const hasWrongQuestions = wrongQuestions.length > 0;

      if (!submissionId) {
        const finalStatus = hasWrongQuestions ? 'retry_available' : 'completed';
        const result = db.prepare(`
          INSERT INTO submissions (assignment_id, user_id, answers, status, total_score, total_max_score, gold_reward, attempt_count, review_status)
          VALUES (?, ?, ?, ?, ?, 100, ?, 1, ?)
        `).run(req.params.id, req.user.userId, JSON.stringify(answers), finalStatus, totalScore, goldReward, finalStatus);

        // 发放金币（走统一管道：累计金币成就与流水一并处理）
        if (goldReward > 0) {
          grantReward(req.user.userId, {
            gold: goldReward,
            source: 'assignment',
            reason: `作业提交: ${assignment.title}`,
          });
        }

        const newSubId = result.lastInsertRowid;
        const insertQA = db.prepare(`
          INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, is_correct, score, max_score, duration_ms, answered_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        for (const r of results) {
          insertQA.run(newSubId, r.question_id, r.user_answer, r.is_correct ? 1 : 0, r.score, 100 / totalQuestionCount, r.duration_ms ?? null);
          upsertPersonalBank({
            userId: req.user.userId, questionId: r.question_id, assignmentId: parseInt(req.params.id),
            assignmentType: assignment.assignment_type, answer: r.user_answer, isCorrect: !!r.is_correct, source: 'online'
          });
        }

        for (const wq of wrongQuestions) {
          const r = results.find(r => r.question_id === wq.original_question_id);
          if (!r) continue;
          const existingWQ = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
            .get(req.user.userId, wq.original_question_id);
          if (existingWQ) {
            db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count + 1, wrong_answer = ?, correct_answer = ?, reviewed = 0 WHERE id = ?')
              .run(r.user_answer || '', r.correct_answer, existingWQ.id);
          } else {
            writeWrongQuestion({
              userId: req.user.userId, assignmentId: req.params.id, questionId: wq.original_question_id,
              wrongAnswer: r.user_answer, correctAnswer: r.correct_answer, analysis: r.analysis,
            });
          }
        }
      } else {
        const retryFinalStatus = wrongQuestions.length > 0 ? 'retry_available' : 'completed';
        // 计算金币差额（本次应得金币 - 上次已得金币）
        const previousGoldReward = db.prepare('SELECT gold_reward FROM submissions WHERE id = ?').get(submissionId)?.gold_reward || 0;
        const goldRewardDiff = goldReward - previousGoldReward;

        db.prepare(`UPDATE submissions SET status = ?, total_score = ?, gold_reward = ?, attempt_count = attempt_count + 1 WHERE id = ?`)
          .run(retryFinalStatus, totalScore, goldReward, submissionId);

        const insertQA = db.prepare(`
          INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, is_correct, score, max_score, duration_ms, answered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        for (const r of results) {
          insertQA.run(submissionId, r.question_id, (existingSubmission?.attempt_count || 0) + 1, r.user_answer, r.is_correct ? 1 : 0, r.score, 100 / totalQuestionCount, r.duration_ms ?? null);
          upsertPersonalBank({
            userId: req.user.userId, questionId: r.question_id, assignmentId: parseInt(req.params.id),
            assignmentType: assignment.assignment_type, answer: r.user_answer, isCorrect: !!r.is_correct, source: 'online'
          });
        }

        // 金币差额双向结算（原先只补发不收回，成绩下滑也能白拿金币）
        if (goldRewardDiff !== 0) {
          grantReward(req.user.userId, {
            gold: goldRewardDiff,
            source: 'assignment_retry',
            reason: `作业重做，金币调整 ${goldRewardDiff > 0 ? '+' : ''}${goldRewardDiff}`,
          });
        }
      }

      // 更新每日任务进度
      try {
        // 完成作业任务
        updateTaskProgress(req.user.userId, 'complete_assignment', 1);
        
        // 正确率达标任务
        if (totalScore >= 80) {
          updateTaskProgress(req.user.userId, 'correct_rate', totalScore);
        }
      } catch (error) {
        console.error('更新每日任务进度失败:', error);
      }

      // 更新知识点统计
      try {
        const today = getChinaDate();
        const insertKnowledgePoint = db.prepare(`
          INSERT OR IGNORE INTO knowledge_point_stats (user_id, knowledge_point, date, total_attempts, correct_attempts, accuracy)
          VALUES (?, ?, ?, 1, ?, ?)
        `);
        const updateKnowledgePoint = db.prepare(`
          UPDATE knowledge_point_stats 
          SET total_attempts = total_attempts + 1,
              correct_attempts = correct_attempts + ?,
              accuracy = ROUND(CAST(correct_attempts + ? AS REAL) / (total_attempts + 1) * 100, 2),
              updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND knowledge_point = ? AND date = ?
        `);
        
        // 从题目中提取知识点（如果有）
        for (const r of results) {
          const question = questions.find(q => q.id === r.question_id);
          if (question && question.knowledge_point) {
            const existing = db.prepare(
              'SELECT id FROM knowledge_point_stats WHERE user_id = ? AND knowledge_point = ? AND date = ?'
            ).get(req.user.userId, question.knowledge_point, today);
            
            if (existing) {
              updateKnowledgePoint.run(r.is_correct ? 1 : 0, r.is_correct ? 1 : 0, req.user.userId, question.knowledge_point, today);
            } else {
              insertKnowledgePoint.run(req.user.userId, question.knowledge_point, today, r.is_correct ? 1 : 0, r.is_correct ? 100 : 0);
            }
          }
        }
      } catch (error) {
        console.error('更新知识点统计失败:', error);
      }

      res.json({
        success: true,
        message: '批改完成',
        results,
        total_score: totalScore,
        total_max_score: 100,
        gold_reward: goldReward,
        base_gold_reward: baseGoldReward,
        combo_bonus: comboBonus,
        combo_streak: bestStreak,
        combo_label: comboLabel,
        perfect_bonus: perfectBonus,
        correct_count: correctCount,
        total_count: totalQuestionCount,
        wrong_count: totalQuestionCount - correctCount,
        wrong_questions: wrongQuestions,
        can_retry: wrongQuestions.length > 0
      });

      // 成就检查
      try {
        const submitCount = db.prepare('SELECT COUNT(DISTINCT assignment_id) as c FROM submissions WHERE user_id = ?').get(req.user.userId)?.c || 0;
        checkAndAwardAchievement(req.user.userId, 'submit_assignment', submitCount);
        if (totalScore >= 90) {
          const highScoreCount = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE user_id = ? AND total_score >= 90").get(req.user.userId)?.c || 0;
          checkAndAwardAchievement(req.user.userId, 'high_score', highScoreCount);
        }
        if (totalScore === 100) {
          const perfectCount = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE user_id = ? AND total_score = 100").get(req.user.userId)?.c || 0;
          checkAndAwardAchievement(req.user.userId, 'perfect_score', perfectCount);
        }
        // 累计金币成就
        const totalGold = db.prepare('SELECT total_gold_earned FROM users WHERE id = ?').get(req.user.userId)?.total_gold_earned || 0;
        checkAndAwardAchievement(req.user.userId, 'total_gold', totalGold);
      } catch (e) { console.error('成就检查失败:', e); }

      // ✨ 向所在班级广播提交事件（教师端实时接收）
      try {
        const io = req.app.get('io');
        if (io && assignment.class_id) {
          io.to(`class:${assignment.class_id}`).emit('assignment-submitted', {
            class_id: assignment.class_id,
            assignment_id: assignment.id,
            assignment_title: assignment.title,
            user_id: req.user.userId,
            username: req.user.username,
            real_name: req.user.real_name,
            total_score: totalScore,
            correct_count: correctCount,
            total_count: questions.length,
            combo_streak: bestStreak,
            at: new Date().toISOString()
          });
        }
      } catch (e) {
        console.error('Socket 广播提交事件失败:', e);
      }

    } else {
      if (existingSubmission) {
        return res.status(400).json({ error: '主观题只能提交一次' });
      }

      /**
       * 混合题型作业（question_type = mixed，或题目类型与作业类型不一致）：
       * 客观题有唯一答案，提交时直接按规则判分写库，**不送 AI**。
       *
       * 改造前整份作业都算「主观题」：10 道选择题 + 2 道作文会发起 12 次 AI 调用，
       * 其中 10 次纯属浪费——又慢又烧额度，而且 AI 判选择题还可能和标准答案不一致。
       * 现在只有真正的主观题才排队等 AI 评阅。
       */
      const objectiveQs = questions.filter((q) => isObjectiveType(q.type));
      const objectiveIds = new Set(objectiveQs.map((q) => q.id));
      // 每题满分：与纯客观题作业保持同一口径（100 / 总题数）
      const perQuestionMax = questions.length > 0 ? 100 / questions.length : 0;
      // 多选题前端可能给数组，直接绑到 SQLite 会崩，统一转成字符串
      const answerToText = (v) => (Array.isArray(v) ? v.join(',') : (v === undefined || v === null ? '' : String(v)));

      const result = db.prepare(`
        INSERT INTO submissions (assignment_id, user_id, answers, attachments, status, total_max_score, review_status)
        VALUES (?, ?, ?, ?, 'submitted', 100, 'pending')
      `).run(req.params.id, req.user.userId, JSON.stringify(answers), JSON.stringify(req.body.attachments || []));

      const newSubId = result.lastInsertRowid;

      // 客观题：判分结果一次写全，reviewed_at 也写上——表示这题已判完、不需要 AI
      const insertGraded = db.prepare(`
        INSERT INTO question_answers
          (submission_id, question_bank_id, attempt_number, student_answer, image_url, is_correct, score, max_score, duration_ms, answered_at, reviewed_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      // 主观题：只落作答内容（含手写照片），等 AI 评阅
      const insertPending = db.prepare(`
        INSERT INTO question_answers
          (submission_id, question_bank_id, attempt_number, student_answer, image_url, duration_ms, answered_at)
        VALUES (?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      for (const ans of answers) {
        const q = objectiveQs.find((x) => x.id === Number(ans.question_id));
        if (!q) {
          insertPending.run(newSubId, ans.question_id, answerToText(ans.answer), ans.image_url || '', durationOf(ans.question_id));
          continue;
        }

        const isCorrect = isAnswerCorrect(q.type, ans.answer, q.answer);
        const userText = answerToText(ans.answer);
        insertGraded.run(
          newSubId, q.id, userText, ans.image_url || '',
          isCorrect ? 1 : 0, isCorrect ? perQuestionMax : 0, perQuestionMax, durationOf(q.id)
        );

        // 错题本口径与纯客观题作业一致：答错记账、答对清账
        if (isCorrect) {
          db.prepare('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?').run(req.user.userId, q.id);
        } else {
          const existingWQ = db.prepare('SELECT id FROM wrong_questions WHERE user_id = ? AND question_id = ?')
            .get(req.user.userId, q.id);
          if (existingWQ) {
            db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count + 1, wrong_answer = ?, correct_answer = ?, reviewed = 0 WHERE id = ?')
              .run(userText, q.answer, existingWQ.id);
          } else {
            writeWrongQuestion({
              userId: req.user.userId, assignmentId: req.params.id, questionId: q.id,
              wrongAnswer: userText, correctAnswer: q.answer, analysis: q.analysis,
            });
          }
        }
      }

      setImmediate(async () => {
        await reviewSubjectiveAssignment(newSubId, req.params.id, req.user.userId);
      });

      res.json({
        success: true,
        message: '已提交，等待AI评阅',
        submission_id: newSubId,
        // 字段集必须和上面的纯客观题分支保持一致。原先这里只回三个字段，
        // 前端结果弹窗读不到 total_max_score，直接渲染成「总分 0/ undefined」，
        // 刷新一次拿到数据库里的 100 才正常。
        // 未评出来的分先按 0 占位，并显式带上 review_status='pending'：
        // 前端靠它区分「还没评完」和「评完是 0 分」，否则会把占位 0
        // 当成真实分数展示给学生。
        results: [],
        review_status: 'pending',
        total_score: 0,
        // 满分口径与上面 INSERT submissions 时写入的 total_max_score 一致
        total_max_score: 100,
        gold_reward: 0,
        correct_count: 0,
        total_count: questions.length,
      });
    }
  } catch (error) {
    console.error('提交作业错误:', error);
    res.status(500).json({ error: '提交作业失败: ' + error.message });
  }
});

/**
 * 主观题评阅入口（薄封装）。
 *
 * 真正的逻辑在 services/subjectiveReview.js：按题独立调 AI、图片进 prompt、
 * 每题完成即写库以便续跑、失败不兜底分。这里只负责接上错题本回调。
 */
async function reviewSubjectiveAssignment(submissionId, assignmentId, userId) {
  try {
    await subjectiveReview.reviewSubmission(submissionId, assignmentId, userId, {
      onWrongQuestion: (info) => writeWrongQuestion(info),
    });
  } catch (error) {
    // 兜底只兜「流程本身崩了」，绝不代替 AI 判分给分。
    // 之前这里会写死 60 分并补发金币，学生交白卷也是 60 分。
    console.error('[主观题评阅]评阅流程异常:', error);
    db.prepare("UPDATE submissions SET review_status = 'pending' WHERE id = ? AND review_status != 'completed'")
      .run(submissionId);
  }
}

router.get('/submissions/:id', authenticateToken, (req, res) => {
  try {
    const submission = db.prepare(`
      SELECT s.*, a.title, a.subject, a.max_exp, a.question_type
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.id = ? AND s.user_id = ?
    `).get(req.params.id, req.user.userId);

    if (!submission) return res.status(404).json({ error: '提交记录不存在' });

    const answers = db.prepare(`
      SELECT qa.*, qb.content as question_content, qb.options, qb.answer as correct_answer, qb.explanation, qb.analysis, qb.type
      FROM question_answers qa
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      WHERE qa.submission_id = ?
      ORDER BY qa.id
    `).all(req.params.id);

    for (const a of answers) {
      if (a.options) {
        try { a.options = JSON.parse(a.options); } catch(e) {}
      }
      if (a.feedback) {
        try { a.feedback = JSON.parse(a.feedback); } catch(e) {}
      }
    }

    res.json({ submission, answers });
  } catch (error) {
    console.error('获取提交详情错误:', error);
    res.status(500).json({ error: '获取提交详情失败' });
  }
});

router.get('/:id/statistics', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    // 归属校验：原先只校验作业存在，任何教师都能查到任意作业的全班成绩与逐题正确率
    if (req.user.role !== 'admin') {
      const isOwner = assignment.teacher_id === req.user.userId;
      const isHeadTeacher = !!db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
      ).get(req.user.userId, assignment.class_id);
      const isMember = isHeadTeacher || !!db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(req.user.userId, assignment.class_id);
      if (!isMember) {
        return res.status(403).json({ error: '无权查看该作业的统计（仅任课教师、班主任或管理员可查看）' });
      }
      // 同班任课老师但非本作业发布者：只允许看自己教过的科目
      if (!isOwner && !isHeadTeacher) {
        const teachesSubject = !!db.prepare(
          `SELECT 1 FROM assignments WHERE teacher_id = ? AND class_id = ? AND subject = ? LIMIT 1`
        ).get(req.user.userId, assignment.class_id, assignment.subject);
        if (!teachesSubject) {
          return res.status(403).json({ error: '无权查看该作业的统计（仅任课教师、班主任或管理员可查看）' });
        }
      }
    }

    const totalStudents = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE class_id = ? AND role = \'student\'').get(assignment.class_id)?.cnt || 0;
    // 按学生去重：重做会产生多条 submission，直接 COUNT 会让提交人数与完成率超过 100%
    const submittedCount = db.prepare(
      'SELECT COUNT(DISTINCT user_id) as cnt FROM submissions WHERE assignment_id = ?'
    ).get(req.params.id)?.cnt || 0;

    // 本作业的全部提交 ID，用于把题目统计限定在本作业范围内
    const submissionIds = db.prepare('SELECT id FROM submissions WHERE assignment_id = ?')
      .all(req.params.id).map(s => s.id);

    const scoreStats = db.prepare(`
      SELECT AVG(total_score) as avg_score, MAX(total_score) as max_score, MIN(total_score) as min_score
      FROM submissions WHERE assignment_id = ? AND total_score IS NOT NULL
    `).get(req.params.id);

    const questions = db.prepare(`
      SELECT aq.question_bank_id, qb.content, qb.type, qb.answer
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);

    // 题目统计：只统计本作业内的作答，且每题只取该提交内最近一次（重做会留下多轮记录）。
    // 原先按 question_bank_id 统计全库作答，重做记录和其他作业的数据都会混进来。
    const questionStats = questions.map(q => {
      const base = {
        question_id: q.question_bank_id,
        content: String(q.content || '').substring(0, 50),
        type: q.type,
        answer: q.answer,
        total_answers: 0,
        correct_count: 0,
        correct_rate: 0,
        avg_score: 0
      };
      if (submissionIds.length === 0) return base;

      const placeholders = submissionIds.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT submission_id, attempt_number, is_correct, score
        FROM question_answers
        WHERE question_bank_id = ? AND submission_id IN (${placeholders})
      `).all(q.question_bank_id, ...submissionIds);

      const latest = new Map();
      for (const r of rows) {
        const prev = latest.get(r.submission_id);
        if (!prev || r.attempt_number > prev.attempt_number) latest.set(r.submission_id, r);
      }
      const counted = [...latest.values()];
      const totalAns = counted.length;
      if (totalAns === 0) return base;

      const correctAns = counted.filter(r => r.is_correct === 1).length;
      const avgScore = counted.reduce((sum, r) => sum + (r.score || 0), 0) / totalAns;

      return {
        ...base,
        total_answers: totalAns,
        correct_count: correctAns,
        correct_rate: Math.round((correctAns / totalAns) * 100),
        avg_score: Math.round(avgScore * 100) / 100
      };
    });

    // 学生成绩：每个学生只保留最新一次提交（按 id 递增取最后一条）
    const allSubmissions = db.prepare(`
      SELECT s.id as submission_id, u.id as user_id, u.username, u.real_name, s.total_score, s.gold_reward, s.submitted_at, s.review_status
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      WHERE s.assignment_id = ?
      ORDER BY s.id ASC
    `).all(req.params.id);
    const latestByUser = new Map();
    for (const row of allSubmissions) latestByUser.set(row.user_id, row);
    const studentResults = [...latestByUser.values()]
      .sort((a, b) => (b.total_score || 0) - (a.total_score || 0));

    res.json({
      assignment_id: parseInt(req.params.id),
      total_students: totalStudents,
      submitted_count: submittedCount,
      completion_rate: totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0,
      average_score: Math.round(scoreStats.avg_score || 0),
      highest_score: scoreStats.max_score || 0,
      lowest_score: scoreStats.min_score || 0,
      question_stats: questionStats,
      student_results: studentResults
    });
  } catch (error) {
    console.error('获取统计错误:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
});

/**
 * 把一位学生的纸质作答登记入库（线上提交与纸质登记同源）。
 * 校验失败时抛出带 message 的 Error，由调用方决定 400 还是逐条收集。
 */
/**
 * 撤销一次纸质登记，为「覆盖登记」做准备。
 *
 * 覆盖不是简单删掉重写——三处副作用必须先回滚，否则会出问题：
 *   1. 金币：原先发的要扣回来。否则老师可以「登记 100 分 → 覆盖 0 分 →
 *      再登记 100 分」反复刷金币。
 *   2. 知识点掌握度：按旧答案逐条减回去，否则统计会随覆盖次数不断膨胀。
 *   3. 通知：旧通知留着会让学生收到两条矛盾的「已登记」消息。
 *
 * 错题本刻意不动：它是累积本，多几道题不影响正确性，
 * 而要精确撤回得记录每道题的来源，反而更容易出错。
 */
function rollbackPaperSubmission({ assignmentId, studentId, submissionId, title }) {
  const oldQas = db.prepare(`
    SELECT qa.question_bank_id, qa.is_correct, qa.answered_at, qb.knowledge_point
    FROM question_answers qa
    JOIN question_bank qb ON qb.id = qa.question_bank_id
    WHERE qa.submission_id = ?
  `).all(submissionId);

  // 1) 回滚知识点统计：按每道题作答当天的日期减回去
  for (const qa of oldQas) {
    if (!qa.knowledge_point) continue;
    const day = getChinaDateOf(qa.answered_at);
    const stat = db.prepare(
      'SELECT id, total_attempts, correct_attempts FROM knowledge_point_stats WHERE user_id = ? AND knowledge_point = ? AND date = ?'
    ).get(studentId, qa.knowledge_point, day);
    if (!stat) continue;
    if (stat.total_attempts <= 1) {
      // 只剩这一次，减完就是 0，直接删掉这行，别留一条 0/0 的脏数据
      db.prepare('DELETE FROM knowledge_point_stats WHERE id = ?').run(stat.id);
      continue;
    }
    const newCorrect = Math.max(0, stat.correct_attempts - (qa.is_correct ? 1 : 0));
    const newTotal = stat.total_attempts - 1;
    db.prepare(
      'UPDATE knowledge_point_stats SET total_attempts = ?, correct_attempts = ?, accuracy = ? WHERE id = ?'
    ).run(newTotal, newCorrect, Math.round((newCorrect / newTotal) * 100 * 100) / 100, stat.id);
  }

  // 2) 扣回金币（grantReward 传负数即扣减；total_gold_earned 是生涯累计，不回退）
  const old = db.prepare('SELECT gold_reward FROM submissions WHERE id = ?').get(submissionId);
  const oldGold = old && Number(old.gold_reward) ? Number(old.gold_reward) : 0;
  if (oldGold > 0) {
    try {
      grantReward(studentId, {
        gold: -oldGold,
        source: 'paper_assignment_overwrite',
        reason: `覆盖登记扣回：${title || '纸质作业'}`,
      });
    } catch (e) {
      console.error('覆盖登记时扣回金币失败:', e.message);
    }
  }

  // 3) 清掉旧答案与旧提交；通知留着，靠新登记那条覆盖语义
  db.prepare('DELETE FROM question_answers WHERE submission_id = ?').run(submissionId);
  db.prepare('DELETE FROM submissions WHERE id = ?').run(submissionId);

  return { rollback_gold: oldGold, rollback_questions: oldQas.length };
}

function registerPaperSubmission({ assignmentId, assignment, studentId, results, note, overwrite = false, operatorId = null, operatorName = '' }) {
  const student = db.prepare('SELECT id, class_id, username, real_name FROM users WHERE id = ?').get(studentId);
  if (!student || student.class_id !== assignment.class_id) {
    throw new Error(`学生 ${student?.real_name || studentId} 不属于此作业的班级`);
  }

  const existing = db.prepare('SELECT id FROM submissions WHERE assignment_id = ? AND user_id = ?').get(assignmentId, studentId);
  let rollbackInfo = null;
  if (existing) {
    if (!overwrite) {
      throw new Error(`${student.real_name || student.username} 已有提交记录（线上或纸质），不能重复登记`);
    }
    // 覆盖：先把上一次登记的副作用回滚干净，再重新登记
    rollbackInfo = rollbackPaperSubmission({
      assignmentId, studentId, submissionId: existing.id, title: assignment.title,
    });
  }

  const questions = db.prepare(`
    SELECT qb.id, qb.type, qb.content, qb.answer, qb.analysis, qb.knowledge_point
    FROM assignment_questions aq
    JOIN question_bank qb ON aq.question_bank_id = qb.id
    WHERE aq.assignment_id = ?
    ORDER BY aq.sort_order
  `).all(assignmentId);
  const qMap = {};
  for (const q of questions) qMap[q.id] = q;

  const perQuestionMax = questions.length > 0 ? 100 / questions.length : 0;
  const rows = [];
  let totalScore = 0;
  for (const r of results) {
    const q = qMap[r.question_id];
    if (!q) continue;
    const isCorrect = r.is_correct ? 1 : 0;
    // 客观题：对=满分错=0分；主观题：允许教师给 0-100 的部分分（折算到本题占比）
    let score = 0;
    if (isCorrect) {
      score = perQuestionMax;
    } else if (typeof r.score === 'number' && r.score > 0) {
      score = Math.max(0, Math.min(1, r.score / 100)) * perQuestionMax;
    }
    totalScore += score;
    rows.push({
      question_id: q.id,
      student_answer: String(r.student_answer || '纸质作答'),
      is_correct: isCorrect,
      score,
    });
  }

  if (rows.length === 0) {
    throw new Error(`${student.real_name || student.username} 没有有效的题目结果`);
  }

  const finalScore = Math.round(totalScore);
  const goldReward = Math.floor((finalScore / 100) * (assignment.max_exp || 30));

  const submitTx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO submissions (assignment_id, user_id, answers, status, total_score, total_max_score, gold_reward, attempt_count, review_status)
      VALUES (?, ?, ?, 'completed', ?, 100, ?, 1, 'graded')
    `).run(
      assignmentId,
      studentId,
      JSON.stringify({ source: 'paper', note: note || '', results }),
      finalScore,
      goldReward
    );
    const submissionId = result.lastInsertRowid;

    if (goldReward > 0) {
      grantReward(studentId, {
        gold: goldReward,
        source: 'paper_assignment',
        reason: `纸质作业: ${assignment.title}`,
      });
    }

    const insertQA = db.prepare(`
      INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, is_correct, score, max_score, answered_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    for (const row of rows) {
      insertQA.run(submissionId, row.question_id, row.student_answer, row.is_correct, row.score, perQuestionMax);
      // 个人题库：纸质作答同样沉淀，source 标记为 paper
      upsertPersonalBank({
        userId: studentId, questionId: row.question_id, assignmentId: parseInt(assignmentId),
        assignmentType: assignment.assignment_type, answer: row.student_answer, isCorrect: !!row.is_correct, source: 'paper'
      });
      // 知识点掌握度：纸质登记与线上提交同源，否则住校生在「学习数据」里看不到任何薄弱知识点
      const qKp = qMap[row.question_id]?.knowledge_point;
      if (qKp) {
        const today = getChinaDate();
        const kpExisting = db.prepare(
          'SELECT id FROM knowledge_point_stats WHERE user_id = ? AND knowledge_point = ? AND date = ?'
        ).get(studentId, qKp, today);
        if (kpExisting) {
          // 已存在：本次作答累加（correct_attempts + is_correct 表示本次是否答对）
          db.prepare(`UPDATE knowledge_point_stats
            SET total_attempts = total_attempts + 1,
                correct_attempts = correct_attempts + ?,
                accuracy = ROUND(CAST(correct_attempts + ? AS REAL) / (total_attempts + 1) * 100, 2)
            WHERE id = ?`)
            .run(row.is_correct, row.is_correct, kpExisting.id);
        } else {
          // 首次：本次作答已计入初始值，不再累加
          db.prepare(`INSERT INTO knowledge_point_stats
            (user_id, knowledge_point, date, total_attempts, correct_attempts, accuracy)
            VALUES (?, ?, ?, 1, ?, ?)`)
            .run(studentId, qKp, today, row.is_correct, row.is_correct ? 100 : 0);
        }
      }
      if (!row.is_correct) {
        const q = qMap[row.question_id];
        writeWrongQuestion({
          userId: studentId, assignmentId, questionId: row.question_id,
          wrongAnswer: row.student_answer, correctAnswer: q.answer, analysis: q.analysis,
        });
      }
    }

    db.prepare(`INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
      VALUES (?, 'paper_graded', ?, ?, 'assignment', ?)`)
      .run(
        studentId,
        rollbackInfo ? '纸质作业成绩已更正' : '纸质作业已登记',
        `作业「${assignment.title}」${rollbackInfo ? '的成绩已被老师更正' : '已由老师登记纸质作答'}，得分 ${finalScore} 分${goldReward > 0 ? `，获得 ${goldReward} 金币` : ''}。`,
        assignmentId
      );

    // 覆盖登记留痕：谁、什么时候、把成绩从多少改成了多少。
    // 成绩是学生权益相关的记录，改动必须可追溯。
    if (rollbackInfo && operatorId) {
      try {
        db.prepare(`INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
          VALUES (?, 'paper_graded', '成绩更正记录', ?, 'assignment', ?)`)
          .run(
            studentId,
            `老师 ${operatorName || ''} 更正了你的纸质作业成绩（${rollbackInfo.rollback_questions} 道题重判）。`,
            assignmentId
          );
      } catch (e) { /* 留痕失败不影响主流程 */ }
      console.log(`[paper-submit] 覆盖登记 assignment=${assignmentId} student=${studentId} by operator=${operatorId} rollbackGold=${rollbackInfo.rollback_gold}`);
    }

    return submissionId;
  });

  const submissionId = submitTx();
  return {
    submission_id: submissionId,
    total_score: finalScore,
    gold_reward: goldReward,
    student_name: student.real_name || student.username,
    overwritten: !!rollbackInfo,
    rollback_gold: rollbackInfo ? rollbackInfo.rollback_gold : 0,
  };
}

/**
 * 校验当前教师有权操作这份作业。
 *
 * 「谁教的课谁评分」——范围与纸质扫描那边保持一致：
 *   - 该班的任课老师（class_teachers里有记录即可，不是只认班主任）
 *   - 这份作业的布置者
 *   - 管理员
 *
 * 这个校验原先是缺的：paper-submit 只查了角色是 teacher，
 * 结果任何老师都能给任意班级的学生登记/改成绩。现在补上。
 */
function requireAssignmentAccess(req, res, next) {
  const assignmentId = parseInt(req.params.id, 10);
  if (!Number.isFinite(assignmentId)) return res.status(400).json({ error: '作业 id 无效' });
  const assignment = db.prepare('SELECT id, class_id, teacher_id FROM assignments WHERE id = ?').get(assignmentId);
  if (!assignment) return res.status(404).json({ error: '作业不存在' });
  if (req.user.role !== 'admin') {
    const teaches = db.prepare('SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?')
      .get(req.user.userId, assignment.class_id);
    if (!teaches && assignment.teacher_id !== req.user.userId) {
      return res.status(403).json({ error: '你不是该班的任课老师，无法登记或更正纸质作业成绩' });
    }
  }
  req.assignmentRow = assignment;
  next();
}

// 教师代登记纸质作业（住校生等无设备场景），数据与线上提交同源
router.post('/:id/paper-submit', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentAccess, (req, res) => {
  try {
    const { student_id, results, note } = req.body;
    if (!student_id || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: '缺少学生或答题结果' });
    }
    // overwrite：老师发现照片拍糊了、追加照片重新识别后要更正成绩。
    // 这是教师端的正常操作（不是学生提交），所以允许覆盖；
    // 但会先回滚上一次登记的金币与知识点统计，避免反复覆盖刷分。
    const overwrite = req.body?.overwrite === true;

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });
    if (assignment.status === 'cancelled') return res.status(400).json({ error: '该作业已被取消' });

    const out = registerPaperSubmission({
      assignmentId: req.params.id, assignment, studentId: student_id, results, note,
      overwrite,
      operatorId: req.user.userId,
      operatorName: req.user.real_name || req.user.username || '',
    });

    res.json({
      message: out.overwritten ? '纸质作答已覆盖更正' : '纸质作答登记成功',
      ...out,
    });
  } catch (error) {
    console.error('纸质作业登记失败:', error);
    const isBusiness = /不属于此作业|已有提交记录|没有有效的题目结果/.test(error.message || '');
    res.status(isBusiness ? 400 : 500).json({ error: error.message || '纸质作业登记失败' });
  }
});

// 批量登记：一次提交多位学生的纸质结果，逐人独立事务，单条失败不影响其他人
router.post('/:id/paper-submit-batch', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { submissions, note } = req.body;
    if (!Array.isArray(submissions) || submissions.length === 0) {
      return res.status(400).json({ error: '没有需要登记的学生' });
    }
    if (submissions.length > 60) {
      return res.status(400).json({ error: '一次最多登记 60 名学生' });
    }

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });
    if (assignment.status === 'cancelled') return res.status(400).json({ error: '该作业已被取消' });

    const succeeded = [];
    const failed = [];
    for (const item of submissions) {
      if (!item?.student_id || !Array.isArray(item.results) || item.results.length === 0) {
        failed.push({ student_id: item?.student_id, reason: '缺少答题结果' });
        continue;
      }
      try {
        const out = registerPaperSubmission({
          assignmentId: req.params.id, assignment, studentId: item.student_id,
          results: item.results, note: item.note || note
        });
        succeeded.push({ student_id: item.student_id, ...out });
      } catch (e) {
        failed.push({ student_id: item.student_id, reason: e.message || '登记失败' });
      }
    }

    res.json({
      message: `登记完成：成功 ${succeeded.length} 人${failed.length > 0 ? `，失败 ${failed.length} 人` : ''}`,
      succeeded,
      failed,
      total_score_avg: succeeded.length
        ? Math.round(succeeded.reduce((s, x) => s + x.total_score, 0) / succeeded.length)
        : 0,
    });
  } catch (error) {
    console.error('批量纸质登记失败:', error);
    res.status(500).json({ error: '批量登记失败: ' + (error.message || '未知错误') });
  }
});

router.get('/wrong/my', authenticateToken, (req, res) => {
  try {
    const { subject } = req.query;
    let query = `
      SELECT wq.*, qb.content as question_content, qb.options, qb.answer as correct_answer, 
      qb.subject, qb.type as question_type, a.title as assignment_title, qb.explanation, qb.analysis,
      qb.knowledge_point, qb.hint, qb.difficulty
      FROM wrong_questions wq
      JOIN question_bank qb ON wq.question_id = qb.id
      LEFT JOIN assignments a ON wq.assignment_id = a.id
      WHERE wq.user_id = ?
    `;
    const params = [req.user.userId];

    if (subject) {
      query += ` AND qb.subject = ?`;
      params.push(subject);
    }

    query += ` ORDER BY wq.id DESC`;

    const wrongQuestions = db.prepare(query).all(...params);
    for (const wq of wrongQuestions) {
      if (wq.options) {
        try { wq.options = JSON.parse(wq.options); } catch(e) {}
      }
    }

    res.json({ wrong_questions: wrongQuestions });
  } catch (error) {
    console.error('获取错题错误:', error);
    res.status(500).json({ error: '获取错题失败' });
  }
});

router.post('/wrong/:id/review', authenticateToken, (req, res) => {
  try {
    const result = db.prepare('UPDATE wrong_questions SET reviewed = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: '错题记录不存在' });
    }
    // 累加今日复习错题任务进度
    try {
      // updateTaskProgress 已在内部累加，这里只传本次增量 1（原先传「旧进度+1」会双倍累加）
      updateTaskProgress(req.user.userId, 'review_weak_point', 1);
    } catch (e) { /* ignore */ }

    // 成就检查
    try {
      const reviewedCount = db.prepare("SELECT COUNT(*) as c FROM wrong_questions WHERE user_id = ? AND reviewed = 1").get(req.user.userId)?.c || 0;
      checkAndAwardAchievement(req.user.userId, 'review_wrong', reviewedCount);
    } catch (e) { console.error('成就检查失败:', e); }

    res.json({ message: '标记复习成功' });
  } catch (error) {
    res.status(500).json({ error: '操作失败' });
  }
});

/**
 * 错题重做：真正做一遍，而不是「标记已复习」
 *
 * 设计取舍：
 *  - question_answers.submission_id 是 NOT NULL 且外键指向 submissions，
 *    而 submissions 又必须挂作业，所以错题重做无法复用作业提交链路。
 *    因此写入独立的 wrong_question_attempts 表，保留完整重做历史
 *    （原先答对即从错题本删除，历史彻底丢失）。
 *  - 客观题自动判分；主观题由学生自评（mode=self_check）。
 *  - 连续 2 次做对自动移出错题本。
 */
router.post('/wrong/retry', authenticateToken, (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '没有需要重做的题目' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: '一次最多重做 50 道题' });
    }

    const hasAttempts = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='wrong_question_attempts'`).get();
    if (!hasAttempts) {
      return res.status(503).json({ error: '错题重做功能未初始化，请联系管理员执行数据库迁移' });
    }

    const results = [];
    const applyTx = db.transaction(() => {
      for (const it of items) {
        const wq = db.prepare('SELECT id, question_id FROM wrong_questions WHERE id = ? AND user_id = ?')
          .get(it.wrong_id, req.user.userId);
        if (!wq) {
          results.push({ wrong_id: it.wrong_id, ok: false, reason: '错题记录不存在' });
          continue;
        }
        const q = db.prepare('SELECT id, type, answer, analysis, explanation, knowledge_point FROM question_bank WHERE id = ?')
          .get(wq.question_id);
        if (!q) {
          results.push({ wrong_id: it.wrong_id, ok: false, reason: '题目已被删除' });
          continue;
        }

        const subjective = q.type === 'essay' || q.type === 'composition';
        // 主观题采用自评；客观题自动判分
        const isCorrect = subjective ? !!it.self_marked_correct : isAnswerCorrect(q.type, it.answer, q.answer);
        const rawDur = parseInt(it.duration_ms);
        const durationMs = Number.isFinite(rawDur) && rawDur >= 500 && rawDur <= 1800000 ? rawDur : null;

        db.prepare(`
          INSERT INTO wrong_question_attempts
            (user_id, wrong_question_id, question_id, answer, is_correct, duration_ms, mode)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(req.user.userId, wq.id, wq.question_id, String(it.answer || ''),
          isCorrect ? 1 : 0, durationMs, subjective ? 'self_check' : 'redo');

        // 知识点掌握度同步更新，保证重做也能反映在「学习数据」里
        if (q.knowledge_point) {
          const today = getChinaDate();
          const ex = db.prepare(
            'SELECT id FROM knowledge_point_stats WHERE user_id = ? AND knowledge_point = ? AND date = ?'
          ).get(req.user.userId, q.knowledge_point, today);
          if (ex) {
            db.prepare(`UPDATE knowledge_point_stats
              SET total_attempts = total_attempts + 1, correct_attempts = correct_attempts + ?,
                  accuracy = ROUND(CAST(correct_attempts + ? AS REAL) / (total_attempts + 1) * 100, 2)
              WHERE id = ?`).run(isCorrect ? 1 : 0, isCorrect ? 1 : 0, ex.id);
          } else {
            db.prepare(`INSERT INTO knowledge_point_stats
              (user_id, knowledge_point, date, total_attempts, correct_attempts, accuracy)
              VALUES (?, ?, ?, 1, ?, ?)`)
              .run(req.user.userId, q.knowledge_point, today, isCorrect ? 1 : 0, isCorrect ? 100 : 0);
          }
        }

        // 个人题库同步
        upsertPersonalBank({
          userId: req.user.userId, questionId: wq.question_id, assignmentId: null,
          assignmentType: null, answer: it.answer, isCorrect, source: 'wrong_retry',
        });

        // 连续做对 2 次 → 移出错题本
        const streak = db.prepare(`
          SELECT COUNT(*) AS c FROM wrong_question_attempts
          WHERE user_id = ? AND question_id = ? AND is_correct = 1
        `).get(req.user.userId, wq.question_id).c;

        let mastered = false;
        if (isCorrect && streak >= 2) {
          db.prepare('DELETE FROM wrong_questions WHERE id = ? AND user_id = ?').run(wq.id, req.user.userId);
          mastered = true;
          try { updateTaskProgress(req.user.userId, 'review_weak_point', 1); } catch (e) { /* ignore */ }
        } else if (isCorrect) {
          db.prepare('UPDATE wrong_questions SET reviewed = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?').run(wq.id);
        } else {
          db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count + 1, wrong_answer = ?, reviewed = 0 WHERE id = ?')
            .run(String(it.answer || ''), wq.id);
        }

        results.push({
          wrong_id: wq.id,
          question_id: wq.question_id,
          ok: true,
          is_correct: !!isCorrect,
          subjective,
          correct_answer: q.answer,
          analysis: q.analysis || q.explanation || '',
          streak,
          mastered,
          message: mastered
            ? '连续答对 2 次，已从错题本移除'
            : isCorrect ? '答对了，再练 1 次即可移出错题本' : '仍然答错，已记录',
        });
      }
    });
    applyTx();

    const okCount = results.filter(r => r.ok && r.is_correct).length;
    res.json({
      results,
      summary: { total: results.length, correct: okCount, mastered: results.filter(r => r.mastered).length },
    });
  } catch (error) {
    console.error('错题重做失败:', error);
    res.status(500).json({ error: '错题重做失败: ' + (error.message || '未知错误') });
  }
});

/** 错题掌握情况：每题重做次数与最近一次结果 */
router.get('/wrong/mastery', authenticateToken, (req, res) => {
  try {
    const hasAttempts = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='wrong_question_attempts'`).get();
    if (!hasAttempts) return res.json({ items: [] });

    const rows = db.prepare(`
      SELECT wq.id AS wrong_id, wq.question_id, qb.subject, qb.knowledge_point, qb.content,
             wq.wrong_count, wq.reviewed,
             (SELECT COUNT(*) FROM wrong_question_attempts a
               WHERE a.user_id = wq.user_id AND a.question_id = wq.question_id AND a.is_correct = 1) AS correct_streak,
             (SELECT COUNT(*) FROM wrong_question_attempts a
               WHERE a.user_id = wq.user_id AND a.question_id = wq.question_id) AS retry_total,
             (SELECT a2.is_correct FROM wrong_question_attempts a2
               WHERE a2.user_id = wq.user_id AND a2.question_id = wq.question_id
               ORDER BY a2.id DESC LIMIT 1) AS last_result
      FROM wrong_questions wq
      JOIN question_bank qb ON qb.id = wq.question_id
      WHERE wq.user_id = ?
      ORDER BY (wq.reviewed = 0) DESC, correct_streak ASC, wq.id DESC
    `).all(req.user.userId);

    res.json({
      items: rows.map(r => ({
        ...r,
        last_result: r.last_result == null ? null : !!r.last_result,
        remaining: Math.max(0, 2 - r.correct_streak),  // 还差几次能移出错题本
      })),
    });
  } catch (error) {
    console.error('获取错题掌握情况失败:', error);
    res.status(500).json({ error: '获取错题掌握情况失败' });
  }
});

// ===== 学生个人题库：保存做过的全部题目（区别于只存错题的错题本）=====

router.get('/personal-bank/my', authenticateToken, (req, res) => {
  try {
    if (!personalBankAvailable()) return res.json({ questions: [], total: 0, available: false });

    const { subject, assignment_type, only_wrong, keyword } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size) || 20));

    let where = `WHERE p.user_id = ?`;
    const params = [req.user.userId];

    if (subject) { where += ` AND p.subject = ?`; params.push(subject); }
    if (assignment_type && ['preview', 'homework', 'review'].includes(assignment_type)) {
      where += ` AND p.assignment_type = ?`; params.push(assignment_type);
    }
    if (only_wrong === '1' || only_wrong === 'true') { where += ` AND p.is_correct = 0`; }
    if (keyword) {
      where += ` AND (qb.content LIKE ? OR qb.knowledge_point LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM personal_question_bank p JOIN question_bank qb ON p.question_id = qb.id ${where}`)
      .get(...params)?.c || 0;

    const rows = db.prepare(`
      SELECT p.id, p.question_id, p.assignment_id, p.assignment_type, p.subject, p.knowledge_point,
        p.first_answer, p.last_answer, p.is_correct, p.attempt_count, p.correct_count, p.source,
        p.created_at, p.updated_at,
        qb.content as question_content, qb.options, qb.answer as correct_answer, qb.type as question_type,
        qb.explanation, qb.analysis, qb.difficulty, qb.hint,
        a.title as assignment_title
      FROM personal_question_bank p
      JOIN question_bank qb ON p.question_id = qb.id
      LEFT JOIN assignments a ON p.assignment_id = a.id
      ${where}
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);

    for (const r of rows) {
      if (r.options) { try { r.options = JSON.parse(r.options); } catch (e) {} }
    }

    res.json({ questions: rows, total, page, page_size: pageSize, available: true });
  } catch (error) {
    console.error('获取个人题库失败:', error);
    res.status(500).json({ error: '获取个人题库失败' });
  }
});

router.get('/personal-bank/stats', authenticateToken, (req, res) => {
  try {
    if (!personalBankAvailable()) {
      return res.json({ available: false, total: 0, correct: 0, wrong: 0, accuracy: 0, by_subject: [], by_type: [] });
    }
    const uid = req.user.userId;

    const base = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct,
        SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as wrong,
        SUM(attempt_count) as attempts
      FROM personal_question_bank WHERE user_id = ?
    `).get(uid);

    const total = base?.total || 0;
    const correct = base?.correct || 0;
    const wrong = base?.wrong || 0;

    const bySubject = db.prepare(`
      SELECT COALESCE(p.subject, '未分类') as subject, COUNT(*) as total,
        SUM(CASE WHEN p.is_correct = 1 THEN 1 ELSE 0 END) as correct
      FROM personal_question_bank p WHERE p.user_id = ?
      GROUP BY COALESCE(p.subject, '未分类') ORDER BY total DESC
    `).all(uid).map(r => ({ ...r, accuracy: r.total > 0 ? Math.round(r.correct / r.total * 100) : 0 }));

    const typeLabel = { preview: '预习', homework: '作业', review: '复习' };
    const byType = db.prepare(`
      SELECT COALESCE(p.assignment_type, 'homework') as assignment_type, COUNT(*) as total,
        SUM(CASE WHEN p.is_correct = 1 THEN 1 ELSE 0 END) as correct
      FROM personal_question_bank p WHERE p.user_id = ?
      GROUP BY COALESCE(p.assignment_type, 'homework')
    `).all(uid).map(r => ({
      assignment_type: r.assignment_type,
      label: typeLabel[r.assignment_type] || r.assignment_type,
      total: r.total,
      correct: r.correct || 0,
      accuracy: r.total > 0 ? Math.round((r.correct || 0) / r.total * 100) : 0
    }));

    res.json({
      available: true,
      total, correct, wrong,
      attempts: base?.attempts || 0,
      accuracy: total > 0 ? Math.round(correct / total * 100) : 0,
      by_subject: bySubject,
      by_type: byType,
    });
  } catch (error) {
    console.error('获取个人题库统计失败:', error);
    res.status(500).json({ error: '获取个人题库统计失败' });
  }
});

router.delete('/personal-bank/:id', authenticateToken, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM personal_question_bank WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: '记录不存在' });
    res.json({ message: '已从个人题库移除' });
  } catch (error) {
    res.status(500).json({ error: '操作失败' });
  }
});

// ===== 学情分组统计：按预习/作业/复习维度汇总班级完成情况 =====

router.get('/stats/type-summary', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { class_id, subject, date_from, date_to } = req.query;

    let classFilter = '';
    const params = [];
    if (class_id) {
      // 越权防护：原先直接按class_id 过滤，教师只要手动传任意班 id 就能拿到别班的学情。
      // 这里先校验该班确实属于当前教师（管理员直通）。
      const targetClass = parseInt(class_id, 10);
      if (req.user.role !== 'admin') {
        const owns = db.prepare(
          `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
        ).get(req.user.userId, targetClass);
        if (!owns) return res.status(403).json({ error: '无权查看该班级的学情统计' });
      }
      classFilter = ` AND a.class_id = ?`;
      params.push(targetClass);
    } else if (req.user.role === 'teacher') {
      const owned = db.prepare('SELECT class_id FROM class_teachers WHERE teacher_id = ?').all(req.user.userId).map(r => r.class_id);
      if (owned.length === 0) return res.json({ summary: [], ranges: [] });
      classFilter = ` AND a.class_id IN (${owned.map(() => '?').join(',')})`;
      params.push(...owned);
    }
    if (subject) { classFilter += ` AND a.subject = ?`; params.push(subject); }
    if (date_from) { classFilter += ` AND DATE(a.created_at, '+8 hours') >= ?`; params.push(date_from); }
    if (date_to) { classFilter += ` AND DATE(a.created_at, '+8 hours') <= ?`; params.push(date_to); }

    const rows = db.prepare(`
      SELECT a.id, a.assignment_type, a.subject, a.class_id, a.max_exp,
        DATE(a.created_at, '+8 hours') AS cn_date,
        (SELECT COUNT(*) FROM users u WHERE u.class_id = a.class_id AND u.role = 'student' AND u.status = 'active') as total_students,
        (SELECT COUNT(DISTINCT user_id) FROM submissions s WHERE s.assignment_id = a.id) as submitted_count,
        (SELECT AVG(total_score) FROM (
            SELECT user_id, MAX(total_score) as total_score FROM submissions
            WHERE assignment_id = a.id GROUP BY user_id
         )) as avg_score
      FROM assignments a
      WHERE a.status != 'cancelled' ${classFilter}
    `).all(...params);

    const { getChinaDate, getChinaYesterday, getChinaDateDaysAgo } = require('../config/timezone');
    const today = getChinaDate();
    const yesterday = getChinaYesterday();

    const labelOf = { preview: '预习', homework: '作业', review: '复习' };
    const typeKeys = ['preview', 'homework', 'review'];

    /** 把一批作业行按「预习/作业/复习」聚合 */
    const aggregate = (list) => {
      const acc = {};
      for (const key of typeKeys) {
        acc[key] = { assignment_type: key, label: labelOf[key], assignment_count: 0, total_students: 0, submitted_count: 0, score_sum: 0, score_count: 0 };
      }
      for (const r of list) {
        const key = acc[r.assignment_type] ? r.assignment_type : 'homework';
        const g = acc[key];
        g.assignment_count += 1;
        g.total_students += r.total_students || 0;
        g.submitted_count += r.submitted_count || 0;
        if (r.avg_score != null) { g.score_sum += r.avg_score; g.score_count += 1; }
      }
      const byType = typeKeys.map((k) => {
        const g = acc[k];
        return {
          assignment_type: k,
          label: g.label,
          assignment_count: g.assignment_count,
          submitted_count: g.submitted_count,
          completion_rate: g.total_students > 0 ? Math.round(g.submitted_count / g.total_students * 100) : 0,
          average_score: g.score_count > 0 ? Math.round(g.score_sum / g.score_count) : 0,
        };
      });
      const totalCount = byType.reduce((s, t) => s + t.assignment_count, 0);
      const submittedSum = byType.reduce((s, t) => s + t.submitted_count, 0);
      // 整体完成率：人次口径（与每份作业的完成率口径一致，不用百分比再求平均）
      const totalStudentsAll = list.reduce((s, r) => s + (r.total_students || 0), 0);
      const scored = list.filter((r) => r.avg_score != null);
      const avgScore = scored.length > 0
        ? Math.round(scored.reduce((s, r) => s + r.avg_score, 0) / scored.length)
        : 0;
      return {
        total_count: totalCount,
        submitted_count: submittedSum,
        completion_rate: totalStudentsAll > 0 ? Math.round(submittedSum / totalStudentsAll * 100) : 0,
        average_score: avgScore,
        by_type: byType,
      };
    };

    // ===== 时间维度卡片 =====
    // 「近 7 天 / 近 30 天」按北京时间自然日计算（含今天），
    // 而不是自然周或自然月 —— 教师心智里「最近一周」就是这 7 天，
    // 用自然周边界反而会让人以为漏掉了上周五布置的作业。
    const inRange = (list, fromDate, toDate) => list.filter((r) => r.cn_date >= fromDate && r.cn_date <= toDate);

    const todayList = inRange(rows, today, today);
    const yesterdayList = inRange(rows, yesterday, yesterday);
    const last7List = inRange(rows, getChinaDateDaysAgo(6), today);
    const last30List = inRange(rows, getChinaDateDaysAgo(29), today);

    // 今日没布置作业时回退显示昨日，避免卡片空着让人以为系统坏了
    const todayEffective = todayList.length > 0 ? todayList : yesterdayList;
    const todayFallback = todayList.length === 0 && yesterdayList.length > 0;

    const ranges = [
      { key: 'today', label: todayFallback ? '昨日' : '今日', hint: todayFallback ? '今日暂无作业，显示昨日' : '北京时间今日', fallback: todayFallback, ...aggregate(todayEffective) },
      { key: '7d', label: '近 7 天', hint: '含今天在内的最近 7 个自然日', fallback: false, ...aggregate(last7List) },
      { key: '30d', label: '近 30 天', hint: '含今天在内的最近 30 个自然日', fallback: false, ...aggregate(last30List) },
    ];

    // summary 保持原语义（全量按类型），供需要自定义筛选的场景使用
    const summary = aggregate(rows).by_type;

    res.json({ summary, ranges, today: getChinaDate() });
  } catch (error) {
    console.error('学情分组统计失败:', error);
    res.status(500).json({ error: '获取学情分组统计失败' });
  }
});

router.post('/upload/image', authenticateToken, paperUpOff, uploadAnswerImages, (req, res) => {
  try {
    const file = (req.files && req.files.file && req.files.file[0]) || null;
    const thumb = (req.files && req.files.thumb && req.files.thumb[0]) || null;
    if (!file) {
      // 只收到缩略图说明调用方有问题，别把没主的文件留在磁盘上
      if (thumb) { try { fs.unlinkSync(thumb.path); } catch (e) { /* ignore */ } }
      return res.status(400).json({ error: '请选择要上传的图片' });
    }

    const result = db.prepare(`
      INSERT INTO upload_files (user_id, original_name, stored_name, file_path, file_size, mime_type, upload_type, thumb_path, thumb_size)
      VALUES (?, ?, ?, ?, ?, ?, 'assignment', ?, ?)
    `).run(
      req.user.userId, file.originalname, file.filename, `/uploads/${file.filename}`, file.size, file.mimetype,
      thumb ? `/uploads/${thumb.filename}` : '', thumb ? thumb.size : 0
    );

    res.json({
      url: `/uploads/${file.filename}`,
      // 没有缩略图就回退原图：前端不必自己判断该用哪个
      thumb_url: thumb ? `/uploads/${thumb.filename}` : `/uploads/${file.filename}`,
      file_id: result.lastInsertRowid,
      original_name: file.originalname
    });
  } catch (error) {
    console.error('上传错误:', error);
    res.status(500).json({ error: '上传失败: ' + error.message });
  }
});

router.patch('/:id/cancel', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });
    if (assignment.status === 'cancelled') return res.status(400).json({ error: '作业已取消' });

    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.userId) {
      return res.status(403).json({ error: '只能取消自己发布的作业' });
    }

    db.prepare("UPDATE assignments SET status = 'cancelled' WHERE id = ?").run(req.params.id);

    res.json({ message: '作业已取消，已提交的成绩保留，未提交的学生将无法继续作答' });
  } catch (error) {
    console.error('取消作业错误:', error);
    res.status(500).json({ error: '取消作业失败' });
  }
});

module.exports = router;
