// BOSS战 / PVP 对战：确认接口可读、演示数据存在、无 500
const BASE = 'http://localhost:3000';

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json };
}

(async () => {
  try {
    const lg = await call('POST', '/api/auth/login', null, { username: 'demo_student1', password: '111111' });
    const token = lg.json?.token;
    console.log('登录:', lg.status);

    // 路径取自前端 utils/api.ts，避免猜测导致误判
    const paths = [
      ['GET', '/api/pets/my-pet'],
      ['GET', '/api/pets/skills'],
      ['GET', '/api/battles/history'],
      ['GET', '/api/boss-battles/list/7'],
      ['GET', '/api/boss-battles/current/7'],
      ['GET', '/api/boss-battles/wrong-questions/7'],
      ['GET', '/api/boss-battles/history/7'],
    ];
    for (const [m, p] of paths) {
      const r = await call(m, p, token);
      const size = r.json ? (Array.isArray(r.json) ? r.json.length : Object.keys(r.json).length) : 0;
      console.log(`${m} ${p} -> ${r.status} 元素/字段数=${size} ${r.status >= 400 ? JSON.stringify(r.json).slice(0, 160) : ''}`);
    }
  } catch (e) {
    console.error('异常:', e.message);
  }
})();
