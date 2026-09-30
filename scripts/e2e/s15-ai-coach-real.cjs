// 真实调用 AI 助教（学习规划 + 学情诊断），确认配置路径可用
const BACKEND = 'http://localhost:3000';

async function get(path, params, token, timeoutMs = 180000) {
  const url = new URL(`${BACKEND}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal });
    let json = null;
    try { json = await res.json(); } catch (e) { /* 非 JSON */ }
    return { status: res.status, json, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, error: e.name === 'AbortError' ? `超时(${timeoutMs}ms)` : e.message, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

function brief(obj) {
  if (!obj) return '(空)';
  const s = JSON.stringify(obj);
  return s.length > 600 ? `${s.slice(0, 600)} ...[截断,总长${s.length}]` : s;
}

(async () => {
  const users = ['demo_student1', 'demo_teacher1'];
  try {
    for (const u of users) {
      const lr = await fetch(`${BACKEND}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: '111111' }),
      });
      const lj = await lr.json();
      const token = lj?.token;
      console.log(`\n===== ${u} 登录: ${lr.status} ${token ? 'ok' : JSON.stringify(lj)} =====`);
      if (!token) continue;

      const plan = await get('/api/ai-coach/learning-plan', { days: 7 }, token, 180000);
      console.log(`学习规划: status=${plan.status} 耗时=${plan.ms}ms`);
      console.log('  响应:', brief(plan.json || plan.error));

      if (u === 'demo_student1') {
        const diag = await get('/api/ai-coach/diagnosis', { days: 7 }, token, 180000);
        console.log(`学情诊断: status=${diag.status} 耗时=${diag.ms}ms`);
        console.log('  响应:', brief(diag.json || diag.error));
      }
    }
  } catch (e) {
    console.error('异常:', e.message);
  }
})();
