const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足，需要管理员角色' });
  }
  next();
};

// ==================== 教师管理 ====================

// 获取所有教师列表
router.get('/teachers', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = `SELECT id, username, email, avatar, created_at, last_login, status FROM users WHERE role = 'teacher'`;
    const params = [];
    
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (search) {
      sql += ` AND (username LIKE ? OR email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY created_at DESC`;
    
    const teachers = db.prepare(sql).all(...params);
    res.json({ teachers });
  } catch (error) {
    console.error('获取教师列表失败:', error);
    res.status(500).json({ error: '获取教师列表失败' });
  }
});

// 获取待审批的教师列表
router.get('/pending-teachers', authenticateToken, requireAdmin, (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT id, username, email, created_at, status 
      FROM users 
      WHERE role = 'teacher' AND status = 'pending_approval'
    `).all();
    res.json({ teachers });
  } catch (error) {
    console.error('获取待审批教师失败:', error);
    res.status(500).json({ error: '获取待审批教师失败' });
  }
});

// 审批教师注册
router.post('/approve-teacher', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { teacher_id, action } = req.body;
    
    if (action === 'approve') {
      db.prepare(`UPDATE users SET status = 'active' WHERE id = ? AND role = 'teacher'`).run(teacher_id);
      res.json({ message: '教师审批通过' });
    } else if (action === 'reject') {
      db.prepare(`DELETE FROM users WHERE id = ? AND role = 'teacher' AND status = 'pending_approval'`).run(teacher_id);
      res.json({ message: '教师注册已拒绝' });
    } else {
      res.status(400).json({ error: '无效的操作' });
    }
  } catch (error) {
    console.error('审批教师失败:', error);
    res.status(500).json({ error: '审批教师失败' });
  }
});

// 更新教师信息
router.put('/teachers/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, avatar, status } = req.body;
    
    const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher'`).get(id);
    if (!teacher) {
      return res.status(404).json({ error: '教师不存在' });
    }
    
    const updates = [];
    const params = [];
    if (username !== undefined) { updates.push('username = ?'); params.push(username); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: '教师信息更新成功' });
  } catch (error) {
    console.error('更新教师信息失败:', error);
    res.status(500).json({ error: '更新教师信息失败' });
  }
});

// 删除/禁用教师
router.delete('/teachers/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    
    const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher'`).get(id);
    if (!teacher) {
      return res.status(404).json({ error: '教师不存在' });
    }
    
    if (action === 'disable') {
      db.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).run(id);
      res.json({ message: '教师已被禁用' });
    } else if (action === 'delete') {
      db.prepare(`DELETE FROM users WHERE id = ? AND role = 'teacher'`).run(id);
      res.json({ message: '教师已删除' });
    } else {
      res.status(400).json({ error: '无效的操作' });
    }
  } catch (error) {
    console.error('删除/禁用教师失败:', error);
    res.status(500).json({ error: '删除/禁用教师失败' });
  }
});

// ==================== 学生管理 ====================

// 获取所有学生列表
router.get('/students', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { status, class_id, search } = req.query;
    let sql = `SELECT u.id, u.username, u.email, u.avatar, u.class_id, u.gold, u.created_at, u.last_login, u.status, c.name as class_name 
               FROM users u LEFT JOIN classes c ON u.class_id = c.id WHERE u.role = 'student'`;
    const params = [];
    
    if (status) {
      sql += ` AND u.status = ?`;
      params.push(status);
    }
    if (class_id) {
      sql += ` AND u.class_id = ?`;
      params.push(class_id);
    }
    if (search) {
      sql += ` AND (u.username LIKE ? OR u.email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY u.created_at DESC`;
    
    const students = db.prepare(sql).all(...params);
    res.json({ students });
  } catch (error) {
    console.error('获取学生列表失败:', error);
    res.status(500).json({ error: '获取学生列表失败' });
  }
});

// 获取学生详情（含宠物、物品、装备）
router.get('/students/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    
    const student = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatar, u.class_id, u.gold, u.created_at, u.last_login, u.status, c.name as class_name
      FROM users u LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.id = ? AND u.role = 'student'
    `).get(id);
    
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }
    
    const pets = db.prepare(`SELECT * FROM pets WHERE user_id = ?`).all(id);
    const items = db.prepare(`
      SELECT ui.*, i.name, i.type, i.image_url 
      FROM user_items ui JOIN items i ON ui.item_id = i.id
      WHERE ui.user_id = ?
    `).all(id);
    const equipment = db.prepare(`
      SELECT ue.*, e.name, e.slot, e.rarity 
      FROM user_equipment ue JOIN equipment e ON ue.equipment_id = e.id
      WHERE ue.user_id = ?
    `).all(id);
    
    res.json({ student, pets, items, equipment });
  } catch (error) {
    console.error('获取学生详情失败:', error);
    res.status(500).json({ error: '获取学生详情失败' });
  }
});

// 更新学生信息
router.put('/students/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, avatar, class_id, status } = req.body;
    
    const student = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'student'`).get(id);
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }
    
    const updates = [];
    const params = [];
    if (username !== undefined) { updates.push('username = ?'); params.push(username); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
    if (class_id !== undefined) { updates.push('class_id = ?'); params.push(class_id); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: '学生信息更新成功' });
  } catch (error) {
    console.error('更新学生信息失败:', error);
    res.status(500).json({ error: '更新学生信息失败' });
  }
});

// 调整学生金币
router.post('/students/:id/gold', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    
    if (typeof amount !== 'number' || amount === 0) {
      return res.status(400).json({ error: '金币调整量无效' });
    }
    
    const student = db.prepare(`SELECT gold FROM users WHERE id = ? AND role = 'student'`).get(id);
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }
    
    const newGold = student.gold + amount;
    if (newGold < 0) {
      return res.status(400).json({ error: '金币不足，无法减少这么多' });
    }
    
    db.prepare(`UPDATE users SET gold = ? WHERE id = ?`).run(newGold, id);
    res.json({ message: `金币调整成功，${amount > 0 ? '增加' : '减少'}了 ${Math.abs(amount)} 金币`, new_gold: newGold });
  } catch (error) {
    console.error('调整金币失败:', error);
    res.status(500).json({ error: '调整金币失败' });
  }
});

// 删除/禁用学生
router.delete('/students/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    
    const student = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'student'`).get(id);
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }
    
    if (action === 'disable') {
      db.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).run(id);
      res.json({ message: '学生已被禁用' });
    } else if (action === 'delete') {
      db.prepare(`DELETE FROM pets WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM user_items WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM user_equipment WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM users WHERE id = ? AND role = 'student'`).run(id);
      res.json({ message: '学生及其数据已删除' });
    } else {
      res.status(400).json({ error: '无效的操作' });
    }
  } catch (error) {
    console.error('删除/禁用学生失败:', error);
    res.status(500).json({ error: '删除/禁用学生失败' });
  }
});

// ==================== 班级管理 ====================

// 获取所有班级列表
router.get('/classes', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let classes;
    if (userRole === 'admin') {
      classes = db.prepare(`
        SELECT c.*, u.username as teacher_name
        FROM classes c LEFT JOIN users u ON c.teacher_id = u.id
        ORDER BY c.created_at DESC
      `).all();
    } else {
      classes = db.prepare(`
        SELECT c.*, u.username as teacher_name
        FROM classes c 
        LEFT JOIN users u ON c.teacher_id = u.id
        INNER JOIN class_teachers ct ON c.id = ct.class_id
        WHERE ct.teacher_id = ?
        ORDER BY c.created_at DESC
      `).all(userId);
    }

    const classesWithTeachers = classes.map(cls => {
      const teachers = db.prepare(`
        SELECT ct.id as class_teacher_id, ct.role, u.id as teacher_id, u.username
        FROM class_teachers ct
        JOIN users u ON ct.teacher_id = u.id
        WHERE ct.class_id = ?
      `).all(cls.id);
      return { ...cls, teachers };
    });

    res.json({ classes: classesWithTeachers });
  } catch (error) {
    console.error('获取班级列表失败:', error);
    res.status(500).json({ error: '获取班级列表失败' });
  }
});

// 为班级添加老师
router.post('/classes/:id/teachers', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { teacher_id, role } = req.body;

    const cls = db.prepare(`SELECT id FROM classes WHERE id = ?`).get(id);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }

    if (!teacher_id) {
      return res.status(400).json({ error: '请指定教师' });
    }

    const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher' AND status = 'active'`).get(teacher_id);
    if (!teacher) {
      return res.status(400).json({ error: '指定的教师不存在或未激活' });
    }

    const existing = db.prepare(`SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ?`).get(id, teacher_id);
    if (existing) {
      return res.status(400).json({ error: '该教师已在班级中' });
    }

    const result = db.prepare(`
      INSERT INTO class_teachers (class_id, teacher_id, role)
      VALUES (?, ?, ?)
    `).run(id, teacher_id, role || 'teacher');

    res.json({ message: '教师已添加到班级', class_teacher_id: result.lastInsertRowid });
  } catch (error) {
    console.error('添加教师到班级失败:', error);
    res.status(500).json({ error: '添加教师到班级失败' });
  }
});

// 从班级移除老师
router.delete('/classes/:id/teachers/:teacherId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id, teacherId } = req.params;

    const result = db.prepare(`DELETE FROM class_teachers WHERE class_id = ? AND teacher_id = ?`).run(id, teacherId);
    if (result.changes === 0) {
      return res.status(404).json({ error: '该教师不在班级中' });
    }

    res.json({ message: '教师已从班级移除' });
  } catch (error) {
    console.error('从班级移除教师失败:', error);
    res.status(500).json({ error: '从班级移除教师失败' });
  }
});

// ==================== 班级申请审批（班主任） ====================

// 获取班级的申请列表（班主任查看本班申请）
router.get('/class-applications', authenticateToken, (req, res) => {
  try {
    const { class_id, status } = req.query;

    let sql = `
      SELECT ca.*, u.username, u.email, c.name as class_name
      FROM class_applications ca
      JOIN users u ON ca.user_id = u.id
      JOIN classes c ON ca.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // 权限检查：班主任只能查看本班申请
    if (req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`
        SELECT class_id FROM class_teachers WHERE teacher_id = ? AND role = 'head_teacher'
      `).all(req.user.userId);
      if (teacherClasses.length === 0) {
        return res.status(403).json({ error: '只有班主任才能审批申请' });
      }
      const classIds = teacherClasses.map(tc => tc.class_id);
      if (class_id) {
        if (!classIds.includes(parseInt(class_id))) {
          return res.status(403).json({ error: '只能查看本班的申请' });
        }
        sql += ` AND ca.class_id = ?`;
        params.push(parseInt(class_id));
      } else {
        sql += ` AND ca.class_id IN (${classIds.map(() => '?').join(',')})`;
        params.push(...classIds);
      }
    } else if (req.user.role === 'student') {
      return res.status(403).json({ error: '学生无法查看申请列表' });
    } else if (req.user.role === 'admin') {
      if (class_id) {
        sql += ` AND ca.class_id = ?`;
        params.push(parseInt(class_id));
      }
    }

    if (status) {
      sql += ` AND ca.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY ca.created_at DESC`;

    const applications = db.prepare(sql).all(...params);
    res.json({ applications });
  } catch (error) {
    console.error('获取申请列表失败:', error);
    res.status(500).json({ error: '获取申请列表失败' });
  }
});

// 审批申请
router.put('/class-applications/:id/review', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: '无效的审批状态' });
    }

    // 获取申请信息
    const application = db.prepare(`
      SELECT ca.*, c.teacher_id as head_teacher_id
      FROM class_applications ca
      JOIN classes c ON ca.class_id = c.id
      WHERE ca.id = ?
    `).get(id);

    if (!application) {
      return res.status(404).json({ error: '申请不存在' });
    }

    // 权限检查：只有班主任或管理员可以审批
    if (req.user.role === 'teacher') {
      const isHeadTeacher = db.prepare(`
        SELECT id FROM class_teachers
        WHERE class_id = ? AND teacher_id = ? AND role = 'head_teacher'
      `).get(application.class_id, req.user.userId);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任才能审批申请' });
      }
    } else if (req.user.role === 'student') {
      return res.status(403).json({ error: '学生无法审批申请' });
    }

    // 更新申请状态
    db.prepare(`
      UPDATE class_applications
      SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, req.user.userId, id);

    // 如果批准，将用户分配到班级
    if (status === 'approved') {
      if (application.role === 'student') {
        db.prepare('UPDATE users SET class_id = ?, status = ? WHERE id = ?')
          .run(application.class_id, 'active', application.user_id);
        // 更新班级学生数
        db.prepare('UPDATE classes SET student_count = student_count + 1 WHERE id = ?')
          .run(application.class_id);
      } else if (application.role === 'teacher') {
        // 将老师添加到班级老师列表
        const existing = db.prepare('SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ?')
          .get(application.class_id, application.user_id);
        if (!existing) {
          db.prepare('INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, ?)')
            .run(application.class_id, application.user_id, 'teacher');
        }
        // 检查是否所有申请都通过了
        const pendingApps = db.prepare(`
          SELECT id FROM class_applications
          WHERE user_id = ? AND status = 'pending'
        `).all(application.user_id);
        if (pendingApps.length === 0) {
          db.prepare('UPDATE users SET status = ? WHERE id = ?')
            .run('active', application.user_id);
        }
      }
    }

    res.json({ message: status === 'approved' ? '已批准申请' : '已拒绝申请' });
  } catch (error) {
    console.error('审批申请失败:', error);
    res.status(500).json({ error: '审批申请失败' });
  }
});

// 创建班级
router.post('/classes', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, grade, teacher_id } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: '班级名称不能为空' });
    }
    
    if (teacher_id) {
      const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher' AND status = 'active'`).get(teacher_id);
      if (!teacher) {
        return res.status(400).json({ error: '指定的教师不存在或未激活' });
      }
    }
    
    const result = db.prepare(`
      INSERT INTO classes (name, grade, teacher_id, student_count, total_exp, created_at)
      VALUES (?, ?, ?, 0, 0, datetime('now'))
    `).run(name, grade || null, teacher_id || null);
    
    res.json({ message: '班级创建成功', class_id: result.lastInsertRowid });
  } catch (error) {
    console.error('创建班级失败:', error);
    res.status(500).json({ error: '创建班级失败' });
  }
});

// 更新班级信息
router.put('/classes/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, grade, teacher_id } = req.body;
    
    const cls = db.prepare(`SELECT id FROM classes WHERE id = ?`).get(id);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }
    
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (grade !== undefined) { updates.push('grade = ?'); params.push(grade); }
    if (teacher_id !== undefined) {
      if (teacher_id) {
        const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'teacher' AND status = 'active'`).get(teacher_id);
        if (!teacher) {
          return res.status(400).json({ error: '指定的教师不存在或未激活' });
        }
      }
      updates.push('teacher_id = ?');
      params.push(teacher_id || null);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    params.push(id);
    db.prepare(`UPDATE classes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: '班级信息更新成功' });
  } catch (error) {
    console.error('更新班级信息失败:', error);
    res.status(500).json({ error: '更新班级信息失败' });
  }
});

// 删除班级
router.delete('/classes/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    
    const cls = db.prepare(`SELECT id, student_count FROM classes WHERE id = ?`).get(id);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }
    
    if (cls.student_count > 0) {
      return res.status(400).json({ error: '班级中还有学生，无法删除' });
    }
    
    db.prepare(`UPDATE classes SET teacher_id = NULL WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM classes WHERE id = ?`).run(id);
    res.json({ message: '班级已删除' });
  } catch (error) {
    console.error('删除班级失败:', error);
    res.status(500).json({ error: '删除班级失败' });
  }
});

// ==================== 系统公告管理 ====================

// 获取所有公告
router.get('/announcements', authenticateToken, requireAdmin, (req, res) => {
  try {
    const announcements = db.prepare(`
      SELECT a.*, u.username as publisher_name, c.name as class_name
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

// 创建公告
router.post('/announcements', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, content, class_id, priority, expires_at } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: '公告标题不能为空' });
    }
    
    const result = db.prepare(`
      INSERT INTO announcements (title, content, class_id, publisher_id, priority, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
    `).run(title, content || '', class_id || null, req.user.userId, priority || 0, expires_at || null);
    
    res.json({ message: '公告创建成功', announcement_id: result.lastInsertRowid });
  } catch (error) {
    console.error('创建公告失败:', error);
    res.status(500).json({ error: '创建公告失败' });
  }
});

// 更新公告
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

// 删除公告
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

// ==================== 数据统计 ====================

// 获取系统统计信息
router.get('/statistics', authenticateToken, (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    
    const totalUsers = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
    const totalTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher'`).get().count;
    const totalStudents = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'student'`).get().count;
    const totalGold = db.prepare(`SELECT SUM(gold) as total FROM users`).get().total || 0;
    
    let statistics = {
      users: { total: totalUsers, teachers: totalTeachers, students: totalStudents },
      totals: { gold: totalGold }
    };
    
    if (userRole === 'admin') {
      const totalClasses = db.prepare(`SELECT COUNT(*) as count FROM classes`).get().count;
      const totalPets = db.prepare(`SELECT COUNT(*) as count FROM pets`).get().count;
      const totalBattles = db.prepare(`SELECT COUNT(*) as count FROM battles`).get().count;
      const activeTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND status = 'active'`).get().count;
      const pendingTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher' AND status = 'pending_approval'`).get().count;
      const totalExp = db.prepare(`SELECT SUM(exp) as total FROM pets`).get().total || 0;
      
      const topClasses = db.prepare(`
        SELECT c.name, c.total_exp, c.student_count, u.username as teacher_name
        FROM classes c LEFT JOIN users u ON c.teacher_id = u.id
        ORDER BY c.total_exp DESC LIMIT 5
      `).all();
      
      const recentRegistrations = db.prepare(`
        SELECT id, username, role, created_at FROM users ORDER BY created_at DESC LIMIT 10
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
        top_classes: topClasses,
        recent_registrations: recentRegistrations
      };
    } else if (userRole === 'teacher') {
      const myClasses = db.prepare(`
        SELECT COUNT(*) as count FROM class_teachers WHERE teacher_id = ?
      `).get(userId).count;
      
      const myClassIds = db.prepare(`
        SELECT class_id FROM class_teachers WHERE teacher_id = ?
      `).all(userId).map(row => row.class_id);
      
      let studentCount = 0;
      if (myClassIds.length > 0) {
        const placeholders = myClassIds.map(() => '?').join(',');
        studentCount = db.prepare(`
          SELECT COUNT(*) as count FROM users WHERE role = 'student' AND class_id IN (${placeholders})
        `).get(...myClassIds).count;
      }
      
      statistics = {
        ...statistics,
        classes: { total: myClasses },
        users: { students: studentCount }
      };
    }
    
    res.json({ statistics });
  } catch (error) {
    console.error('获取统计信息失败:', error);
    res.status(500).json({ error: '获取统计信息失败' });
  }
});

// ==================== AI设置 ====================

// 获取大模型设置
router.get('/settings/ai', authenticateToken, requireAdmin, (req, res) => {
  try {
    const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`).get();
    if (!hasTable) {
      db.prepare(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_model', 'gpt-3.5-turbo')`).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_api_key', '')`).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('ai_base_url', 'https://api.openai.com/v1')`).run();
    }
    
    const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
    const result = {};
    settings.forEach(s => result[s.key] = s.value);
    res.json({ settings: result });
  } catch (error) {
    console.error('获取设置失败:', error);
    res.status(500).json({ error: '获取设置失败' });
  }
});

// 保存大模型设置
router.post('/settings/ai', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { ai_model, ai_api_key, ai_base_url } = req.body;
    
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      if (ai_model !== undefined) stmt.run('ai_model', ai_model);
      if (ai_api_key !== undefined) stmt.run('ai_api_key', ai_api_key);
      if (ai_base_url !== undefined) stmt.run('ai_base_url', ai_base_url);
    })();
    
    res.json({ message: '设置保存成功' });
  } catch (error) {
    console.error('保存设置失败:', error);
    res.status(500).json({ error: '保存设置失败' });
  }
});

module.exports = router;