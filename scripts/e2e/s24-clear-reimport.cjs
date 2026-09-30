// 阶段24：验证「清理数据 → 重新导入演示数据」往返可用
// 前置：先备份 backend/data/database.sqlite，异常时可整体还原
const fs = require('fs');
const path = require('path');
const BACKEND = 'http://localhost:3000';

const DB_FILE = 'D:/参赛用/2026-创AI/pet/backend/data/database.sqlite';
const BACKUP = `${DB_FILE}.bak-${Date.now()}`;

const TABLES = ['users', 'classes', 'assignments', 'submissions', 'wrong_questions',
  'achievements', 'tasks', 'forums', 'question_bank', 'pets', 'cards'];

async function call(p, token, method = 'GET', body) {
  const res = await fetch(`${BACKEND}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json };
}

function counts(db) {
  const out = {};
  for (const t of TABLES) {
    try { out[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch (e) { out[t] = 'ERR'; }
  }
  return out;
}

(async () => {
  fs.copyFileSync(DB_FILE, BACKUP);
  console.log('已备份数据库 ->', path.basename(BACKUP));

  // 用独立连接读库（后端进程已打开同一个文件，只读统计不受影响）
  const Database = require('D:/参赛用/2026-创AI/pet/backend/node_modules/better-sqlite3');
  const db = new Database(DB_FILE, { readonly: true });

  let token = null;
  try {
    const login = await call('/api/auth/login', null, 'POST', { username: 'admin', password: '111111' });
    token = login.json?.token || login.json?.access_token;
    console.log('登录 admin:', login.status);
    if (!token) throw new Error('未取得 token');

    console.log('\n[清理前] ', JSON.stringify(counts(db)));

    const clean = await call('/api/admin/clean-all-data', token, 'POST', {});
    console.log('清理数据:', clean.status, clean.json?.message || JSON.stringify(clean.json));
    const afterClean = counts(db);
    console.log('[清理后] ', JSON.stringify(afterClean));

    const baseOk = ['achievements', 'tasks', 'forums', 'question_bank']
      .every(t => typeof afterClean[t] === 'number' && afterClean[t] > 0);
    console.log('基础配置保留(成就/任务/论坛/题库):', baseOk ? 'OK' : '❌ 被误删');
    console.log('业务数据已清空(users<=1 且 assignments=0):',
      afterClean.users <= 1 && afterClean.assignments === 0 ? 'OK' : `users=${afterClean.users} assignments=${afterClean.assignments}`);

    const imp = await call('/api/admin/system/demo-data', token, 'POST', { updateNotices: true });
    console.log('\n重新导入:', imp.status, imp.json?.message || JSON.stringify(imp.json).slice(0, 200));
    const afterImport = counts(db);
    console.log('[导入后] ', JSON.stringify(afterImport));

    const restored = afterImport.users > 10 && afterImport.assignments > 0 && afterImport.classes > 0;
    console.log('往返结果:', restored ? '✅ 数据已恢复' : '❌ 未能恢复');
  } catch (e) {
    console.error('异常:', e.message);
    console.log('如需还原：把备份文件覆盖回', DB_FILE);
  } finally {
    db.close();
  }
})();
