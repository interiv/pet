/**
 * 按角色决定「通知中心可见哪些类型」与「左侧菜单红点统计哪些类型」。
 *
 * 原先 Notifications.tsx 和 Home.tsx 各写了一份白名单，且已经漂移
 * （student / admin 的 answer_changed 两边不一致），
 * 容易出现「红点亮着但点进去没有」或反过来的问题，故收敛到一处。
 *
 * 关于 class_join_request：申请只会发给该班班主任；但当班级没有班主任时，
 * 没有任何教师能审批，会兜底通知管理员，所以管理员必须能看到这一类。
 */
const NOTIFICATION_VISIBLE_TYPES: Record<string, string[]> = {
  admin: ['system', 'forum_reply', 'forum_like', 'forum_quote', 'answer_changed', 'class_join_request'],
  teacher: ['system', 'forum_reply', 'forum_like', 'forum_quote', 'friend_request', 'friend_accepted', 'class_join_request', 'post_like', 'post_comment'],
  student: ['friend_request', 'friend_accepted', 'gift_received', 'achievement', 'post_like', 'post_comment', 'forum_reply', 'forum_like', 'answer_changed'],
};

export function visibleNotificationTypes(role?: string): string[] {
  return NOTIFICATION_VISIBLE_TYPES[role || 'student'] || NOTIFICATION_VISIBLE_TYPES.student;
}

export default NOTIFICATION_VISIBLE_TYPES;