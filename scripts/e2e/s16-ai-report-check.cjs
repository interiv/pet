// 检查 AI 助教报告是否为「修复前」的陈旧缓存：对比真实正确率与报告口径，并强制刷新一次
const BACKEND = 'http://localhost:3000';
const { db } = require('D:/参赛用/2026-创AI/pet/backend/src/config/database');

(async () => {
  const cols = db.prepare('pragma table_info(submissions)').all().map((x) => x.name);
  console.log('submissions 字段:', cols.join(','));

  const uid = db.prepare('select id from users where username = ?').get('demo_student1')?.id;
  console.log('demo_student1 id =', uid);
  if (!uid) return;

  const join = cols.includes('student_id') ? 's.student_id' : 's.user_id';
  const stat = db.prepare(
    'select count(*) total, sum(case when qa.is_correct=1 then 1 else 0 end) correct ' +
    'from question_answers qa join submissions s on s.id = qa.submission_id ' +
    `where ${join} = ?`
  ).get(uid);
  console.log(`真实答题明细: 共 ${stat.total} 题，答对 ${stat.correct || 0} 题，正确率 ${stat.total ? ((stat.correct || 0) / stat.total * 100).toFixed(1) : 0}%`);

  const cache = db.prepare('select report_type, generated_at, length(content) len from ai_reports where user_id = ?').all(uid);
  console.log('AI 报告缓存:', cache.length ? cache.map((c) => `${c.report_type}@${c.generated_at}(${c.len}字)`).join(' | ') : '(无缓存)');

  // 强制刷新（真实调用大模型）
  const lr = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo_student1', password: '111111' }),
  });
  const token = (await lr.json())?.token;
  const t0 = Date.now();
  const res = await fetch(`${BACKEND}/api/ai-coach/learning-plan?days=7&force=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => null);
  console.log(`\n强制刷新 learning-plan: status=${res.status} 耗时=${Date.now() - t0}ms`);
  const ov = json?.plan?.overview || json?.message || JSON.stringify(json).slice(0, 300);
  console.log('刷新后 overview:', String(ov).slice(0, 400));

  const after = db.prepare('select report_type, generated_at from ai_reports where user_id = ?').all(uid);
  console.log('刷新后缓存:', after.map((c) => `${c.report_type}@${c.generated_at}`).join(' | '));
})();
