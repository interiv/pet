const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 获取知识点统计
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { date, days = 7 } = req.query;
    
    // 如果指定了日期，查询该日期的统计
    if (date) {
      const stats = db.prepare(`
        SELECT 
          knowledge_point,
          total_attempts,
          correct_attempts,
          accuracy
        FROM knowledge_point_stats
        WHERE user_id = ? AND date = ?
        ORDER BY total_attempts DESC
      `).all(userId, date);
      
      return res.json({
        date,
        stats,
        total_points: stats.length,
        avg_accuracy: stats.length > 0 
          ? (stats.reduce((sum, s) => sum + s.accuracy, 0) / stats.length).toFixed(2)
          : 0
      });
    }
    
    // 否则查询最近N天的统计
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const stats = db.prepare(`
      SELECT 
        knowledge_point,
        SUM(total_attempts) as total_attempts,
        SUM(correct_attempts) as correct_attempts,
        ROUND(CAST(SUM(correct_attempts) AS REAL) / SUM(total_attempts) * 100, 2) as accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      GROUP BY knowledge_point
      HAVING SUM(total_attempts) >= 3
      ORDER BY SUM(total_attempts) DESC
    `).all(userId, startDateStr);
    
    res.json({
      days,
      start_date: startDateStr,
      stats,
      total_points: stats.length,
      avg_accuracy: stats.length > 0 
        ? (stats.reduce((sum, s) => sum + s.accuracy, 0) / stats.length).toFixed(2)
        : 0
    });
  } catch (error) {
    console.error('获取知识点统计失败:', error);
    res.status(500).json({ error: '获取知识点统计失败' });
  }
});

// 获取知识点列表
router.get('/list', authenticateToken, (req, res) => {
  try {
    const knowledgePoints = db.prepare(`
      SELECT DISTINCT knowledge_point
      FROM knowledge_point_stats
      WHERE user_id = ?
      ORDER BY knowledge_point
    `).all(req.user.userId).map(row => row.knowledge_point);
    
    res.json({
      knowledge_points: knowledgePoints,
      total: knowledgePoints.length
    });
  } catch (error) {
    console.error('获取知识点列表失败:', error);
    res.status(500).json({ error: '获取知识点列表失败' });
  }
});

// 获取知识点热力图数据
router.get('/heatmap', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const heatmapData = db.prepare(`
      SELECT 
        date,
        knowledge_point,
        total_attempts,
        correct_attempts,
        accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      ORDER BY date, knowledge_point
    `).all(userId, startDateStr);
    
    // 转换为热力图格式
    const dates = [...new Set(heatmapData.map(d => d.date))].sort();
    const points = [...new Set(heatmapData.map(d => d.knowledge_point))].sort();
    
    const matrix = [];
    for (const point of points) {
      const row = { knowledge_point: point };
      for (const date of dates) {
        const record = heatmapData.find(d => d.date === date && d.knowledge_point === point);
        row[date] = record ? {
          attempts: record.total_attempts,
          accuracy: record.accuracy
        } : null;
      }
      matrix.push(row);
    }
    
    res.json({
      dates,
      knowledge_points: points,
      matrix,
      days
    });
  } catch (error) {
    console.error('获取热力图数据失败:', error);
    res.status(500).json({ error: '获取热力图数据失败' });
  }
});

// 获取薄弱知识点（正确率低于60%）
router.get('/weak-points', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { days = 7, threshold = 60 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const weakPoints = db.prepare(`
      SELECT 
        knowledge_point,
        SUM(total_attempts) as total_attempts,
        SUM(correct_attempts) as correct_attempts,
        ROUND(CAST(SUM(correct_attempts) AS REAL) / SUM(total_attempts) * 100, 2) as accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      GROUP BY knowledge_point
      HAVING SUM(total_attempts) >= 3 AND accuracy < ?
      ORDER BY accuracy ASC
    `).all(userId, startDateStr, threshold);
    
    res.json({
      weak_points: weakPoints,
      count: weakPoints.length,
      days,
      threshold
    });
  } catch (error) {
    console.error('获取薄弱知识点失败:', error);
    res.status(500).json({ error: '获取薄弱知识点失败' });
  }
});

// 获取相似题目（基于同科目+同知识点+同题型，排除已做过，优先同难度）
router.get('/similar-questions', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { question_id, limit = 5 } = req.query;

    if (!question_id) {
      return res.status(400).json({ error: '缺少参数 question_id' });
    }

    const origin = db.prepare(`
      SELECT id, subject, knowledge_point, topic, type, difficulty, variant_group_id
      FROM question_bank WHERE id = ?
    `).get(question_id);

    if (!origin) {
      return res.status(404).json({ error: '原始题目不存在' });
    }

    // 已做过的题目：包括原题，以及用户已作答 / 已在错题本中的题
    const answeredIds = db.prepare(`
      SELECT DISTINCT qa.question_bank_id AS id
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id = ?
      UNION
      SELECT DISTINCT question_id AS id FROM wrong_questions WHERE user_id = ?
    `).all(userId, userId).map(r => r.id);

    const excludeIds = new Set([Number(question_id), ...answeredIds]);
    // 变体组内的其它题视为等价，也排除
    if (origin.variant_group_id) {
      const siblings = db.prepare('SELECT id FROM question_bank WHERE variant_group_id = ?')
        .all(origin.variant_group_id).map(r => r.id);
      siblings.forEach(id => excludeIds.add(id));
    }

    const excludeList = [...excludeIds];
    const placeholders = excludeList.length > 0 ? excludeList.map(() => '?').join(',') : 'NULL';

    // 优先级1：同科目+同知识点+同题型+同难度
    // 优先级2：同科目+同知识点+同题型（其它难度）
    // 优先级3：同科目+同知识点（其它题型）
    // 优先级4：同科目+同topic
    const buildQuery = (conditions) => `
      SELECT id, subject, topic, knowledge_point, type, difficulty, content, options, answer, explanation, analysis, hint
      FROM question_bank
      WHERE ${conditions}
      AND id NOT IN (${placeholders})
      ORDER BY usage_count ASC, id DESC
      LIMIT ?
    `;

    const collected = [];
    const seen = new Set();
    const pickFrom = (conditionSQL, conditionParams) => {
      if (collected.length >= limit) return;
      const remaining = Number(limit) - collected.length;
      const rows = db.prepare(buildQuery(conditionSQL))
        .all(...conditionParams, ...excludeList, remaining);
      for (const r of rows) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          collected.push(r);
        }
      }
    };

    if (origin.knowledge_point) {
      pickFrom('subject = ? AND knowledge_point = ? AND type = ? AND difficulty = ?',
        [origin.subject, origin.knowledge_point, origin.type, origin.difficulty]);
      pickFrom('subject = ? AND knowledge_point = ? AND type = ?',
        [origin.subject, origin.knowledge_point, origin.type]);
      pickFrom('subject = ? AND knowledge_point = ?',
        [origin.subject, origin.knowledge_point]);
    }
    if (origin.topic) {
      pickFrom('subject = ? AND topic = ? AND type = ?',
        [origin.subject, origin.topic, origin.type]);
    }

    // 解析options
    const similar = collected.map(q => {
      if (q.options) { try { q.options = JSON.parse(q.options); } catch (e) {} }
      return q;
    });

    res.json({
      origin_question_id: Number(question_id),
      knowledge_point: origin.knowledge_point || origin.topic || null,
      subject: origin.subject,
      similar_questions: similar,
      count: similar.length
    });
  } catch (error) {
    console.error('获取相似题失败:', error);
    res.status(500).json({ error: '获取相似题失败' });
  }
});

// 获取复习效果监测：对比前期 vs 近期正确率，计算漲幅
// 默认近期=最近7天，前期=更早的连续14天（共考察21天）
router.get('/review-effectiveness', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const recentDays = parseInt(req.query.recent_days) || 7;
    const baseDays = parseInt(req.query.base_days) || 14;

    const now = new Date();
    const recentStart = new Date(now);
    recentStart.setDate(recentStart.getDate() - recentDays);
    const recentStartStr = recentStart.toISOString().split('T')[0];

    const baseEnd = new Date(recentStart);
    baseEnd.setDate(baseEnd.getDate() - 1);
    const baseEndStr = baseEnd.toISOString().split('T')[0];

    const baseStart = new Date(recentStart);
    baseStart.setDate(baseStart.getDate() - baseDays);
    const baseStartStr = baseStart.toISOString().split('T')[0];

    // 前期聚合
    const baseStats = db.prepare(`
      SELECT knowledge_point,
             SUM(total_attempts) AS attempts,
             SUM(correct_attempts) AS correct,
             ROUND(CAST(SUM(correct_attempts) AS REAL) / NULLIF(SUM(total_attempts), 0) * 100, 2) AS accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ? AND date <= ?
      GROUP BY knowledge_point
    `).all(userId, baseStartStr, baseEndStr);

    // 近期聚合
    const recentStats = db.prepare(`
      SELECT knowledge_point,
             SUM(total_attempts) AS attempts,
             SUM(correct_attempts) AS correct,
             ROUND(CAST(SUM(correct_attempts) AS REAL) / NULLIF(SUM(total_attempts), 0) * 100, 2) AS accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      GROUP BY knowledge_point
    `).all(userId, recentStartStr);

    const recentMap = {};
    recentStats.forEach(s => { recentMap[s.knowledge_point] = s; });

    // 结果：仅关心前期存在且算偏弱或中等的知识点
    const items = baseStats.map(b => {
      const r = recentMap[b.knowledge_point];
      const baseAccuracy = b.accuracy || 0;
      const recentAccuracy = r ? (r.accuracy || 0) : null;
      let delta = null, status = 'no_data', statusLabel = '尚未复习';
      if (recentAccuracy !== null) {
        delta = Math.round((recentAccuracy - baseAccuracy) * 100) / 100;
        if (delta >= 10) { status = 'improving'; statusLabel = '明显提升'; }
        else if (delta <= -10) { status = 'declining'; statusLabel = '出现下滑'; }
        else if (Math.abs(delta) < 10 && recentAccuracy >= 80) { status = 'consolidated'; statusLabel = '已巩固'; }
        else { status = 'stable'; statusLabel = '基本稳定'; }
      }
      return {
        knowledge_point: b.knowledge_point,
        base_attempts: b.attempts,
        base_accuracy: baseAccuracy,
        recent_attempts: r ? r.attempts : 0,
        recent_accuracy: recentAccuracy,
        delta,
        status,
        status_label: statusLabel,
        was_weak: baseAccuracy < 60
      };
    }).sort((a, b) => {
      // 优先展示原本薄弱的项
      if (a.was_weak !== b.was_weak) return a.was_weak ? -1 : 1;
      if (a.delta === null) return 1;
      if (b.delta === null) return -1;
      return (b.delta || 0) - (a.delta || 0);
    });

    const improving = items.filter(x => x.status === 'improving').length;
    const declining = items.filter(x => x.status === 'declining').length;
    const consolidated = items.filter(x => x.status === 'consolidated').length;
    const noReview = items.filter(x => x.status === 'no_data' && x.was_weak).length;

    res.json({
      base_period: { start: baseStartStr, end: baseEndStr, days: baseDays },
      recent_period: { start: recentStartStr, days: recentDays },
      items,
      summary: {
        total_tracked: items.length,
        improving,
        declining,
        consolidated,
        weak_not_reviewed: noReview
      }
    });
  } catch (error) {
    console.error('获取复习效果失败:', error);
    res.status(500).json({ error: '获取复习效果失败' });
  }
});

// ====== 教师端：班级学情总览 ======
// GET /class/:classId/overview
// 聚合班级所有学生最近 N 天的知识点掌握情况
router.get('/class/:classId/overview', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const days = parseInt(req.query.days) || 14;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // 权限：admin / 该班级教师
    if (userRole !== 'admin') {
      const isTeacher = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(userId, classId);
      if (!isTeacher) return res.status(403).json({ error: '无权访问该班级学情' });
    }

    // 班级学生列表
    const students = db.prepare(
      `SELECT id, username, avatar FROM users WHERE class_id = ? AND role = 'student'`
    ).all(classId);
    const studentIds = students.map(s => s.id);
    const studentCount = students.length;

    if (studentCount === 0) {
      return res.json({
        class_id: classId,
        days,
        student_count: 0,
        avg_accuracy: 0,
        total_attempts: 0,
        top_weak: [],
        top_mastered: [],
        subject_distribution: [],
        student_rankings: []
      });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    const placeholders = studentIds.map(() => '?').join(',');

    // 班级整体知识点聚合
    const kpAggregate = db.prepare(`
      SELECT knowledge_point,
             SUM(total_attempts) AS attempts,
             SUM(correct_attempts) AS correct,
             ROUND(CAST(SUM(correct_attempts) AS REAL) / NULLIF(SUM(total_attempts), 0) * 100, 2) AS accuracy,
             COUNT(DISTINCT user_id) AS covered_students
      FROM knowledge_point_stats
      WHERE user_id IN (${placeholders}) AND date >= ?
      GROUP BY knowledge_point
      HAVING SUM(total_attempts) >= 3
      ORDER BY accuracy ASC
    `).all(...studentIds, startDateStr);

    const totalAttempts = kpAggregate.reduce((s, r) => s + r.attempts, 0);
    const totalCorrect = kpAggregate.reduce((s, r) => s + r.correct, 0);
    const avgAccuracy = totalAttempts > 0
      ? Math.round((totalCorrect / totalAttempts) * 10000) / 100
      : 0;

    const topWeak = kpAggregate.filter(k => k.accuracy < 60).slice(0, 8);
    const topMastered = [...kpAggregate].filter(k => k.accuracy >= 80)
      .sort((a, b) => b.accuracy - a.accuracy).slice(0, 8);

    // 科目分布：从 question_bank 关联 question_answers
    const subjectDist = db.prepare(`
      SELECT qb.subject,
             COUNT(qa.id) AS total,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
             ROUND(CAST(SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS REAL) /
                   NULLIF(COUNT(qa.id), 0) * 100, 2) AS accuracy
      FROM question_answers qa
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id IN (${placeholders}) AND DATE(qa.answered_at) >= ?
      GROUP BY qb.subject
      ORDER BY total DESC
    `).all(...studentIds, startDateStr);

    // 各学生概况（用于排行与钻取入口）
    const studentRankings = students.map(stu => {
      const row = db.prepare(`
        SELECT SUM(total_attempts) AS attempts,
               SUM(correct_attempts) AS correct,
               ROUND(CAST(SUM(correct_attempts) AS REAL) / NULLIF(SUM(total_attempts), 0) * 100, 2) AS accuracy,
               COUNT(DISTINCT knowledge_point) AS kp_count
        FROM knowledge_point_stats
        WHERE user_id = ? AND date >= ?
      `).get(stu.id, startDateStr) || {};
      const weak = db.prepare(`
        SELECT COUNT(*) AS cnt FROM (
          SELECT knowledge_point,
                 CAST(SUM(correct_attempts) AS REAL) / NULLIF(SUM(total_attempts), 0) * 100 AS acc
          FROM knowledge_point_stats
          WHERE user_id = ? AND date >= ?
          GROUP BY knowledge_point
          HAVING SUM(total_attempts) >= 3 AND acc < 60
        )
      `).get(stu.id, startDateStr) || { cnt: 0 };
      return {
        user_id: stu.id,
        username: stu.username,
        avatar: stu.avatar,
        attempts: row.attempts || 0,
        correct: row.correct || 0,
        accuracy: row.accuracy || 0,
        kp_count: row.kp_count || 0,
        weak_kp_count: weak.cnt || 0
      };
    }).sort((a, b) => b.accuracy - a.accuracy);

    res.json({
      class_id: classId,
      days,
      student_count: studentCount,
      avg_accuracy: avgAccuracy,
      total_attempts: totalAttempts,
      total_correct: totalCorrect,
      knowledge_point_count: kpAggregate.length,
      top_weak: topWeak,
      top_mastered: topMastered,
      subject_distribution: subjectDist,
      student_rankings: studentRankings
    });
  } catch (error) {
    console.error('获取班级学情总览失败:', error);
    res.status(500).json({ error: '获取班级学情总览失败' });
  }
});

// GET /class/:classId/student/:studentId
// 教师钻取查看单个学生学情
router.get('/class/:classId/student/:studentId', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const studentId = parseInt(req.params.studentId);
    const days = parseInt(req.query.days) || 14;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole !== 'admin') {
      const isTeacher = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(userId, classId);
      if (!isTeacher) return res.status(403).json({ error: '无权查看' });
    }

    // 校验该学生确实在该班级
    const stu = db.prepare(
      `SELECT id, username, avatar FROM users WHERE id = ? AND class_id = ? AND role = 'student'`
    ).get(studentId, classId);
    if (!stu) return res.status(404).json({ error: '学生不存在或不在此班级' });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const kpStats = db.prepare(`
      SELECT knowledge_point,
             SUM(total_attempts) AS total_attempts,
             SUM(correct_attempts) AS correct_attempts,
             ROUND(CAST(SUM(correct_attempts) AS REAL) / NULLIF(SUM(total_attempts), 0) * 100, 2) AS accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      GROUP BY knowledge_point
      ORDER BY accuracy ASC
    `).all(studentId, startDateStr);

    const weakPoints = kpStats.filter(k => k.total_attempts >= 3 && k.accuracy < 60);
    const masteredPoints = kpStats.filter(k => k.total_attempts >= 3 && k.accuracy >= 80);

    const recentWrong = db.prepare(`
      SELECT wq.id, wq.question_id, wq.wrong_count, wq.is_resolved,
             qb.subject, qb.topic, qb.knowledge_point, qb.content
      FROM wrong_questions wq
      LEFT JOIN question_bank qb ON wq.question_id = qb.id
      WHERE wq.user_id = ?
      ORDER BY wq.updated_at DESC
      LIMIT 20
    `).all(studentId);

    // 每日提交数据（用于趋势）
    const dailyTrend = db.prepare(`
      SELECT date,
             SUM(total_attempts) AS attempts,
             SUM(correct_attempts) AS correct,
             ROUND(CAST(SUM(correct_attempts) AS REAL) / NULLIF(SUM(total_attempts), 0) * 100, 2) AS accuracy
      FROM knowledge_point_stats
      WHERE user_id = ? AND date >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(studentId, startDateStr);

    res.json({
      student: stu,
      days,
      knowledge_points: kpStats,
      weak_points: weakPoints,
      mastered_points: masteredPoints,
      recent_wrong: recentWrong,
      daily_trend: dailyTrend
    });
  } catch (error) {
    console.error('获取学生学情失败:', error);
    res.status(500).json({ error: '获取学生学情失败' });
  }
});

// ====== 学习时间分析 ======
// GET /learning-time
// 聚合近 N 天的答题时间分布：日趋势、周天分布、小时分布、学科分布
router.get('/learning-time', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const days = parseInt(req.query.days) || 14;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    // 每日答题数
    const daily = db.prepare(`
      SELECT DATE(qa.answered_at) AS date,
             COUNT(qa.id) AS answers,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id = ? AND DATE(qa.answered_at) >= ?
      GROUP BY DATE(qa.answered_at)
      ORDER BY date ASC
    `).all(userId, startDateStr);

    // 周天分布（SQLite：strftime('%w') 返回 0=周日 ... 6=周六）
    const weekdayRows = db.prepare(`
      SELECT CAST(strftime('%w', qa.answered_at) AS INTEGER) AS weekday_idx,
             COUNT(qa.id) AS answers
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id = ? AND DATE(qa.answered_at) >= ?
      GROUP BY weekday_idx
    `).all(userId, startDateStr);
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekdayMap = {};
    weekdayRows.forEach(r => { weekdayMap[r.weekday_idx] = r.answers; });
    // 以周一开头的顺序返回
    const weekday = [1, 2, 3, 4, 5, 6, 0].map(idx => ({
      weekday: weekdayNames[idx],
      weekday_idx: idx,
      answers: weekdayMap[idx] || 0
    }));

    // 小时分布
    const hourRows = db.prepare(`
      SELECT CAST(strftime('%H', qa.answered_at) AS INTEGER) AS hour,
             COUNT(qa.id) AS answers
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id = ? AND DATE(qa.answered_at) >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(userId, startDateStr);
    const hourMap = {};
    hourRows.forEach(r => { hourMap[r.hour] = r.answers; });
    const hourly = [];
    for (let h = 0; h < 24; h++) {
      hourly.push({ hour: `${String(h).padStart(2, '0')}:00`, hour_idx: h, answers: hourMap[h] || 0 });
    }

    // 学科分布
    const subjectDist = db.prepare(`
      SELECT qb.subject AS subject,
             COUNT(qa.id) AS answers,
             ROUND(CAST(SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(qa.id), 0) * 100, 2) AS accuracy
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      WHERE s.user_id = ? AND DATE(qa.answered_at) >= ?
      GROUP BY qb.subject
      ORDER BY answers DESC
    `).all(userId, startDateStr);

    // 总体统计与活跃时段识别
    const totalAnswers = daily.reduce((s, d) => s + d.answers, 0);
    const activeDays = daily.length;
    const avgPerDay = activeDays > 0 ? Math.round(totalAnswers / activeDays * 10) / 10 : 0;
    let peakHour = null, peakCount = 0;
    hourly.forEach(h => { if (h.answers > peakCount) { peakCount = h.answers; peakHour = h.hour; } });
    let peakWeekday = null, peakWCount = 0;
    weekday.forEach(w => { if (w.answers > peakWCount) { peakWCount = w.answers; peakWeekday = w.weekday; } });

    res.json({
      days,
      start_date: startDateStr,
      daily,
      weekday,
      hourly,
      subject_distribution: subjectDist,
      summary: {
        total_answers: totalAnswers,
        active_days: activeDays,
        avg_per_day: avgPerDay,
        peak_hour: peakHour,
        peak_weekday: peakWeekday
      }
    });
  } catch (error) {
    console.error('获取学习时间分析失败:', error);
    res.status(500).json({ error: '获取学习时间分析失败' });
  }
});

module.exports = router;
