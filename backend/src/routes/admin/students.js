const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { getChinaDate } = require('../../config/timezone');
const { getAIConfig, isAIConfigured, getAITimeoutMs } = require('../../config/ai');
const { startAsyncTask, handleTaskQuery } = require('../../utils/asyncTask');
const { PROMPTS, SETTING_PREFIX, getPrompt, fillTemplate } = require('../../config/prompts');
const {
  USERNAME_MAX_LEN,
  AI_USERNAME_BATCH_SIZE,
  requireAdmin,  purgeUserData,
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

router.get('/students', authenticateToken, (req, res) => {
  try {
    const { status, class_id, search } = req.query;
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole === 'student') {
      return res.status(403).json({ error: '无权访问学生列表' });
    }

    let sql = `SELECT u.id, u.username, u.real_name, u.email, u.avatar, u.class_id, u.gold, u.created_at, u.last_login, u.status, c.name as class_name 
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
      sql += ` AND (u.username LIKE ? OR u.email LIKE ? OR u.real_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY u.created_at DESC`;
    
    const students = db.prepare(sql).all(...params);
    res.json({ students });
  } catch (error) {
    console.error('获取学生列表失败:', error);
    res.status(500).json({ error: '获取学生列表失败' });
  }
});

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
      // CSV 可直接用 Excel 打开编辑；开头加 BOM，否则 Excel 打开中文会乱码
      const header = '用户名,密码,邮箱,姓名\n';
      const rows = [
        'student1,111111,student1@example.com,张三',
        'student2,111111,student2@example.com,李四'
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=student_import_template.csv');
      res.send('\uFEFF' + header + rows);
    } else {
      res.status(400).json({ error: '不支持的格式，请使用 json 或 csv' });
    }
  } catch (error) {
    console.error('获取导入模板失败:', error);
    res.status(500).json({ error: '获取模板失败' });
  }
});

router.get('/students/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    // 防御：学生 ID 必须是数字，避免把 /students/xxx 这类路径当成 ID
    if (!/^\d+$/.test(String(id))) {
      return res.status(400).json({ error: '学生 ID 无效' });
    }
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole === 'student') {
      return res.status(403).json({ error: '无权查看学生详情' });
    }

    const student = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.email, u.avatar, u.class_id, u.gold, u.created_at, u.last_login, u.status, c.name as class_name
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

router.post('/students/reset-passwords', authenticateToken, (req, res) => {
  try {
    const { student_ids, password } = req.body || {};
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (userRole === 'student') {
      return res.status(403).json({ error: '无权重置学生密码' });
    }

    const ids = Array.isArray(student_ids) ? student_ids.map((v) => Number(v)).filter(Boolean) : [];
    if (ids.length === 0) {
      return res.status(400).json({ error: '请选择要重置密码的学生' });
    }

    const fixedPwd = (password === undefined || password === null || String(password).trim() === '')
      ? null
      : String(password).trim();
    if (fixedPwd && fixedPwd.length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }

    const updateStmt = db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND role = 'student'`);
    const results = [];

    for (const id of ids) {
      const student = db.prepare(`SELECT id, username, real_name, class_id FROM users WHERE id = ? AND role = 'student'`).get(id);
      if (!student) continue;

      // 班主任只能重置本班学生
      if (userRole === 'teacher') {
        const isHeadTeacher = db.prepare(
          `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
        ).get(userId, student.class_id);
        if (!isHeadTeacher) continue;
      }

      const pwd = fixedPwd || String(Math.floor(100000 + Math.random() * 900000));
      updateStmt.run(bcrypt.hashSync(pwd, 10), student.id);
      results.push({ id: student.id, username: student.username, real_name: student.real_name, password: pwd });
    }

    res.json({ message: `已重置 ${results.length} 个学生的密码`, results });
  } catch (error) {
    console.error('重置学生密码失败:', error);
    res.status(500).json({ error: '重置学生密码失败' });
  }
});

router.put('/students/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { username, real_name, email, avatar, class_id, status, password } = req.body;
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
    if (username !== undefined) {
      const uname = String(username || '').trim();
      if (!uname) {
        return res.status(400).json({ error: '用户名不能为空' });
      }
      // 改名时校验重名（忽略大小写，排除自己）
      const dup = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?').get(uname, id);
      if (dup) {
        return res.status(400).json({ error: '用户名已存在' });
      }
      updates.push('username = ?'); params.push(uname);
    }
    if (real_name !== undefined) { updates.push('real_name = ?'); params.push(String(real_name || '').trim() || null); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
    if (class_id !== undefined) { updates.push('class_id = ?'); params.push(class_id); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    // 重置密码（可选）：只有传入非空密码时才更新，密码以 bcrypt 哈希存储
    if (password !== undefined && password !== null && String(password).trim() !== '') {
      const pwd = String(password).trim();
      if (pwd.length < 6) {
        return res.status(400).json({ error: '密码至少 6 位' });
      }
      updates.push('password_hash = ?'); params.push(bcrypt.hashSync(pwd, 10));
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }
    
    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: password ? '学生信息更新成功，密码已重置' : '学生信息更新成功' });
  } catch (error) {
    console.error('更新学生信息失败:', error);
    res.status(500).json({ error: '更新学生信息失败' });
  }
});

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
      purgeUserData(id);
      res.json({ message: '学生及其数据已删除' });
    } else {
      res.status(400).json({ error: '无效的操作' });
    }
  } catch (error) {
    console.error('删除/禁用学生失败:', error);
    res.status(500).json({ error: '删除/禁用学生失败' });
  }
});

router.get('/unassigned-students', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权查看' });
    }
    const students = db.prepare(`
      SELECT id, username, real_name, email, avatar, created_at, status
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

router.post('/students/generate-accounts', authenticateToken, (req, res) => {
  // 前置校验必须同步做完并立刻返回错误：这些是毫秒级的判断，
  // 而 AI 生成 200 个账号要串行 10 批、可能跑好几分钟，不能占着连接等。
  const precheck = precheckGenerateAccounts(req);
  if (precheck.error) {
    return res.status(precheck.status).json(precheck.body);
  }
  // mode=sequence 是纯本地算号，秒回；只有走 AI 才转异步任务
  if (precheck.mode === 'sequence') {
    return runGenerateAccounts(req, res, () => {});
  }
  return startAsyncTask(res, {
    userId: req.user.userId,
    kind: 'gen_accounts',
    title: '学生账号生成',
    runningMsg: '已开始生成，请稍候',
  }, (fakeRes, onProgress) => runGenerateAccounts(req, fakeRes, onProgress, precheck));
});

/**
 * 生成学生账号前的同步校验：权限、姓名清洗、AI 配置。
 * 返回 { error } 表示要直接回给客户端；否则把清洗结果带进后续流程。
 */
function precheckGenerateAccounts(req) {
  const { names, mode = 'ai', class_id } = req.body;

  if (req.user.role === 'student') {
    return { status: 403, error: true, body: { error: '权限不足' } };
  }
  if (req.user.role !== 'admin') {
    const isHeadTeacher = class_id
      ? db.prepare(`SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`)
        .get(req.user.userId, parseInt(class_id))
      : db.prepare(`SELECT 1 FROM class_teachers WHERE teacher_id = ? AND role = 'head_teacher'`)
        .get(req.user.userId);
    if (!isHeadTeacher) {
      return { status: 403, error: true, body: { error: '需要班主任或管理员权限' } };
    }
  }

  const { names: cleanedNames, stats } = cleanStudentNames(names);
  if (cleanedNames.length === 0) {
    return { status: 400, error: true, body: { error: '没有解析到有效的姓名，请检查粘贴内容', stats } };
  }
  if (cleanedNames.length > 200) {
    return { status: 400, error: true, body: { error: '一次最多生成 200 个账号，请分批处理', stats } };
  }

  const useAI = mode !== 'sequence';
  let aiConfig = null;
  if (useAI) {
    ensureSettingsTable(); // 确保 settings / token_usage 表存在
    aiConfig = getAIConfig();
    if (!isAIConfigured(aiConfig)) {
      return {
        status: 400,
        error: true,
        body: {
          error: 'AI 功能当前不可用：管理员尚未在「AI设置」中完成模型配置，可改用「按序号生成账号」',
          can_fallback: true,
          stats,
        },
      };
    }
  }
  return { cleanedNames, stats, useAI, aiConfig, mode };
}

async function runGenerateAccounts(req, res, onProgress = () => {}, precheck = null) {
  const startedAt = Date.now();
  const { prefix = 'stu' } = req.body;
  try {
    const pc = precheck || precheckGenerateAccounts(req);
    if (pc.error) return res.status(pc.status).json(pc.body);
    const { cleanedNames, stats, useAI, aiConfig } = pc;
    const aiUsernames = new Map();

    if (useAI) {
      try {
        const { map, tokens } = await generateUsernamesByAI(cleanedNames, onProgress);
        for (const [name, username] of map) aiUsernames.set(name, username);

        // 记录 Token 用量（失败不影响主流程）
        try {
          db.prepare(`
            INSERT INTO token_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, model, subject, topic, question_count, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            req.user.userId, getChinaDate(),
            tokens.promptTokens, tokens.completionTokens, tokens.totalTokens,
            aiConfig.ai_model, '账号生成', '粘贴姓名生成学生账号', cleanedNames.length, Date.now() - startedAt
          );
        } catch (logErr) {
          console.error('⚠️ Token 使用记录写入失败:', logErr.message);
        }
      } catch (aiError) {
        const detail = aiError?.response?.data?.error?.message
          || aiError?.response?.data?.message
          || aiError?.message
          || '未知错误';
        console.error('❌ AI 生成账号失败:', detail);
        return res.status(502).json({
          error: `AI 生成账号失败：${detail}。可改用「按序号生成账号」`,
          can_fallback: true,
          stats
        });
      }
    }

    // 生成账号 + 随机密码
    const used = new Set();
    const aiMissingNames = [];
    const seqPrefix = sanitizeSequencePrefix(prefix);

    const accounts = cleanedNames.map((realName, idx) => {
      let base = aiUsernames.get(realName);
      if (!base) {
        if (useAI) aiMissingNames.push(realName);
        base = `${seqPrefix}${String(idx + 1).padStart(3, '0')}`;
      }
      return {
        real_name: realName,
        username: ensureUniqueUsername(base, used),
        password: randomPassword()
      };
    });

    const duplicateNames = findDuplicateNames(cleanedNames);
    console.log(`✅ 生成学生账号 ${accounts.length} 个（模式：${useAI ? 'AI' : '序号'}）`);

    res.json({
      mode: useAI ? 'ai' : 'sequence',
      count: accounts.length,
      accounts,
      stats,
      duplicate_names: duplicateNames,
      ai_fallback_names: aiMissingNames,
      message: `已生成 ${accounts.length} 个账号`
    });
  } catch (error) {
    console.error('生成学生账号失败:', error);
    res.status(500).json({ error: '生成账号失败: ' + error.message });
  }
}

// 轮询进度（账号生成任务）
router.get('/students/task/:taskId', authenticateToken, (req, res) => {
  handleTaskQuery(req, res);
});

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

      const uname = String(username || '').trim();

      // 验证必填字段
      if (!uname || !password) {
        results.failed.push({ ...student, error: '用户名和密码不能为空' });
        return;
      }

      // 检查用户名是否已存在（忽略大小写）
      const existingUser = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(uname);
      if (existingUser) {
        results.skipped.push({ ...student, error: '用户名已存在' });
        return;
      }

      // 密码加密
      const passwordHash = bcrypt.hashSync(password, 10);

      // 创建用户（含真实姓名）
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, email, real_name, role, class_id, status, created_at)
        VALUES (?, ?, ?, ?, 'student', ?, 'active', datetime('now'))
      `).run(uname, passwordHash, email || null, String(real_name || '').trim() || null, classId);

      results.success.push({
        id: result.lastInsertRowid,
        username,
        email: email || null,
        real_name: String(real_name || '').trim() || null
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

module.exports = router;
