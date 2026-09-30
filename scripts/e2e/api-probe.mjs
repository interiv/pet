// 直接调用后端 API 核对数据
const BASE = 'http://127.0.0.1:3000';
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log(s); };

async function login(u, p) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('login failed ' + JSON.stringify(j));
  return j.token;
}
const get = async (path, token) => {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  let j; try { j = await r.json(); } catch { j = null; }
  return { status: r.status, body: j };
};

const t = await login('demo_teacher1', '111111');
log('=== GET /api/admin/statistics (teacher) ===');
let r = await get('/api/admin/statistics', t);
log('status', r.status);
log(JSON.stringify(r.body?.statistics?.classes, null, 1).slice(0, 1200));

const classId = r.body?.statistics?.classes?.list?.[0]?.id;
log('\n=== leaderboard class_id=' + classId + ' ===');
r = await get(`/api/leaderboard/level?class_id=${classId}&limit=5`, t);
log('status', r.status, JSON.stringify(r.body).slice(0, 500));

log('\n=== knowledge-points class overview ===');
r = await get(`/api/knowledge-points/class-overview?class_id=${classId}&days=14`, t);
log('status', r.status, JSON.stringify(r.body).slice(0, 800));

log('\n=== assignments (teacher) ===');
r = await get('/api/assignments', t);
const list = r.body?.assignments || [];
log('status', r.status, 'count', list.length);
log(JSON.stringify(list.slice(0, 2).map(a => ({ id: a.id, title: a.title, due_date: a.due_date, question_count: a.question_count, class_student_count: a.class_student_count, submitted_count: a.submitted_count })), null, 1));

// 学生
const s = await login('demo_student1', '111111');
log('\n=== 学生 jobs 列表 ===');
r = await get('/api/assignments', s);
const sl = r.body?.assignments || [];
log('count', sl.length);
log(JSON.stringify(sl.slice(0, 2).map(a => ({ id: a.id, title: a.title, due_date: a.due_date, my_score: a.my_score, question_count: a.question_count, class_student_count: a.class_student_count })), null, 1));

log('\n=== 成就列表 ===');
r = await get('/api/achievements', s);
log('status', r.status, JSON.stringify(r.body).slice(0, 400));

log('\n=== 每日任务 ===');
r = await get('/api/daily-tasks', s);
log('status', r.status, JSON.stringify(r.body).slice(0, 600));
