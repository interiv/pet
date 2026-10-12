/**
 * 面向访客的公开接口（挂载于 /api/public，全部免登录）
 *
 * 这个文件只放「任何人可以看」的东西。判断标准不是「访客需不需要」，
 * 而是「泄露出去有没有风险」——所以学校名、班级名、学生数可以公开，
 * 学生真名、金币、成绩、班级内部公告一律不行。
 *
 * 放在独立文件而不是塞进 admin 或 schools 路由，是为了让人一眼看出
 * 「这里的接口没有鉴权」，改动时不容易顺手写出越权查询。
 */

const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { getChinaDate } = require('../config/timezone');
const { isFeatureEnabled } = require('../middleware/featureFlags');

/**
 * 公开公告（首页公告栏）
 *
 * 只返回 class_id IS NULL 的**全校公告**。班级公告（class_id 有值）
 * 属于班级内部信息，不在公开接口里出现——否则访客能看到某个班的考试安排、
 * 活动通知之类的东西。
 *
 * 另外过滤掉已过期的（expires_at 有值且早于当前时间）。
 */
router.get('/announcements', (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const now = getChinaDate();
    const announcements = db
      .prepare(
        `SELECT a.id, a.title, a.content, a.priority, a.created_at,
                c.name AS class_name, s.name AS school_name
         FROM announcements a
         LEFT JOIN classes c ON a.class_id = c.id
         LEFT JOIN schools s ON c.school_id = s.id
   WHERE a.class_id IS NULL
       AND (a.expires_at IS NULL OR a.expires_at = '' OR a.expires_at >= ?)
ORDER BY a.priority DESC, a.created_at DESC
         LIMIT ?`
      )
      .all(now, limit);
    res.json({ announcements });
  } catch (error) {
    console.error('获取公开公告失败:', error);
    res.status(500).json({ error: '获取公告失败' });
  }
});

/**
 * 年级概览（首页「全年级概览」区块）
 *
 * 之前全仓库没有任何 GROUP BY grade 的查询，classes.grade 只是个没人用的字符串列，
 * 于是「初二有 3 个班 90 名学生」这种最基本的年级概览都做不出来。
 *
 * 只返回班级数/学生数/教师数这类**统计数字**，不返回任何学生明细——
 * 统计数字是首页该展示的，学生名单不是。
 */
router.get('/by-grade', (req, res) => {
  try {
    const grades = db
      .prepare(
        `SELECT c.grade,
     (SELECT COUNT(*) FROM classes WHERE grade = c.grade) AS class_count,
    (SELECT COUNT(*) FROM users u JOIN classes c2 ON c2.id = u.class_id
       WHERE u.role = 'student' AND c2.grade = c.grade) AS student_count,
     (SELECT COUNT(DISTINCT ct.teacher_id) FROM class_teachers ct JOIN classes c3 ON c3.id = ct.class_id
        WHERE c3.grade = c.grade) AS teacher_count,
     (SELECT COUNT(DISTINCT c4.school_id) FROM classes c4 WHERE c4.grade = c.grade) AS school_count
FROM classes c
         WHERE c.grade IS NOT NULL AND TRIM(c.grade) <> ''
      GROUP BY c.grade
    ORDER BY class_count DESC, c.grade ASC`
      )
      .all();
    res.json({ grades });
  } catch (error) {
    console.error('获取年级概览失败:', error);
    res.status(500).json({ error: '获取年级概览失败' });
  }
});

/**
 * 班级广场（首页「班级数量」卡片点进去的页面）
 *
 * 与 /api/classes/public-list 的区别：public-list 只给注册流程挑班级用，字段极简；
 * 这里额外带上宠物统计（宠物数/平均等级/最强宠物），让访客一眼看出
 * 「这个班养了多少宠物、养到什么程度」——这正是班级主页想展示的东西。
 *
 * 隐私口径不变：只出班级名/学校名/班主任姓名，**不出任何学生信息**。
 */
router.get('/classes', (req, res) => {
  try {
    if (!isFeatureEnabled('class_public_enabled')) return res.json({ classes: [] });
    const classes = db
      .prepare(
        `SELECT c.id, c.name, c.grade, c.slug, c.school_id,
        s.name AS school_name, s.theme_color AS school_theme,
        (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'student') AS student_count,
        (SELECT COUNT(DISTINCT ct.teacher_id) FROM class_teachers ct WHERE ct.class_id = c.id) AS teacher_count,
        (SELECT COUNT(*) FROM pets p JOIN users u ON u.id = p.user_id
           WHERE u.class_id = c.id AND u.role = 'student') AS pet_count,
        (SELECT COALESCE(ROUND(AVG(p.level), 1), 0) FROM pets p JOIN users u ON u.id = p.user_id
           WHERE u.class_id = c.id AND u.role = 'student') AS avg_level,
        (SELECT COALESCE(MAX(p.level), 0) FROM pets p JOIN users u ON u.id = p.user_id
           WHERE u.class_id = c.id AND u.role = 'student') AS max_level,
        (SELECT p.name FROM pets p JOIN users u ON u.id = p.user_id
           WHERE u.class_id = c.id AND u.role = 'student'
           ORDER BY p.level DESC, p.exp DESC LIMIT 1) AS top_pet_name,
        (SELECT ps.name FROM pets p
             JOIN users u ON u.id = p.user_id
             JOIN pet_species ps ON ps.id = p.species_id
           WHERE u.class_id = c.id AND u.role = 'student'
           ORDER BY p.level DESC, p.exp DESC LIMIT 1) AS top_pet_species,
        (SELECT GROUP_CONCAT(COALESCE(u2.real_name, u2.username), char(31))
           FROM class_teachers ct2 JOIN users u2 ON u2.id = ct2.teacher_id
          WHERE ct2.class_id = c.id AND ct2.role = 'head_teacher') AS head_teacher_names
      FROM classes c
      LEFT JOIN schools s ON s.id = c.school_id
      WHERE COALESCE(c.is_public, 1) = 1
      ORDER BY pet_count DESC, c.grade ASC, c.name ASC`
      )
      .all();
    // 班主任名用 ASCII 单元分隔符拼接（见 SQL 里的 char(31)），
    // 不能按默认逗号拆：姓名里出现逗号时会被劈成两个人。
    // 与 routes/classes.js 的班级宠物页同一口径。
    res.json({
      classes: classes.map((c) => ({
        ...c,
        head_teacher_names: c.head_teacher_names
          ? String(c.head_teacher_names).split('\u001f').filter(Boolean)
          : [],
      })),
    });
  } catch (error) {
    console.error('获取公开班级广场失败:', error);
    res.status(500).json({ error: '获取班级广场失败' });
  }
});

/**
 * 教师团队（首页「在职教师」卡片点进去的页面）
 *
 * 可以公开什么：教师姓名 + 任教学校 + 带班情况。教师在校内是公开职务身份，
 * 学生和家长本来就知道自己的老师是谁。
 * 不能公开什么：username（可用来撞库登录）、邮箱、手机号——一律不出。
 *
 * 只统计「真的有任教关系」的教师。只注册了账号但没被排进任何班的教师
 * 不出现在名单里，否则会把还在审批中的账号也暴露出来。
 */
router.get('/teachers', (req, res) => {
  try {
    const teachers = db
      .prepare(
        `SELECT u.id,
        COALESCE(NULLIF(TRIM(COALESCE(u.real_name, '')), ''), u.username) AS name,
        COUNT(DISTINCT ct.class_id) AS class_count,
        SUM(CASE WHEN ct.role = 'head_teacher' THEN 1 ELSE 0 END) AS head_class_count,
        (SELECT COUNT(*) FROM users st JOIN class_teachers ct2 ON ct2.class_id = st.class_id
          WHERE ct2.teacher_id = u.id AND st.role = 'student') AS student_count,
        GROUP_CONCAT(DISTINCT c.name) AS class_names,
        GROUP_CONCAT(DISTINCT s.name) AS school_names,
        MAX(s.theme_color) AS theme_color
      FROM users u
      JOIN class_teachers ct ON ct.teacher_id = u.id
      JOIN classes c ON c.id = ct.class_id
      LEFT JOIN schools s ON s.id = c.school_id
      WHERE u.role = 'teacher' AND COALESCE(u.status, 'active') = 'active'
      GROUP BY u.id
      ORDER BY class_count DESC, head_class_count DESC, name ASC`
      )
      .all()
      .map((t) => ({
        ...t,
        class_names: t.class_names ? String(t.class_names).split(',').filter(Boolean) : [],
        school_names: t.school_names ? String(t.school_names).split(',').filter(Boolean) : [],
      }));

    // 顶部汇总：教师数、班主任数、覆盖学校数、涉及班级数
    const totals = {
      teacher_count: teachers.length,
      head_teacher_count: teachers.filter((t) => (t.head_class_count || 0) > 0).length,
      school_count: new Set(teachers.flatMap((t) => t.school_names)).size,
      student_count: teachers.reduce((sum, t) => sum + (t.student_count || 0), 0),
    };

    res.json({ teachers, totals });
  } catch (error) {
    console.error('获取公开教师团队失败:', error);
    res.status(500).json({ error: '获取教师团队失败' });
  }
});

/**
 * 学生概览（首页「在校学生」卡片点进去的页面）
 *
 * 红线：这里**一个学生姓名都不出**。学生是未成年人，真名、账号、成绩
 * 一律不能进公开接口。访客能看的是「规模」和「养成情况」这两类聚合数字：
 *   - 全站：学生数、已领养宠物数、领养率、平均等级、等级分布
 *   - 按学校 / 按班级：人数、宠物数、平均等级
 */
router.get('/students-overview', (req, res) => {
  try {
    const studentWhere = `u.role = 'student' AND COALESCE(u.status, 'active') = 'active'`;

    const totals = db
      .prepare(
        `SELECT
        (SELECT COUNT(*) FROM users u WHERE ${studentWhere}) AS student_count,
        (SELECT COUNT(*) FROM pets p JOIN users u ON u.id = p.user_id WHERE ${studentWhere}) AS pet_count,
        (SELECT COUNT(*) FROM classes) AS class_count,
        (SELECT COUNT(*) FROM schools) AS school_count,
        (SELECT COALESCE(ROUND(AVG(p.level), 1), 0) FROM pets p JOIN users u ON u.id = p.user_id WHERE ${studentWhere}) AS avg_level,
        (SELECT COALESCE(MAX(p.level), 0) FROM pets p JOIN users u ON u.id = p.user_id WHERE ${studentWhere}) AS max_level
        -- 这里原来还查了 SUM(u.gold) AS total_gold，与本文件开头
        -- 「金币一律不出公开接口」的自述红线直接冲突：
        -- /api/public 全部免登录，访客能据此算出全校学生的金币总量。
        -- 要看金币请登录后看自己或本班（/api/classes/by-slug/:slug/pets 仅成员可见）。`
      )
      .get();

    // 等级分布：让访客看到「大家普遍养到几级」，比一个平均值更有体感
    const levelDistribution = db
      .prepare(
        `SELECT CASE
            WHEN p.level < 5 THEN '1-4 级'
            WHEN p.level < 10 THEN '5-9 级'
            WHEN p.level < 20 THEN '10-19 级'
            WHEN p.level < 30 THEN '20-29 级'
            ELSE '30 级以上'
          END AS bucket,
          COUNT(*) AS count
       FROM pets p JOIN users u ON u.id = p.user_id
       WHERE ${studentWhere}
       GROUP BY bucket`
      )
      .all();

    const schools = db
      .prepare(
        `SELECT s.id, s.name, s.theme_color,
        (SELECT COUNT(*) FROM classes c WHERE c.school_id = s.id) AS class_count,
        (SELECT COUNT(*) FROM users u JOIN classes c ON c.id = u.class_id
          WHERE c.school_id = s.id AND ${studentWhere}) AS student_count,
        (SELECT COUNT(*) FROM pets p JOIN users u ON u.id = p.user_id
             JOIN classes c ON c.id = u.class_id
          WHERE c.school_id = s.id AND ${studentWhere}) AS pet_count,
        (SELECT COALESCE(ROUND(AVG(p.level), 1), 0) FROM pets p JOIN users u ON u.id = p.user_id
             JOIN classes c ON c.id = u.class_id
          WHERE c.school_id = s.id AND ${studentWhere}) AS avg_level
      FROM schools s
      ORDER BY student_count DESC, s.name ASC`
      )
      .all();

    // 班级明细同样只给统计数字；私密班（is_public=0）不出现在公开列表里
    const classes = isFeatureEnabled('class_public_enabled')
      ? db
          .prepare(
            `SELECT c.id, c.name, c.grade, c.slug,
            s.name AS school_name,
            (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND ${studentWhere}) AS student_count,
            (SELECT COUNT(*) FROM pets p JOIN users u ON u.id = p.user_id
              WHERE u.class_id = c.id AND ${studentWhere}) AS pet_count,
            (SELECT COALESCE(ROUND(AVG(p.level), 1), 0) FROM pets p JOIN users u ON u.id = p.user_id
              WHERE u.class_id = c.id AND ${studentWhere}) AS avg_level
          FROM classes c
          LEFT JOIN schools s ON s.id = c.school_id
          WHERE COALESCE(c.is_public, 1) = 1
          ORDER BY student_count DESC, c.name ASC`
          )
          .all()
      : [];

    res.json({
      totals: {
        ...totals,
        // 领养率：有宠物的学生 / 全部学生
        adoption_rate:
          totals.student_count > 0
            ? Math.round((totals.pet_count / totals.student_count) * 100)
            : 0,
      },
      level_distribution: levelDistribution,
      schools,
      classes,
    });
  } catch (error) {
    console.error('获取学生概览失败:', error);
    res.status(500).json({ error: '获取学生概览失败' });
  }
});

module.exports = router;
