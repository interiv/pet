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

module.exports = { requireClassMember, requireHeadTeacher, isClassMember };
