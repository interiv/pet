const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getChinaDate, getChinaDateDaysAgo, resolveDateRange } = require('../config/timezone');
const {
  MIN_POINT_ATTEMPTS, MIN_ATTEMPTS_FOR_JUDGE, WEAK_ACCURACY, MASTERED_ACCURACY,
  resolveWindow, subjectExistsFilter, accuracyPct, classifyMastery, kpAggregateSql, decoratePoints, compareWindows,
} = require('../utils/analytics');

// 获取知识点统计
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const { date, days = 7, min_attempts } = req.query;
    const minAttempts = Math.max(1, parseInt(min_attempts) || MIN_POINT_ATTEMPTS);

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
    const win = resolveWindow(req.query, { defaultDays: 7, alias: 'kps' });
    const { sql, params } = kpAggregateSql({
      userId,
      dateClause: win.dateClause,
      dateParams: win.params,
      minAttempts,
      orderBy: 'total_attempts DESC',
    });

    const stats = db.prepare(sql).all(...params);

    res.json({
      days: win.days,
      start_date: win.start,
      end_date: win.end,
      stats: decoratePoints(stats),
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

    const win = resolveWindow(req.query, { defaultDays: 30, alias: 'kps' });
    const startDateStr = win.start;
    
    const heatmapData = db.prepare(`
      SELECT 
        date,
        knowledge_point,
        total_attempts,
        correct_attempts,
        ROUND(CAST(correct_attempts AS REAL) / NULLIF(total_attempts, 0) * 100, 2) as accuracy
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
    const { days = 7, threshold = 60, min_attempts } = req.query;
    const minAttempts = Math.max(1, parseInt(min_attempts) || MIN_POINT_ATTEMPTS);

    const win = resolveWindow(req.query, { defaultDays: 7, alias: 'kps' });
    const { sql, params } = kpAggregateSql({
      userId,
      dateClause: win.dateClause,
      dateParams: win.params,
      minAttempts,
      orderBy: 'accuracy ASC',
    });

    const all = db.prepare(sql).all(...params);
    const weakPoints = all.filter((p) => p.accuracy < Number(threshold));

    res.json({
      weak_points: decoratePoints(weakPoints),
      count: weakPoints.length,
      days: win.days,
      start_date: win.start,
      threshold: Number(threshold)
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

// 获取复习效果监测：对比前期 vs 近期正确率，计算涨跌幅
// 默认近期=最近7天，前期=更早的连续14天（共考察21天）
// 已切到 analytics.compareWindows：修正了时区口径，并新增「尚未复习 / 新增关注」两类状态
router.get('/review-effectiveness', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const recentDays = parseInt(req.query.recent_days) || 7;
    const baseDays = parseInt(req.query.base_days) || 14;
    const subject = req.query.subject || null;

    const recentStart = getChinaDateDaysAgo(recentDays);
    const baseEnd = getChinaDateDaysAgo(recentDays + 1);
    const baseStart = getChinaDateDaysAgo(recentDays + baseDays);

    const { points, summary } = compareWindows(db, {
      userId,
      subject,
      recentStart,
      recentEnd: null,
      baseStart,
      baseEnd,
    });

    res.json({
      base_period: { start: baseStart, end: baseEnd, days: baseDays },
      recent_period: { start: recentStart, days: recentDays },
      subject,
      items: points,
      summary,
    });
  } catch (error) {
    console.error('获取复习效果失败:', error);
    res.status(500).json({ error: '获取复习效果失败' });
  }
});

// ====== 教师端：班级学情总览 ======
// GET /class/:classId/overview
// 班主任：查看班级所有学生全学科数据
// 任课老师：只看自己科目相关的数据
router.get('/class/:classId/overview', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const days = parseInt(req.query.days) || 14;
    const userId = req.user.userId;
    const userRole = req.user.role;

    let isHeadTeacher = false;
    let teacherSubjects = [];

    if (userRole === 'admin') {
      isHeadTeacher = true;
    } else {
      const teacherRecord = db.prepare(
        `SELECT role FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(userId, classId);
      if (!teacherRecord) return res.status(403).json({ error: '无权访问该班级学情' });

      if (teacherRecord.role === 'head_teacher') {
        isHeadTeacher = true;
      } else {
        teacherSubjects = db.prepare(
          `SELECT DISTINCT subject FROM assignments WHERE teacher_id = ? AND class_id = ? AND subject IS NOT NULL`
        ).all(userId, classId).map(r => r.subject);
      }
    }

    const students = db.prepare(
      `SELECT id, username, real_name, avatar FROM users WHERE class_id = ? AND role = 'student'`
    ).all(classId);
    const studentIds = students.map(s => s.id);
    const studentCount = students.length;

    if (studentCount === 0) {
      return res.json({
        class_id: classId, days, student_count: 0,
        avg_accuracy: 0, total_attempts: 0,
        top_weak: [], top_mastered: [],
        subject_distribution: [], student_rankings: [],
        role: isHeadTeacher ? 'head_teacher' : 'subject_teacher',
        teacher_subjects: teacherSubjects
      });
    }

    const win = resolveWindow(req.query, { defaultDays: days, alias: 'kps' });
    const startDateStr = win.start;
    const placeholders = studentIds.map(() => '?').join(',');

    // 任课老师只看自己教过的学科；用 EXISTS 过滤，避免 JOIN 造成的行膨胀
    const subjFilter = isHeadTeacher
      ? { sql: '', params: [] }
      : subjectExistsFilter(teacherSubjects, 'kps');
    const minAttempts = Math.max(1, parseInt(req.query.min_attempts) || MIN_POINT_ATTEMPTS);

    if (!isHeadTeacher && teacherSubjects.length === 0) {
      return res.json({
        class_id: classId, days, student_count: studentCount,
        avg_accuracy: 0, total_attempts: 0,
        top_weak: [], top_mastered: [],
        subject_distribution: [], student_rankings: [],
        role: 'subject_teacher', teacher_subjects: []
      });
    }

    const kpAggregate = db.prepare(`
      SELECT kps.knowledge_point,
             SUM(kps.total_attempts) AS attempts,
             SUM(kps.correct_attempts) AS correct,
             ROUND(CAST(SUM(kps.correct_attempts) AS REAL) / NULLIF(SUM(kps.total_attempts), 0) * 100, 2) AS accuracy,
             COUNT(DISTINCT kps.user_id) AS covered_students
      FROM knowledge_point_stats kps
      WHERE kps.user_id IN (${placeholders}) AND kps.date >= ? AND kps.date <= ?${subjFilter.sql}
      GROUP BY kps.knowledge_point
      HAVING SUM(kps.total_attempts) >= ${minAttempts}
      ORDER BY accuracy ASC
    `).all(...studentIds, win.params[0], win.params[1], ...subjFilter.params);

    const totalAttempts = kpAggregate.reduce((s, r) => s + r.attempts, 0);
    const totalCorrect = kpAggregate.reduce((s, r) => s + r.correct, 0);
    const avgAccuracy = accuracyPct(totalCorrect, totalAttempts);

    const topWeak = kpAggregate.filter(k => k.accuracy < WEAK_ACCURACY).slice(0, 8);
    const topMastered = [...kpAggregate].filter(k => k.accuracy >= MASTERED_ACCURACY)
      .sort((a, b) => b.accuracy - a.accuracy).slice(0, 8);

    let subjectDist;
    if (isHeadTeacher) {
      subjectDist = db.prepare(`
        SELECT qb.subject,
               COUNT(qa.id) AS total,
               SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
               ROUND(CAST(SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS REAL) /
                     NULLIF(COUNT(qa.id), 0) * 100, 2) AS accuracy
        FROM question_answers qa
        JOIN question_bank qb ON qa.question_bank_id = qb.id
        JOIN submissions s ON qa.submission_id = s.id
        WHERE s.user_id IN (${placeholders}) AND DATE(qa.answered_at, '+8 hours') >= ?
        GROUP BY qb.subject
        ORDER BY total DESC
      `).all(...studentIds, startDateStr);
    } else {
      const subjectPlaceholders = teacherSubjects.map(() => '?').join(',');
      subjectDist = db.prepare(`
        SELECT qb.subject,
               COUNT(qa.id) AS total,
               SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
               ROUND(CAST(SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS REAL) /
                     NULLIF(COUNT(qa.id), 0) * 100, 2) AS accuracy
        FROM question_answers qa
        JOIN question_bank qb ON qa.question_bank_id = qb.id
        JOIN submissions s ON qa.submission_id = s.id
        WHERE s.user_id IN (${placeholders}) AND DATE(qa.answered_at, '+8 hours') >= ? AND qb.subject IN (${subjectPlaceholders})
        GROUP BY qb.subject
        ORDER BY total DESC
      `).all(...studentIds, startDateStr, ...teacherSubjects);
    }

    // 一次查出全班各生统计与薄弱知识点数，消除原先的 N+1 查询
    const perStudent = db.prepare(`
      SELECT kps.user_id,
             SUM(kps.total_attempts) AS attempts,
             SUM(kps.correct_attempts) AS correct,
             COUNT(DISTINCT kps.knowledge_point) AS kp_count
      FROM knowledge_point_stats kps
      WHERE kps.user_id IN (${placeholders}) AND kps.date >= ? AND kps.date <= ?${subjFilter.sql}
      GROUP BY kps.user_id
    `).all(...studentIds, win.params[0], win.params[1], ...subjFilter.params);
    const statMap = new Map(perStudent.map(r => [r.user_id, r]));

    const weakMap = new Map(db.prepare(`
      SELECT user_id, COUNT(*) AS weak_kp_count FROM (
        SELECT kps.user_id, kps.knowledge_point
        FROM knowledge_point_stats kps
        WHERE kps.user_id IN (${placeholders}) AND kps.date >= ? AND kps.date <= ?${subjFilter.sql}
        GROUP BY kps.user_id, kps.knowledge_point
        HAVING SUM(kps.total_attempts) >= ${MIN_ATTEMPTS_FOR_JUDGE}
           AND CAST(SUM(kps.correct_attempts) AS REAL) / SUM(kps.total_attempts) * 100 < ${WEAK_ACCURACY}
      ) GROUP BY user_id
    `).all(...studentIds, win.params[0], win.params[1], ...subjFilter.params).map(r => [r.user_id, r.weak_kp_count]));

    const studentRankings = students.map(stu => {
      const row = statMap.get(stu.id) || {};
      return {
        user_id: stu.id,
        username: stu.username,
        real_name: stu.real_name,
        avatar: stu.avatar,
        attempts: row.attempts || 0,
        correct: row.correct || 0,
        accuracy: accuracyPct(row.correct, row.attempts),
        kp_count: row.kp_count || 0,
        weak_kp_count: weakMap.get(stu.id) || 0
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
      student_rankings: studentRankings,
      role: isHeadTeacher ? 'head_teacher' : 'subject_teacher',
      teacher_subjects: teacherSubjects
    });
  } catch (error) {
    console.error('获取班级学情总览失败:', error);
    res.status(500).json({ error: '获取班级学情总览失败' });
  }
});

// GET /class/:classId/student/:studentId
// 教师钻取查看单个学生学情
// 班主任：可查看该学生全学科、所有作业、全部学习相关数据
// 任课老师：仅能查看自己所授科目、自己布置下发的作业对应的学生完成情况与学习数据
router.get('/class/:classId/student/:studentId', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const studentId = parseInt(req.params.studentId);
    const days = parseInt(req.query.days) || 14;
    const userId = req.user.userId;
    const userRole = req.user.role;

    let isHeadTeacher = false;
    let isSubjectTeacher = false;
    let teacherSubjects = [];

    if (userRole === 'admin') {
      isHeadTeacher = true;
    } else {
      const teacherRecord = db.prepare(
        `SELECT role FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(userId, classId);
      if (!teacherRecord) return res.status(403).json({ error: '无权查看' });

      if (teacherRecord.role === 'head_teacher') {
        isHeadTeacher = true;
      } else {
        isSubjectTeacher = true;
        teacherSubjects = db.prepare(
          `SELECT DISTINCT subject FROM assignments WHERE teacher_id = ? AND class_id = ? AND subject IS NOT NULL`
        ).all(userId, classId).map(r => r.subject);
      }
    }

    const stu = db.prepare(
      `SELECT id, username, real_name, avatar FROM users WHERE id = ? AND class_id = ? AND role = 'student'`
    ).get(studentId, classId);
    if (!stu) return res.status(404).json({ error: '学生不存在或不在此班级' });

    const win = resolveWindow(req.query, { defaultDays: days, alias: 'kps' });
    const startDateStr = win.start;

    let kpStats;
    if (isHeadTeacher) {
      kpStats = db.prepare(`
        SELECT kps.knowledge_point,
               SUM(kps.total_attempts) AS total_attempts,
               SUM(kps.correct_attempts) AS correct_attempts,
               ROUND(CAST(SUM(kps.correct_attempts) AS REAL) / NULLIF(SUM(kps.total_attempts), 0) * 100, 2) AS accuracy
        FROM knowledge_point_stats kps
        WHERE kps.user_id = ? AND kps.date >= ? AND kps.date <= ?
        GROUP BY kps.knowledge_point
        ORDER BY accuracy ASC
      `).all(studentId, win.params[0], win.params[1]);
    } else {
      if (teacherSubjects.length === 0) {
        return res.json({
          student: stu, days, role: 'subject_teacher',
          knowledge_points: [], weak_points: [], mastered_points: [],
          recent_wrong: [], daily_trend: [], subject_stats: [],
          teacher_subjects: []
        });
      }
      // EXISTS 过滤学科，避免 JOIN 同名知识点导致的行膨胀
      const sf = subjectExistsFilter(teacherSubjects, 'kps');
      kpStats = db.prepare(`
        SELECT kps.knowledge_point,
               SUM(kps.total_attempts) AS total_attempts,
               SUM(kps.correct_attempts) AS correct_attempts,
               ROUND(CAST(SUM(kps.correct_attempts) AS REAL) / NULLIF(SUM(kps.total_attempts), 0) * 100, 2) AS accuracy
        FROM knowledge_point_stats kps
        WHERE kps.user_id = ? AND kps.date >= ? AND kps.date <= ?${sf.sql}
        GROUP BY kps.knowledge_point
        ORDER BY accuracy ASC
      `).all(studentId, win.params[0], win.params[1], ...sf.params);
    }

    const weakPoints = kpStats.filter(k => k.total_attempts >= MIN_ATTEMPTS_FOR_JUDGE && k.accuracy < WEAK_ACCURACY);
    const masteredPoints = kpStats.filter(k => k.total_attempts >= MIN_ATTEMPTS_FOR_JUDGE && k.accuracy >= MASTERED_ACCURACY);

    let recentWrong;
    if (isHeadTeacher) {
      recentWrong = db.prepare(`
        SELECT wq.id, wq.question_id, wq.wrong_count, wq.wrong_answer, wq.correct_answer,
               qb.subject, qb.topic, qb.knowledge_point, qb.content
        FROM wrong_questions wq
        LEFT JOIN question_bank qb ON wq.question_id = qb.id
        WHERE wq.user_id = ?
        ORDER BY wq.id DESC
        LIMIT 20
      `).all(studentId);
    } else {
      const subjectPlaceholders = teacherSubjects.map(() => '?').join(',');
      recentWrong = db.prepare(`
        SELECT wq.id, wq.question_id, wq.wrong_count, wq.wrong_answer, wq.correct_answer,
               qb.subject, qb.topic, qb.knowledge_point, qb.content
        FROM wrong_questions wq
        LEFT JOIN question_bank qb ON wq.question_id = qb.id
        WHERE wq.user_id = ? AND (qb.subject IN (${subjectPlaceholders}) OR qb.subject IS NULL)
        ORDER BY wq.id DESC
        LIMIT 20
      `).all(studentId, ...teacherSubjects);
    }

    // 任课老师此前能拿到该生「全学科」的日趋势，属于越权，这里补上学科过滤
    const dailyTrend = (() => {
      if (isHeadTeacher) {
        return db.prepare(`
          SELECT date,
                 SUM(total_attempts) AS attempts,
                 SUM(correct_attempts) AS correct,
                 ROUND(CAST(SUM(correct_attempts) AS REAL) / NULLIF(SUM(total_attempts), 0) * 100, 2) AS accuracy
          FROM knowledge_point_stats
          WHERE user_id = ? AND date >= ? AND date <= ?
          GROUP BY date
          ORDER BY date ASC
        `).all(studentId, win.params[0], win.params[1]);
      }
      const sf = subjectExistsFilter(teacherSubjects, 'kps');
      return db.prepare(`
        SELECT kps.date AS date,
               SUM(kps.total_attempts) AS attempts,
               SUM(kps.correct_attempts) AS correct,
               ROUND(CAST(SUM(kps.correct_attempts) AS REAL) / NULLIF(SUM(kps.total_attempts), 0) * 100, 2) AS accuracy
        FROM knowledge_point_stats kps
        WHERE kps.user_id = ? AND kps.date >= ? AND kps.date <= ?${sf.sql}
        GROUP BY kps.date
        ORDER BY kps.date ASC
      `).all(studentId, win.params[0], win.params[1], ...sf.params);
    })();

    let subjectStats;
    if (isHeadTeacher) {
      subjectStats = db.prepare(`
        SELECT qb.subject,
               COUNT(qa.id) AS total,
               SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
               ROUND(CAST(SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS REAL) /
                     NULLIF(COUNT(qa.id), 0) * 100, 2) AS accuracy
        FROM question_answers qa
        JOIN question_bank qb ON qa.question_bank_id = qb.id
        JOIN submissions s ON qa.submission_id = s.id
        WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') >= ?
        GROUP BY qb.subject
        ORDER BY total DESC
      `).all(studentId, startDateStr);
    } else {
      const subjectPlaceholders = teacherSubjects.map(() => '?').join(',');
      subjectStats = db.prepare(`
        SELECT qb.subject,
               COUNT(qa.id) AS total,
               SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
               ROUND(CAST(SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS REAL) /
                     NULLIF(COUNT(qa.id), 0) * 100, 2) AS accuracy
        FROM question_answers qa
        JOIN question_bank qb ON qa.question_bank_id = qb.id
        JOIN submissions s ON qa.submission_id = s.id
        WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') >= ? AND qb.subject IN (${subjectPlaceholders})
        GROUP BY qb.subject
        ORDER BY total DESC
      `).all(studentId, startDateStr, ...teacherSubjects);
    }

    res.json({
      student: stu,
      days,
      role: isHeadTeacher ? 'head_teacher' : 'subject_teacher',
      teacher_subjects: isHeadTeacher ? [] : teacherSubjects,
      knowledge_points: kpStats,
      weak_points: weakPoints,
      mastered_points: masteredPoints,
      recent_wrong: recentWrong,
      daily_trend: dailyTrend,
      subject_stats: subjectStats
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

    // 窗口起点用中国时区计算（原先用 UTC，早 8 点前会少算「今天」）
    const startDateStr = getChinaDateDaysAgo(days);

    // 每日答题数
    const daily = db.prepare(`
      SELECT DATE(qa.answered_at, '+8 hours') AS date,
             COUNT(qa.id) AS answers,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') >= ?
      GROUP BY DATE(qa.answered_at, '+8 hours')
      ORDER BY date ASC
    `).all(userId, startDateStr);

    // 周天分布（SQLite：strftime('%w') 返回 0=周日 ... 6=周六）
    const weekdayRows = db.prepare(`
      SELECT CAST(strftime('%w', qa.answered_at, '+8 hours') AS INTEGER) AS weekday_idx,
             COUNT(qa.id) AS answers
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') >= ?
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
      SELECT CAST(strftime('%H', qa.answered_at, '+8 hours') AS INTEGER) AS hour,
             COUNT(qa.id) AS answers
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') >= ?
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
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') >= ?
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

    // ===== 作答耗时（011 迁移新增，存量数据为 NULL 需忽略）=====
    const durationRow = db.prepare(`
      SELECT COUNT(qa.duration_ms) AS measured,
             AVG(qa.duration_ms) AS avg_ms,
             SUM(qa.duration_ms) AS total_ms,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct_with_duration,
             COUNT(CASE WHEN qa.is_correct = 1 THEN 1 END) AS correct_total
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') >= ?
        AND qa.duration_ms IS NOT NULL
    `).get(userId, startDateStr);

    const avgDurationSec = durationRow?.avg_ms ? Math.round(durationRow.avg_ms / 100) / 10 : 0;
    const totalMinutes = durationRow?.total_ms ? Math.round(durationRow.total_ms / 60000) : 0;
    const durationAccuracy = durationRow?.correct_total
      ? Math.round((durationRow.correct_with_duration / durationRow.correct_total) * 10000) / 100
      : null;

    // 耗时与正确率的关系：过快(<10s)可能蒙答案，过慢(>120s)可能卡住
    let paceBias = null;
    if (durationRow?.measured >= 5) {
      if (avgDurationSec > 0 && avgDurationSec < 10) paceBias = 'too_fast';
      else if (avgDurationSec > 120) paceBias = 'too_slow';
    }

    // ===== 预习 / 作业 / 复习 三类维度 =====
    const typeDist = db.prepare(`
      SELECT COALESCE(a.assignment_type, 'homework') AS assignment_type,
             COUNT(qa.id) AS answers,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
             COUNT(DISTINCT a.id) AS assignment_count
      FROM question_answers qa
      JOIN submissions s ON qa.submission_id = s.id
      JOIN assignments a ON a.id = s.assignment_id
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') >= ?
      GROUP BY COALESCE(a.assignment_type, 'homework')
    `).all(userId, startDateStr);
    const typeLabel = { preview: '预习', homework: '作业', review: '复习' };
    const byType = ['preview', 'homework', 'review']
      .map(t => {
        const r = typeDist.find(x => x.assignment_type === t);
        if (!r) return { assignment_type: t, label: typeLabel[t], answers: 0, assignment_count: 0, accuracy: 0 };
        return {
          assignment_type: t,
          label: typeLabel[t],
          answers: r.answers,
          assignment_count: r.assignment_count,
          correct: r.correct,
          accuracy: accuracyPct(r.correct, r.answers),
        };
      })
      .filter(x => x.answers > 0);

    res.json({
      days,
      start_date: startDateStr,
      daily,
      weekday,
      hourly,
      subject_distribution: subjectDist,
      by_type: byType,
      duration: {
        measured_questions: durationRow?.measured || 0,
        avg_seconds: avgDurationSec,
        total_minutes: totalMinutes,
        accuracy: durationAccuracy,
        pace_bias: paceBias,
        available: (durationRow?.measured || 0) > 0,
      },
      summary: {
        total_answers: totalAnswers,
        active_days: activeDays,
        avg_per_day: avgPerDay,
        peak_hour: peakHour,
        peak_weekday: peakWeekday,
        total_minutes: totalMinutes
      }
    });
  } catch (error) {
    console.error('获取学习时间分析失败:', error);
    res.status(500).json({ error: '获取学习时间分析失败' });
  }
});

module.exports = router;
