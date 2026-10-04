/**
 * AI 学情报告（教师端）
 *
 * 复用 ai-coach.js 的成熟链路：收集上下文 → 填模板 → 调模型 → 解析 JSON → 落库。
 * 与学生端 ai-coach 的区别：
 *  1. 目标从「本人」扩展为「一个班 / 一个学生」，且尊重班主任与任课老师的可见范围
 *  2. 支持按学科、按绝对时间区间过滤
 *  3. 报告存档到 learning_reports（保留历史版本），学生端的 ai_reports 是覆盖写
 *  4. 接入 token_usage 统计，纳入每日额度
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { getPrompt, fillTemplate } = require('../config/prompts');
const { getChinaDate, getChinaDateDaysAgo, resolveDateRange } = require('../config/timezone');
const { accuracyPct, WEAK_ACCURACY, MASTERED_ACCURACY } = require('../utils/analytics');
const { requireFeature } = require('../middleware/featureFlags');

// AI 总闸：学情报告是最耗 token 的功能之一，必须能被一键停掉。
// 只拦「生成」两个入口，历史报告的读取不受影响。
const aiOff = requireFeature('ai_enabled', { message: 'AI 功能当前已关闭，请联系管理员' });

const ANSWER_JOIN = `
  FROM question_answers qa
  JOIN submissions s ON s.id = qa.submission_id
  JOIN question_bank qb ON qb.id = qa.question_bank_id
`;

function getAIConfig() {
  const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
  const config = {};
  settings.forEach(s => config[s.key] = s.value);
  if (!config.ai_api_key && process.env.AI_API_KEY) config.ai_api_key = process.env.AI_API_KEY;
  if (!config.ai_base_url && process.env.AI_BASE_URL) config.ai_base_url = process.env.AI_BASE_URL;
  if (!config.ai_model && process.env.AI_MODEL) config.ai_model = process.env.AI_MODEL;
  return config;
}

function getSystemSetting(key, defaultVal) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultVal;
}

async function callAI(prompt, subject) {
  const config = getAIConfig();
  if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
    const e = new Error('AI 配置未完成，请联系管理员');
    e.status = 500;
    throw e;
  }
  const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
  const started = Date.now();
  const resp = await axios.post(`${config.ai_base_url}/chat/completions`, {
    model: config.ai_model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: getSystemSetting('max_tokens_per_generation', 18000),
  }, {
    headers: { 'Authorization': `Bearer ${config.ai_api_key}`, 'Content-Type': 'application/json' },
    timeout: timeoutMs,
  });
  return { content: resp.data.choices[0].message.content, usage: resp.data.usage || {}, model: config.ai_model, elapsed: Date.now() - started };
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) { /* fallthrough */ }
  const match = text.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) { /* fallthrough */ }
  }
  const e = new Error('AI 返回内容无法解析为 JSON，请重试');
  e.status = 502;
  throw e;
}

/** 合并 query 与 body 参数：AI 报告用 POST body 提交，查询类接口用 query */
function mergedParams(req) {
  return { ...(req.query || {}), ...(req.body || {}) };
}

/** 班级权限校验（与 learning-reports.js 保持一致的口径） */
function resolveClassAccess(req, res) {
  const p = mergedParams(req);
  const classId = parseInt(p.class_id);
  if (!classId) { res.status(400).json({ error: '请指定班级' }); return null; }
  if (req.user.role === 'admin') return { classId, isHeadTeacher: true, teacherSubjects: [] };
  const record = db.prepare('SELECT role FROM class_teachers WHERE teacher_id = ? AND class_id = ?')
    .get(req.user.userId, classId);
  if (!record) { res.status(403).json({ error: '无权查看该班级' }); return null; }
  const isHeadTeacher = record.role === 'head_teacher';
  const teacherSubjects = isHeadTeacher ? [] : db.prepare(
    `SELECT DISTINCT subject FROM assignments WHERE teacher_id = ? AND class_id = ? AND subject IS NOT NULL`
  ).all(req.user.userId, classId).map(r => r.subject);
  if (!isHeadTeacher && teacherSubjects.length === 0) {
    res.status(403).json({ error: '你还未在该班布置过作业，无法生成报告' });
    return null;
  }
  return { classId, isHeadTeacher, teacherSubjects };
}

function resolveSubjects(params, access) {
  const subject = params.subject;
  if (access.isHeadTeacher) return subject && subject !== 'all' ? [subject] : [];
  if (subject && subject !== 'all') return access.teacherSubjects.includes(subject) ? [subject] : [];
  return access.teacherSubjects;
}

const line = (s) => `- ${s}`;

/**
 * 生成班级学情分析报告
 * POST /api/learning-reports/ai-report  { class_id, subject?, date_from?, date_to? }
 */
router.post('/ai-report', authenticateToken, authorizeRole('teacher', 'admin'), aiOff, async (req, res) => {
  const startedAt = Date.now();
  try {
    const access = resolveClassAccess(req, res);
    if (!access) return;
    const params = mergedParams(req);
    const subjects = resolveSubjects(params, access);
    const { start, end } = resolveDateRange({ ...params, defaultDays: 30 });
    const subjSql = subjects.length > 0 ? ` AND qb.subject IN (${subjects.map(() => '?').join(',')})` : '';

    const cls = db.prepare('SELECT id, name, grade FROM classes WHERE id = ?').get(access.classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    const students = db.prepare(
      `SELECT id, real_name, username FROM users WHERE class_id = ? AND role='student' AND status='active'`
    ).all(access.classId);
    if (students.length === 0) return res.status(400).json({ error: '该班暂无学生' });

    const sIds = students.map(s => s.id);
    const ph = sIds.map(() => '?').join(',');

    const kpi = db.prepare(`
      SELECT COUNT(qa.id) AS total_answers,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS total_correct,
             COUNT(DISTINCT s.user_id) AS active_students,
             COUNT(DISTINCT qa.question_bank_id) AS distinct_questions
      ${ANSWER_JOIN}
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
    `).get(...sIds, start, end, ...subjects);

    const totalAnswers = kpi?.total_answers || 0;
    if (totalAnswers === 0) {
      return res.status(400).json({ error: '所选区间内没有作答数据，无法生成报告' });
    }

    // 知识点掌握情况
    const kpRows = db.prepare(`
      SELECT qb.knowledge_point, COUNT(qa.id) AS attempts,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?
        AND qb.knowledge_point IS NOT NULL AND qb.knowledge_point <> ''${subjSql}
      GROUP BY qb.knowledge_point
      HAVING SUM(qa.id) >= 2
      ORDER BY attempts DESC
      LIMIT 40
    `).all(...sIds, start, end, ...subjects)
      .map(r => ({ ...r, accuracy: accuracyPct(r.correct, r.attempts) }));

    const weakPoints = kpRows.filter(r => r.accuracy < WEAK_ACCURACY).slice(0, 10);
    const masteredPoints = kpRows.filter(r => r.accuracy >= MASTERED_ACCURACY)
      .sort((a, b) => b.accuracy - a.accuracy).slice(0, 10);

    // 学生表现
    const stuRows = db.prepare(`
      SELECT s.user_id, u.real_name, u.username, COUNT(qa.id) AS attempts,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
             MAX(qa.answered_at) AS last_at
      ${ANSWER_JOIN}
      JOIN users u ON u.id = s.user_id
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
      GROUP BY s.user_id
    `).all(...sIds, start, end, ...subjects)
      .map(r => ({ ...r, accuracy: accuracyPct(r.correct, r.attempts) }));

    const inRange = new Set(stuRows.map(r => r.user_id));
    const neverAnswered = students.filter(s => !inRange.has(s.id));
    const struggling = stuRows.filter(r => r.attempts >= 2 && r.accuracy < WEAK_ACCURACY).slice(0, 12);

    // 作业类型维度
    const typeRows = db.prepare(`
      SELECT a.assignment_type, COUNT(qa.id) AS total,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
             COUNT(DISTINCT a.id) AS assignment_count
      ${ANSWER_JOIN}
      JOIN assignments a ON a.id = s.assignment_id
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
      GROUP BY a.assignment_type
    `).all(...sIds, start, end, ...subjects);

    const typeLabel = { preview: '预习', homework: '作业', review: '复习' };
    const typeSummary = ['preview', 'homework', 'review']
      .map(t => {
        const r = typeRows.find(x => (x.assignment_type || 'homework') === t);
        if (!r) return null;
        return `${typeLabel[t]}：${r.assignment_count}份 / 作答${r.total}题 / 正确率${accuracyPct(r.correct, r.total)}%`;
      })
      .filter(Boolean)
      .join('\n') || '（本区间无作业数据）';

    const homeworkInsights = [
      `班均作答 ${accuracyPct(totalAnswers / students.length, 1) === 0 ? 0 : Math.round(totalAnswers / students.length * 10) / 10} 题/人`,
      `参与学生 ${kpi?.active_students || 0}/${students.length} 人`,
      `人均练习量 ${Math.round(totalAnswers / students.length)} 题${totalAnswers / students.length < 5 ? '（练习量偏少，结论需谨慎）' : ''}`,
      `覆盖独立题目 ${kpi?.distinct_questions || 0} 道`,
      neverAnswered.length > 0 ? `${neverAnswered.length} 人本区间无任何作答记录` : '全员本区间均有作答',
    ].join('\n');

    const kpiText = [
      `- 学生总数：${students.length}人`,
      `- 统计区间作答：${totalAnswers}题，正确率 ${accuracyPct(kpi?.total_correct, totalAnswers)}%`,
      `- 参与作答：${kpi?.active_students || 0} 人`,
      `- 覆盖题目：${kpi?.distinct_questions || 0} 道独立题目`,
    ].join('\n');

    const prompt = fillTemplate(getPrompt('coach_class_report'), {
      class_name: cls.name,
      grade: cls.grade ? `（${cls.grade}）` : '',
      range: `${start} 至 ${end}`,
      subject_scope: subjects.length > 0 ? subjects.join('、') : '全部学科',
      kpi: kpiText,
      type_summary: typeSummary,
      weak_points: weakPoints.length > 0
        ? weakPoints.map(w => line(`${w.knowledge_point}：正确率${w.accuracy}%（练习${w.attempts}题）`)).join('\n')
        : '（无明显薄弱知识点，或练习量不足以判定）',
      mastered_points: masteredPoints.length > 0
        ? masteredPoints.map(w => line(`${w.knowledge_point}：正确率${w.accuracy}%`)).join('\n')
        : '（暂无达到掌握标准的知识点）',
      struggling_students: struggling.length > 0
        ? struggling.map(s => line(`${s.real_name || s.username}：正确率${s.accuracy}%，练习${s.attempts}题`)).join('\n')
        : (neverAnswered.length > 0
          ? neverAnswered.slice(0, 10).map(s => line(`${s.real_name || s.username}：本区间无作答记录`)).join('\n')
          : '（全班均在阈值以上）'),
      homework_insights: homeworkInsights,
    });

    const { content, usage, model, elapsed } = await callAI(prompt, subjects[0] || '综合');
    const report = parseJSON(content);

    const snapshot = {
      kpi: { ...kpi, accuracy: accuracyPct(kpi?.total_correct, totalAnswers) },
      weak_points: weakPoints,
      mastered_points: masteredPoints,
      struggling: struggling.map(s => ({ name: s.real_name || s.username, accuracy: s.accuracy, attempts: s.attempts })),
      range: { start, end },
    };

    const saved = db.prepare(`
      INSERT INTO learning_reports
        (report_type, class_id, subject, period_start, period_end, content, context, model,
         generated_by, generated_by_name, summary)
      VALUES ('class', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      access.classId,
      subjects.length === 1 ? subjects[0] : null,
      start, end,
      JSON.stringify(report),
      JSON.stringify(snapshot),
      model,
      req.user.userId,
      req.user.real_name || req.user.username || null,
      String(report.summary || '').slice(0, 500)
    );

    // token 统计（纳入每日额度）
    try {
      const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'`).get();
      if (hasTable) {
        db.prepare(`
          INSERT INTO token_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, model, subject, topic, question_type, question_count, duration_ms, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')
        `).run(
          req.user.userId, getChinaDate(),
          usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.total_tokens || 0,
          model, subjects[0] || '学情报告', '班级学情分析', 'report', 0, elapsed
        );
      }
    } catch (e) {
      console.warn('报告 token 统计写入失败:', e.message);
    }

    res.json({
      report,
      report_id: saved.lastInsertRowid,
      context: snapshot,
      model,
      range: { start, end },
      subject: subjects.length === 1 ? subjects[0] : null,
    });
  } catch (error) {
    console.error('生成班级学情报告失败:', error.message);
    const status = error.status || (error.code === 'ECONNABORTED' ? 504 : 500);
    res.status(status).json({ error: error.message || '生成报告失败' });
  }
});

/**
 * 生成单个学生的教师视角报告
 * POST /api/learning-reports/ai-report/student  { class_id, student_id, subject?, date_from?, date_to? }
 */
router.post('/ai-report/student', authenticateToken, authorizeRole('teacher', 'admin'), aiOff, async (req, res) => {
  try {
    const access = resolveClassAccess(req, res);
    if (!access) return;
    const params = mergedParams(req);
    const studentId = parseInt(params.student_id);
    if (!studentId) return res.status(400).json({ error: '请指定学生' });

    const stu = db.prepare(
      `SELECT id, real_name, username FROM users WHERE id = ? AND class_id = ? AND role='student'`
    ).get(studentId, access.classId);
    if (!stu) return res.status(404).json({ error: '学生不存在或不在该班' });

    const subjects = resolveSubjects(params, access);
    const { start, end } = resolveDateRange({ ...params, defaultDays: 30 });
    const subjSql = subjects.length > 0 ? ` AND qb.subject IN (${subjects.map(() => '?').join(',')})` : '';

    const overall = db.prepare(`
      SELECT COUNT(qa.id) AS total, SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
    `).get(studentId, start, end, ...subjects);

    if (!overall || !overall.total) {
      return res.status(400).json({ error: '该生所选区间内没有作答数据' });
    }

    const kpRows = db.prepare(`
      SELECT qb.knowledge_point, COUNT(qa.id) AS attempts,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?
        AND qb.knowledge_point IS NOT NULL AND qb.knowledge_point <> ''${subjSql}
      GROUP BY qb.knowledge_point ORDER BY attempts DESC LIMIT 30
    `).all(studentId, start, end, ...subjects).map(r => ({ ...r, accuracy: accuracyPct(r.correct, r.attempts) }));

    const bySubject = db.prepare(`
      SELECT qb.subject, COUNT(qa.id) AS total, SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
        AND qb.subject IS NOT NULL
      GROUP BY qb.subject ORDER BY total DESC
    `).all(studentId, start, end, ...subjects).map(r => ({ ...r, accuracy: accuracyPct(r.correct, r.total) }));

    const scoreTrend = db.prepare(`
      SELECT a.title, a.subject, MAX(s.total_score) AS best_score
      FROM submissions s JOIN assignments a ON a.id = s.assignment_id
      WHERE s.user_id = ? AND DATE(s.submitted_at) BETWEEN ? AND ?
        ${subjects.length > 0 ? `AND a.subject IN (${subjects.map(() => '?').join(',')})` : ''}
      GROUP BY s.assignment_id ORDER BY s.submitted_at ASC
    `).all(studentId, start, end, ...subjects);

    const wrongRows = db.prepare(`
      SELECT qb.knowledge_point, COUNT(*) AS cnt
      FROM wrong_questions wq JOIN question_bank qb ON qb.id = wq.question_id
      WHERE wq.user_id = ?${subjSql}
      GROUP BY qb.knowledge_point ORDER BY cnt DESC LIMIT 10
    `).all(studentId, ...subjects);

    const wrongPending = db.prepare('SELECT COUNT(*) c FROM wrong_questions WHERE user_id = ? AND reviewed = 0')
      .get(studentId).c;
    const assignTotal = db.prepare(`
      SELECT COUNT(*) c FROM assignments
      WHERE class_id = ? AND status != 'cancelled' AND DATE(created_at) BETWEEN ? AND ?
        ${subjects.length > 0 ? `AND subject IN (${subjects.map(() => '?').join(',')})` : ''}
    `).get(access.classId, start, end, ...subjects).c || 0;
    const assignDone = db.prepare(`
      SELECT COUNT(DISTINCT assignment_id) c FROM submissions
      WHERE user_id = ? AND DATE(submitted_at) BETWEEN ? AND ?
    `).get(studentId, start, end).c || 0;

    const weakKp = kpRows.filter(r => r.accuracy < WEAK_ACCURACY).slice(0, 8);
    const masteredKp = kpRows.filter(r => r.accuracy >= MASTERED_ACCURACY).slice(0, 8);

    const prompt = fillTemplate(getPrompt('coach_student_report'), {
      student_name: stu.real_name || stu.username,
      range: `${start} 至 ${end}`,
      subject_scope: subjects.length > 0 ? subjects.join('、') : '全部学科',
      overall: `- 作答 ${overall.total} 题，正确率 ${accuracyPct(overall.correct, overall.total)}%`,
      subject_summary: bySubject.length > 0
        ? bySubject.map(r => line(`${r.subject}：正确率${r.accuracy}%（${r.total}题）`)).join('\n')
        : '（无学科数据）',
      weak_points: weakKp.length > 0
        ? weakKp.map(w => line(`${w.knowledge_point}：正确率${w.accuracy}%（练习${w.attempts}题）`)).join('\n')
        : '（无明显薄弱知识点）',
      mastered_summary: masteredKp.length > 0
        ? masteredKp.map(w => line(`${w.knowledge_point}：正确率${w.accuracy}%`)).join('\n')
        : '（暂无）',
      wrong_summary: `错题本未复习 ${wrongPending} 题` +
        (wrongRows.length > 0 ? '\n' + wrongRows.map(w => line(`${w.knowledge_point || '未标注'}：错${w.cnt}次`)).join('\n') : ''),
      score_trend: scoreTrend.length > 0
        ? scoreTrend.map(s => line(`${s.title}：${s.best_score}分`)).join('\n')
        : '（无作业记录）',
      attendance_summary: `- 应完成作业 ${assignTotal} 份，实际完成 ${assignDone} 份（完成率 ${assignTotal > 0 ? Math.round(assignDone / assignTotal * 100) : 0}%）`,
    });

    const { content, model } = await callAI(prompt, subjects[0] || '综合');
    const report = parseJSON(content);

    const saved = db.prepare(`
      INSERT INTO learning_reports
        (report_type, class_id, target_student_id, subject, period_start, period_end,
         content, context, model, generated_by, generated_by_name, summary)
      VALUES ('student', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      access.classId,
      studentId,
      subjects.length === 1 ? subjects[0] : null,
      start, end,
      JSON.stringify(report),
      JSON.stringify({ overall, bySubject, weakKp, masteredKp }),
      model,
      req.user.userId,
      req.user.real_name || req.user.username || null,
      String(report.summary || '').slice(0, 500)
    );

    res.json({ report, report_id: saved.lastInsertRowid, model, range: { start, end } });
  } catch (error) {
    console.error('生成学生报告失败:', error.message);
    const status = error.status || (error.code === 'ECONNABORTED' ? 504 : 500);
    res.status(status).json({ error: error.message || '生成报告失败' });
  }
});

/** 报告历史列表 */
router.get('/ai-report/history', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const access = resolveClassAccess(req, res);
    if (!access) return;
    const { report_type, subject } = req.query;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    const where = ['lr.class_id = ?'];
    const params = [access.classId];
    if (report_type) { where.push('lr.report_type = ?'); params.push(report_type); }
    if (subject && subject !== 'all') { where.push('lr.subject = ?'); params.push(subject); }

    const list = db.prepare(`
      SELECT lr.id, lr.report_type, lr.subject, lr.period_start, lr.period_end,
             lr.model, lr.generated_by_name, lr.summary, lr.created_at,
             lr.target_student_id,
             (SELECT COALESCE(real_name, username) FROM users WHERE id = lr.target_student_id) AS target_name
      FROM learning_reports lr
      WHERE ${where.join(' AND ')}
      ORDER BY lr.created_at DESC
      LIMIT ?
    `).all(...params, limit);

    res.json({ reports: list });
  } catch (error) {
    console.error('获取报告历史失败:', error);
    res.status(500).json({ error: '获取报告历史失败' });
  }
});

/** 报告详情（含 AI 全文） */
router.get('/ai-report/:id', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const access = resolveClassAccess(req, res);
    if (!access) return;
    const row = db.prepare(
      `SELECT * FROM learning_reports WHERE id = ? AND class_id = ?`
    ).get(req.params.id, access.classId);
    if (!row) return res.status(404).json({ error: '报告不存在' });

    let content = {};
    let context = {};
    try { content = JSON.parse(row.content); } catch (e) {}
    try { context = JSON.parse(row.context || '{}'); } catch (e) {}

    res.json({ ...row, content, context });
  } catch (error) {
    console.error('获取报告详情失败:', error);
    res.status(500).json({ error: '获取报告详情失败' });
  }
});

module.exports = router;
