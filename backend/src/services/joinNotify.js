const { db } = require('../config/database');

/**
 * 班级成员变动通知的收件人规则（原先散落在 auth.js / classes.js 三处，都是「通知全班所有教师」，
 * 但只有班主任才有审批权，导致普通任课教师收到通知却点不动；班级没有班主任时更是没人收到）。
 *
 * 分级规则：
 *   1. 有班主任 → 只通知班主任本人（任课教师不参与审批，不打扰）。
 *   2. 没有班主任 → 没有任何教师能处理，改由管理员兜底，并在内容里点明「该班无班主任」，
 *      让管理员可以直接去指派班主任，而不是干等。
 *   3. 班主任和管理员都没有 → 记日志，绝不静默丢弃。
 */

function resolveRecipients(classId) {
  const headTeacherRows = db.prepare(
    `SELECT teacher_id FROM class_teachers WHERE class_id = ? AND role = 'head_teacher'`
  ).all(classId);
  if (headTeacherRows.length > 0) {
    return { recipients: [...new Set(headTeacherRows.map((r) => r.teacher_id))], hasHeadTeacher: true };
  }
  const adminRows = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`).all();
  return { recipients: [...new Set(adminRows.map((r) => r.id))], hasHeadTeacher: false };
}

function insertNotification(userId, title, content, sourceType, sourceId) {
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
    VALUES (?, 'class_join_request', ?, ?, ?, ?)
  `).run(userId, title, content, sourceType, sourceId);
}

function getClassName(classId) {
  return db.prepare('SELECT name FROM classes WHERE id = ?').get(classId)?.name || '未知班级';
}

function fanout({ classId, title, content, sourceType, sourceId }) {
  const { recipients, hasHeadTeacher } = resolveRecipients(classId);

  if (recipients.length === 0) {
    console.warn(`⚠️ 班级 #${classId}（${getClassName(classId)}）既无班主任也无管理员，申请/加入通知已丢弃：${title}`);
    return 0;
  }

  const className = getClassName(classId);
  for (const userId of recipients) {
    // 无班主任时收件人是管理员，文案要换成「请你处理」而不是「请前往审批」
    const finalContent = hasHeadTeacher ? content : `${content}\n该班当前没有班主任，无法自行审批，请管理员协助处理。`;
    insertNotification(userId, title, finalContent, sourceType, sourceId);
  }
  return recipients.length;
}

/**
 * 有人（教师或学生）提交了入班申请，尚未审批。
 *
 * @param {number} classId      申请的班级
 * @param {number} applicantId  申请人 user_id（用作 source_id）
 * @param {string} applicantName 申请人展示名
 * @param {'teacher'|'student'} role
 * @param {'head_teacher'|'teacher'} [teacherType] 申请教师时的身份
 * @param {string} [subject]    任教科目
 */
function notifyClassApplication({ classId, applicantId, applicantName, role, teacherType, subject }) {
  const className = getClassName(classId);
  const subjectText = subject ? `（科目：${subject}）` : '';
  const wantHeadTeacher = role === 'teacher' && teacherType === 'head_teacher';

  const title = wantHeadTeacher
    ? '新教师申请担任班主任'
    : role === 'teacher' ? '新教师申请加入班级' : '新学生申请加入班级';

  const content = wantHeadTeacher
    ? `${applicantName} 申请担任班级「${className}」的班主任${subjectText}，请前往审批。`
    : role === 'teacher'
      ? `${applicantName} 申请以任课教师身份加入班级「${className}」${subjectText}，请前往审批。`
      : `${applicantName} 申请加入班级「${className}」，请前往审批。`;

  return fanout({ classId, title, content, sourceType: 'class_application', sourceId: applicantId });
}

/**
 * 有人通过邀请码直接加入了班级（成员已落地，这里只做知会）。
 */
function notifyClassMemberJoined({ classId, memberId, memberName, role }) {
  const className = getClassName(classId);
  const title = `新${role === 'teacher' ? '教师' : '学生'}已加入班级`;
  const content = `${memberName} 通过邀请码加入了班级「${className}」。`;
  return fanout({ classId, title, content, sourceType: 'class_member', sourceId: memberId });
}

module.exports = { notifyClassApplication, notifyClassMemberJoined };