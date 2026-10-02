const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { getChinaDate } = require('../../config/timezone');
const { getAIConfig, isAIConfigured, getAITimeoutMs } = require('../../config/ai');
const { PROMPTS, SETTING_PREFIX, getPrompt, fillTemplate } = require('../../config/prompts');
const {
  USERNAME_MAX_LEN,
  AI_USERNAME_BATCH_SIZE,
  requireAdmin,
  purgeUserData,
  applyApplicationToClass,
  approveTeacherPendingApplications,
  checkDataPermission,
  cleanStudentNames,
  findDuplicateNames,
  sanitizeUsername,
  sanitizeSequencePrefix,
  isUsernameTaken,
  ensureUniqueUsername,
  randomPassword,
  parseJSONArray,
  generateUsernamesByAI,
  ensureSettingsTable,
} = require('./_shared');

router.get('/statistics/public', (req, res) => {
  try {
    const totalStudents = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'student' AND status = 'active'`).get().count;
    const totalTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND status = 'active'`).get().count;
    const totalClasses = db.prepare(`SELECT COUNT(*) as count FROM classes`).get().count;
    const totalPets = db.prepare(`SELECT COUNT(*) as count FROM pets`).get().count;
    const totalSchools = db.prepare(`SELECT COUNT(*) as count FROM schools`).get().count;
    const totalBattles = db.prepare(`SELECT COUNT(*) as count FROM battles`).get().count;

    res.json({
      statistics: {
        students: totalStudents,
        teachers: totalTeachers,
        classes: totalClasses,
        pets: totalPets,
        schools: totalSchools,
        battles: totalBattles,
      }
    });
  } catch (error) {
    console.error('获取公开统计失败:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
});

router.get('/statistics', authenticateToken, (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.userId;

    const totalUsers = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
    const totalTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher'`).get().count;
    const totalStudents = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'student'`).get().count;
    const totalGold = db.prepare(`SELECT SUM(gold) as total FROM users`).get().total || 0;

    let statistics = {
      users: { total: totalUsers, teachers: totalTeachers, students: totalStudents },
      totals: { gold: totalGold }
    };

    if (userRole === 'admin') {
      const today = getChinaDate();

      const totalClasses = db.prepare(`SELECT COUNT(*) as count FROM classes`).get().count;
      const totalPets = db.prepare(`SELECT COUNT(*) as count FROM pets`).get().count;
      const totalBattles = db.prepare(`SELECT COUNT(*) as count FROM battles`).get().count;
      const activeTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND status = 'active'`).get().count;
      const pendingTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND status = 'pending_approval'`).get().count;
      const totalExp = db.prepare(`SELECT SUM(exp) as total FROM pets`).get().total || 0;

      // 检查表是否存在
      const hasUserActivities = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_activities'`).get();
      const hasGoldTransactions = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='gold_transactions'`).get();

      let dailyActiveUsers = 0;
      if (hasUserActivities) {
        dailyActiveUsers = db.prepare(`
          SELECT COUNT(DISTINCT user_id) as count FROM user_activities
          WHERE DATE(created_at) = DATE('now', 'localtime')
        `).get().count || 0;
      }

      let dailyGoldDistributed = 0;
      let dailyGoldConsumed = 0;
      if (hasGoldTransactions) {
        dailyGoldDistributed = db.prepare(`
          SELECT COALESCE(SUM(gold_change), 0) as total FROM gold_transactions
          WHERE DATE(created_at) = DATE('now', 'localtime') AND gold_change > 0
        `).get().total || 0;

        dailyGoldConsumed = db.prepare(`
          SELECT COALESCE(SUM(ABS(gold_change)), 0) as total FROM gold_transactions
          WHERE DATE(created_at) = DATE('now', 'localtime') AND gold_change < 0
        `).get().total || 0;
      }

      const topClasses = db.prepare(`
        SELECT c.id, c.name, c.total_exp, c.student_count,
          (SELECT COALESCE(u.real_name, u.username) FROM class_teachers ct JOIN users u ON ct.teacher_id = u.id WHERE ct.class_id = c.id AND ct.role = 'head_teacher' LIMIT 1) as teacher_name
        FROM classes c
        ORDER BY c.total_exp DESC LIMIT 5
      `).all();

      const recentRegistrations = db.prepare(`
        SELECT id, username, real_name, role, created_at FROM users ORDER BY created_at DESC LIMIT 10
      `).all();

      const topSellingItems = db.prepare(`
        SELECT i.name, i.rarity, COUNT(ui.id) as purchase_count, SUM(ui.quantity) as total_quantity
        FROM user_items ui
        JOIN items i ON ui.item_id = i.id
        GROUP BY i.id
        ORDER BY purchase_count DESC
        LIMIT 10
      `).all();

      statistics = {
        ...statistics,
        classes: { total: totalClasses },
        pets: { total: totalPets },
        battles: { total: totalBattles },
        totals: { gold: totalGold, exp: totalExp },
        status: {
          active_teachers: activeTeachers,
          pending_teachers: pendingTeachers
        },
        daily: {
          active_users: dailyActiveUsers,
          gold_distributed: dailyGoldDistributed,
          gold_consumed: dailyGoldConsumed
        },
        top_classes: topClasses,
        top_selling_items: topSellingItems,
        recent_registrations: recentRegistrations
      };
    } else if (userRole === 'teacher') {
      // 任教班级明细：教师工作台首页依赖 classes.list 来拉取班级排行与学情概览，
      // 缺失时前端会以 undefined 调接口（/knowledge-points/class/undefined/... -> 404）
      const myClassRows = db.prepare(`
        SELECT c.id, c.name, c.grade, c.school_id, c.student_count, c.slug, ct.role as class_role
        FROM class_teachers ct
        JOIN classes c ON c.id = ct.class_id
        WHERE ct.teacher_id = ?
        ORDER BY c.id
      `).all(userId);

      const myClassIds = myClassRows.map(row => row.id);
      const myClasses = myClassIds.length;

      let studentCount = 0;
      if (myClassIds.length > 0) {
        const placeholders = myClassIds.map(() => '?').join(',');
        studentCount = db.prepare(`
          SELECT COUNT(*) as count FROM users WHERE role = 'student' AND class_id IN (${placeholders})
        `).get(...myClassIds).count;
      }

      // 教师分支原先没有 daily 字段，教师工作台「今日活跃 / 今日发金」恒为 0。
      // 这里按任教班级的学生口径统计，与班级维度对齐。
      let dailyActiveStudents = 0;
      let dailySubmissions = 0;
      let dailyGoldDistributed = 0;
      if (myClassIds.length > 0) {
        const placeholders = myClassIds.map(() => '?').join(',');
        dailyActiveStudents = db.prepare(`
          SELECT COUNT(DISTINCT qa.user_id) as count
          FROM question_answers qa
          WHERE DATE(qa.answered_at, '+8 hours') = DATE('now', '+8 hours')
            AND qa.user_id IN (SELECT id FROM users WHERE role = 'student' AND class_id IN (${placeholders}))
        `).get(...myClassIds).count || 0;

        dailySubmissions = db.prepare(`
          SELECT COUNT(*) as count
          FROM question_answers qa
          JOIN submissions s ON s.id = qa.submission_id
          WHERE DATE(qa.answered_at, '+8 hours') = DATE('now', '+8 hours')
            AND s.user_id IN (SELECT id FROM users WHERE role = 'student' AND class_id IN (${placeholders}))
        `).get(...myClassIds).count || 0;

        dailyGoldDistributed = db.prepare(`
          SELECT COALESCE(SUM(gt.gold_change), 0) as total FROM gold_transactions gt
          WHERE DATE(gt.created_at, '+8 hours') = DATE('now', '+8 hours') AND gt.gold_change > 0
            AND gt.user_id IN (SELECT id FROM users WHERE role = 'student' AND class_id IN (${placeholders}))
        `).get(...myClassIds).total || 0;
      }

      statistics = {
        ...statistics,
        classes: { total: myClasses, list: myClassRows },
        users: { students: studentCount },
        daily: {
          active_users: dailyActiveStudents,
          submissions: dailySubmissions,
          gold_distributed: dailyGoldDistributed,
          gold_consumed: 0
        }
      };
    }
    
    res.json({ statistics });
  } catch (error) {
    console.error('获取统计信息失败:', error);
    res.status(500).json({ error: '获取统计信息失败' });
  }
});

router.get('/operational-stats', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '权限不足' });
    }

    // 待处理事项
    const pendingTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND status = 'pending_approval'`).get().count;
    const pendingApplications = db.prepare(`SELECT COUNT(*) as count FROM class_applications WHERE status = 'pending'`).get().count;

    // 近7天每日活跃用户趋势
    const hasUserActivities = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_activities'`).get();
    let dauTrend = [];
    if (hasUserActivities) {
      dauTrend = db.prepare(`
        SELECT DATE(created_at) as date, COUNT(DISTINCT user_id) as count
        FROM user_activities
        WHERE created_at >= DATE('now', '-7 days', 'localtime')
        GROUP BY DATE(created_at)
        ORDER BY date
      `).all();
    }

    // 近7天每日作业提交趋势
    let submissionTrend = [];
    try {
      submissionTrend = db.prepare(`
        SELECT DATE(submitted_at) as date, COUNT(*) as count
        FROM submissions
        WHERE submitted_at >= DATE('now', '-7 days', 'localtime')
        GROUP BY DATE(submitted_at)
        ORDER BY date
      `).all();
    } catch (e) { /* submissions table may not exist */ }

    // 近7天每日新作业趋势
    let assignmentTrend = [];
    try {
      assignmentTrend = db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM assignments
        WHERE created_at >= DATE('now', '-7 days', 'localtime')
        GROUP BY DATE(created_at)
        ORDER BY date
      `).all();
    } catch (e) { /* assignments table may not exist */ }

    // 教师活跃度排行（近30天布置作业数、收到提交数、未批改数）
    let teacherActivity = [];
    try {
      teacherActivity = db.prepare(`
        SELECT
          u.id as teacher_id,
          u.username,
          u.real_name,
          u.avatar,
          COUNT(DISTINCT a.id) as assignment_count,
          (SELECT COUNT(*) FROM submissions s JOIN assignments a2 ON s.assignment_id = a2.id WHERE a2.teacher_id = u.id AND s.submitted_at >= DATE('now', '-30 days', 'localtime')) as submission_count,
          (SELECT COUNT(*) FROM submissions s JOIN assignments a2 ON s.assignment_id = a2.id WHERE a2.teacher_id = u.id AND s.status = 'submitted' AND (s.teacher_score IS NULL OR s.review_status = 'pending')) as ungraded_count
        FROM users u
        LEFT JOIN assignments a ON a.teacher_id = u.id AND a.created_at >= DATE('now', '-30 days', 'localtime')
        WHERE u.role = 'teacher' AND u.status = 'active'
        GROUP BY u.id
        ORDER BY assignment_count DESC
        LIMIT 10
      `).all();
    } catch (e) { /* assignments/submissions table may not exist */ }

    // 最近系统事件（最近注册、最近作业发布、最近公告）
    const recentEvents = [];

    const recentRegs = db.prepare(`SELECT id, username, real_name, role, created_at as time, 'register' as event_type FROM users ORDER BY created_at DESC LIMIT 5`).all();
    recentRegs.forEach(r => recentEvents.push({
      type: 'register',
      time: r.time,
      message: `新${r.role === 'teacher' ? '教师' : '学生'}注册：${r.real_name || r.username}`
    }));

    try {
      const recentAssign = db.prepare(`
        SELECT a.id, a.title, u.username, u.real_name, a.created_at as time
        FROM assignments a JOIN users u ON a.teacher_id = u.id
        ORDER BY a.created_at DESC LIMIT 5
      `).all();
      recentAssign.forEach(a => recentEvents.push({
        type: 'assignment',
        time: a.time,
        message: `${a.real_name || a.username} 发布了作业「${a.title}」`
      }));
    } catch (e) { /* assignments table may not exist */ }

    try {
      const recentAnnounce = db.prepare(`SELECT id, title, created_at as time FROM announcements ORDER BY created_at DESC LIMIT 3`).all();
      recentAnnounce.forEach(a => recentEvents.push({
        type: 'announcement',
        time: a.time,
        message: `新公告发布：${a.title}`
      }));
    } catch (e) { /* announcements table may not exist */ }

    // 按时间排序
    recentEvents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    res.json({
      pending: {
        teachers: pendingTeachers,
        applications: pendingApplications
      },
      trends: {
        dau: dauTrend,
        submissions: submissionTrend,
        assignments: assignmentTrend
      },
      teacher_activity: teacherActivity,
      recent_events: recentEvents.slice(0, 10)
    });
  } catch (error) {
    console.error('获取运营统计失败:', error);
    res.status(500).json({ error: '获取运营统计失败' });
  }
});

module.exports = router;
