// 演示数据：清除演示数据（由 services/demoData.js 拆分而来，内容未改动）

const {
  DEMO_PREFIX, DEMO_PASSWORD, DEMO_SCHOOL_NAME, DEMO_CLASS_NAMES,
  DEMO_TEACHER_COUNT, DEMO_STUDENT_COUNT, stages,
  seededRandom, slugFor, isDemoUsername, buildDemoNotice,
  applyDemoNotices, restoreDemoNotices, getDemoUsers, getDemoClassIds,
} = require('./_common');

const { db } = require('../../config/database');

async function clearDemoData(knex) {
  const demoUsers = await getDemoUsers(knex);
  const demoClassIds = await getDemoClassIds(knex);

  if (demoUsers.length === 0 && demoClassIds.length === 0) {
    // 没有演示数据时，仍尝试还原此前写入的演示公告
    const restored = await restoreDemoNotices(knex);
    return {
      users: 0,
      classes: 0,
      noticesRestored: restored,
      message: restored ? '没有找到演示数据，演示公告已还原' : '没有找到演示数据',
    };
  }

  const userIds = demoUsers.map((u) => u.id);
  const petIds = userIds.length ? (await knex('pets').whereIn('user_id', userIds).select('id')).map((p) => p.id) : [];

  // 演示数据之间相互引用，临时关闭外键检查，按依赖顺序清理
  await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    if (petIds.length) {
      await knex('pet_skills').whereIn('pet_id', petIds).del();
      await knex('battles').whereIn('pet1_id', petIds).orWhereIn('pet2_id', petIds).del();
    }
    if (userIds.length) {
      await knex('pets').whereIn('user_id', userIds).del();
      await knex('user_items').whereIn('user_id', userIds).del();
      await knex('user_equipment').whereIn('user_id', userIds).del();
      // 先删答题明细（引用 submissions），再删提交记录
      const demoSubmissionIds = (await knex('submissions').whereIn('user_id', userIds).select('id')).map((s) => s.id);
      if (demoSubmissionIds.length) {
        await knex('question_answers').whereIn('submission_id', demoSubmissionIds).del();
        await knex('submissions').whereIn('id', demoSubmissionIds).del();
      }
      await knex('friends').whereIn('user_id', userIds).orWhereIn('friend_id', userIds).del();
      await knex('friend_requests').whereIn('sender_id', userIds).orWhereIn('receiver_id', userIds).del();
      await knex('notifications').whereIn('user_id', userIds).del();
      await knex('user_achievements').whereIn('user_id', userIds).del();
      await knex('gold_transactions').whereIn('user_id', userIds).del();
      await knex('user_activities').whereIn('user_id', userIds).del();
      await knex('chat_messages').whereIn('user_id', userIds).orWhereIn('target_user_id', userIds).del();
      await knex('chat_read_status').whereIn('user_id', userIds).orWhereIn('target_user_id', userIds).del();
      await knex('class_applications').whereIn('user_id', userIds).del();
      await knex('class_teachers').whereIn('teacher_id', userIds).del();
      await knex('ai_reports').whereIn('user_id', userIds).del();
      await knex('wrong_questions').whereIn('user_id', userIds).del();
      await knex('knowledge_point_stats').whereIn('user_id', userIds).del();
      await knex('user_tasks').whereIn('user_id', userIds).del();
      await knex('daily_task_logs').whereIn('user_id', userIds).del();
      await knex('posts').whereIn('user_id', userIds).del();
      await knex('post_likes').whereIn('user_id', userIds).del();
      await knex('post_comments').whereIn('user_id', userIds).del();
    }
    if (demoClassIds.length) {
      const demoAssignmentIds = (await knex('assignments').whereIn('class_id', demoClassIds).select('id')).map((a) => a.id);
      if (demoAssignmentIds.length) {
        await knex('assignment_questions').whereIn('assignment_id', demoAssignmentIds).del();
      }
      await knex('assignments').whereIn('class_id', demoClassIds).del();
      await knex('announcements').whereIn('class_id', demoClassIds).del();
      await knex('class_teachers').whereIn('class_id', demoClassIds).del();
      await knex('class_applications').whereIn('class_id', demoClassIds).del();
      await knex('class_invitations').whereIn('class_id', demoClassIds).del();
      await knex('chat_messages').whereIn('room_id', demoClassIds).del();
      await knex('classes').whereIn('id', demoClassIds).del();
    }
    if (userIds.length) {
      await knex('users').whereIn('id', userIds).del();
    }
    await knex('schools').where('name', DEMO_SCHOOL_NAME).del();
  } finally {
    await knex.raw('PRAGMA foreign_keys = ON');
  }

  // 若公告内容仍是我们导入时写入的（未被人工修改），则清空还原
  const noticesRestored = await restoreDemoNotices(knex);

  return {
    users: demoUsers.length,
    classes: demoClassIds.length,
    noticesRestored,
    message: `已清除 ${demoUsers.length} 个演示账号、${demoClassIds.length} 个演示班级及相关演示数据`
      + (noticesRestored ? '，演示公告已还原为空' : ''),
  };
}

// ==================== 演示数据规模 ====================

module.exports = clearDemoData;
