// 班级成员权限中间件：校验登录用户是否为指定班级的学生/教师（管理员直通）。
// 使用方式：requireClassMember()              // 从 req.params.id 读取 classId
//         requireClassMember('classId')       // 从 req.params.classId 读取
//         requireClassMember({ source: 'query', key: 'class_id' })
const { db } = require('../config/database');

function resolveClassId(req, opts) {
  const source = (opts && opts.source) || 'params';
  const key = (opts && opts.key) || 'id';
  const bag = source === 'query' ? req.query : source === 'body' ? req.body : req.params;
  const raw = bag ? bag[key] : undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function isClassMember(userId, classId) {
  const asStudent = db
    .prepare(`SELECT 1 FROM users WHERE id = ? AND class_id = ?`)
    .get(userId, classId);
  if (asStudent) return true;
  const asTeacher = db
    .prepare(`SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`)
    .get(userId, classId);
  return !!asTeacher;
}

/**
 * 列出用户所属的全部班级 id：自己作为学生所在的班 + 作为教师任教的班（可同时有多个）。
 *
 * 教师的多班归属由 class_teachers 维护，其 users.class_id 通常为 NULL，
 * 所以凡是「我属于哪些班」的判断都不能只看 users.class_id。
 */
function listMemberClassIds(userId) {
  const ids = new Set();
  const studentRow = db.prepare(`SELECT class_id FROM users WHERE id = ?`).get(userId);
  if (studentRow?.class_id) ids.add(Number(studentRow.class_id));
  for (const row of db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(userId)) {
    if (row.class_id) ids.add(Number(row.class_id));
  }
  return [...ids];
}

/**
 * 是否为该班的班主任（兼容管理员：管理员对所有班级都算有管理权）。
 * 用于「班主任可管理本班学生内容、管理员可管理全部」这类分级授权。
 */
function isHeadTeacherOf(userId, classId) {
  const row = db
    .prepare(`SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`)
    .get(userId, classId);
  return !!row;
}

/** 内容管理权：管理员全局，或该班的班主任。 */
function canManageClassContent(userId, role, classId) {
  if (role === 'admin') return true;
  if (!classId) return false;
  return isHeadTeacherOf(userId, classId);
}

function requireClassMember(optsOrKey) {
  const opts = typeof optsOrKey === 'string' ? { key: optsOrKey } : optsOrKey || {};
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    if (req.user.role === 'admin') return next();

    const classId = resolveClassId(req, opts);
    if (!classId) {
      return res.status(400).json({ error: '未提供班级 ID' });
    }
    if (!isClassMember(req.user.userId, classId)) {
      return res.status(403).json({ error: '无权访问该班级' });
    }
    req.classId = classId;
    next();
  };
}

// 班主任校验（兼容 admin）
function requireHeadTeacher(optsOrKey) {
  const opts = typeof optsOrKey === 'string' ? { key: optsOrKey } : optsOrKey || {};
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    if (req.user.role === 'admin') return next();
    const classId = resolveClassId(req, opts);
    if (!classId) return res.status(400).json({ error: '未提供班级 ID' });
    const row = db
      .prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
      )
      .get(req.user.userId, classId);
    if (!row) return res.status(403).json({ error: '需要班主任权限' });
    req.classId = classId;
    next();
  };
}

module.exports = {
  requireClassMember,
  requireHeadTeacher,
  isClassMember,
  listMemberClassIds,
  isHeadTeacherOf,
  canManageClassContent,
};
