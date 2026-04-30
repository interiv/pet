const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

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
  const resp = await axios.post(`${config.ai_base_url}/chat/completions`, {
    model: config.ai_model,
    messages: [{ role: 'user', content: prompt }]
  }, {
    headers: {
      'Authorization': `Bearer ${config.ai_api_key}`,
      'Content-Type': 'application/json'
    },
    timeout: 120000
  });
  return resp.data.choices[0].message.content;
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  const match = text.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) {}
  }
  throw new Error('AI 返回的 JSON 无法解析');
}

/**
 * GET /api/ai-coach/learning-plan
 * 基于学情生成个性化学习规划
 */
router.get('/learning-plan', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const days = parseInt(req.query.days) || 14;

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

    const prompt = `你是一位富有耐心的AI学习教练，要为一位学生制定未来7天的个性化学习规划。请只返回纯JSON，不要任何额外文字或markdown。

【学生学情摘要】
- 最近${days}天累计作答：${ctx.totalAnswered.cnt}题，答对${ctx.totalAnswered.correct_cnt}题
- 各科目表现：${subjectSummary}
- 薄弱知识点：${weakSummary}
- 已掌握知识点：${masteredSummary}
- 未复习错题样本：
${wrongSummary}

请输出结构化的7天学习规划，严格遵循以下JSON格式：
{
  "overview": "用2-3句话总结学生整体学情和规划核心目标",
  "priority_goals": ["核心目标1", "核心目标2", "核心目标3"],
  "daily_plan": [
    {"day": 1, "theme": "当日主题", "focus_points": ["知识点1", "知识点2"], "tasks": ["具体任务1", "具体任务2"], "estimated_minutes": 30},
    {"day": 2, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 3, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 4, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 5, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 6, "theme": "...", "focus_points": [], "tasks": [], "estimated_minutes": 30},
    {"day": 7, "theme": "复盘测评", "focus_points": [], "tasks": [], "estimated_minutes": 30}
  ],
  "weekly_milestone": "第7天完成时应达到的可验证目标",
  "encouragement": "给学生一段温暖鼓励的话（50字以内）"
}

要求：
1. 前3天优先攻克薄弱知识点与未复习错题
2. 中间2-3天穿插巩固练习+相似题训练
3. 最后1-2天做综合复盘与自测
4. tasks要具体可执行（如"重做错题本前5题"、"做10道二次函数选择题"）
5. 不同day的focus_points不要完全重复
6. 只返回JSON，不要任何其它内容`;

    const aiText = await callAI(prompt);
    const parsed = parseJSON(aiText);

    res.json({
      plan: parsed,
      empty: false,
      context: {
        days,
        total_answered: ctx.totalAnswered.cnt,
        weak_point_count: ctx.weakPoints.length,
        unreviewed_wrong_count: ctx.unreviewedWrong.length
      },
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('生成学习规划失败:', error.message);
    res.status(500).json({ error: error.message || '生成学习规划失败' });
  }
});

/**
 * GET /api/ai-coach/diagnosis
 * AI诊断报告：综合学情分析 + 个性化建议
 */
router.get('/diagnosis', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const days = parseInt(req.query.days) || 30;

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

    const prompt = `你是一位专业的AI学情诊断师。请基于学生学情生成一份结构化诊断报告。只返回纯JSON，不要任何额外文字。

【学生学情】
- 统计周期：最近${days}天
- 总答题量：${ctx.totalAnswered.cnt}，整体正确率：${overall_accuracy}%
- 各科目：${subjectSummary}
- 薄弱知识点：${weakSummary}
- 稳定掌握：${masteredSummary}
- 错题本共${ctx.wrongQuestions.length}题，未复习${ctx.unreviewedWrong.length}题

请严格按照以下JSON格式返回：
{
  "overall_score": 75,
  "level": "良好",
  "strengths": ["优势点1", "优势点2"],
  "weaknesses": ["问题1", "问题2", "问题3"],
  "root_cause_analysis": "用50-120字分析薄弱点成因，如'选择题审题不细致'、'公式记忆模糊'等",
  "recommendations": [
    {"priority": "高", "action": "具体行动建议", "expected_effect": "预期效果"},
    {"priority": "中", "action": "...", "expected_effect": "..."},
    {"priority": "低", "action": "...", "expected_effect": "..."}
  ],
  "next_focus_points": ["下一阶段应重点突破的知识点1", "知识点2", "知识点3"],
  "summary": "用30-50字给出整体评价，温暖且建设性"
}

要求：
1. overall_score 0-100整数，level从"待提升/一般/良好/优秀/卓越"中选
2. strengths 至少1条；weaknesses 2-4条；recommendations 2-4条
3. 建议要具体可执行，避免空话套话
4. 只返回JSON`;

    const aiText = await callAI(prompt);
    const parsed = parseJSON(aiText);

    res.json({
      report: parsed,
      empty: false,
      context: {
        days,
        total_answered: ctx.totalAnswered.cnt,
        overall_accuracy,
        weak_point_count: ctx.weakPoints.length,
        mastered_count: ctx.masteredPoints.length,
        wrong_question_count: ctx.wrongQuestions.length,
        unreviewed_wrong_count: ctx.unreviewedWrong.length,
        subject_distribution: ctx.subjectDist
      },
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('生成诊断报告失败:', error.message);
    res.status(500).json({ error: error.message || '生成诊断报告失败' });
  }
});

module.exports = router;
