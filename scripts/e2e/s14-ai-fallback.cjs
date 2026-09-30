// 验证「无 API Key」时 AI 链路的降级行为（临时清空密钥 → 请求 → 必须立即恢复）
const BACKEND = 'http://localhost:3000';
const { db } = require('D:/参赛用/2026-创AI/pet/backend/src/config/database');

const KEY_ROW = 'ai_api_key';

async function post(path, body, token) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
  return { status: res.status, json };
}

(async () => {
  const original = db.prepare('SELECT key, value FROM settings WHERE key = ?').get(KEY_ROW);
  console.log('原始密钥长度:', (original?.value || '').length);

  try {
    const login = await post('/api/auth/login', { username: 'demo_teacher1', password: '111111' });
    const token = login.json?.token || login.json?.access_token;
    console.log('登录:', login.status, token ? 'ok' : JSON.stringify(login.json));
    if (!token) throw new Error('未取得 token');

    // 1) 临时清空密钥，模拟「管理员未配置 AI」
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('', KEY_ROW);
    const cleared = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_ROW);
    console.log('清空后密钥长度:', (cleared?.value || '').length);

    // 2) 调 AI 生成作业
    const gen = await post('/api/assignments/generate', {
      subject: '数学', question_type: 'choice_single', count: 1, topic: '二次函数', difficulty: 'easy',
    }, token);
    console.log('AI生成(无Key) 状态码:', gen.status);
    console.log('AI生成(无Key) 响应:', JSON.stringify(gen.json));

    // 3) 调 AI 助教
    const coach = await post('/api/ai-coach/chat', { message: '给我一个学习计划' }, token);
    console.log('AI助教(无Key) 状态码:', coach.status);
    console.log('AI助教(无Key) 响应:', JSON.stringify(coach.json));

  } catch (e) {
    console.error('探测异常:', e.message);
  } finally {
    // 必须恢复密钥
    if (original && original.value) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(original.value, KEY_ROW);
      const now = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY_ROW);
      console.log('已恢复密钥，长度:', (now?.value || '').length, now?.value === original.value ? '(一致)' : '(不一致！请检查)');
    } else {
      console.log('原始无密钥，未做恢复');
    }
  }
})();
