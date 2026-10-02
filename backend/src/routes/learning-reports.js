/**
 * 学情报告（教师端）
 *
 * 解决三个问题：
 *  1. 现有学情接口只有看板和单生下钻，没有「可生成、可导出、可存档」的报告
 *  2. 除 type-summary 外，所有接口都不支持按学科过滤
 *  3. 没有绝对时间区间（只有相对 days）
 *
 * 口径统一走 utils/analytics，避免各处重复实现。
 */
const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { getChinaDate, getChinaDateDaysAgo, resolveDateRange } = require('../config/timezone');
const { accuracyPct, classifyMastery, WEAK_ACCURACY, MASTERED_ACCURACY, MIN_ATTEMPTS_FOR_JUDGE } = require('../utils/analytics');

/** 校验教师对班级的权限，返回 { classId, isHeadTeacher, teacherSubjects } */
function resolveClassAccess(req, res) {
  const classId = parseInt(req.params.classId || req.query.class_id);
  const userId = req.user.userId;
  if (!classId) {
    res.status(400).json({ error: '请指定班级' });
    return null;
  }
  if (req.user.role === 'admin') {
    return { classId, isHeadTeacher: true, teacherSubjects: [] };
  }
  const record = db.prepare('SELECT role FROM class_teachers WHERE teacher_id = ? AND class_id = ?')
    .get(userId, classId);
  if (!record) {
    res.status(403).json({ error: '无权查看该班级' });
    return null;
  }
  const isHeadTeacher = record.role === 'head_teacher';
  const teacherSubjects = isHeadTeacher ? [] : db.prepare(
    `SELECT DISTINCT subject FROM assignments WHERE teacher_id = ? AND class_id = ? AND subject IS NOT NULL`
  ).all(userId, classId).map(r => r.subject);
  if (!isHeadTeacher && teacherSubjects.length === 0) {
    res.status(403).json({ error: '你还未在该班布置过作业，无法查看学情报告' });
    return null;
  }
  return { classId, isHeadTeacher, teacherSubjects };
}

/**
 * 学科过滤：任课老师只能看自己教的科目。
 * subject=all 时表示该老师的所有任教科目。
 */
function resolveSubjects(query, access) {
  const { subject } = query;
  if (access.isHeadTeacher) {
    return subject && subject !== 'all' ? [subject] : [];
  }
  if (subject && subject !== 'all') {
    return access.teacherSubjects.includes(subject) ? [subject] : [];
  }
  return access.teacherSubjects;
}

/** 通用作答事件表：question_answers JOIN submissions JOIN question_bank */
const ANSWER_JOIN = `
  FROM question_answers qa
  JOIN submissions s ON s.id = qa.submission_id
  JOIN question_bank qb ON qb.id = qa.question_bank_id
`;

/**
 * 报告总览：KPI + 学科/作业类型/时间趋势
 * GET /api/learning-reports/overview?class_id=&subject=&date_from=&date_to=
 */
router.get('/overview', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const access = resolveClassAccess(req, res);
    if (!access) return;
    const subjects = resolveSubjects(req.query, access);
    const { start, end } = resolveDateRange({ ...req.query, defaultDays: 30 });

    const students = db.prepare(
      `SELECT id, username, real_name, avatar FROM users WHERE class_id = ? AND role = 'student' AND status = 'active'`
    ).all(access.classId);
    const sIds = students.map(s => s.id);
    const ph = sIds.map(() => '?').join(',');
    if (sIds.length === 0) {
      return res.json({ empty: true, message: '该班暂无学生', range: { start, end } });
    }

    const subjSql = subjects.length > 0 ? ` AND qb.subject IN (${subjects.map(() => '?').join(',')})` : '';
    const subjParams = subjects;

    // 总览 KPI
    const kpi = db.prepare(`
      SELECT COUNT(qa.id) AS total_answers,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS total_correct,
             COUNT(DISTINCT s.user_id) AS active_students,
             COUNT(DISTINCT qa.question_bank_id) AS distinct_questions
      ${ANSWER_JOIN}
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
    `).get(...sIds, start, end, ...subjParams);

    // 作业维度：份数、完成率、平均分
    const assignSql = `
      SELECT a.id, a.title, a.subject, a.assignment_type, a.created_at, a.due_date, a.max_exp,
        (SELECT COUNT(*) FROM users u WHERE u.class_id = a.class_id AND u.role='student' AND u.status='active') AS total_students,
        (SELECT COUNT(DISTINCT user_id) FROM submissions sub WHERE sub.assignment_id = a.id) AS submitted_count,
        (SELECT ROUND(AVG(total_score)) FROM (
           SELECT user_id, MAX(total_score) AS total_score FROM submissions WHERE assignment_id = a.id GROUP BY user_id
         )) AS avg_score
      FROM assignments a
      WHERE a.class_id = ? AND a.status != 'cancelled'
        AND DATE(a.created_at) BETWEEN ? AND ?
        ${subjects.length > 0 ? `AND a.subject IN (${subjects.map(() => '?').join(',')})` : ''}
      ORDER BY a.created_at DESC
    `;
    const assignments = db.prepare(assignSql).all(access.classId, start, end, ...subjParams);

    // 日趋势
    const daily = db.prepare(`
      SELECT DATE(qa.answered_at, '+8 hours') AS date,
             COUNT(qa.id) AS answers,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
      GROUP BY date ORDER BY date ASC
    `).all(...sIds, start, end, ...subjParams)
      .map(r => ({ ...r, accuracy: accuracyPct(r.correct, r.answers) }));

    // 学科正确率对比
    const bySubject = db.prepare(`
      SELECT qb.subject, COUNT(qa.id) AS total,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?
        AND qb.subject IS NOT NULL${subjSql}
      GROUP BY qb.subject ORDER BY total DESC
    `).all(...sIds, start, end, ...subjParams)
      .map(r => ({ subject: r.subject, total: r.total, correct: r.correct, accuracy: accuracyPct(r.correct, r.total) }));

    // 作业类型维度（预习/作业/复习）
    const byType = db.prepare(`
      SELECT a.assignment_type,
             COUNT(qa.id) AS total,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
             COUNT(DISTINCT a.id) AS assignment_count
      ${ANSWER_JOIN}
      JOIN assignments a ON a.id = s.assignment_id
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
      GROUP BY a.assignment_type
    `).all(...sIds, start, end, ...subjParams)
      .map(r => ({
        assignment_type: r.assignment_type || 'homework',
        label: { preview: '预习', homework: '作业', review: '复习' }[r.assignment_type || 'homework'],
        total: r.total, correct: r.correct,
        assignment_count: r.assignment_count,
        accuracy: accuracyPct(r.correct, r.total),
      }));

    const classInfo = db.prepare('SELECT id, name, grade FROM classes WHERE id = ?').get(access.classId);

    res.json({
      range: { start, end },
      class: classInfo,
      subjects,
      role: access.isHeadTeacher ? 'head_teacher' : 'subject_teacher',
      kpi: {
        total_answers: kpi?.total_answers || 0,
        total_correct: kpi?.total_correct || 0,
        accuracy: accuracyPct(kpi?.total_correct, kpi?.total_answers),
        active_students: kpi?.active_students || 0,
        student_count: students.length,
        participation: students.length > 0
          ? Math.round((kpi?.active_students || 0) / students.length * 100) : 0,
        distinct_questions: kpi?.distinct_questions || 0,
        assignment_count: assignments.length,
        average_score: assignments.filter(a => a.avg_score != null).length > 0
          ? Math.round(assignments.reduce((s, a) => s + a.avg_score, 0) / assignments.filter(a => a.avg_score != null).length)
          : 0,
      },
      daily,
      by_subject: bySubject,
      by_type: byType,
      assignments: assignments.map(a => ({
        ...a,
        completion_rate: a.total_students > 0 ? Math.round(a.submitted_count / a.total_students * 100) : 0,
      })),
    });
  } catch (error) {
    console.error('生成学情总览失败:', error);
    res.status(500).json({ error: '生成学情总览失败' });
  }
});

/**
 * 知识点矩阵：学生 × 知识点 的掌握度热力图数据
 * GET /api/learning-reports/knowledge-matrix?class_id=&subject=&limit_kp=
 */
router.get('/knowledge-matrix', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const access = resolveClassAccess(req, res);
    if (!access) return;
    const subjects = resolveSubjects(req.query, access);
    const { start, end } = resolveDateRange({ ...req.query, defaultDays: 30 });
    const limitKp = Math.min(30, Math.max(3, parseInt(req.query.limit_kp) || 12));

    const students = db.prepare(
      `SELECT id, username, real_name FROM users WHERE class_id = ? AND role='student' AND status='active' ORDER BY real_name`
    ).all(access.classId);
    if (students.length === 0) return res.json({ empty: true, knowledge_points: [], matrix: [] });

    const sIds = students.map(s => s.id);
    const ph = sIds.map(() => '?').join(',');
    const subjSql = subjects.length > 0 ? ` AND qb.subject IN (${subjects.map(() => '?').join(',')})` : '';

    // 以「全班的知识点」为口径选 Top N：优先出现次数多、正确率低的
    const topKp = db.prepare(`
      SELECT qb.knowledge_point,
             COUNT(qa.id) AS attempts,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?
        AND qb.knowledge_point IS NOT NULL AND qb.knowledge_point <> ''${subjSql}
      GROUP BY qb.knowledge_point
      ORDER BY attempts DESC
      LIMIT ?
    `).all(...sIds, start, end, ...subjects, limitKp);

    const kps = topKp.map(k => k.knowledge_point);
    if (kps.length === 0) return res.json({ empty: true, knowledge_points: [], matrix: [] });

    const cells = db.prepare(`
      SELECT s.user_id, qb.knowledge_point,
             COUNT(qa.id) AS attempts,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?
        AND qb.knowledge_point IN (${kps.map(() => '?').join(',')})${subjSql}
      GROUP BY s.user_id, qb.knowledge_point
    `).all(...sIds, start, end, ...kps, ...subjects);

    const cellMap = new Map(cells.map(c => [`${c.user_id}|${c.knowledge_point}`, c]));
    const matrix = students.map(stu => {
      const row = { user_id: stu.id, real_name: stu.real_name, username: stu.username, points: {} };
      for (const kp of kps) {
        const c = cellMap.get(`${stu.id}|${kp}`);
        row.points[kp] = c
          ? { attempts: c.attempts, accuracy: accuracyPct(c.correct, c.attempts) }
          : null;
      }
      return row;
    });

    res.json({
      range: { start, end },
      knowledge_points: kps.map(kp => {
        const row = topKp.find(k => k.knowledge_point === kp);
        return {
          knowledge_point: kp,
          attempts: row.attempts,
          accuracy: accuracyPct(row.correct, row.attempts),
        };
      }),
      matrix,
    });
  } catch (error) {
    console.error('生成知识点矩阵失败:', error);
    res.status(500).json({ error: '生成知识点矩阵失败' });
  }
});

/**
 * 学生排行 + 需关注名单
 * GET /api/learning-reports/students?class_id=&subject=&limit=
 */
router.get('/students', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const access = resolveClassAccess(req, res);
    if (!access) return;
    const subjects = resolveSubjects(req.query, access);
    const { start, end } = resolveDateRange({ ...req.query, defaultDays: 30 });
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit) || 50));

    const students = db.prepare(
      `SELECT id, username, real_name, avatar, gold FROM users
       WHERE class_id = ? AND role='student' AND status='active' ORDER BY real_name`
    ).all(access.classId);
    if (students.length === 0) return res.json({ students: [] });

    const sIds = students.map(s => s.id);
    const ph = sIds.map(() => '?').join(',');
    const subjSql = subjects.length > 0 ? ` AND qb.subject IN (${subjects.map(() => '?').join(',')})` : '';

    const rows = db.prepare(`
      SELECT s.user_id,
             COUNT(qa.id) AS attempts,
             SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
             COUNT(DISTINCT qa.question_bank_id) AS distinct_questions,
             MAX(qa.answered_at) AS last_answer_at
      ${ANSWER_JOIN}
      WHERE s.user_id IN (${ph}) AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
      GROUP BY s.user_id
    `).all(...sIds, start, end, ...subjects);

    const rowMap = new Map(rows.map(r => [r.user_id, r]));

    // 错题数与待复习数
    const wqRows = db.prepare(`
      SELECT wq.user_id, COUNT(*) AS wrong_total,
             SUM(CASE WHEN wq.reviewed = 1 THEN 1 ELSE 0 END) AS reviewed
      FROM wrong_questions wq
      JOIN question_bank qb ON qb.id = wq.question_id
      WHERE wq.user_id IN (${ph})${subjSql}
      GROUP BY wq.user_id
    `).all(...sIds, ...subjects);
    const wqMap = new Map(wqRows.map(r => [r.user_id, r]));

    // 作业完成情况
    const subRows = db.prepare(`
      SELECT s.user_id, COUNT(DISTINCT s.assignment_id) AS submitted_assignments
      FROM submissions s JOIN assignments a ON a.id = s.assignment_id
      WHERE s.user_id IN (${ph}) AND DATE(s.submitted_at) BETWEEN ? AND ?
        ${subjects.length > 0 ? `AND a.subject IN (${subjects.map(() => '?').join(',')})` : ''}
      GROUP BY s.user_id
    `).all(...sIds, start, end, ...subjects);
    const subMap = new Map(subRows.map(r => [r.user_id, r]));

    const totalAssignments = db.prepare(`
      SELECT COUNT(*) AS c FROM assignments
      WHERE class_id = ? AND status != 'cancelled' AND DATE(created_at) BETWEEN ? AND ?
        ${subjects.length > 0 ? `AND subject IN (${subjects.map(() => '?').join(',')})` : ''}
    `).get(access.classId, start, end, ...subjects).c || 0;

    const list = students.map(stu => {
      const r = rowMap.get(stu.id) || {};
      const w = wqMap.get(stu.id) || {};
      const sub = subMap.get(stu.id) || {};
      const accuracy = accuracyPct(r.correct, r.attempts);
      return {
        user_id: stu.id,
        real_name: stu.real_name,
        username: stu.username,
        avatar: stu.avatar,
        attempts: r.attempts || 0,
        correct: r.correct || 0,
        accuracy,
        mastery: classifyMastery(accuracy, r.attempts || 0),
        distinct_questions: r.distinct_questions || 0,
        last_answer_at: r.last_answer_at || null,
        wrong_total: w.wrong_total || 0,
        wrong_unreviewed: (w.wrong_total || 0) - (w.reviewed || 0),
        submitted_assignments: sub.submitted_assignments || 0,
        total_assignments: totalAssignments,
        completion_rate: totalAssignments > 0
          ? Math.round((sub.submitted_assignments || 0) / totalAssignments * 100) : 0,
      };
    });

    list.sort((a, b) => b.accuracy - a.accuracy);

    res.json({
      range: { start, end },
      total_assignments: totalAssignments,
      students: list.slice(0, limit),
      // 需关注：低正确率、长期未作答、错题积压多
      need_attention: list.filter(s =>
        (s.attempts >= MIN_ATTEMPTS_FOR_JUDGE && s.accuracy < WEAK_ACCURACY) ||
        (s.attempts === 0) ||
        (s.wrong_unreviewed >= 10)
      ).slice(0, 20),
    });
  } catch (error) {
    console.error('生成学生名单失败:', error);
    res.status(500).json({ error: '生成学生名单失败' });
  }
});

/**
 * 单个学生的跨学科画像（教师/班主任视角）
 * GET /api/learning-reports/student/:studentId?class_id=&subject=&days=
 */
router.get('/student/:studentId', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const access = resolveClassAccess(req, res);
    if (!access) return;
    const studentId = parseInt(req.params.studentId);
    const stu = db.prepare(
      `SELECT id, username, real_name, avatar, gold, created_at FROM users
       WHERE id = ? AND class_id = ? AND role='student'`
    ).get(studentId, access.classId);
    if (!stu) return res.status(404).json({ error: '学生不存在或不在该班' });

    const { subject } = req.query;
    const { start, end } = resolveDateRange({ ...req.query, defaultDays: 30 });
    const subjects = subject && subject !== 'all' ? [subject] : resolveSubjects({}, access);
    const subjSql = subjects.length > 0 ? ` AND qb.subject IN (${subjects.map(() => '?').join(',')})` : '';

    const overall = db.prepare(`
      SELECT COUNT(qa.id) AS total, SUM(CASE WHEN qa.is_correct=1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
    `).get(studentId, start, end, ...subjects);

    const bySubject = db.prepare(`
      SELECT qb.subject, COUNT(qa.id) AS total,
             SUM(CASE WHEN qa.is_correct=1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?
        AND qb.subject IS NOT NULL${subjSql}
      GROUP BY qb.subject ORDER BY total DESC
    `).all(studentId, start, end, ...subjects)
      .map(r => ({ subject: r.subject, total: r.total, correct: r.correct, accuracy: accuracyPct(r.correct, r.total) }));

    const knowledge = db.prepare(`
      SELECT qb.knowledge_point, COUNT(qa.id) AS attempts,
             SUM(CASE WHEN qa.is_correct=1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?
        AND qb.knowledge_point IS NOT NULL AND qb.knowledge_point <> ''${subjSql}
      GROUP BY qb.knowledge_point ORDER BY attempts DESC
    `).all(studentId, start, end, ...subjects)
      .map(r => {
        const acc = accuracyPct(r.correct, r.attempts);
        return {
          knowledge_point: r.knowledge_point, attempts: r.attempts, accuracy: acc,
          mastery: classifyMastery(acc, r.attempts),
        };
      });

    const daily = db.prepare(`
      SELECT DATE(qa.answered_at, '+8 hours') AS date, COUNT(qa.id) AS answers,
             SUM(CASE WHEN qa.is_correct=1 THEN 1 ELSE 0 END) AS correct
      ${ANSWER_JOIN}
      WHERE s.user_id = ? AND DATE(qa.answered_at, '+8 hours') BETWEEN ? AND ?${subjSql}
      GROUP BY date ORDER BY date ASC
    `).all(studentId, start, end, ...subjects)
      .map(r => ({ ...r, accuracy: accuracyPct(r.correct, r.answers) }));

    // 作业得分趋势（submissions.submitted_at 重做不更新，用 answered_at 的最大值兜底）
    const scoreTrend = db.prepare(`
      SELECT s.assignment_id, a.title, a.subject, a.assignment_type,
             MAX(s.total_score) AS best_score,
             MAX(qa.answered_at) AS last_answered_at,
             COUNT(DISTINCT qa.id) AS answered
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      LEFT JOIN question_answers qa ON qa.submission_id = s.id
      WHERE s.user_id = ? AND DATE(s.submitted_at) BETWEEN ? AND ?
        ${subjects.length > 0 ? `AND a.subject IN (${subjects.map(() => '?').join(',')})` : ''}
      GROUP BY s.assignment_id
      ORDER BY last_answered_at ASC
    `).all(studentId, start, end, ...subjects);

    const wrong = db.prepare(`
      SELECT wq.id, wq.question_id, wq.wrong_count, wq.reviewed, wq.created_at,
             qb.subject, qb.knowledge_point, qb.content
      FROM wrong_questions wq JOIN question_bank qb ON qb.id = wq.question_id
      WHERE wq.user_id = ?${subjSql}
      ORDER BY wq.wrong_count DESC, wq.id DESC LIMIT 20
    `).all(studentId, ...subjects);

    res.json({
      student: stu,
      range: { start, end },
      subjects,
      overall: {
        attempts: overall?.total || 0,
        accuracy: accuracyPct(overall?.correct, overall?.total),
        mastery: classifyMastery(accuracyPct(overall?.correct, overall?.total), overall?.total || 0),
        weak_knowledge_count: knowledge.filter(k => k.mastery === 'weak').length,
        mastered_knowledge_count: knowledge.filter(k => k.mastery === 'mastered').length,
        wrong_pending: db.prepare('SELECT COUNT(*) c FROM wrong_questions WHERE user_id = ? AND reviewed = 0')
          .get(studentId).c,
      },
      by_subject: bySubject,
      knowledge_points: knowledge,
      daily,
      score_trend: scoreTrend,
      wrong_questions: wrong,
    });
  } catch (error) {
    console.error('生成学生画像失败:', error);
    res.status(500).json({ error: '生成学生画像失败' });
  }
});

module.exports = router;
