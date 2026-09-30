// 一次性：清除演示账号的陈旧 AI 助教报告缓存（对齐 10c 新增的清理逻辑）
const { db } = require('D:/参赛用/2026-创AI/pet/backend/src/config/database');

const before = db.prepare('select count(*) c from ai_reports').get().c;
const info = db.prepare(
  'delete from ai_reports where user_id in (select id from users where username like ?)'
).run('demo_%');
const after = db.prepare('select count(*) c from ai_reports').get().c;
const restRows = db.prepare('select r.report_type, r.generated_at, u.username from ai_reports r join users u on u.id = r.user_id').all();

console.log(`清理前报告数: ${before}`);
console.log(`已删除演示账号报告: ${info.changes}`);
console.log(`清理后剩余: ${after}`);
console.log('剩余明细:', restRows.length ? restRows.map((r) => `${r.username}/${r.report_type}@${r.generated_at}`).join(' | ') : '(无)');
