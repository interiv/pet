const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { checkLevelUp } = require('./pets');
const { grantReward } = require('../services/rewards');
const { updateTaskProgress } = require('./daily-tasks');
const { checkAndAwardAchievement } = require('./achievements');
const { getChinaDate } = require('../config/timezone');
const { getPrompt, fillTemplate } = require('../config/prompts');
const { isAnswerCorrect } = require('../utils/answerCheck');
const { collectQuestions } = require('../services/aiQuestion');
const { beginUsage, settleUsage, countBilledUsage, markFailed, countReferencedQuestions, deleteUnusedQuestions } = require('../services/aiUsage');
const axios = require('axios');
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

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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

function getAIConfig() {
  const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();  const config = {};
  settings.forEach(s => config[s.key] = s.value);
  // fallback 到环境变量（数据库未配置时使用）
  if (!config.ai_api_key && process.env.AI_API_KEY) config.ai_api_key = process.env.AI_API_KEY;
  if (!config.ai_base_url && process.env.AI_BASE_URL) config.ai_base_url = process.env.AI_BASE_URL;
  if (!config.ai_model && process.env.AI_MODEL) config.ai_model = process.env.AI_MODEL;
  return config;
}

function isObjectiveType(type) {
  return ['choice_single', 'choice_multi', 'judgment', 'fill_blank'].includes(type);
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

router.post('/generate', authenticateToken, authorizeRole('teacher', 'admin'), async (req, res) => {
  // 额度记录句柄提升到函数作用域：流程失败时要在 catch 里把它退还
  let usageId = 0;
  let usageStartedAt = 0;
  try {
    // token_usage 表由 004 号迁移创建，不再在请求时动态建表
    const { subject, topic, difficulty = 'medium', question_type, count = 10, grade_level = '', mode = 'topic', requirements = '', raw_text = '' } = req.body;
    
    console.log('\n========== AI 生成作业请求 ==========');
    console.log('📥 请求参数:', JSON.stringify({ mode, subject, topic, difficulty, question_type, count, grade_level, requirements_len: String(requirements || '').length, raw_text_len: String(raw_text || '').length }, null, 2));
    console.log('👤 用户ID:', req.user.userId, '| 角色:', req.user.role);
    
    // 生成模式：topic=按知识点主题(原有) | requirements=按教师详细要求 | paste=粘贴题目AI整理
    const genMode = ['topic', 'requirements', 'paste'].includes(mode) ? mode : 'topic';
    const isPasteMode = genMode === 'paste';
    const isRequirementsMode = genMode === 'requirements';
    const noVariants = isPasteMode || !isObjectiveType(question_type);

    if (!subject || !question_type) {
      console.log('❌ 参数验证失败');
      return res.status(400).json({ error: '请填写科目和题型' });
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

    const maxQuestionsPerGen = getSystemSetting('max_questions_per_generation', 20);
    if (count > maxQuestionsPerGen) {
      return res.status(400).json({ error: `单次最多生成 ${maxQuestionsPerGen} 道题目` });
    }

    // 提前挡掉没有对应提示词模板的题型，避免带着空 prompt 去打 LLM 还白扣一次额度
    if (!GEN_PROMPT_KEYS[question_type]) {
      return res.status(400).json({ error: `暂不支持生成该题型（${question_type}）` });
    }

    const { getChinaDate } = require('../config/timezone');
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

    const typeLabel = typeLabels[question_type] || question_type;
    const actualCount = count * 3;

    const effectiveTopic = topic || (isRequirementsMode ? String(requirements).trim().slice(0, 30) : `${subject}${typeLabel}练习`);

    const taskDesc = fillTemplate(
      getPrompt(isRequirementsMode ? 'gen_task_requirements' : 'gen_task_topic'),
      { grade_level, effectiveTopic, subject, typeLabel, difficulty, requirements }
    );

    // 每组变体数：客观题 3 道一组（学生做错时给相似新题），主观题/粘贴整理不做变体
    const VARIANT_STEP = noVariants ? 1 : 3;
    // 目标题量（含变体）。粘贴整理模式由素材决定，传 0 表示不限制。
    const targetCount = isPasteMode ? 0 : count * VARIANT_STEP;

    let pasteVars = null;
    let pasteKey = '';
    if (isPasteMode) {
      let formatSample = '';
      let typeRules = '';
      if (question_type === 'choice_single') {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目内容","options":["选项A内容","选项B内容","选项C内容","选项D内容"],"answer":"A","explanation":"详细解析","analysis":"解题步骤/思路","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer为单个正确选项字母（如"A"）；若原题缺少选项，请根据题意补全A/B/C/D四个选项；若选项数量不足四个，保持原有选项数量即可';
      } else if (question_type === 'choice_multi') {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目内容","options":["选项A内容","选项B内容","选项C内容","选项D内容"],"answer":["A","C"],"explanation":"详细解析","analysis":"解题步骤","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer必须是由正确选项字母组成的数组（如["A","C"]）；若原题缺少选项，请根据题意补全选项';
      } else if (question_type === 'judgment') {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"判断题陈述内容","answer":true,"explanation":"为什么对或错的解析","analysis":"判断依据","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer必须是布尔值true或false，判断题不需要options字段';
      } else if (question_type === 'fill_blank') {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"含空位的题目（用______表示要填的部分）","answer":"应填入的内容","explanation":"详细解析","analysis":"解题步骤","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer是填入空位的内容字符串（多个空用英文逗号分隔），填空题不需要options字段';
      } else {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目要求","answer":"参考答案要点","explanation":"评分标准和解析","analysis":"答题思路指导","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer为参考答案要点，主观题不需要options字段';
      }
      pasteVars = { subject, typeLabel, question_type, raw_text, formatSample, typeRules };
      pasteKey = PASTE_PROMPT_KEYS[question_type] || 'gen_paste_essay';
    }

    /**
     * 按本轮实际要生成的题量拼提示词。
     * 「一次性要 30 道题」是判断题/多选题失败的主因——输出量过大会被模型
     * 自身的长度上限截断。现在改成多轮：先要满量，拿不全就自动接着补齐。
     */
    const buildPrompt = (ask, note) => {
      let base;
      if (isPasteMode) {
        base = fillTemplate(getPrompt(pasteKey), pasteVars);
      } else {
        const key = GEN_PROMPT_KEYS[question_type];
        const want = ask || targetCount || actualCount;
        base = fillTemplate(getPrompt(key), {
          taskDesc,
          actualCount: want,
          count: Math.max(1, Math.round(want / VARIANT_STEP)),
        });
      }
      return note ? `${base}\n\n${note}` : base;
    };

    console.log('\n📤 发送请求到 LLM 服务器...');
    console.log('🎯 目标地址:', `${config.ai_base_url}/chat/completions`);
    console.log('🤖 使用模型:', config.ai_model);
    console.log('📝 首轮 Prompt 长度:', buildPrompt(targetCount || 0, '').length, '字符');
    console.log('⏱️ 超时设置:', timeoutMs / 1000, '秒');
    
    const maxTokensPerGen = getSystemSetting('max_tokens_per_generation', 18000);

    usageStartedAt = Date.now();

    // 先领取一次额度。后续只要没走到 res.json()，就一定会在 settle 时把它退还，
    // 因此「AI 失败/解析失败/返回空题」都不会再占用每日生成次数。
    usageId = beginUsage(req.user.userId, today, {
      model: config.ai_model,
      subject,
      topic: effectiveTopic,
      question_type,
      count,
    });
    const usageTokens = { prompt: 0, completion: 0, total: 0 };

    const maxRounds = Math.max(1, getSystemSetting('ai_gen_max_rounds', 3));

    const genResult = await collectQuestions({
      config,
      timeoutMs,
      maxTokens: maxTokensPerGen,
      type: question_type,
      target: targetCount,
      variants: VARIANT_STEP,
      maxRounds,
      buildPrompt,
      onTokens: (u) => {
        usageTokens.prompt += u.prompt_tokens || 0;
        usageTokens.completion += u.completion_tokens || 0;
        usageTokens.total += u.total_tokens || 0;
      },
      logger: (m) => console.log(m),
    });

    const elapsed = ((Date.now() - usageStartedAt) / 1000).toFixed(2);
    console.log('\n⏱️ 总耗时:', elapsed, '秒 | 请求轮次:', genResult.rounds.length);
    console.log('📊 Token 使用: prompt=' + usageTokens.prompt + ', completion=' + usageTokens.completion + ', total=' + usageTokens.total);

    if (usageTokens.completion > 0) {
      const updatedGlobalTokens = db.prepare(`SELECT COALESCE(SUM(completion_tokens), 0) as total FROM token_usage WHERE date = ?`).get(today)?.total || 0;
      if (updatedGlobalTokens > dailyGlobalTokenLimit) {
        console.log('⚠️ 生成完成后，全局Token已超限，本次结果仍返回，但后续生成将被阻止');
      }
    }

    const questions = genResult.questions;
    const parsed = genResult.lastPack || {};

    console.log('\n📊 最终结果:');
    console.log('  - 有效题目数量:', questions.length, '/ 目标', targetCount || '由素材决定');
    if (questions.length > 0) {
      console.log('  - 第一题预览:', questions[0].content?.slice(0, 50) + '...');
      console.log('  - 知识点分布:', [...new Set(questions.map(q => q.knowledge_point).filter(Boolean))].slice(0, 5).join(', '));
    }
    if (genResult.invalid.length > 0) {
      console.log(`  - 已剔除不合格题目 ${genResult.invalid.length} 道:`);
      genResult.invalid.slice(0, 5).forEach((x) => console.log(`      · ${x.content} → ${x.reason}`));
    }

    if (questions.length === 0) {
      console.log('❌ AI未能生成有效题目，本次额度已退还');
      settleUsage(usageId, 'failed', { ...usageTokens, duration: Date.now() - usageStartedAt });
      const detail = genResult.lastError ? `：${genResult.lastError}` : '';
      return res.status(500).json({
        error: `AI 生成失败${detail}，本次未消耗生成次数，请稍后重试`,
        quota_refunded: true,
      });
    }

    const maxGroupId = db.prepare('SELECT MAX(variant_group_id) as max_id FROM question_bank').get();
    let variantGroupId = (maxGroupId?.max_id || 0) + 1;
    const processedQuestions = [];

    for (let i = 0; i < questions.length; i++) {
      // 题目已在上游完成校验与答案归一化：answer 一定是与题型匹配的字符串
      const q = questions[i];
      const answerStr = String(q.answer ?? '');

      processedQuestions.push({
        subject,
        topic: effectiveTopic,
        difficulty,
        type: question_type,
        content: q.content,
        options: q.options ? JSON.stringify(q.options) : null,
        answer: answerStr,
        explanation: q.explanation || '',
        analysis: q.analysis || '',
        hint: q.hint || '',
        knowledge_point: (q.knowledge_point && String(q.knowledge_point).trim()) || effectiveTopic,
        variant_group_id: noVariants ? null : variantGroupId,
        variant_index: noVariants ? 0 : (i % VARIANT_STEP),
        source: 'ai',
        created_by: req.user.userId
      });

      if (!noVariants && (i + 1) % VARIANT_STEP === 0) {
        variantGroupId++;
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

    const toDisplay = (idx) => ({
      tempId: insertedIds[idx],
      content: questions[idx].content,
      options: questions[idx].options ? (typeof questions[idx].options === 'string' ? JSON.parse(questions[idx].options) : questions[idx].options) : null,
      answer: questions[idx].answer !== undefined ? (Array.isArray(questions[idx].answer) ? questions[idx].answer.join(',') : String(questions[idx].answer)) : '',
      explanation: questions[idx].explanation || '',
      type: question_type,
      knowledge_point: processedQuestions[idx]?.knowledge_point || effectiveTopic
    });

    const displayQuestions = [];

    if (noVariants) {
      insertedIds.forEach((_id, idx) => {
        displayQuestions.push({ ...toDisplay(idx), hasVariants: false });
      });
    } else {
      // 多轮补齐后实际题量可能少于目标数量，这里按真实生成的组数组织变体，避免下标越界
      const availableGroups = Math.min(count, Math.floor(insertedIds.length / VARIANT_STEP));
      if (availableGroups === 0) {
        // 连一组变体都没凑齐，退化成普通列表展示，别把已经生成的题白白丢掉
        insertedIds.forEach((_id, idx) => {
          displayQuestions.push({ ...toDisplay(idx), hasVariants: false });
        });
      }
      for (let g = 0; g < availableGroups; g++) {
        const baseIdx = g * VARIANT_STEP;
        const groupIds = [];
        const variants = [];
        for (let v = 0; v < VARIANT_STEP; v++) {
          const vIdx = baseIdx + v;
          if (vIdx >= insertedIds.length) break;
          groupIds.push(insertedIds[vIdx]);
          if (v > 0) variants.push(toDisplay(vIdx));
        }
        displayQuestions.push({ ...toDisplay(baseIdx), variantIds: groupIds, hasVariants: true, variants });
      }
    }

    console.log('\n📤 返回结果给客户端...');
    console.log('========================================\n');

    settleUsage(usageId, 'ok', {
      ...usageTokens,
      question_count: insertedIds.length,
      duration: Date.now() - usageStartedAt
    });

    const resultCount = noVariants ? questions.length : displayQuestions.length;
    // 多轮补齐后仍没凑够目标题量时告知前端，界面可以提示「本次只生成了 N 道，可再点一次继续补齐」
    const shortfall = noVariants ? 0 : Math.max(0, count - displayQuestions.length);

    res.json({
      message: '生成成功',
      title: parsed.title || `${effectiveTopic} - ${typeLabel}练习`,
      description: parsed.description || `共${resultCount}道${effectiveTopic}相关${typeLabel}`,
      subject,
      question_type,
      question_count: resultCount,
      requested_count: noVariants ? questions.length : count,
      shortfall,
      rejected_count: genResult.invalid.length,
      total_generated: insertedIds.length,
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
        if (!headTeacherClassIds.includes(parseInt(class_id))) {
          sql += ` AND a.teacher_id = ?`;
          params.push(req.user.userId);
        }
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
        req.user.userId, req.user.userId, req.user.userId, req.user.userId,
        req.user.userId, req.user.userId, req.user.userId,
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

    const wrongAnswers = db.prepare(`
      SELECT COALESCE(qb.variant_group_id, -qb.id) as group_key, qb.variant_group_id, MAX(qa.question_bank_id) as question_bank_id
      FROM question_answers qa
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      WHERE qa.submission_id = ? AND qa.is_correct = 0
      GROUP BY group_key
    `).all(submission.id);

    const retryQuestions = [];
    for (const wa of wrongAnswers) {
      if (wa.variant_group_id) {
        const variants = db.prepare(`
          SELECT id, type, content, options, answer, explanation, analysis, variant_index, difficulty, knowledge_point, subject, topic
          FROM question_bank WHERE variant_group_id = ? ORDER BY variant_index
        `).all(wa.variant_group_id);

        const attemptedIds = db.prepare(`
          SELECT DISTINCT question_bank_id FROM question_answers WHERE submission_id = ?
        `).all(submission.id).map(r => r.question_bank_id);

        const unusedVariants = variants.filter(v => !attemptedIds.includes(v.id));
        const retryQuestion = unusedVariants.length > 0 ? unusedVariants[0] : variants[0];

        if (retryQuestion) {
          if (retryQuestion.options) {
            try { retryQuestion.options = JSON.parse(retryQuestion.options); } catch(e) {}
          }
          retryQuestion.original_question_id = wa.question_bank_id;
          retryQuestions.push(retryQuestion);
        }
      } else {
        const q = db.prepare(`
          SELECT id, type, content, options, answer, explanation, analysis, difficulty, knowledge_point, subject, topic
          FROM question_bank WHERE id = ?
        `).get(wa.question_bank_id);
        if (q) {
          if (q.options) {
            try { q.options = JSON.parse(q.options); } catch(e) {}
          }
          q.original_question_id = wa.question_bank_id;
          retryQuestions.push(q);
        }
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

        // 必须覆盖全部错题，否则可只挑会做的题提交来刷高分
        const coveredOriginals = new Set();
        for (const id of submittedIds) {
          const row = attemptRows.find(r => r.question_bank_id === id);
          const grp = row ? row.variant_group_id : questions.find(q => q.id === id)?.variant_group_id;
          const oid = resolveOriginalId(id, grp);
          if (oid != null) coveredOriginals.add(oid);
        }
        if ([...wrongOriginalIds].some(oid => !coveredOriginals.has(oid))) {
          return res.status(400).json({ error: '请完成全部错题的重做后再提交' });
        }

        const retryQuestionIds = submittedIds;
        const retryQuestions = db.prepare(`
            SELECT id, type, content, options, answer, explanation, analysis, variant_group_id, knowledge_point
            FROM question_bank WHERE id IN (${retryQuestionIds.map(() => '?').join(',')})
          `).all(...retryQuestionIds);

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

          if (!isCorrect && q.variant_group_id) {
            const variants = db.prepare(`
              SELECT id, type, content, options, answer, explanation, analysis, variant_index
              FROM question_bank WHERE variant_group_id = ? ORDER BY variant_index
            `).all(q.variant_group_id);

            const attemptedIds = db.prepare(`
              SELECT DISTINCT question_bank_id FROM question_answers WHERE submission_id = ?
            `).all(submissionId).map(r => r.question_bank_id);
            attemptedIds.push(q.id);

            const unusedVariants = variants.filter(v => !attemptedIds.includes(v.id));
            const retryQuestion = unusedVariants.length > 0 ? unusedVariants[0] : variants[0];

            if (retryQuestion) {
              if (retryQuestion.options) {
                try { retryQuestion.options = JSON.parse(retryQuestion.options); } catch(e) {}
              }
              wrongQuestions.push({
                original_question_id: q.id,
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

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const userAnswer = answers.find(a => a.question_id === q.id)?.answer;
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

        if (!isCorrect && q.variant_group_id) {
          const variants = db.prepare(`
            SELECT id, type, content, options, answer, explanation, analysis, variant_index
            FROM question_bank WHERE variant_group_id = ? ORDER BY variant_index
          `).all(q.variant_group_id);

          const unusedVariants = variants.filter(v => v.id !== q.id);
          const retryQuestion = unusedVariants.length > 0 ? unusedVariants[0] : variants[0];

          if (retryQuestion) {
            if (retryQuestion.options) {
              try { retryQuestion.options = JSON.parse(retryQuestion.options); } catch(e) {}
            }
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

      const result = db.prepare(`
        INSERT INTO submissions (assignment_id, user_id, answers, attachments, status, total_max_score, review_status)
        VALUES (?, ?, ?, ?, 'submitted', 100, 'pending')
      `).run(req.params.id, req.user.userId, JSON.stringify(answers), JSON.stringify(req.body.attachments || []));

      const newSubId = result.lastInsertRowid;

      const insertQA = db.prepare(`
        INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, image_url, answered_at)
        VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
      `);
      for (const ans of answers) {
        insertQA.run(newSubId, ans.question_id, ans.answer || '', ans.image_url || '');
      }

      setImmediate(async () => {
        await reviewSubjectiveAssignment(newSubId, req.params.id, req.user.userId);
      });

      res.json({
        success: true,
        message: '已提交，等待AI评阅',
        submission_id: newSubId
      });
    }
  } catch (error) {
    console.error('提交作业错误:', error);
    res.status(500).json({ error: '提交作业失败: ' + error.message });
  }
});

async function reviewSubjectiveAssignment(submissionId, assignmentId, userId) {
  try {
    const submission = db.prepare(`
      SELECT s.*, a.max_exp, a.subject
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.id = ?
    `).get(submissionId);

    if (!submission || submission.review_status !== 'pending') return;

    db.prepare("UPDATE submissions SET review_status = 'reviewing' WHERE id = ?").run(submissionId);

    const questionAnswers = db.prepare(`
      SELECT qa.id, qa.question_bank_id, qa.student_answer, qa.image_url,
      qb.content as question_content, qb.answer as reference_answer, qb.explanation, qb.analysis
      FROM question_answers qa
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      WHERE qa.submission_id = ?
    `).all(submissionId);

    const config = getAIConfig();
    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
    let totalScore = 0;
    const feedbackList = [];

    if (config.ai_api_key && config.ai_base_url && config.ai_model) {
      for (const qa of questionAnswers) {
        const reviewPrompt = fillTemplate(getPrompt('review_subjective'), {
          subject: submission.subject,
          question_content: qa.question_content,
          reference_answer: qa.reference_answer || '无',
          student_answer: qa.student_answer || '(未提供文字答案)'
        });

        try {
          const resp = await axios.post(`${config.ai_base_url}/chat/completions`, {
            model: config.ai_model,
            messages: [{ role: 'user', content: reviewPrompt }]
          }, {
            headers: { 'Authorization': `Bearer ${config.ai_api_key}`, 'Content-Type': 'application/json' },
            timeout: timeoutMs
          });

          const aiContent = resp.data.choices[0].message.content;
          let aiResult;
          try {
            aiResult = JSON.parse(aiContent);
          } catch (parseErr) {
            // 尝试提取JSON对象
            const jsonMatch = aiContent.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
            if (jsonMatch) {
              aiResult = JSON.parse(jsonMatch[0]);
            } else {
              throw new Error('AI返回格式错误');
            }
          }
          const score = Math.max(0, Math.min(100, aiResult.score || 60));
          totalScore += score;

          // 构建完整的反馈信息
          const feedbackData = {
            score: score,
            feedback: aiResult.feedback || '已评阅',
            key_points: aiResult.key_points || [],
            improvements: aiResult.improvements || []
          };

          db.prepare(`
            UPDATE question_answers SET score = ?, max_score = 100, feedback = ?, reviewed_at = CURRENT_TIMESTAMP, is_correct = ? WHERE id = ?
          `).run(score, JSON.stringify(feedbackData), score >= 60 ? 1 : 0, qa.id);

          feedbackList.push({
            question_id: qa.question_bank_id,
            score,
            feedback: aiResult.feedback || '已评阅',
            is_correct: score >= 60
          });
        } catch (e) {
          totalScore += 60;
          db.prepare(`UPDATE question_answers SET score = 60, max_score = 100, feedback = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(JSON.stringify({ feedback: '自动评分', suggestions: ['继续努力'] }), qa.id);
        }
      }
    } else {
      totalScore = questionAnswers.length * 60;
      for (const qa of questionAnswers) {
        db.prepare(`UPDATE question_answers SET score = 60, max_score = 100, feedback = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(JSON.stringify({ feedback: '默认评分' }), qa.id);
      }
    }

    const avgScore = questionAnswers.length > 0 ? Math.round(totalScore / questionAnswers.length) : 0;
    const goldReward = Math.floor((avgScore / 100) * (submission.max_exp || 30));

    db.prepare(`
      UPDATE submissions SET total_score = ?, gold_reward = ?, review_status = 'completed', graded_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(avgScore, goldReward, submissionId);

    grantReward(userId, {
      gold: goldReward,
      source: 'assignment_subjective',
      reason: `主观题作业评阅: ${submission.assignment_id}`,
    });

    for (const qa of questionAnswers) {
      const qaRecord = db.prepare('SELECT is_correct, score FROM question_answers WHERE id = ?').get(qa.id);
      if (qaRecord && qaRecord.is_correct === 0) {
        writeWrongQuestion({
          userId, assignmentId, questionId: qa.question_bank_id,
          wrongAnswer: qa.student_answer, correctAnswer: qa.reference_answer || '',
          analysis: qa.analysis || qa.explanation || '',
        });
      }
    }

    console.log(`主观题评阅完成: submission=${submissionId}, score=${avgScore}, gold=${goldReward}`);
  } catch (error) {
    console.error('主观题评阅错误:', error);
    // 兜底给 60 分并补发对应金币（原先只写 submissions.gold_reward，忘了 UPDATE users，
    // 导致评阅异常时学生一分钱都拿不到）
    const fallbackGold = Math.floor(0.6 * (db.prepare('SELECT max_exp FROM assignments WHERE id = ?').get(assignmentId)?.max_exp || 30));
    db.prepare("UPDATE submissions SET review_status = 'completed', total_score = 60, gold_reward = ? WHERE id = ?")
      .run(fallbackGold, submissionId);
    if (fallbackGold > 0) {
      try {
        grantReward(userId, {
          gold: fallbackGold,
          source: 'assignment_subjective',
          reason: '主观题评阅异常兜底发放',
        });
      } catch (goldErr) { console.error('兜底金币发放失败:', goldErr); }
    }
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
function registerPaperSubmission({ assignmentId, assignment, studentId, results, note }) {
  const student = db.prepare('SELECT id, class_id, username, real_name FROM users WHERE id = ?').get(studentId);
  if (!student || student.class_id !== assignment.class_id) {
    throw new Error(`学生 ${student?.real_name || studentId} 不属于此作业的班级`);
  }

  const existing = db.prepare('SELECT id FROM submissions WHERE assignment_id = ? AND user_id = ?').get(assignmentId, studentId);
  if (existing) {
    throw new Error(`${student.real_name || student.username} 已有提交记录（线上或纸质），不能重复登记`);
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
      VALUES (?, 'paper_graded', '纸质作业已登记', ?, 'assignment', ?)`)
      .run(studentId, `作业「${assignment.title}」已由老师登记纸质作答，得分 ${finalScore} 分${goldReward > 0 ? `，获得 ${goldReward} 金币` : ''}。`, assignmentId);

    return submissionId;
  });

  const submissionId = submitTx();
  return { submission_id: submissionId, total_score: finalScore, gold_reward: goldReward, student_name: student.real_name || student.username };
}

// 教师代登记纸质作业（住校生等无设备场景），数据与线上提交同源
router.post('/:id/paper-submit', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { student_id, results, note } = req.body;
    if (!student_id || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: '缺少学生或答题结果' });
    }

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });
    if (assignment.status === 'cancelled') return res.status(400).json({ error: '该作业已被取消' });

    const out = registerPaperSubmission({
      assignmentId: req.params.id, assignment, studentId: student_id, results, note
    });

    res.json({ message: '纸质作答登记成功', ...out });
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

// 纸质作业照片 AI 识别判分（视觉模型，结果供教师确认后通过 paper-submit 入库）
router.post('/:id/ai-paper-judge', authenticateToken, authorizeRole('teacher', 'admin'), async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '请先上传作业照片' });
    }
    if (images.length > 6) {
      return res.status(400).json({ error: '一次最多识别6张照片' });
    }

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.answer
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);
    if (questions.length === 0) {
      return res.status(400).json({ error: '该作业没有题目' });
    }

    const config = getAIConfig();
    if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }
    const visionModel = (config.ai_vision_model && String(config.ai_vision_model).trim()) || config.ai_model;

    const tLabel = (t) => ({ choice_single: '单选题', choice_multi: '多选题', judgment: '判断题', fill_blank: '填空题', essay: '简答/主观题' }[t] || t);
    const questionList = questions.map((q, i) =>
      `ID:${q.id} 第${i + 1}题[${tLabel(q.type)}] 题目：${String(q.content).slice(0, 80)} 参考答案：${q.answer}`
    ).join('\n');

    const prompt = fillTemplate(getPrompt('judge_paper_assignment'), {
      subject: assignment.subject || '',
      question_list: questionList,
      count: questions.length,
      image_count: images.length
    });

    const content = [
      { type: 'text', text: prompt },
      ...images.map((img) => ({ type: 'image_url', image_url: { url: img } }))
    ];

    const axios = require('axios');
    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
    const startTime = Date.now();
    const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
      model: visionModel,
      messages: [{ role: 'user', content }],
      max_tokens: getSystemSetting('max_tokens_per_generation', 18000)
    }, {
      headers: {
        'Authorization': `Bearer ${config.ai_api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });

    try {
      const usage = response.data?.usage || {};
      const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'`).get();
      if (hasTable) {
        db.prepare(`
          INSERT INTO token_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, model, subject, topic, question_type, question_count, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(req.user.userId, getChinaDate(), usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.total_tokens || 0, visionModel, assignment.subject || '纸质识别', '纸质作业AI识别', assignment.question_type, questions.length, Date.now() - startTime);
      }
    } catch (e) {
      // 统计失败不影响识别
    }

    const aiContent = response.data.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(aiContent);
    } catch (e) {
      const m = aiContent.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (!m) return res.status(500).json({ error: 'AI返回格式错误，请重试' });
      parsed = JSON.parse(m[0]);
    }

    const qIds = new Set(questions.map(q => q.id));
    const results = (parsed.results || [])
      .map((r) => ({
        question_id: parseInt(r.question_id),
        recognized_answer: r.recognized_answer ? String(r.recognized_answer) : '',
        is_correct: r.is_correct === true || r.is_correct === 'true',
        score: Math.max(0, Math.min(100, parseInt(r.score) || 0)),
        comment: r.comment ? String(r.comment) : ''
      }))
      .filter((r) => qIds.has(r.question_id));

    if (results.length === 0) {
      return res.status(500).json({ error: 'AI未能识别出有效结果，请重新拍照（光线充足、字迹清晰）后再试' });
    }

    res.json({ results, model: visionModel });
  } catch (error) {
    console.error('纸质作业AI识别失败:', error.message);
    if (error.code === 'ECONNABORTED') {
      return res.status(500).json({ error: 'AI识别超时，请稍后重试' });
    }
    if (error.response) {
      console.error('视觉模型响应:', error.response.status, JSON.stringify(error.response.data).slice(0, 300));
      return res.status(500).json({ error: '视觉模型调用失败，请确认已配置支持图片的模型（AI设置→视觉模型）' });
    }
    res.status(500).json({ error: '纸质作业AI识别失败: ' + (error.message || '未知错误') });
  }
});

// 姓名匹配：AI 识别出的卷面姓名 → 班级学生。匹配不上返回 null，交由老师手动指派
function matchStudentByName(rawName, students) {
  const name = String(rawName || '').trim();
  if (!name || name === '(未识别)') return null;
  const norm = (s) => String(s || '').replace(/\s+/g, '').trim();
  const target = norm(name);

  // 1) 真实姓名精确匹配
  let hit = students.find(s => norm(s.real_name) === target);
  if (hit) return hit;
  // 2) 用户名精确匹配
  hit = students.find(s => norm(s.username) === target);
  if (hit) return hit;
  // 3) 姓名包含（应对 AI 识别出「张三」还是「三年二班 张三」这类前缀噪声）
  const containsHits = students.filter(s => {
    const rn = norm(s.real_name);
    return rn && (target.includes(rn) || rn.includes(target));
  });
  // 仅在唯一命中时才采纳，避免「小明」同时命中「小明」「王小明」
  if (containsHits.length === 1) return containsHits[0];
  return null;
}

// 批量纸质作业识别：一次上传多张照片，AI 识别每份卷面姓名并逐题判分，返回按学生分组的结果
router.post('/:id/ai-paper-judge-batch', authenticateToken, authorizeRole('teacher', 'admin'), async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '请先上传作业照片' });
    }
    if (images.length > 12) {
      return res.status(400).json({ error: '一次最多识别 12 张照片' });
    }

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.answer
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);
    if (questions.length === 0) {
      return res.status(400).json({ error: '该作业没有题目' });
    }

    const config = getAIConfig();
    if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }
    const visionModel = (config.ai_vision_model && String(config.ai_vision_model).trim()) || config.ai_model;

    // 班级名单交给模型做姓名校正
    const students = db.prepare(
      `SELECT id, username, real_name FROM users WHERE class_id = ? AND role = 'student' AND status = 'active'`
    ).all(assignment.class_id);

    const tLabel = (t) => ({ choice_single: '单选题', choice_multi: '多选题', judgment: '判断题', fill_blank: '填空题', essay: '简答/主观题' }[t] || t);
    const questionList = questions.map((q, i) =>
      `ID:${q.id} 第${i + 1}题[${tLabel(q.type)}] 题目：${String(q.content).slice(0, 80)} 参考答案：${q.answer}`
    ).join('\n');
    const nameList = students.map(s => s.real_name || s.username).join('、') || '（未获取到名单）';

    const prompt = fillTemplate(getPrompt('judge_paper_batch'), {
      subject: assignment.subject || '',
      question_list: questionList,
      count: questions.length,
      image_count: images.length,
      name_list: nameList
    });

    const content = [
      { type: 'text', text: prompt },
      ...images.map((img) => ({ type: 'image_url', image_url: { url: img } }))
    ];

    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
    const startTime = Date.now();
    const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
      model: visionModel,
      messages: [{ role: 'user', content }],
      max_tokens: getSystemSetting('max_tokens_per_generation', 18000)
    }, {
      headers: {
        'Authorization': `Bearer ${config.ai_api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });

    try {
      const usage = response.data?.usage || {};
      const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'`).get();
      if (hasTable) {
        db.prepare(`
          INSERT INTO token_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, model, subject, topic, question_type, question_count, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(req.user.userId, getChinaDate(), usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.total_tokens || 0, visionModel, assignment.subject || '纸质识别', '批量纸质作业AI识别', assignment.question_type, questions.length * images.length, Date.now() - startTime);
      }
    } catch (e) {
      // 统计失败不影响识别
    }

    const aiContent = response.data.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(aiContent);
    } catch (e) {
      const m = aiContent.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (!m) return res.status(500).json({ error: 'AI返回格式错误，请重试' });
      parsed = JSON.parse(m[0]);
    }

    const qIds = new Set(questions.map(q => q.id));
    const rawPapers = Array.isArray(parsed.papers) ? parsed.papers : [];

    const papers = rawPapers.map((p, idx) => {
      const matched = matchStudentByName(p.student_name, students);
      const results = (Array.isArray(p.results) ? p.results : [])
        .map((r) => ({
          question_id: parseInt(r.question_id),
          recognized_answer: r.recognized_answer ? String(r.recognized_answer) : '',
          is_correct: r.is_correct === true || r.is_correct === 'true',
          score: Math.max(0, Math.min(100, parseInt(r.score) || 0)),
          comment: r.comment ? String(r.comment) : ''
        }))
        .filter((r) => qIds.has(r.question_id));

      const imgIdx = Array.isArray(p.image_indexes)
        ? p.image_indexes.map(i => parseInt(i)).filter(i => Number.isInteger(i) && i >= 0 && i < images.length)
        : [];

      return {
        key: `paper_${idx}_${Date.now()}`,
        student_id: matched ? matched.id : null,
        student_name: matched ? (matched.real_name || matched.username) : String(p.student_name || ''),
        raw_name: String(p.student_name || ''),
        matched: !!matched,
        image_indexes: imgIdx,
        results,
      };
    }).filter(p => p.results.length > 0);

    if (papers.length === 0) {
      return res.status(500).json({ error: 'AI未能识别出有效结果，请重新拍照（光线充足、字迹清晰、姓名写在卷首）后再试' });
    }

    res.json({
      papers,
      model: visionModel,
      // 已登记过的学生，前端据此提示「该生已有记录」
      registered_ids: db.prepare('SELECT user_id FROM submissions WHERE assignment_id = ?').all(req.params.id).map(r => r.user_id),
      students: students.map(s => ({ id: s.id, name: s.real_name || s.username })),
    });
  } catch (error) {
    console.error('批量纸质作业AI识别失败:', error.message);
    if (error.code === 'ECONNABORTED') {
      return res.status(500).json({ error: 'AI识别超时，请减少照片数量后重试' });
    }
    if (error.response) {
      console.error('视觉模型响应:', error.response.status, JSON.stringify(error.response.data).slice(0, 300));
      return res.status(500).json({ error: '视觉模型调用失败，请确认已配置支持图片的模型（AI设置→视觉模型）' });
    }
    res.status(500).json({ error: '批量识别失败: ' + (error.message || '未知错误') });
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
      classFilter = ` AND a.class_id = ?`;
      params.push(class_id);
    } else if (req.user.role === 'teacher') {
      const owned = db.prepare('SELECT class_id FROM class_teachers WHERE teacher_id = ?').all(req.user.userId).map(r => r.class_id);
      if (owned.length === 0) return res.json({ summary: [] });
      classFilter = ` AND a.class_id IN (${owned.map(() => '?').join(',')})`;
      params.push(...owned);
    }
    if (subject) { classFilter += ` AND a.subject = ?`; params.push(subject); }
    if (date_from) { classFilter += ` AND a.created_at >= ?`; params.push(date_from); }
    if (date_to) { classFilter += ` AND a.created_at <= ?`; params.push(date_to + ' 23:59:59'); }

    const rows = db.prepare(`
      SELECT a.id, a.assignment_type, a.subject, a.class_id, a.max_exp,
        (SELECT COUNT(*) FROM users u WHERE u.class_id = a.class_id AND u.role = 'student' AND u.status = 'active') as total_students,
        (SELECT COUNT(DISTINCT user_id) FROM submissions s WHERE s.assignment_id = a.id) as submitted_count,
        (SELECT AVG(total_score) FROM (
            SELECT user_id, MAX(total_score) as total_score FROM submissions
            WHERE assignment_id = a.id GROUP BY user_id
         )) as avg_score
      FROM assignments a
      WHERE a.status != 'cancelled' ${classFilter}
    `).all(...params);

    const labelOf = { preview: '预习', homework: '作业', review: '复习' };
    const acc = {};
    for (const key of ['preview', 'homework', 'review']) {
      acc[key] = { assignment_type: key, label: labelOf[key], assignment_count: 0, total_students: 0, submitted_count: 0, score_sum: 0, score_count: 0 };
    }
    for (const r of rows) {
      const key = acc[r.assignment_type] ? r.assignment_type : 'homework';
      const g = acc[key];
      g.assignment_count += 1;
      g.total_students += r.total_students || 0;
      g.submitted_count += r.submitted_count || 0;
      if (r.avg_score != null) { g.score_sum += r.avg_score; g.score_count += 1; }
    }

    const summary = Object.values(acc).map(g => ({
      assignment_type: g.assignment_type,
      label: g.label,
      assignment_count: g.assignment_count,
      submitted_count: g.submitted_count,
      completion_rate: g.total_students > 0 ? Math.round(g.submitted_count / g.total_students * 100) : 0,
      average_score: g.score_count > 0 ? Math.round(g.score_sum / g.score_count) : 0,
    }));

    res.json({ summary });
  } catch (error) {
    console.error('学情分组统计失败:', error);
    res.status(500).json({ error: '获取学情分组统计失败' });
  }
});

router.post('/upload/image', authenticateToken, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择要上传的图片' });
    }

    const result = db.prepare(`
      INSERT INTO upload_files (user_id, original_name, stored_name, file_path, file_size, mime_type, upload_type)
      VALUES (?, ?, ?, ?, ?, ?, 'assignment')
    `).run(req.user.userId, req.file.originalname, req.file.filename, `/uploads/${req.file.filename}`, req.file.size, req.file.mimetype);

    res.json({
      url: `/uploads/${req.file.filename}`,
      file_id: result.lastInsertRowid,
      original_name: req.file.originalname
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
