const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
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

router.get('/announcements', authenticateToken, requireAdmin, (req, res) => {
  try {
    const announcements = db.prepare(`
      SELECT a.*, COALESCE(u.real_name, u.username) as publisher_name, c.name as class_name
      FROM announcements a 
      LEFT JOIN users u ON a.publisher_id = u.id
      LEFT JOIN classes c ON a.class_id = c.id
      ORDER BY a.created_at DESC
    `).all();
    res.json({ announcements });
  } catch (error) {
    console.error('获取公告失败:', error);
    res.status(500).json({ error: '获取公告失败' });
  }
});

router.post('/announcements', authenticateToken, (req, res) => {
  try {
    const { title, content, class_ids, priority, expires_at } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (!title) {
      return res.status(400).json({ error: '公告标题不能为空' });
    }

    // 学生无权发布公告（原先此处无任何角色校验，学生可直接调用）
    if (userRole === 'student') {
      return res.status(403).json({ error: '学生无权发布公告' });
    }

    // 统一转成数字，避免前端传字符串时 includes 判定失准而误放行越权班级
    let requestedIds = Array.isArray(class_ids) && class_ids.length > 0
      ? [...new Set(class_ids.map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n)))]
      : [];

    if (userRole === 'teacher') {
      const myClassIds = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(userId).map(row => row.class_id);
      if (requestedIds.length > 0) {
        const invalidIds = requestedIds.filter((id) => !myClassIds.includes(id));
        if (invalidIds.length > 0) {
          return res.status(403).json({ error: '只能为自己所属的班级发布公告' });
        }
      } else {
        // 未指定班级时，教师只能发给自己的全部班级，且不得退化成全站公告
        if (myClassIds.length === 0) {
          return res.status(403).json({ error: '你尚未加入任何班级，无法发布公告' });
        }
        requestedIds = myClassIds;
      }
    }

    const insertAnn = db.prepare(`
      INSERT INTO announcements (title, content, class_id, publisher_id, priority, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
    `);

    // 多条公告必须同生同死，避免部分写入
    db.transaction(() => {
      if (requestedIds.length > 0) {
        for (const classId of requestedIds) {
          insertAnn.run(title, content || '', classId, userId, priority || 0, expires_at || null);
        }
      } else {
        // 仅管理员（未指定班级）可发布全站公告
        insertAnn.run(title, content || '', null, userId, priority || 0, expires_at || null);
      }
    })();

    res.json({ message: '公告创建成功' });
  } catch (error) {
    console.error('创建公告失败:', error);
    res.status(500).json({ error: '创建公告失败' });
  }
});

router.put('/announcements/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, class_id, priority, expires_at } = req.body;
    
    const announcement = db.prepare(`SELECT id FROM announcements WHERE id = ?`).get(id);
    if (!announcement) {
      return res.status(404).json({ error: '公告不存在' });
    }
    
    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (content !== undefined) { updates.push('content = ?'); params.push(content); }
    if (class_id !== undefined) { updates.push('class_id = ?'); params.push(class_id); }
    if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
    if (expires_at !== undefined) { updates.push('expires_at = ?'); params.push(expires_at); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    params.push(id);
    db.prepare(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: '公告更新成功' });
  } catch (error) {
    console.error('更新公告失败:', error);
    res.status(500).json({ error: '更新公告失败' });
  }
});

router.delete('/announcements/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    
    const result = db.prepare(`DELETE FROM announcements WHERE id = ?`).run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: '公告不存在' });
    }
    res.json({ message: '公告已删除' });
  } catch (error) {
    console.error('删除公告失败:', error);
    res.status(500).json({ error: '删除公告失败' });
  }
});

module.exports = router;
