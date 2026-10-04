const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getPrompt, fillTemplate } = require('../config/prompts');
const { requireFeature } = require('../middleware/featureFlags');
const { startAsyncTask, handleTaskQuery } = require('../utils/asyncTask');

// AI 总闸：学习规划与诊断都是 LLM 调用，纳入统一停用范围
const aiOff = requireFeature('ai_enabled', { message: 'AI 功能当前已关闭，请联系管理员' });

function getAIConfig() {
  const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
  const config = {};
  settings.forEach(s => config[s.key] = s.value);
  // fallback 到环境变量（数据库未配置时使用）
  if (!config.ai_api_key && process.env.AI_API_KEY) config.ai_api_key = process.env.AI_API_KEY;
  if (!config.ai_base_url && process.env.AI_BASE_URL) config.ai_base_url = process.env.AI_BASE_URL;
  if (!config.ai_model && process.env.AI_MODEL) config.ai_model = process.env.AI_MODEL;
  return config;
}

/**
 * 收集用户学情上下文：薄弱知识点、最近错题、平均正确率、累计答题数
 */
function collectUserContext(userId, days = 14) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  // 知识点掌握度
  const kpStats = db.prepare(`
    SELECT knowledge_point,
           SUM(total_attempts) AS total_attempts,
           SUM(correct_attempts) AS correct_attempts,
           ROUND(CAST(SUM(correct_attempts) AS REAL) / SUM(total_attempts) * 100, 2) AS accuracy
    FROM knowledge_point_stats
    WHERE user_id = ? AND date >= ?
    GROUP BY knowledge_point
    HAVING SUM(total_attempts) >= 1
    ORDER BY accuracy ASC
  `).all(userId, startDateStr);

  const weakPoints = kpStats.filter(s => s.accuracy < 60);
  const masteredPoints = kpStats.filter(s => s.accuracy >= 85);

  // 最近错题
  const wrongQuestions = db.prepare(`
    SELECT wq.id, qb.content, qb.subject, qb.knowledge_point, qb.type, wq.wrong_count, wq.reviewed
    FROM wrong_questions wq
    JOIN question_bank qb ON wq.question_id = qb.id
    WHERE wq.user_id = ?
    ORDER BY wq.reviewed ASC, wq.wrong_count DESC, wq.id DESC
    LIMIT 20
  `).all(userId);

  const unreviewedWrong = wrongQuestions.filter(w => !w.reviewed);

  // 答题总量
  const totalAnswered = db.prepare(`
    SELECT COUNT(*) AS cnt,
           SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct_cnt
    FROM question_answers qa
    JOIN submissions s ON qa.submission_id = s.id
    WHERE s.user_id = ?
  `).get(userId) || { cnt: 0, correct_cnt: 0 };

  // 按科目分布
  const subjectDist = db.prepare(`
    SELECT qb.subject, COUNT(*) AS cnt,
           SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct_cnt,
           ROUND(CAST(SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) AS accuracy
    FROM question_answers qa
    JOIN submissions s ON qa.submission_id = s.id
    JOIN question_bank qb ON qa.question_bank_id = qb.id
    WHERE s.user_id = ?
    GROUP BY qb.subject
  `).all(userId);

  return {
    days,
    knowledgePoints: kpStats,
    weakPoints,
    masteredPoints,
    wrongQuestions,
    unreviewedWrong,
    totalAnswered,
    subjectDist
  };
}

async function callAI(prompt) {
  const config = getAIConfig();
  if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
    throw new Error('AI 配置未完成，请联系管理员');
  }

  if (/[\u4e00-\u9fff]/.test(config.ai_api_key)) {
    throw new Error('AI API Key 包含中文字符，请在后台管理页面配置正确的 API Key');
  }

  if (!/^https?:\/\//.test(config.ai_base_url)) {
    throw new Error('AI Base URL 格式不正确，请在后台管理页面配置正确的地址');
  }
  
  const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
  
  console.log('\n🤖 调用 AI 服务...');
  console.log('🎯 地址:', `${config.ai_base_url}/chat/completions`);
  console.log('🤖 模型:', config.ai_model);
  console.log('📝 Prompt 长度:', prompt.length, '字符');
  console.log('⏱️ 超时设置:', timeoutMs / 1000, '秒');
  
  const startTime = Date.now();
  const resp = await axios.post(`${config.ai_base_url}/chat/completions`, {
    model: config.ai_model,
    messages: [{ role: 'user', content: prompt }]
  }, {
    headers: {
      'Authorization': `Bearer ${config.ai_api_key}`,
      'Content-Type': 'application/json'
    },
    timeout: timeoutMs
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('✅ AI 响应成功, 耗时:', elapsed, '秒');
  console.log('📦 响应大小:', JSON.stringify(resp.data).length, '字节');
  
  const content = resp.data.choices[0].message.content;
  console.log('📄 AI 返回内容预览 (前300字符):');
  console.log(content.slice(0, 300));
  console.log('📄 总长度:', content.length, '字符');
  
  return content;
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  const match = text.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) {}
  }
  throw new Error('AI 返回的 JSON 无法解析');
}

/** 报告重新生成的冷却天数（默认 3 天） */
function getIntervalDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_report_interval_days'").get();
  return parseInt(row?.value) || 3;
}

/**
 * GET /api/ai-coach/learning-plan
 * 基于学情生成个性化学习规划
 *
 * 命中缓存时同步秒回；未命中要调 AI（可能几十秒），此时改为
 * 返回 202 + task_id，由前端轮询 progress，避免长连接被网关切断。
 */
router.get('/learning-plan', authenticateToken, aiOff, (req, res) => {
  const userId = req.user.userId;
  const days = parseInt(req.query.days) || 14;
  const force = req.query.force === '1';
  const intervalDays = getIntervalDays();

  // 命中冷却期内的缓存就直接返回，不打扰 AI
  const cached = db.prepare('SELECT * FROM ai_reports WHERE user_id = ? AND report_type = ?').get(userId, 'learning_plan');
  if (cached && !force) {
    const generatedAt = new Date(cached.generated_at);
    const daysSinceGenerated = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceGenerated < intervalDays) {
      return res.json({
        plan: JSON.parse(cached.content),
        empty: false,
        context: cached.context ? JSON.parse(cached.context) : {},
        generated_at: cached.generated_at,
        can_regenerate_at: new Date(generatedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString(),
        interval_days: intervalDays,
      });
    }
  }

  return startAsyncTask(res, {
    userId,
    kind: 'coach_plan',
    title: 'AI 学习规划',
    runningMsg: 'AI 正在分析，请稍候',
  }, (fakeRes, onProgress) => runLearningPlan(req, fakeRes, onProgress));
});

async function runLearningPlan(req, res, onProgress = () => {}) {
  try {
    const userId = req.user.userId;
    const days = parseInt(req.query.days) || 14;
    const intervalDays = getIntervalDays();

    const ctx = collectUserContext(userId, days);

    if (ctx.totalAnswered.cnt === 0) {
      return res.json({
        plan: null,
        empty: true,
        message: '暂无答题数据，先完成几次作业再来查看学习规划吧'
      });
    }

    const weakSummary = ctx.weakPoints.slice(0, 8)
      .map(w => `${w.knowledge_point}（正确率${w.accuracy}%，练习${w.total_attempts}次）`).join('；') || '暂无明显薄弱点';
    const masteredSummary = ctx.masteredPoints.slice(0, 5)
      .map(w => `${w.knowledge_point}（${w.accuracy}%）`).join('；') || '暂无稳定掌握的知识点';
    const subjectSummary = ctx.subjectDist
      .map(s => `${s.subject}(${s.accuracy}%, ${s.correct_cnt}/${s.cnt})`).join('、') || '暂无科目数据';
    const wrongSummary = ctx.unreviewedWrong.slice(0, 10)
      .map(w => `【${w.subject}·${w.knowledge_point || '未标注'}】${String(w.content).slice(0, 50)}`).join('\n') || '暂无未复习错题';

    const prompt = fillTemplate(getPrompt('coach_learning_plan'), {
      days,
      total_cnt: ctx.totalAnswered.cnt,
      correct_cnt: ctx.totalAnswered.correct_cnt,
      subject_summary: subjectSummary,
      weak_summary: weakSummary,
      mastered_summary: masteredSummary,
      wrong_summary: wrongSummary
    });

    onProgress({ phase: 'ai', label: 'AI 正在分析你的学情（通常需 30-90 秒）' });
    const aiText = await callAI(prompt);
    const parsed = parseJSON(aiText);

    const contextData = {
      days,
      total_answered: ctx.totalAnswered.cnt,
      weak_point_count: ctx.weakPoints.length,
      unreviewed_wrong_count: ctx.unreviewedWrong.length
    };

    db.prepare(`
      INSERT INTO ai_reports (user_id, report_type, content, context, generated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, report_type) DO UPDATE SET
        content = excluded.content,
        context = excluded.context,
        generated_at = CURRENT_TIMESTAMP
    `).run(userId, 'learning_plan', JSON.stringify(parsed), JSON.stringify(contextData));

    res.json({
      plan: parsed,
      empty: false,
      context: contextData,
      generated_at: new Date().toISOString(),
      can_regenerate_at: new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000).toISOString(),
      interval_days: intervalDays
    });
  } catch (error) {
    console.error('生成学习规划失败:', error.message);
    res.status(500).json({ error: error.message || '生成学习规划失败' });
  }
}

/**
 * GET /api/ai-coach/diagnosis
 * AI诊断报告：综合学情分析 + 个性化建议
 *
 * 同 learning-plan：命中缓存同步返回，未命中转异步任务。
 */
router.get('/diagnosis', authenticateToken, aiOff, (req, res) => {
  const userId = req.user.userId;
  const days = parseInt(req.query.days) || 30;
  const force = req.query.force === '1';
  const intervalDays = getIntervalDays();

  const cached = db.prepare('SELECT * FROM ai_reports WHERE user_id = ? AND report_type = ?').get(userId, 'diagnosis');
  if (cached && !force) {
    const generatedAt = new Date(cached.generated_at);
    const daysSinceGenerated = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceGenerated < intervalDays) {
      return res.json({
        report: JSON.parse(cached.content),
        empty: false,
        context: cached.context ? JSON.parse(cached.context) : {},
        generated_at: cached.generated_at,
        can_regenerate_at: new Date(generatedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString(),
        interval_days: intervalDays,
      });
    }
  }

  return startAsyncTask(res, {
    userId,
    kind: 'coach_diagnosis',
    title: 'AI 学情诊断',
    runningMsg: 'AI 正在分析，请稍候',
  }, (fakeRes, onProgress) => runDiagnosis(req, fakeRes, onProgress));
});

async function runDiagnosis(req, res, onProgress = () => {}) {
  try {
    const userId = req.user.userId;
    const days = parseInt(req.query.days) || 30;
    const intervalDays = getIntervalDays();

    const ctx = collectUserContext(userId, days);

    if (ctx.totalAnswered.cnt === 0) {
      return res.json({
        report: null,
        empty: true,
        message: '暂无答题数据，先完成几次作业再来查看诊断报告吧'
      });
    }

    const overall_accuracy = ctx.totalAnswered.cnt > 0
      ? Math.round((ctx.totalAnswered.correct_cnt / ctx.totalAnswered.cnt) * 100)
      : 0;

    const weakSummary = ctx.weakPoints.slice(0, 10)
      .map(w => `${w.knowledge_point}（${w.accuracy}%，${w.correct_attempts}/${w.total_attempts}）`).join('；') || '无';
    const masteredSummary = ctx.masteredPoints.slice(0, 8)
      .map(w => `${w.knowledge_point}（${w.accuracy}%）`).join('；') || '无';
    const subjectSummary = ctx.subjectDist
      .map(s => `${s.subject} 正确率${s.accuracy}%（${s.correct_cnt}/${s.cnt}）`).join('；') || '无数据';

    const prompt = fillTemplate(getPrompt('coach_diagnosis'), {
      days,
      total_cnt: ctx.totalAnswered.cnt,
      overall_accuracy,
      subject_summary: subjectSummary,
      weak_summary: weakSummary,
      mastered_summary: masteredSummary,
      wrong_total: ctx.wrongQuestions.length,
      unreviewed_total: ctx.unreviewedWrong.length
    });

    onProgress({ phase: 'ai', label: 'AI 正在分析你的学情（通常需 30-90 秒）' });
    const aiText = await callAI(prompt);
    const parsed = parseJSON(aiText);

    const contextData = {
      days,
      total_answered: ctx.totalAnswered.cnt,
      overall_accuracy,
      weak_point_count: ctx.weakPoints.length,
      mastered_count: ctx.masteredPoints.length,
      wrong_question_count: ctx.wrongQuestions.length,
      unreviewed_wrong_count: ctx.unreviewedWrong.length,
      subject_distribution: ctx.subjectDist
    };

    db.prepare(`
      INSERT INTO ai_reports (user_id, report_type, content, context, generated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, report_type) DO UPDATE SET
        content = excluded.content,
        context = excluded.context,
        generated_at = CURRENT_TIMESTAMP
    `).run(userId, 'diagnosis', JSON.stringify(parsed), JSON.stringify(contextData));

    res.json({
      report: parsed,
      empty: false,
      context: contextData,
      generated_at: new Date().toISOString(),
      can_regenerate_at: new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000).toISOString(),
      interval_days: intervalDays
    });
  } catch (error) {
    console.error('生成诊断报告失败:', error.message);
    res.status(500).json({ error: error.message || '生成诊断报告失败' });
  }
}

// 轮询进度
router.get('/task/:taskId', authenticateToken, (req, res) => {
  handleTaskQuery(req, res);
});

module.exports = router;
