// 阶段21：验证 AI 助教（learning-plan / diagnosis）在无 API Key 时的降级行为
// 说明：s14 之前调用的是不存在的 /ai-coach/chat（404），本脚本使用前端真实调用的接口
const BACKEND = 'http://localhost:3000';
const { db } = require('D:/参赛用/2026-创AI/pet/backend/src/config/database');

const KEY_ROW = 'ai_api_key';

async function call(path, token, method = 'GET', body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json };
}

(async () => {
  const original = db.prepare('SELECT key, value FROM settings WHERE key = ?').get(KEY_ROW);
  console.log('原始密钥长度:', (original?.value || '').length);
  let token = null;
  try {
    const login = await call('/api/auth/login', null, 'POST', { username: 'demo_student1', password: '111111' });
    token = login.json?.token || login.json?.access_token;
    console.log('登录:', login.status, token ? 'ok' : JSON.stringify(login.json));
    if (!token) throw new Error('未取得 token');

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('', KEY_ROW);
    console.log('已临时清空 API Key');

    for (const p of ['/api/ai-coach/learning-plan?force=1', '/api/ai-coach/diagnosis?force=1']) {
      const r = await call(p, token);
      console.log(`\nGET ${p} -> ${r.status}`);
      console.log('  响应:', JSON.stringify(r.json).slice(0, 300));
    }
  } catch (e) {
    console.error('探测异常:', e.message);
  } finally {
    if (original && original.value) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(original.value, KEY_ROW);
      const now = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_ROW);
      console.log('\n已恢复密钥，长度:', (now?.value || '').length, now?.value === original.value ? '(一致)' : '(不一致！请检查)');
    } else {
      console.log('\n原始无密钥，未做恢复');
    }
  }
})();
