const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getChinaDate } = require('../config/timezone');

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足，需要管理员角色' });
  }
  next();
};

// ==================== 教师管理 ====================

// 获取所有教师列表（教师/管理员可用；学生禁止）
router.get('/teachers', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权访问教师列表' });
    }
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
router.get('/students', authenticateToken, (req, res) => {
  try {
    const { status, class_id, search } = req.query;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole === 'student') {
      return res.status(403).json({ error: '无权访问学生列表' });
    }

    let sql = `SELECT u.id, u.username, u.email, u.avatar, u.class_id, u.gold, u.created_at, u.last_login, u.status, c.name as class_name 
               FROM users u LEFT JOIN classes c ON u.class_id = c.id WHERE u.role = 'student'`;
    const params = [];
    
    if (userRole === 'teacher') {
      const myClassIds = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(userId).map(row => row.class_id).filter(id => id != null);
      if (myClassIds.length > 0) {
        const placeholders = myClassIds.map(() => '?').join(',');
        sql += ` AND u.class_id IN (${placeholders})`;
        params.push(...myClassIds);
      } else {
        sql += ` AND 1=0`;
      }
    }
    
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
router.get('/students/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole === 'student') {
      return res.status(403).json({ error: '无权查看学生详情' });
    }

    const student = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatar, u.class_id, u.gold, u.created_at, u.last_login, u.status, c.name as class_name
      FROM users u LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.id = ? AND u.role = 'student'
    `).get(id);
    
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    if (userRole === 'teacher') {
      const isMyClass = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(userId, student.class_id);
      if (!isMyClass) {
        return res.status(403).json({ error: '只能查看本班学生详情' });
      }
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

// 更新学生信息（管理员 或 本班班主任）
router.put('/students/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, avatar, class_id, status } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole === 'student') {
      return res.status(403).json({ error: '无权修改学生信息' });
    }

    const student = db.prepare(`SELECT id, class_id FROM users WHERE id = ? AND role = 'student'`).get(id);
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    if (userRole === 'teacher') {
      const isHeadTeacher = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
      ).get(userId, student.class_id);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任可以修改本班学生信息' });
      }
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

// 调整学生金币（管理员 或 本班班主任）
router.post('/students/:id/gold', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole === 'student') {
      return res.status(403).json({ error: '无权调整金币' });
    }

    if (typeof amount !== 'number' || amount === 0) {
      return res.status(400).json({ error: '金币调整量无效' });
    }
    
    const student = db.prepare(`SELECT gold, class_id FROM users WHERE id = ? AND role = 'student'`).get(id);
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    if (userRole === 'teacher') {
      const isHeadTeacher = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
      ).get(userId, student.class_id);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任可以调整本班学生金币' });
      }
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

// 删除/禁用学生（管理员 或 本班班主任）
router.delete('/students/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const student = db.prepare(`SELECT id, class_id FROM users WHERE id = ? AND role = 'student'`).get(id);
    if (!student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    if (userRole === 'teacher') {
      const isHeadTeacher = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
      ).get(userId, student.class_id);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任可以禁用或删除本班学生' });
      }
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
    const userId = req.user.userId;
    const userRole = req.user.role;

    let classes;
    if (userRole === 'admin') {
      classes = db.prepare(`
        SELECT c.*, u.username as teacher_name, s.name AS school_name,
          (SELECT COUNT(*) FROM users WHERE class_id = c.id AND role = 'student') as student_count,
          (SELECT COALESCE(SUM(exp), 0) FROM pets WHERE user_id IN (SELECT id FROM users WHERE class_id = c.id AND role = 'student')) as total_exp,
          (SELECT COALESCE(SUM(gold), 0) FROM users WHERE class_id = c.id AND role = 'student') as total_gold
        FROM classes c
        LEFT JOIN users u ON c.teacher_id = u.id
        LEFT JOIN schools s ON c.school_id = s.id
        ORDER BY c.created_at DESC
      `).all();
    } else {
      classes = db.prepare(`
        SELECT c.*, u.username as teacher_name, s.name AS school_name,
          (SELECT COUNT(*) FROM users WHERE class_id = c.id AND role = 'student') as student_count,
          (SELECT COALESCE(SUM(exp), 0) FROM pets WHERE user_id IN (SELECT id FROM users WHERE class_id = c.id AND role = 'student')) as total_exp,
          (SELECT COALESCE(SUM(gold), 0) FROM users WHERE class_id = c.id AND role = 'student') as total_gold
        FROM classes c
        LEFT JOIN users u ON c.teacher_id = u.id
        LEFT JOIN schools s ON c.school_id = s.id
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
router.post('/classes/:id/teachers', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { teacher_id, role } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const cls = db.prepare(`SELECT id FROM classes WHERE id = ?`).get(id);
    if (!cls) {
      return res.status(404).json({ error: '班级不存在' });
    }

    if (!teacher_id) {
      return res.status(400).json({ error: '请指定教师' });
    }

    if (userRole !== 'admin') {
      const myHeadTeacherClass = db.prepare(`SELECT id FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`).get(userId, id);
      if (!myHeadTeacherClass) {
        return res.status(403).json({ error: '只有班主任可以添加本班教师' });
      }
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

// 从班级移除老师（管理员 或 本班班主任）
router.delete('/classes/:id/teachers/:teacherId', authenticateToken, (req, res) => {
  try {
    const { id, teacherId } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole !== 'admin') {
      const isHeadTeacher = db.prepare(
        `SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ? AND role = 'head_teacher'`
      ).get(id, userId);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '只有班主任或管理员可以移除教师' });
      }
    }

    const targetRecord = db.prepare(
      `SELECT role FROM class_teachers WHERE class_id = ? AND teacher_id = ?`
    ).get(id, teacherId);
    if (!targetRecord) {
      return res.status(404).json({ error: '该教师不在班级中' });
    }
    if (targetRecord.role === 'head_teacher') {
      return res.status(400).json({ error: '不能移除班主任，请先更换班主任' });
    }

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

// 更新班级信息（管理员，可改核心字段）
router.put('/classes/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, grade, teacher_id, description, is_public, cover_image, slug, school_id } = req.body;

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
    if (description !== undefined) { updates.push('description = ?'); params.push(description || null); }
    if (is_public !== undefined) { updates.push('is_public = ?'); params.push(is_public ? 1 : 0); }
    if (cover_image !== undefined) { updates.push('cover_image = ?'); params.push(cover_image || null); }
    if (slug !== undefined) {
      const s = String(slug || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{2,31}$/i.test(s)) {
        return res.status(400).json({ error: 'slug 需 3-32 位字母/数字/连字符，且首字符为字母或数字' });
      }
      const dup = db.prepare(`SELECT id FROM classes WHERE slug = ? AND id <> ?`).get(s, id);
      if (dup) return res.status(400).json({ error: '该 slug 已被占用' });
      updates.push('slug = ?'); params.push(s);
    }
    if (school_id !== undefined) {
      if (school_id) {
        const school = db.prepare(`SELECT id FROM schools WHERE id = ?`).get(school_id);
        if (!school) return res.status(400).json({ error: '指定的学校不存在' });
      }
      updates.push('school_id = ?'); params.push(school_id || null);
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

// 未分班学生（管理员/教师查看自己班级可邀请的候选）
router.get('/unassigned-students', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权查看' });
    }
    const students = db.prepare(`
      SELECT id, username, email, avatar, created_at, status
      FROM users
      WHERE role = 'student' AND (class_id IS NULL OR status = 'pending_approval')
      ORDER BY created_at DESC
    `).all();
    res.json({ students });
  } catch (error) {
    console.error('获取未分班学生失败:', error);
    res.status(500).json({ error: '获取未分班学生失败' });
  }
});

// 指派学生到班级（管理员 或 目标班级的班主任）
router.post('/students/:id/assign-class', authenticateToken, (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const { class_id } = req.body || {};
    if (!class_id) return res.status(400).json({ error: '请提供班级 ID' });

    const student = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'student'`).get(studentId);
    if (!student) return res.status(404).json({ error: '学生不存在' });

    const cls = db.prepare(`SELECT id FROM classes WHERE id = ?`).get(class_id);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    if (req.user.role !== 'admin') {
      const isHead = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
      ).get(req.user.userId, class_id);
      if (!isHead) return res.status(403).json({ error: '仅管理员或该班班主任可指派' });
    }

    db.prepare(`UPDATE users SET class_id = ?, status = 'active' WHERE id = ?`).run(class_id, studentId);
    db.prepare(`UPDATE classes SET student_count = (SELECT COUNT(*) FROM users WHERE class_id = ? AND role = 'student') WHERE id = ?`).run(class_id, class_id);

    res.json({ message: '已指派到班级' });
  } catch (error) {
    console.error('指派学生到班级失败:', error);
    res.status(500).json({ error: '指派学生到班级失败' });
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
router.post('/announcements', authenticateToken, (req, res) => {
  try {
    const { title, content, class_ids, priority, expires_at } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (!title) {
      return res.status(400).json({ error: '公告标题不能为空' });
    }

    if (userRole === 'teacher') {
      const myClassIds = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(userId).map(row => row.class_id);
      if (class_ids && class_ids.length > 0) {
        const invalidIds = class_ids.filter((id) => !myClassIds.includes(id));
        if (invalidIds.length > 0) {
          return res.status(403).json({ error: '只能为自己所属的班级发布公告' });
        }
      } else {
        if (myClassIds.length > 0) {
          for (const classId of myClassIds) {
            db.prepare(`
              INSERT INTO announcements (title, content, class_id, publisher_id, priority, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
            `).run(title, content || '', classId, userId, priority || 0, expires_at || null);
          }
          return res.json({ message: '公告创建成功' });
        }
      }
    }

    if (class_ids && class_ids.length > 0) {
      for (const classId of class_ids) {
        db.prepare(`
          INSERT INTO announcements (title, content, class_id, publisher_id, priority, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
        `).run(title, content || '', classId, userId, priority || 0, expires_at || null);
      }
    } else {
      db.prepare(`
        INSERT INTO announcements (title, content, class_id, publisher_id, priority, created_at, expires_at)
        VALUES (?, ?, NULL, ?, ?, datetime('now'), ?)
      `).run(title, content || '', userId, priority || 0, expires_at || null);
    }

    res.json({ message: '公告创建成功' });
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

// 公开平台统计（无需认证，仅暴露聚合计数）
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

// 获取系统统计信息
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
          (SELECT u.username FROM class_teachers ct JOIN users u ON ct.teacher_id = u.id WHERE ct.class_id = c.id AND ct.role = 'head_teacher' LIMIT 1) as teacher_name
        FROM classes c
        ORDER BY c.total_exp DESC LIMIT 5
      `).all();

      const recentRegistrations = db.prepare(`
        SELECT id, username, role, created_at FROM users ORDER BY created_at DESC LIMIT 10
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

// ==================== 运营看板 ====================

// 管理员运营看板数据
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

    const recentRegs = db.prepare(`SELECT id, username, role, created_at as time, 'register' as event_type FROM users ORDER BY created_at DESC LIMIT 5`).all();
    recentRegs.forEach(r => recentEvents.push({
      type: 'register',
      time: r.time,
      message: `新${r.role === 'teacher' ? '教师' : '学生'}注册：${r.username}`
    }));

    try {
      const recentAssign = db.prepare(`
        SELECT a.id, a.title, u.username, a.created_at as time
        FROM assignments a JOIN users u ON a.teacher_id = u.id
        ORDER BY a.created_at DESC LIMIT 5
      `).all();
      recentAssign.forEach(a => recentEvents.push({
        type: 'assignment',
        time: a.time,
        message: `${a.username} 发布了作业「${a.title}」`
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

// 班主任查看班级各任课老师情况
router.get('/classes/:id/teacher-activity', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.params.id, 10);
    if (!classId) return res.status(400).json({ error: '班级 ID 无效' });
    const userId = req.user.userId;
    const userRole = req.user.role;

    // 权限检查：班主任或管理员
    if (userRole === 'teacher') {
      const isHeadTeacher = db.prepare(`
        SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'
      `).get(userId, classId);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '需要班主任权限' });
      }
    } else if (userRole !== 'admin') {
      return res.status(403).json({ error: '权限不足' });
    }

    // 班级基本信息
    const classInfo = db.prepare(`SELECT id, name, grade, student_count FROM classes WHERE id = ?`).get(classId);
    if (!classInfo) {
      return res.status(404).json({ error: '班级不存在' });
    }

    // 任课老师列表及其教学数据
    let teachers = [];
    try {
      teachers = db.prepare(`
        SELECT
          u.id as teacher_id,
          u.username,
          u.avatar,
          ct.role as class_role,
          COUNT(DISTINCT a.id) as total_assignments,
          COUNT(DISTINCT CASE WHEN a.created_at >= DATE('now', '-30 days', 'localtime') THEN a.id END) as recent_assignments,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id IN (SELECT id FROM assignments WHERE teacher_id = u.id AND class_id = ?)) as total_submissions,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id IN (SELECT id FROM assignments WHERE teacher_id = u.id AND class_id = ?) AND s.status = 'submitted' AND (s.teacher_score IS NULL OR s.review_status = 'pending')) as ungraded_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id IN (SELECT id FROM assignments WHERE teacher_id = u.id AND class_id = ?) AND s.submitted_at >= DATE('now', '-7 days', 'localtime')) as recent_submissions
        FROM class_teachers ct
        JOIN users u ON ct.teacher_id = u.id
        LEFT JOIN assignments a ON a.teacher_id = u.id AND a.class_id = ?
        WHERE ct.class_id = ? AND u.status = 'active'
        GROUP BY u.id
        ORDER BY total_assignments DESC
      `).all(classId, classId, classId, classId, classId);
    } catch (e) {
      console.error('获取任课老师数据失败:', e);
    }

    // 各科成绩对比
    let subjectStats = [];
    try {
      subjectStats = db.prepare(`
        SELECT
          a.subject,
          COUNT(DISTINCT a.id) as assignment_count,
          COUNT(DISTINCT s.user_id) as active_students,
          ROUND(AVG(CASE WHEN s.total_score IS NOT NULL AND s.total_max_score > 0 THEN s.total_score * 100.0 / s.total_max_score END), 1) as avg_accuracy,
          ROUND(AVG(CASE WHEN s.total_score IS NOT NULL THEN s.total_score END), 1) as avg_score
        FROM assignments a
        LEFT JOIN submissions s ON s.assignment_id = a.id
        WHERE a.class_id = ? AND a.subject IS NOT NULL AND a.subject != ''
        GROUP BY a.subject
        ORDER BY assignment_count DESC
      `).all(classId);
    } catch (e) { /* assignments/submissions may not exist */ }

    // 学生薄弱情况（正确率低于60%的知识点数）
    let strugglingStudents = [];
    try {
      strugglingStudents = db.prepare(`
        SELECT
          u.id as user_id,
          u.username,
          u.avatar,
          COUNT(DISTINCT CASE WHEN kps.accuracy < 60 THEN kps.knowledge_point END) as weak_kp_count,
          COUNT(DISTINCT kps.knowledge_point) as total_kp_count,
          ROUND(AVG(kps.accuracy), 1) as avg_accuracy
        FROM users u
        LEFT JOIN knowledge_point_stats kps ON kps.user_id = u.id AND kps.date >= DATE('now', '-30 days', 'localtime')
        WHERE u.role = 'student' AND u.class_id = ?
        GROUP BY u.id
        HAVING weak_kp_count > 0 OR total_kp_count = 0
        ORDER BY weak_kp_count DESC
        LIMIT 10
      `).all(classId);
    } catch (e) { /* knowledge_point_stats may not exist */ }

    // 不活跃学生（7天内无活动）
    let inactiveStudents = [];
    try {
      inactiveStudents = db.prepare(`
        SELECT u.id, u.username, u.avatar, u.last_login
        FROM users u
        WHERE u.role = 'student' AND u.class_id = ?
          AND (u.last_login IS NULL OR u.last_login < DATE('now', '-7 days', 'localtime'))
        ORDER BY u.last_login ASC
        LIMIT 10
      `).all(classId);
    } catch (e) { /* users may not have last_login */ }

    // 待处理入学申请
    let pendingApps = 0;
    try {
      pendingApps = db.prepare(`SELECT COUNT(*) as count FROM class_applications WHERE class_id = ? AND status = 'pending'`).get(classId).count;
    } catch (e) { /* class_applications may not exist */ }

    // 最近提交的作业（实时动态）
    let recentSubmissions = [];
    try {
      recentSubmissions = db.prepare(`
        SELECT s.id, s.total_score, s.total_max_score, s.submitted_at,
               u.username as student_name,
               a.title as assignment_title, a.subject
        FROM submissions s
        JOIN users u ON s.user_id = u.id
        JOIN assignments a ON s.assignment_id = a.id
        WHERE a.class_id = ?
        ORDER BY s.submitted_at DESC
        LIMIT 10
      `).all(classId);
    } catch (e) { /* submissions may not exist */ }

    res.json({
      class_info: classInfo,
      teachers,
      subject_stats: subjectStats,
      struggling_students: strugglingStudents,
      inactive_students: inactiveStudents,
      pending_applications: pendingApps,
      recent_submissions: recentSubmissions
    });
  } catch (error) {
    console.error('获取班级教学数据失败:', error);
    res.status(500).json({ error: '获取班级教学数据失败' });
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
    // 只写不读：不暴露 API Key 到前端
    if (result.ai_api_key && result.ai_api_key.length > 0) {
      result.ai_api_key = '***';
    }
    res.json({ settings: result });
  } catch (error) {
    console.error('获取设置失败:', error);
    res.status(500).json({ error: '获取设置失败' });
  }
});

// 保存大模型设置
router.post('/settings/ai', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { ai_model, ai_api_key, ai_base_url, ai_report_interval_days, ai_timeout } = req.body;
    
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      if (ai_model !== undefined) stmt.run('ai_model', ai_model);
      // API Key 只写不读：仅在用户明确提供真实值时更新
      if (ai_api_key !== undefined && ai_api_key !== '' && ai_api_key !== '***') {
        stmt.run('ai_api_key', ai_api_key);
      }
      if (ai_base_url !== undefined) stmt.run('ai_base_url', ai_base_url);
      if (ai_report_interval_days !== undefined) stmt.run('ai_report_interval_days', String(ai_report_interval_days));
      if (ai_timeout !== undefined) stmt.run('ai_timeout', String(ai_timeout));
    })();

    res.json({ message: '设置保存成功' });
  } catch (error) {
    console.error('保存设置失败:', error);
    res.status(500).json({ error: '保存设置失败' });
  }
});

// 测试 AI 连接
router.post('/settings/ai/test', authenticateToken, requireAdmin, async (req, res) => {
  const axios = require('axios');
  try {
    let { ai_model, ai_api_key, ai_base_url, ai_timeout } = req.body;
    
    // 如果前端传了 *** 掩码，从数据库读取真实 key
    if (!ai_api_key || ai_api_key === '***') {
      ensureSettingsTable();
      const row = db.prepare(`SELECT value FROM settings WHERE key = 'ai_api_key'`).get();
      ai_api_key = row?.value || '';
    }
    
    if (!ai_model || !ai_api_key || !ai_base_url) {
      return res.status(400).json({ error: '请填写完整的 AI 配置' });
    }

    const timeoutMs = (parseInt(ai_timeout) || 300) * 1000;

    console.log('\n========== AI 连接测试 ==========');
    console.log('🎯 目标地址:', `${ai_base_url}/chat/completions`);
    console.log('🤖 使用模型:', ai_model);
    console.log('🔑 API Key:', `${ai_api_key.slice(0, 8)}...${ai_api_key.slice(-4)}`);
    console.log('⏱️ 超时设置:', timeoutMs / 1000, '秒');

    const startTime = Date.now();
    const response = await axios.post(`${ai_base_url}/chat/completions`, {
      model: ai_model,
      messages: [{ role: 'user', content: '你好，请回复"连接成功"四个字。' }]
    }, {
      headers: {
        'Authorization': `Bearer ${ai_api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const aiReply = response.data.choices?.[0]?.message?.content || '';
    console.log('✅ AI 响应成功, 耗时:', elapsed, '秒');
    console.log('📄 AI 回复内容:', aiReply);
    console.log('========================================\n');

    res.json({
      success: true,
      message: '连接测试成功',
      ai_reply: aiReply,
      elapsed: `${elapsed}秒`,
      model: ai_model
    });
  } catch (error) {
    console.error('\n❌ AI 连接测试失败:', error.message);
    if (error.response) {
      console.error('📡 响应状态:', error.response.status);
      console.error('📡 响应数据:', JSON.stringify(error.response.data));
      res.status(500).json({
        error: `连接失败 (HTTP ${error.response.status})`,
        detail: error.response.data?.error?.message || JSON.stringify(error.response.data)
      });
    } else if (error.code === 'ECONNABORTED') {
      console.error('⏱️ 请求超时');
      res.status(500).json({ error: `请求超时 (${timeoutMs / 1000}秒)`, detail: '请检查网络连接或 API 地址是否正确' });
    } else if (error.code === 'ECONNREFUSED') {
      console.error('🚫 连接被拒绝');
      res.status(500).json({ error: '连接被拒绝', detail: '请检查 API 地址是否正确' });
    } else {
      console.error('❌ 未知错误:', error);
      res.status(500).json({ error: '连接失败', detail: error.message });
    }
  }
});

function checkDataPermission(permKey, userId, userRole) {
  if (userRole === 'admin') return { allowed: true, classIds: null };

  ensureSettingsTable();
  const setting = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(permKey);
  const permLevel = setting?.value || 'head_teacher';

  if (userRole === 'student') return { allowed: false, classIds: [] };

  if (permLevel === 'all_teacher') {
    const classIds = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(userId).map(r => r.class_id);
    return { allowed: classIds.length > 0, classIds };
  }

  if (permLevel === 'subject_teacher') {
    const classIds = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(userId).map(r => r.class_id);
    return { allowed: classIds.length > 0, classIds };
  }

  const headClassIds = db.prepare(
    `SELECT class_id FROM class_teachers WHERE teacher_id = ? AND role = 'head_teacher'`
  ).all(userId).map(r => r.class_id);
  return { allowed: headClassIds.length > 0, classIds: headClassIds };
}

// 获取战斗记录
router.get('/battles', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { class_id } = req.query;

    const perm = checkDataPermission('perm_battle_records', userId, userRole);
    if (!perm.allowed) {
      return res.status(403).json({ error: '无权查看战斗记录' });
    }

    let sql = `
      SELECT b.*,
        p1.user_id as challenger_id,
        p2.user_id as defender_id,
        u1.username as challenger_name,
        u2.username as defender_name,
        c.name as class_name
      FROM battles b
      JOIN pets p1 ON b.pet1_id = p1.id
      JOIN pets p2 ON b.pet2_id = p2.id
      JOIN users u1 ON p1.user_id = u1.id
      JOIN users u2 ON p2.user_id = u2.id
      LEFT JOIN classes c ON u1.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (perm.classIds !== null) {
      if (perm.classIds.length > 0) {
        const placeholders = perm.classIds.map(() => '?').join(',');
        sql += ` AND u1.class_id IN (${placeholders})`;
        params.push(...perm.classIds);
      } else {
        sql += ` AND 1=0`;
      }
    }

    if (class_id) {
      sql += ` AND u1.class_id = ?`;
      params.push(class_id);
    }

    sql += ` ORDER BY b.battle_date DESC LIMIT 100`;

    const battles = db.prepare(sql).all(...params);
    res.json({ battles });
  } catch (error) {
    console.error('获取战斗记录失败:', error);
    res.status(500).json({ error: '获取战斗记录失败' });
  }
});

// 获取作业列表
router.get('/assignments', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { class_id } = req.query;

    const perm = checkDataPermission('perm_homework_records', userId, userRole);
    if (!perm.allowed) {
      return res.status(403).json({ error: '无权查看作业记录' });
    }

    let sql = `
      SELECT a.*,
        u.username as creator_name,
        c.name as class_name
      FROM assignments a
      JOIN users u ON a.teacher_id = u.id
      LEFT JOIN classes c ON a.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (perm.classIds !== null) {
      if (userRole === 'teacher') {
        const setting = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('perm_homework_records');
        const permLevel = setting?.value || 'subject_teacher';
        if (permLevel === 'subject_teacher') {
          if (perm.classIds.length > 0) {
            const placeholders = perm.classIds.map(() => '?').join(',');
            sql += ` AND (a.teacher_id = ? OR a.class_id IN (${placeholders}))`;
            params.push(userId, ...perm.classIds);
          } else {
            sql += ` AND a.teacher_id = ?`;
            params.push(userId);
          }
        } else {
          if (perm.classIds.length > 0) {
            const placeholders = perm.classIds.map(() => '?').join(',');
            sql += ` AND a.class_id IN (${placeholders})`;
            params.push(...perm.classIds);
          } else {
            sql += ` AND 1=0`;
          }
        }
      }
    }

    if (class_id) {
      sql += ` AND a.class_id = ?`;
      params.push(class_id);
    }

    sql += ` ORDER BY a.created_at DESC LIMIT 100`;

    const assignments = db.prepare(sql).all(...params);
    res.json({ assignments });
  } catch (error) {
    console.error('获取作业列表失败:', error);
    res.status(500).json({ error: '获取作业列表失败' });
  }
});

// 获取商店购买记录
router.get('/shop-records', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { class_id } = req.query;

    const perm = checkDataPermission('perm_purchase_records', userId, userRole);
    if (!perm.allowed) {
      return res.status(403).json({ error: '无权查看购买记录' });
    }

    let sql = `
      SELECT ui.*,
        u.username as buyer_name,
        i.name as item_name,
        i.rarity,
        c.name as class_name
      FROM user_items ui
      JOIN users u ON ui.user_id = u.id
      JOIN items i ON ui.item_id = i.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (perm.classIds !== null) {
      if (perm.classIds.length > 0) {
        const placeholders = perm.classIds.map(() => '?').join(',');
        sql += ` AND u.class_id IN (${placeholders})`;
        params.push(...perm.classIds);
      } else {
        sql += ` AND 1=0`;
      }
    }

    if (class_id) {
      sql += ` AND u.class_id = ?`;
      params.push(class_id);
    }

    sql += ` ORDER BY ui.obtained_at DESC LIMIT 100`;

    const records = db.prepare(sql).all(...params);
    res.json({ records });
  } catch (error) {
    console.error('获取商店记录失败:', error);
    res.status(500).json({ error: '获取商店记录失败' });
  }
});

// ==================== 教师端一键导入学生 ====================

// 教师批量导入学生（班主任或管理员）
router.post('/students/import', authenticateToken, async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { class_id, students } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // 验证班级 ID
    const classId = parseInt(class_id, 10);
    if (!classId) return res.status(400).json({ error: '班级 ID 无效' });

    // 验证班级是否存在
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    // 权限检查：班主任或管理员
    if (userRole === 'teacher') {
      const isHeadTeacher = db.prepare(`
        SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'
      `).get(userId, classId);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '需要班主任权限才能导入学生' });
      }
    } else if (userRole !== 'admin') {
      return res.status(403).json({ error: '权限不足' });
    }

    // 验证学生列表
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: '学生列表不能为空' });
    }

    const results = {
      success: [],
      failed: [],
      skipped: []
    };

    const importStudent = db.transaction((student) => {
      const { username, password, email, real_name } = student;

      // 验证必填字段
      if (!username || !password) {
        results.failed.push({ ...student, error: '用户名和密码不能为空' });
        return;
      }

      // 检查用户名是否已存在
      const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existingUser) {
        results.skipped.push({ ...student, error: '用户名已存在' });
        return;
      }

      // 密码加密
      const passwordHash = bcrypt.hashSync(password, 10);

      // 创建用户
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, email, role, class_id, status, created_at)
        VALUES (?, ?, ?, 'student', ?, 'active', datetime('now'))
      `).run(username, passwordHash, email || null, classId);

      // 如果有真实姓名字段，可以保存到某个地方
      // 这里可以扩展

      results.success.push({
        id: result.lastInsertRowid,
        username,
        email: email || null,
        real_name: real_name || null
      });
    });

    // 导入学生
    students.forEach((student) => {
      try {
        importStudent(student);
      } catch (e) {
        results.failed.push({ ...student, error: e.message });
      }
    });

    // 更新班级学生数
    const studentCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ? AND class_id = ?').get('student', classId);
    db.prepare('UPDATE classes SET student_count = ? WHERE id = ?').run(studentCount.count, classId);

    res.json({
      message: `导入完成：成功 ${results.success.length} 个，失败 ${results.failed.length} 个，跳过 ${results.skipped.length} 个`,
      results
    });
  } catch (error) {
    console.error('批量导入学生失败:', error);
    res.status(500).json({ error: '导入失败: ' + error.message });
  }
});

// 教师下载导入模板（班主任或管理员）
router.get('/students/import-template', authenticateToken, (req, res) => {
  try {
    const { format = 'json' } = req.query;

    if (format === 'json') {
      const template = [
        {
          username: 'student1',
          password: '111111',
          email: 'student1@example.com',
          real_name: '张三'
        },
        {
          username: 'student2',
          password: '111111',
          email: 'student2@example.com',
          real_name: '李四'
        }
      ];
      res.json({ template });
    } else if (format === 'csv') {
      const header = 'username,password,email,real_name\n';
      const rows = [
        'student1,111111,student1@example.com,张三',
        'student2,111111,student2@example.com,李四'
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=student_import_template.csv');
      res.send(header + rows);
    } else {
      res.status(400).json({ error: '不支持的格式，请使用 json 或 csv' });
    }
  } catch (error) {
    console.error('获取导入模板失败:', error);
    res.status(500).json({ error: '获取模板失败' });
  }
});

// ==================== 网站设置 ====================

function ensureSettingsTable() {
  const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`).get();
  if (!hasTable) {
    db.prepare(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `).run();
    const defaults = [
      ['site_name', '班级宠物养成系统'],
      ['site_description', '寓教于乐，让学习更有趣'],
      ['site_logo', '🐾'],
      ['site_footer', '© 2026 班级宠物养成系统'],
      ['site_announcement', ''],
      ['registration_enabled', 'true'],
      ['battle_enabled', 'true'],
      ['shop_enabled', 'true'],
      ['max_pets_per_user', '1'],
      ['daily_login_gold', '10'],
      ['battle_stamina_cost', '20'],
      ['ai_model', 'gpt-3.5-turbo'],
      ['ai_api_key', ''],
      ['ai_base_url', 'https://api.openai.com/v1'],
      ['ai_timeout', '300'],
      ['perm_battle_records', 'head_teacher'],
      ['perm_homework_records', 'subject_teacher'],
      ['perm_purchase_records', 'head_teacher'],
      ['max_tokens_per_generation', '18000'],
      ['daily_teacher_gen_limit', '5'],
      ['daily_global_token_limit', '2000000'],
      ['max_questions_per_generation', '20'],
    ];
    const stmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      defaults.forEach(([key, value]) => stmt.run(key, value));
    })();
  } else {
    const newKeys = [
      ['max_tokens_per_generation', '18000'],
      ['daily_teacher_gen_limit', '5'],
      ['daily_global_token_limit', '2000000'],
      ['max_questions_per_generation', '20'],
    ];
    const stmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      newKeys.forEach(([key, value]) => stmt.run(key, value));
    })();
  }

  const hasTokenUsage = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'`).get();
  if (!hasTokenUsage) {
    db.prepare(`
      CREATE TABLE token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        model TEXT DEFAULT '',
        subject TEXT DEFAULT '',
        topic TEXT DEFAULT '',
        question_type TEXT DEFAULT '',
        question_count INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_token_usage_user_date ON token_usage(user_id, date)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(date)`).run();
  }
}

router.get('/settings/site', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const settings = db.prepare(`SELECT key, value FROM settings`).all();
    const result = {};
    settings.forEach(s => result[s.key] = s.value);
    // 只写不读：不暴露 API Key 到前端
    if (result.ai_api_key && result.ai_api_key.length > 0) {
      result.ai_api_key = '***';
    }
    res.json({ settings: result });
  } catch (error) {
    console.error('获取网站设置失败:', error);
    res.status(500).json({ error: '获取网站设置失败' });
  }
});

router.post('/settings/site', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const allowedKeys = [
      'site_name', 'site_description', 'site_logo', 'site_footer',
      'site_announcement', 'registration_enabled', 'battle_enabled',
      'shop_enabled', 'max_pets_per_user', 'daily_login_gold',
      'battle_stamina_cost', 'ai_model', 'ai_api_key', 'ai_base_url',
      'ai_report_interval_days', 'ai_timeout',
      'perm_battle_records', 'perm_homework_records', 'perm_purchase_records',
      'max_tokens_per_generation', 'daily_teacher_gen_limit',
      'daily_global_token_limit', 'max_questions_per_generation',
    ];
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      Object.entries(req.body).forEach(([key, value]) => {
        if (allowedKeys.includes(key)) {
          // API Key 只写不读：仅在用户明确提供真实值时更新
          if (key === 'ai_api_key') {
            if (value !== undefined && value !== '' && value !== '***') {
              stmt.run(key, String(value));
            }
            return;
          }
          stmt.run(key, String(value));
        }
      });
    })();
    res.json({ message: '设置保存成功' });
  } catch (error) {
    console.error('保存网站设置失败:', error);
    res.status(500).json({ error: '保存网站设置失败' });
  }
});

// 公开接口：获取站点基本信息（无需认证）
router.get('/settings/public', (req, res) => {
  try {
    ensureSettingsTable();
    const publicKeys = ['site_name', 'site_description', 'site_logo', 'site_footer', 'site_announcement', 'registration_enabled', 'show_test_accounts'];
    const settings = db.prepare(`SELECT key, value FROM settings WHERE key IN (${publicKeys.map(() => '?').join(',')})`).all(...publicKeys);
    const result = {};
    settings.forEach(s => result[s.key] = s.value);
    res.json({ settings: result });
  } catch (error) {
    console.error('获取公开设置失败:', error);
    res.status(500).json({ error: '获取设置失败' });
  }
});

router.delete('/assignments/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const assignmentId = parseInt(req.params.id);
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const questionIds = db.prepare('SELECT question_bank_id FROM assignment_questions WHERE assignment_id = ?').all(assignmentId).map(q => q.question_bank_id);

    const deleteAll = db.transaction(() => {
      for (const qid of questionIds) {
        const qaIds = db.prepare('SELECT id FROM question_answers WHERE question_bank_id = ?').all(qid).map(qa => qa.id);
        if (qaIds.length > 0) {
          const qaPlaceholders = qaIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM question_answers WHERE id IN (${qaPlaceholders})`).run(...qaIds);
        }
        db.prepare('DELETE FROM wrong_questions WHERE question_id = ?').run(qid);
        db.prepare('DELETE FROM knowledge_point_stats WHERE knowledge_point = (SELECT knowledge_point FROM question_bank WHERE id = ?)').run(qid);
      }

      const submissionIds = db.prepare('SELECT id FROM submissions WHERE assignment_id = ?').all(assignmentId).map(s => s.id);
      if (submissionIds.length > 0) {
        const subPlaceholders = submissionIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM question_answers WHERE submission_id IN (${subPlaceholders})`).run(...submissionIds);
        db.prepare(`DELETE FROM submissions WHERE assignment_id = ?`).run(assignmentId);
      }

      db.prepare('DELETE FROM assignment_questions WHERE assignment_id = ?').run(assignmentId);
      db.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentId);

      for (const qid of questionIds) {
        db.prepare('DELETE FROM question_bank WHERE id = ?').run(qid);
      }
    });

    deleteAll();

    res.json({
      message: '作业及相关数据已彻底删除',
      deleted: {
        assignment_id: assignmentId,
        questions_deleted: questionIds.length,
        submissions_deleted: submissionIds.length
      }
    });
  } catch (error) {
    console.error('删除作业错误:', error);
    res.status(500).json({ error: '删除作业失败: ' + error.message });
  }
});

router.delete('/assignments/:assignmentId/questions/:questionId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const assignmentId = parseInt(req.params.assignmentId);
    const questionId = parseInt(req.params.questionId);

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const aq = db.prepare('SELECT * FROM assignment_questions WHERE assignment_id = ? AND question_bank_id = ?').get(assignmentId, questionId);
    if (!aq) return res.status(404).json({ error: '该题目不在此作业中' });

    const deleteQuestion = db.transaction(() => {
      const qaIds = db.prepare('SELECT id FROM question_answers WHERE question_bank_id = ?').all(questionId).map(qa => qa.id);
      if (qaIds.length > 0) {
        const qaPlaceholders = qaIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM question_answers WHERE id IN (${qaPlaceholders})`).run(...qaIds);
      }

      db.prepare('DELETE FROM wrong_questions WHERE question_id = ?').run(questionId);

      const kp = db.prepare('SELECT knowledge_point FROM question_bank WHERE id = ?').get(questionId);
      if (kp && kp.knowledge_point) {
        db.prepare('DELETE FROM knowledge_point_stats WHERE knowledge_point = ?').run(kp.knowledge_point);
      }

      db.prepare('DELETE FROM assignment_questions WHERE assignment_id = ? AND question_bank_id = ?').run(assignmentId, questionId);
      db.prepare('DELETE FROM question_bank WHERE id = ?').run(questionId);
    });

    deleteQuestion();

    res.json({ message: '题目及相关记录已删除', deleted_question_id: questionId });
  } catch (error) {
    console.error('删除题目错误:', error);
    res.status(500).json({ error: '删除题目失败: ' + error.message });
  }
});

module.exports = router;

// ==================== Token 使用看板 ====================

router.get('/token-usage/dashboard', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const { getChinaDate } = require('../config/timezone');
    const today = getChinaDate();

    const todayStats = db.prepare(`
      SELECT 
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as total_generations
      FROM token_usage WHERE date = ?
    `).get(today);

    const last7Days = db.prepare(`
      SELECT 
        date,
        SUM(prompt_tokens) as prompt_tokens,
        SUM(completion_tokens) as completion_tokens,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as generations,
        COUNT(DISTINCT user_id) as active_teachers
      FROM token_usage 
      WHERE date >= date(?, '-6 days')
      GROUP BY date 
      ORDER BY date ASC
    `).all(today);

    const topTeachers = db.prepare(`
      SELECT 
        tu.user_id,
        u.username,
        SUM(tu.total_tokens) as total_tokens,
        SUM(tu.prompt_tokens) as prompt_tokens,
        SUM(tu.completion_tokens) as completion_tokens,
        COUNT(*) as generations
      FROM token_usage tu
      JOIN users u ON tu.user_id = u.id
      WHERE tu.date = ?
      GROUP BY tu.user_id
      ORDER BY total_tokens DESC
      LIMIT 10
    `).all(today);

    const settings = db.prepare(`SELECT key, value FROM settings WHERE key IN ('daily_global_token_limit', 'daily_teacher_gen_limit', 'max_tokens_per_generation', 'max_questions_per_generation')`).all();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = parseInt(s.value) || 0);

    res.json({
      today: todayStats,
      last7Days,
      topTeachers,
      settings: settingsMap,
      date: today
    });
  } catch (error) {
    console.error('获取Token看板失败:', error);
    res.status(500).json({ error: '获取Token看板失败' });
  }
});

router.get('/token-usage/records', authenticateToken, requireAdmin, (req, res) => {
  try {
    ensureSettingsTable();
    const { user_id, date, page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let sql = `
      SELECT tu.*, u.username
      FROM token_usage tu
      JOIN users u ON tu.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (user_id) {
      sql += ` AND tu.user_id = ?`;
      params.push(user_id);
    }
    if (date) {
      sql += ` AND tu.date = ?`;
      params.push(date);
    }

    const countResult = db.prepare(`SELECT COUNT(*) as total FROM token_usage tu JOIN users u ON tu.user_id = u.id WHERE 1=1${user_id ? ' AND tu.user_id = ?' : ''}${date ? ' AND tu.date = ?' : ''}`).get(...params);
    
    sql += ` ORDER BY tu.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(pageSize), offset);

    const records = db.prepare(sql).all(...params);

    res.json({
      records,
      total: countResult.total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取Token记录失败:', error);
    res.status(500).json({ error: '获取Token记录失败' });
  }
});

// 教师查询自己今日生成次数和限制（教师可用）
router.get('/token-usage/my-limit', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: '仅教师可查看' });
    }
    ensureSettingsTable();
    const { getChinaDate } = require('../config/timezone');
    const today = getChinaDate();

    const dailyLimit = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'daily_teacher_gen_limit'`).get()?.value || '5');
    const todayCount = db.prepare(`SELECT COUNT(*) as count FROM token_usage WHERE user_id = ? AND date = ?`).get(req.user.userId, today)?.count || 0;

    const globalTokenLimit = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'daily_global_token_limit'`).get()?.value || '2000000');
    const todayGlobalTokens = db.prepare(`SELECT COALESCE(SUM(completion_tokens), 0) as total FROM token_usage WHERE date = ?`).get(today)?.total || 0;

    res.json({
      daily_limit: dailyLimit,
      daily_used: todayCount,
      daily_remaining: Math.max(0, dailyLimit - todayCount),
      global_token_limit: globalTokenLimit,
      global_tokens_used: todayGlobalTokens,
      global_tokens_remaining: Math.max(0, globalTokenLimit - todayGlobalTokens),
      date: today
    });
  } catch (error) {
    console.error('查询生成限制失败:', error);
    res.status(500).json({ error: '查询生成限制失败' });
  }
});

// ==================== 清理所有数据 ====================

router.post('/clean-all-data', authenticateToken, requireAdmin, (req, res) => {
  try {
    const cleanAll = db.transaction(() => {
      const adminUser = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get();
      if (!adminUser) {
        throw new Error('admin 账号不存在');
      }

      db.prepare(`DELETE FROM forum_favorites`).run();
      db.prepare(`DELETE FROM forum_post_likes`).run();
      db.prepare(`DELETE FROM forum_likes`).run();
      db.prepare(`DELETE FROM forum_posts`).run();
      db.prepare(`DELETE FROM forum_threads`).run();
      db.prepare(`DELETE FROM forum_boards`).run();

      db.prepare(`DELETE FROM boss_battle_answers`).run();
      db.prepare(`DELETE FROM boss_battle_rewards`).run();
      db.prepare(`DELETE FROM boss_battle_participants`).run();
      db.prepare(`DELETE FROM boss_battle_questions`).run();
      db.prepare(`DELETE FROM boss_battles`).run();

      db.prepare(`DELETE FROM question_answers`).run();
      db.prepare(`DELETE FROM assignment_questions`).run();
      db.prepare(`DELETE FROM submissions`).run();
      db.prepare(`DELETE FROM assignments`).run();

      db.prepare(`DELETE FROM wrong_questions`).run();
      db.prepare(`DELETE FROM knowledge_point_stats`).run();

      db.prepare(`DELETE FROM battles`).run();

      db.prepare(`DELETE FROM user_equipment`).run();
      db.prepare(`DELETE FROM user_items`).run();

      db.prepare(`DELETE FROM pets`).run();

      db.prepare(`DELETE FROM user_tasks`).run();
      db.prepare(`DELETE FROM daily_tasks`).run();
      db.prepare(`DELETE FROM daily_task_logs`).run();
      db.prepare(`DELETE FROM tasks`).run();

      db.prepare(`DELETE FROM user_achievements`).run();
      db.prepare(`DELETE FROM achievements`).run();

      db.prepare(`DELETE FROM gold_transactions`).run();
      db.prepare(`DELETE FROM user_activities`).run();

      db.prepare(`DELETE FROM post_comments`).run();
      db.prepare(`DELETE FROM post_likes`).run();
      db.prepare(`DELETE FROM posts`).run();

      db.prepare(`DELETE FROM chat_read_status`).run();
      db.prepare(`DELETE FROM chat_messages`).run();

      db.prepare(`DELETE FROM friend_requests`).run();
      db.prepare(`DELETE FROM friends`).run();

      db.prepare(`DELETE FROM notifications`).run();

      db.prepare(`DELETE FROM announcements`).run();

      db.prepare(`DELETE FROM class_invitations`).run();
      db.prepare(`DELETE FROM class_applications`).run();
      db.prepare(`DELETE FROM class_teachers`).run();
      db.prepare(`DELETE FROM classes`).run();

      db.prepare(`DELETE FROM schools`).run();

      db.prepare(`DELETE FROM users WHERE id != ?`).run(adminUser.id);

      db.prepare(`DELETE FROM upload_files`).run();

      db.prepare(`DELETE FROM ai_configs`).run();
    });

    cleanAll();

    res.json({ message: '所有数据已清理，仅保留 admin 账号和基础配置数据' });
  } catch (error) {
    console.error('清理数据失败:', error);
    res.status(500).json({ error: `清理数据失败: ${error.message}` });
  }
});

module.exports = router;