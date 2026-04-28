// 学校相关路由（本期仅最小）
const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 学校列表（公开，供注册时选择）
router.get('/', (req, res) => {
  try {
    const schools = db
      .prepare(
        `SELECT id, name, city, region, logo, theme_color,
           (SELECT COUNT(*) FROM classes WHERE school_id = schools.id) AS class_count
         FROM schools
         ORDER BY name ASC`
      )
      .all();
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

// 学校下的班级列表（公开主页用）
router.get('/:id/classes', (req, res) => {
  try {
    const schoolId = parseInt(req.params.id, 10);
    const school = db.prepare(`SELECT * FROM schools WHERE id = ?`).get(schoolId);
    if (!school) return res.status(404).json({ error: '学校不存在' });
    const classes = db
      .prepare(
        `SELECT c.id, c.name, c.grade, c.slug, c.is_public,
           (SELECT COUNT(*) FROM users WHERE class_id = c.id AND role = 'student') AS student_count
         FROM classes c
         WHERE c.school_id = ?
         ORDER BY c.created_at DESC`
      )
      .all(schoolId);
    res.json({ school, classes });
  } catch (error) {
    console.error('获取学校班级失败:', error);
    res.status(500).json({ error: '获取学校班级失败' });
  }
});

module.exports = router;
