// 演示数据：常量与公共工具（由 services/demoData.js 拆分而来，内容未改动）
const crypto = require('crypto');

const DEMO_PREFIX = 'demo_';
const DEMO_PASSWORD = '111111';
const DEMO_SCHOOL_NAME = '演示学校';
const DEMO_CLASS_NAMES = ['演示1班', '演示2班'];
const DEMO_TEACHER_COUNT = 4;
const DEMO_STUDENT_COUNT = 30;

const stages = ['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'];

// 固定随机种子，保证每次生成的演示数据一致（可复现）
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

function slugFor(name) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'class'}-${crypto.randomBytes(3).toString('hex')}`;
}

const isDemoUsername = (u) => String(u || '').startsWith(DEMO_PREFIX);

// 演示公告文案（导入演示数据时可选写入「全局公告」「首页公告」）
function buildDemoNotice() {
  return [
    '想体验系统？试试演示账号：',
    `教师：${DEMO_PREFIX}teacher1 ~ ${DEMO_PREFIX}teacher${DEMO_TEACHER_COUNT}（密码 ${DEMO_PASSWORD}）`,
    `学生：${DEMO_PREFIX}student1 ~ ${DEMO_PREFIX}student${DEMO_STUDENT_COUNT}（密码 ${DEMO_PASSWORD}）`,
    '（演示数据可在管理后台「系统数据」页签一键清除）',
  ].join('\n');
}

const NOTICE_KEYS = ['site_announcement', 'home_notice'];
const NOTICE_SNAPSHOT_KEY = 'demo_notice_snapshot';

// 写入演示公告，并记录快照（用于清除演示数据时安全还原）
async function applyDemoNotices(knex) {
  const text = buildDemoNotice();
  for (const key of NOTICE_KEYS) {
    await knex('settings').insert({ key, value: text }).onConflict('key').merge();
  }
  await knex('settings')
    .insert({ key: NOTICE_SNAPSHOT_KEY, value: JSON.stringify({ site_announcement: text, home_notice: text }) })
    .onConflict('key').merge();
  return text;
}

// 清除演示数据时：若公告内容仍是我们写入的内容（未被人工修改），则清空还原
async function restoreDemoNotices(knex) {
  const snapshotRow = await knex('settings').where('key', NOTICE_SNAPSHOT_KEY).first();
  if (!snapshotRow) return false;

  let snapshot = {};
  try { snapshot = JSON.parse(snapshotRow.value); } catch (e) { /* 忽略解析失败 */ }

  let restored = false;
  for (const key of NOTICE_KEYS) {
    const current = await knex('settings').where('key', key).first();
    if (current && snapshot[key] && current.value === snapshot[key]) {
      await knex('settings').where('key', key).update({ value: '' });
      restored = true;
    }
  }
  await knex('settings').where('key', NOTICE_SNAPSHOT_KEY).del();
  return restored;
}

async function getDemoUsers(knex) {
  const users = await knex('users').select('id', 'username', 'role');
  return users.filter((u) => isDemoUsername(u.username));
}

async function getDemoClassIds(knex) {
  const rows = await knex('classes').select('id', 'name');
  return rows.filter((c) => DEMO_CLASS_NAMES.includes(c.name)).map((c) => c.id);
}

// ==================== 导入演示数据 ====================

module.exports = {
  DEMO_PREFIX, DEMO_PASSWORD, DEMO_SCHOOL_NAME, DEMO_CLASS_NAMES,
  DEMO_TEACHER_COUNT, DEMO_STUDENT_COUNT, stages,
  seededRandom, slugFor, isDemoUsername, buildDemoNotice,
  applyDemoNotices, restoreDemoNotices, getDemoUsers, getDemoClassIds,
};
