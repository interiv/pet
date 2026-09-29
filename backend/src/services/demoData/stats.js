// 演示数据：演示数据规模统计（由 services/demoData.js 拆分而来，内容未改动）

const {
  DEMO_PREFIX, DEMO_PASSWORD, DEMO_SCHOOL_NAME, DEMO_CLASS_NAMES,
  DEMO_TEACHER_COUNT, DEMO_STUDENT_COUNT, stages,
  seededRandom, slugFor, isDemoUsername, buildDemoNotice,
  applyDemoNotices, restoreDemoNotices, getDemoUsers, getDemoClassIds,
} = require('./_common');

const { db } = require('../../config/database');

async function getDemoStats(knex) {
  const demoUsers = await getDemoUsers(knex);
  const demoClassIds = await getDemoClassIds(knex);
  const userIds = demoUsers.map((u) => u.id);

  const countIn = async (table, column = 'user_id') => {
    if (!userIds.length) return 0;
    const row = await knex(table).whereIn(column, userIds).count('* as cnt').first();
    return row ? row.cnt : 0;
  };

  return {
    imported: demoUsers.length > 0,
    teachers: demoUsers.filter((u) => u.role === 'teacher').length,
    students: demoUsers.filter((u) => u.role === 'student').length,
    classes: demoClassIds.length,
    pets: await countIn('pets'),
    assignments: demoClassIds.length
      ? (await knex('assignments').whereIn('class_id', demoClassIds).count('* as cnt').first()).cnt
      : 0,
    submissions: await countIn('submissions'),
    friends: await countIn('friends'),
    password: DEMO_PASSWORD,
    prefix: DEMO_PREFIX,
  };
}

module.exports = getDemoStats;
