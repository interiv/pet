// 通过管理后台接口重新导入演示数据（幂等，用于补齐题目并修正异常分数）
const BASE = 'http://127.0.0.1:3000';

const login = async (u, p) => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  return (await r.json()).token;
};

const token = await login('admin', '111111');
const r = await fetch(`${BASE}/api/admin/system/demo-data`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({}),
});
const j = await r.json();
console.log('status', r.status);
console.log(JSON.stringify(j, null, 1));
