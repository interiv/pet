/**
 * admin 模块共享的中间件与工具函数
 * 由 routes/admin.js 拆分而来，内容与拆分前完全一致（纯移动，无逻辑改动）
 */
const { db } = require('../../config/database');
const axios = require('axios');

const USERNAME_MAX_LEN = 20;
const AI_USERNAME_BATCH_SIZE = 20;

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足，需要管理员角色' });
  }
  next();
};

function purgeUserData(userId) {
  db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      // 学生若已入班，先扣减班级人数计数（审批通过时 +1，删除时需 -1）
      const target = db.prepare('SELECT role, class_id FROM users WHERE id = ?').get(userId);
      if (target && target.role === 'student' && target.class_id) {
        db.prepare('UPDATE classes SET student_count = MAX(student_count - 1, 0) WHERE id = ?').run(target.class_id);
      }

      // 先清理宠物的子表（pet_skills 不直接引用 users）
      db.prepare(`DELETE FROM pet_skills WHERE pet_id IN (SELECT id FROM pets WHERE user_id = ?)`).run(userId);

      // AI 直连接令没有外键约束，删除账号时要一并清掉，避免令牌残留
      try {
        db.prepare(`DELETE FROM agent_tokens WHERE user_id = ?`).run(userId);
      } catch (e) { /* 表可能还不存在，忽略 */ }

      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      ).all();
      for (const { name } of tables) {
        if (name === 'users') continue;
        const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all().filter(fk => fk.table === 'users');
        if (fks.length === 0) continue;
        const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
        for (const fk of fks) {
          const col = cols.find(c => c.name === fk.from);
          if (!col) continue;
          if (col.notnull) {
            db.prepare(`DELETE FROM "${name}" WHERE "${fk.from}" = ?`).run(userId);
          } else {
            db.prepare(`UPDATE "${name}" SET "${fk.from}" = NULL WHERE "${fk.from}" = ?`).run(userId);
          }
        }
      }

      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
    run();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function applyApplicationToClass(application, reviewerId) {
  const applicantId = application.user_id;
  const cls = db.prepare('SELECT id, name, head_teacher_id FROM classes WHERE id = ?').get(application.class_id);
  if (!cls) {
    return { ok: false, reason: `班级 #${application.class_id} 不存在` };
  }

  const isTeacherApplication = application.role === 'teacher';
  const isHeadTeacherApply = isTeacherApplication && application.teacher_type === 'head_teacher';

  if (isHeadTeacherApply) {
    const hasHeadTeacher = cls.head_teacher_id
      || db.prepare(`SELECT 1 FROM class_teachers WHERE class_id = ? AND role = 'head_teacher'`).get(cls.id);
    if (hasHeadTeacher) {
      return { ok: false, reason: `班级「${cls.name}」已有班主任` };
    }
    const otherClass = db.prepare('SELECT name FROM classes WHERE head_teacher_id = ?').get(applicantId);
    if (otherClass) {
      return { ok: false, reason: `该教师已是班级「${otherClass.name}」的班主任` };
    }
  }

  // 标记申请已通过
  db.prepare(`
    UPDATE class_applications
    SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(reviewerId, application.id);

  if (application.role === 'student') {
    db.prepare('UPDATE users SET class_id = ?, status = ? WHERE id = ?')
      .run(cls.id, 'active', applicantId);
    db.prepare('UPDATE classes SET student_count = student_count + 1 WHERE id = ?').run(cls.id);
    return { ok: true, classId: cls.id, className: cls.name, isHeadTeacher: false };
  }

  // 教师申请：注册时填的任教科目一并落到 class_teachers（布置作业时用它做默认科目）
  const existing = db.prepare('SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ?')
    .get(cls.id, applicantId);
  const applySubject = String(application.subject || '').trim().slice(0, 20) || null;

  if (isHeadTeacherApply) {
    if (existing) {
      db.prepare(`UPDATE class_teachers SET role = 'head_teacher', subject = COALESCE(?, subject) WHERE id = ?`)
        .run(applySubject, existing.id);
    } else {
      db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role, subject) VALUES (?, ?, 'head_teacher', ?)`)
        .run(cls.id, applicantId, applySubject);
    }
    db.prepare('UPDATE classes SET head_teacher_id = ? WHERE id = ?').run(applicantId, cls.id);
  } else if (!existing) {
    db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role, subject) VALUES (?, ?, 'teacher', ?)`)
      .run(cls.id, applicantId, applySubject);
  } else if (applySubject && !existing.subject) {
    // 已在本班但没科目（历史数据）：补上申请时填的科目
    db.prepare(`UPDATE class_teachers SET subject = ? WHERE id = ?`).run(applySubject, existing.id);
  }

  // 激活账号
  db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(applicantId);

  return { ok: true, classId: cls.id, className: cls.name, isHeadTeacher: isHeadTeacherApply };
}

function approveTeacherPendingApplications(teacherId, reviewerId) {
  const applications = db.prepare(`
    SELECT * FROM class_applications
    WHERE user_id = ? AND status = 'pending' AND role = 'teacher'
    ORDER BY id ASC
  `).all(teacherId);

  const applied = [];
  const skipped = [];
  for (const application of applications) {
    const result = applyApplicationToClass(application, reviewerId);
    if (result.ok) {
      applied.push(`${result.className}${result.isHeadTeacher ? '（班主任）' : ''}`);
    } else {
      skipped.push(result.reason);
    }
  }
  return { applied, skipped };
}

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

function cleanStudentNames(input) {
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const stats = { input_lines: 0, empty: 0, invalid: 0 };
  const names = [];

  // 全角数字/字母转半角（如 "２、李四" → "2、李四"），否则行首序号识别不到
  const toHalfWidth = (str) => str.replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  for (const line of lines) {
    stats.input_lines += 1;

    let s = toHalfWidth(String(line === null || line === undefined ? '' : line))
      .replace(/\u3000/g, ' ') // 全角空格
      .trim();
    if (!s) { stats.empty += 1; continue; }

    // 行首序号
    s = s.replace(/^[(\[（【]?\d+[)\]）】]?\s*[.、,，:：-]?\s*/, '').trim();

    // 分隔符取列
    const parts = s.split(/[,，;；\t]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      s = parts[1];
    } else if (parts.length > 2) {
      const noDigit = parts.filter((p) => !/\d/.test(p));
      s = noDigit.length ? noDigit[noDigit.length - 1] : parts[parts.length - 1];
    }

    // 去掉包裹的引号 / 括号
    s = s.replace(/^["'“”‘’【】\[\]()（）\s]+|["'“”‘’【】\[\]()（）\s]+$/g, '').trim();

    if (!s) { stats.empty += 1; continue; }
    if (s.length > 20) { stats.invalid += 1; continue; } // 明显不是姓名的超长内容

    names.push(s);
  }

  return { names, stats };
}

function findDuplicateNames(names) {
  const counter = new Map();
  names.forEach((n) => counter.set(n, (counter.get(n) || 0) + 1));
  return Array.from(counter.entries()).filter(([, c]) => c > 1).map(([n]) => n);
}

function sanitizeUsername(raw, fallback = 'stu') {
  let s = String(raw || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  s = s.replace(/^[^a-z]+/, ''); // 必须以字母开头
  s = s.slice(0, USERNAME_MAX_LEN);
  return s || fallback;
}

function sanitizeSequencePrefix(prefix) {
  const p = sanitizeUsername(prefix, 'stu').replace(/_/g, '');
  return p.slice(0, 12) || 'stu';
}

function isUsernameTaken(username) {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username));
}

function ensureUniqueUsername(base, used) {
  const clean = sanitizeUsername(base);
  let candidate = clean;
  let i = 1;
  while (used.has(candidate) || isUsernameTaken(candidate)) {
    i += 1;
    candidate = `${clean}${i}`.slice(0, USERNAME_MAX_LEN);
    if (i > 500) { candidate = `${clean}${Date.now() % 100000}`.slice(0, USERNAME_MAX_LEN); break; }
  }
  used.add(candidate);
  return candidate;
}

function randomPassword() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function parseJSONArray(text) {
  const raw = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function generateUsernamesByAI(names) {
  const axios = require('axios');
  const config = getAIConfig();
  // 账号生成属于轻量任务：最多等 60 秒，避免用户长时间干等
  const timeoutMs = Math.min(getAITimeoutMs(config), 60000);
  const map = new Map(); // 姓名 → 账号
  const tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let i = 0; i < names.length; i += AI_USERNAME_BATCH_SIZE) {
    const batch = names.slice(i, i + AI_USERNAME_BATCH_SIZE);
    const listText = batch.map((n, idx) => `${idx + 1}. ${n}`).join('\n');
    const prompt = fillTemplate(getPrompt('admin_student_accounts'), { list_text: listText });

    const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
      model: config.ai_model,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Authorization': `Bearer ${config.ai_api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });

    const usage = response.data?.usage || {};
    tokens.promptTokens += usage.prompt_tokens || 0;
    tokens.completionTokens += usage.completion_tokens || 0;
    tokens.totalTokens += usage.total_tokens || 0;

    const content = response.data?.choices?.[0]?.message?.content || '';
    for (const item of parseJSONArray(content)) {
      if (item && item.name && item.username) {
        map.set(String(item.name).trim(), String(item.username));
      }
    }
  }

  return { map, tokens };
}

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
      ['home_notice', ''],
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
      // 每位教师每日 AI 生成次数。管理员可在「AI 设置」里随时调整。
      ['daily_teacher_gen_limit', '20'],
      ['daily_global_token_limit', '2000000'],
      ['max_questions_per_generation', '20'],
      // AI 出题单笔请求的最大重试/续写轮次：题量偏多时会自动分轮补齐
      ['ai_gen_max_rounds', '3'],
    ];
    const stmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      defaults.forEach(([key, value]) => stmt.run(key, value));
    })();
  } else {
    const newKeys = [
      ['max_tokens_per_generation', '18000'],
      ['daily_teacher_gen_limit', '20'],
      ['daily_global_token_limit', '2000000'],
      ['max_questions_per_generation', '20'],
      ['ai_gen_max_rounds', '3'],
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

module.exports = {
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
};
