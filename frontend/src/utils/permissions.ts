/**
 * 前端侧的班级权限判定（与后端 middleware/classAccess.js 的规则一一对应）：
 *
 *   普通教师  —— 无权参与任教关系管理，也不该管理班级内容
 *   班主任    —— 可管理本班任教关系与本班学生内容，不能改他人身份
 *   管理员    —— 全权限
 *
 * 「班主任」不是 user.role，而是 class_teachers.role === 'head_teacher'，
 * 该信息由登录接口通过 user.teacher_classes[].class_role 提供。
 */

export interface TeacherClassBrief {
  id: number;
  name?: string;
  class_role?: 'head_teacher' | 'teacher';
  subject?: string | null;
}

/** 该用户是否为指定班级的班主任（管理员不算「班主任」，但下面 canManage 会兜住）。 */
export function isHeadTeacherOfClass(user: any, classId?: number | null): boolean {
  if (!user || user.role === 'admin' || !classId) return false;
  const list: TeacherClassBrief[] = user.teacher_classes || [];
  return list.some((c) => Number(c.id) === Number(classId) && c.class_role === 'head_teacher');
}

/** 该用户是否对指定班级内容有管理权（管理员全局，或该班班主任）。 */
export function canManageClassContent(user: any, classId?: number | null): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return isHeadTeacherOfClass(user, classId);
}

/** 是否是自己发布的。 */
export function isOwnPost(user: any, authorId?: number | null): boolean {
  return !!user && authorId != null && Number(user.id) === Number(authorId);
}

/**
 * 能否删除一条动态/帖子：作者本人、管理员、或该条所属班的班主任。
 */
export function canDeletePost(
  user: any,
  post: { user_id?: number; class_id?: number | null } | null | undefined
): boolean {
  if (!user || !post) return false;
  return isOwnPost(user, post.user_id) || canManageClassContent(user, post.class_id);
}