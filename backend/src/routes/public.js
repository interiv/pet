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

module.exports = router;
