const BASE = 'http://127.0.0.1:3000';
const login = async (u, p) => (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token;
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } }); let j; try { j = await r.json(); } catch { j = null; } return { status: r.status, body: j }; };

const s = await login('demo_student1', '111111');
for (const p of ['/api/knowledge-points', '/api/knowledge-points?days=30', '/api/knowledge-points/heatmap?days=30', '/api/knowledge-points/weak-points?days=30', '/api/knowledge-points/learning-time?days=30']) {
  const r = await get(p, s);
  console.log('\n===', p, '->', r.status);
  console.log(JSON.stringify(r.body).slice(0, 700));
}

const t = await login('demo_teacher1', '111111');
for (const p of ['/api/knowledge-points/class/32/overview?days=30']) {
  const r = await get(p, t);
  console.log('\n===', p, '->', r.status);
  console.log(JSON.stringify(r.body).slice(0, 900));
}
