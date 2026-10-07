/**
 * 班主任（head_teacher）关系工具
 *
 * 数据模型约定：
 *  - class_teachers.role = 'head_teacher' 是权威关系，支持多对多
 *    （一个班级可以有多位班主任，一位教师也可以担任多个班级的班主任）。
 *  - classes.head_teacher_id 是历史遗留的单值冗余字段，现语义调整为「主班主任」，
 *    指向该班最早设置的那位班主任。保留它是为了让班级公开页、统计报表等
 *    只展示单个人的旧逻辑继续可用；任何改动班主任关系的操作之后都必须调用
 *    syncPrimaryHeadTeacher() 重新同步，否则这些旧逻辑会失真。
 */
const { db } = require('../config/database');

/**
 * 取某班级的全部班主任（按设置时间升序，首位即主班主任）
 * @param {number|string} classId
 * @returns {{id:number, username:string, real_name:string|null, avatar:string|null, subject:string|null}[]}
 */
function getHeadTeachers(classId) {
  return db.prepare(`
    SELECT ct.teacher_id AS id, u.username, u.real_name, u.avatar, ct.subject, ct.created_at
    FROM class_teachers ct
    JOIN users u ON u.id = ct.teacher_id
    WHERE ct.class_id = ? AND ct.role = 'head_teacher'
    ORDER BY ct.created_at ASC, ct.id ASC
  `).all(classId);
}

/**
 * 取某教师担任班主任的全部班级（一个教师可同时是多个班的班主任）
 * @param {number|string} teacherId
 * @returns {any[]}
 */
function getHeadTeacherClasses(teacherId) {
  return db.prepare(`
    SELECT c.*, COALESCE(u.real_name, u.username) AS head_teacher_name
    FROM classes c
    JOIN class_teachers ct ON ct.class_id = c.id
    LEFT JOIN users u ON u.id = c.head_teacher_id
    WHERE ct.teacher_id = ? AND ct.role = 'head_teacher'
    ORDER BY c.created_at DESC
  `).all(teacherId);
}

/**
 * 取某班级的班主任人数
 * @param {number|string} classId
 * @returns {number}
 */
function countHeadTeachers(classId) {
  return db.prepare(
    `SELECT COUNT(*) AS c FROM class_teachers WHERE class_id = ? AND role = 'head_teacher'`
  ).get(classId).c;
}

/**
 * 同步冗余字段 classes.head_teacher_id（= 主班主任）。
 * 该班没有班主任时置空。幂等，可在任意改动班主任关系后安全调用。
 * @param {number|string} classId
 */
function syncPrimaryHeadTeacher(classId) {
  const primary = db.prepare(`
    SELECT teacher_id FROM class_teachers
    WHERE class_id = ? AND role = 'head_teacher'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).get(classId);
  db.prepare('UPDATE classes SET head_teacher_id = ? WHERE id = ?')
    .run(primary ? primary.teacher_id : null, classId);
}

module.exports = {
  getHeadTeachers,
  getHeadTeacherClasses,
  countHeadTeachers,
  syncPrimaryHeadTeacher,
};