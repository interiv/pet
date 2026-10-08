// 学校相关路由（本期仅最小）
const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 学校列表（公开，供注册时选择、首页展示）
//
// 聚合字段说明：
//   class_count   该校下的班级数
//   student_count 真实学生数（含私密班）。原先首页是把这个数字算在前端的，
//                 而前端只能看到 is_public=1 的班，于是私密班的学生被漏掉，
//                 学校显示的人数一直偏少。人数必须由服务端算。
//   teacher_count 该校下的教师数（班主任 + 任课教师，去重）
//   grades        该校出现的年级列表，供首页展开后按年级分组展示
router.get('/', (req, res) => {
  try {
    const schools = db
      .prepare(
        `SELECT s.id, s.name, s.city, s.region, s.logo, s.theme_color,
           (SELECT COUNT(*) FROM classes WHERE school_id = s.id) AS class_count,
           (SELECT COUNT(*)
              FROM users u JOIN classes c ON c.id = u.class_id
             WHERE c.school_id = s.id AND u.role = 'student') AS student_count,
           (SELECT COUNT(DISTINCT ct.teacher_id)
              FROM class_teachers ct JOIN classes c ON c.id = ct.class_id
             WHERE c.school_id = s.id) AS teacher_count,
           (SELECT GROUP_CONCAT(DISTINCT c.grade)
              FROM classes c
             WHERE c.school_id = s.id AND c.grade IS NOT NULL AND TRIM(c.grade) <> '') AS grades
         FROM schools s
         ORDER BY student_count DESC, s.name ASC`
      )
      .all()
      // grades 取出后拆成数组：SQLite 的 GROUP_CONCAT 返回逗号分隔的字符串，
      // 直接丢给前端的话前端还得再 split 一次，不如后端就拆好
      .map((s) => ({
        ...s,
        grades: s.grades ? String(s.grades).split(',').filter(Boolean) : [],
      }));
    res.json({ schools });
  } catch (error) {
    console.error('获取学校列表失败:', error);
    res.status(500).json({ error: '获取学校列表失败' });
  }
});

// 新建学校（教师/管理员可发起。首创者成为 admin_user_id）
router.post('/', authenticateToken, (req, res) => {
  try {
    const { name, city, region, theme_color } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '学校名称不能为空' });
    }
    if (!['teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: '只有教师或管理员可以创建学校' });
    }
    const existed = db.prepare(`SELECT id FROM schools WHERE name = ?`).get(name.trim());
    if (existed) {
      return res.status(400).json({ error: '学校名称已存在' });
    }
    const result = db
      .prepare(
        `INSERT INTO schools (name, city, region, admin_user_id, theme_color)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(name.trim(), city || null, region || null, req.user.userId, theme_color || '#1677ff');
    res.status(201).json({
      message: '创建成功',
      school: {
        id: result.lastInsertRowid,
        name: name.trim(),
        city: city || null,
        region: region || null,
        theme_color: theme_color || '#1677ff'
      }
    });
  } catch (error) {
    console.error('创建学校失败:', error);
    res.status(500).json({ error: '创建学校失败' });
  }
});

// 更新学校（管理员 或 学校创建者）
router.put('/:id', authenticateToken, (req, res) => {
  try {
    const schoolId = parseInt(req.params.id, 10);
    const school = db.prepare(`SELECT * FROM schools WHERE id = ?`).get(schoolId);
    if (!school) return res.status(404).json({ error: '学校不存在' });
    if (req.user.role !== 'admin' && school.admin_user_id !== req.user.userId) {
      return res.status(403).json({ error: '无权修改该学校' });
    }
    const { name, city, region, theme_color, logo } = req.body || {};
    const fields = [];
    const params = [];
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: '学校名称不能为空' });
      const dup = db.prepare(`SELECT id FROM schools WHERE name = ? AND id <> ?`).get(name.trim(), schoolId);
      if (dup) return res.status(400).json({ error: '学校名称已存在' });
      fields.push('name = ?'); params.push(name.trim());
    }
    if (city !== undefined) { fields.push('city = ?'); params.push(city || null); }
    if (region !== undefined) { fields.push('region = ?'); params.push(region || null); }
    if (theme_color !== undefined) { fields.push('theme_color = ?'); params.push(theme_color || null); }
    if (logo !== undefined) { fields.push('logo = ?'); params.push(logo || null); }
    if (!fields.length) return res.status(400).json({ error: '没有要更新的字段' });
    params.push(schoolId);
    db.prepare(`UPDATE schools SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: '更新成功' });
  } catch (error) {
    console.error('更新学校失败:', error);
    res.status(500).json({ error: '更新学校失败' });
  }
});

// 删除学校（仅管理员；学校无班级时才允许）
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '仅管理员可删除学校' });
    }
    const schoolId = parseInt(req.params.id, 10);
    const school = db.prepare(`SELECT id FROM schools WHERE id = ?`).get(schoolId);
    if (!school) return res.status(404).json({ error: '学校不存在' });
    const hasClasses = db.prepare(`SELECT COUNT(*) AS c FROM classes WHERE school_id = ?`).get(schoolId).c;
    if (hasClasses > 0) {
      return res.status(400).json({ error: '该学校下仍有班级，无法删除' });
    }
    db.prepare(`DELETE FROM schools WHERE id = ?`).run(schoolId);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除学校失败:', error);
    res.status(500).json({ error: '删除学校失败' });
  }
});

// 学校下的班级列表（公开主页 + 首页展开用）
//
// 隐私口径：is_public=0 的私密班也返回，但只给基础信息（名字/年级/人数），
// 不返回 slug —— slug 是班级公开主页的钥匙，私密班不该被外人顺着链接进去。
// 首页据此把私密班标成「未公开」，不提供跳转。
router.get('/:id/classes', (req, res) => {
  try {
    const schoolId = parseInt(req.params.id, 10);
    const school = db.prepare(`SELECT * FROM schools WHERE id = ?`).get(schoolId);
    if (!school) return res.status(404).json({ error: '学校不存在' });
    const classes = db
      .prepare(
        `SELECT c.id, c.name, c.grade, c.slug, c.is_public,
           (SELECT COUNT(*) FROM users WHERE class_id = c.id AND role = 'student') AS student_count,
           (SELECT COUNT(DISTINCT ct.teacher_id) FROM class_teachers ct WHERE ct.class_id = c.id) AS teacher_count,
           (SELECT COALESCE(u.real_name, u.username) FROM users u WHERE u.id = c.head_teacher_id) AS head_teacher_name
         FROM classes c
         WHERE c.school_id = ?
      ORDER BY c.grade ASC, c.created_at DESC`
      )
      .all(schoolId)
      .map((c) => ({ ...c, slug: c.is_public ? c.slug : null }));
    res.json({ school, classes });
  } catch (error) {
    console.error('获取学校班级失败:', error);
    res.status(500).json({ error: '获取学校班级失败' });
  }
});

module.exports = router;
