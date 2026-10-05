/**
 * 异步出题接口本地测试
 *
 * 用项目自身的 JWT secret 签发测试 token：不碰账号密码、不写数据库。
 * token 里带的用户直接从库里取一个真实的教师账号，保证权限校验与线上一致。
 *
 * 前置条件：
 *   1. 后端已启动：node src/server.js
 *   2. mock AI 已启动（让耗时可控、不烧真实额度）：
 *        MOCK_DELAY_MS=25000 node tests/mock-ai-server.cjs
 *      并把 backend/.env 的 AI base_url 指向 http://127.0.0.1:8897
 *
 * 想验证「超过 60 秒不被切断」，让总耗时超过 60 秒即可，例如：
 *   5 种题型 + ai_gen_concurrency=2 + 每个请求 25 秒  →  约 75 秒
 *
 * 验证目标：
 *  1. 提交任务立即返回（不挂长连接）
 *  2. 轮询能拿到题型级进度
 *  3. 总耗时超过 60 秒仍能正常拿到结果（这正是原来 504 的场景）
 *  4. 同一用户重复提交被拦截
 *  5. 别人的任务查不到（403）
 *  6. 不存在的任务返回 404
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { db } = require('../src/config/database');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3001/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 签发 token：与登录接口同一套密钥、同一套 payload 结构
function issueToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
}

const teacher = db.prepare("SELECT id, username, role, class_id FROM users WHERE role='teacher' ORDER BY id DESC LIMIT 1").get();
const other = db.prepare("SELECT id, username, role FROM users WHERE role='teacher' AND id != ? ORDER BY id DESC LIMIT 1").get(teacher.id);
if (!teacher) { console.error('库里没有教师账号，无法测试'); process.exit(1); }

let token = issueToken(teacher);

async function call(method, p, body, tk) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 无 body */ }
  return { status: res.status, data };
}

const stamp = () => new Date().toISOString().slice(11, 23);
const say = (s) => console.log(`[${stamp()}] ${s}`);
const pass = (ok) => (ok ? 'PASS' : 'FAIL');

(async () => {
  say(`测试身份: ${teacher.username} (id=${teacher.id})`);

  // ---------- 1. 查不存在的任务 ----------
  const nf = await call('GET', '/assignments/generate/not-exist-id', null, token);
  console.log(`\n【边界1】查询不存在的任务 -> ${nf.status} ${JSON.stringify(nf.data)}`);
  console.log(`  判定: ${pass(nf.status === 404)}  (应为 404)`);

  // ---------- 2. 提交任务 ----------
  // 5 种题型，并发 3 → 分 2 批跑完。配合 mock 每个请求 35 秒的延迟，
  // 总耗时必然超过 60 秒，正好复现原来必 504 的场景。
  const payload = {
    subject: '语文',
    mode: 'topic',
    topic: '七年级下册第一单元第2课的生字词读读写写，生成题目',
    type_specs: [
      { question_type: 'choice_single', count: 1, difficulty: 'easy' },
      { question_type: 'choice_multi', count: 1, difficulty: 'easy' },
      { question_type: 'judgment', count: 1, difficulty: 'easy' },
      { question_type: 'fill_blank', count: 1, difficulty: 'easy' },
      { question_type: 'essay', count: 1, difficulty: 'easy' },
    ],
  };

  say('提交任务...');
  const t0 = Date.now();
  const sub = await call('POST', '/assignments/generate', payload, token);
  const submitMs = Date.now() - t0;
  const taskId = sub.data && sub.data.task_id;

  console.log(`\n【核心1】提交响应 ${sub.status}，耗时 ${submitMs}ms`);
  console.log(`  返回: ${JSON.stringify(sub.data)}`);
  console.log(`  判定: ${pass(sub.status === 202 && !!taskId)}  立即返回 202 且带 task_id`);
  console.log(`  判定: ${pass(submitMs < 2000)}  未挂长连接 (<2s，实际 ${submitMs}ms)`);
  if (!taskId) { console.error('拿不到 task_id，后续测试无法进行'); process.exit(1); }

  // ---------- 3. 重复提交拦截 ----------
  const dup = await call('POST', '/assignments/generate', payload, token);
  console.log(`\n【核心2】重复提交 -> ${dup.status} ${JSON.stringify(dup.data)}`);
  console.log(`  判定: ${pass(dup.status === 409)}  同一用户重复提交被拦截`);

  // ---------- 4. 越权访问 ----------
  if (other) {
    const peek = await call('GET', `/assignments/generate/${taskId}`, null, issueToken(other));
    console.log(`\n【安全】其他教师(${other.username}) 查该任务 -> ${peek.status}`);
    console.log(`  判定: ${pass(peek.status === 403)}  越权被拒 (403)`);
  }

  // ---------- 5. 轮询进度 ----------
  console.log('\n【核心3】轮询进度:');
  const pollStart = Date.now();
  let lastLine = '';
  let sawProgress = false;
  let result = null;
  const pollTimes = [];

  while (Date.now() - pollStart < 10 * 60 * 1000) {
    const p0 = Date.now();
    const poll = await call('GET', `/assignments/generate/${taskId}`, null, token);
    pollTimes.push(Date.now() - p0);

    if (poll.status !== 200) { console.log(`  轮询中断: ${poll.status} ${JSON.stringify(poll.data)}`); break; }
    const d = poll.data;
    const line = `  ${String(d.percent).padStart(3)}% | ${d.current_label} | ${d.status}`;
    if (line !== lastLine) { console.log(line); lastLine = line; }
    if (d.percent > 0) sawProgress = true;

    if (d.status === 'done') { result = d.result; break; }
    if (d.status === 'failed') { console.log(`  任务失败: ${d.error}`); break; }
    await sleep(2000);
  }

  const totalSec = (Date.now() - pollStart) / 1000;
  const maxPoll = Math.max(...pollTimes);
  console.log(`\n  总耗时 ${totalSec.toFixed(1)}s |轮询 ${pollTimes.length} 次 | 单次最长 ${maxPoll}ms`);
  console.log(`  判定: ${pass(maxPoll < 5000)}  每次轮询 <5s（最长 ${maxPoll}ms），网关不会切断`);
  console.log(`  判定: ${pass(totalSec > 60)}  总耗时超过 60 秒仍未中断（原场景必 504）`);
  console.log(`  判定: ${pass(sawProgress)}  拿到过题型级进度变化`);

  if (result) {
    console.log(`\n【核心4】结果校验:`);
    console.log(`  标题: ${result.title}`);
    console.log(`  题目数: ${result.question_count} / 目标 ${result.requested_count}`);
    console.log(`  题型: ${JSON.stringify(result.question_types || [])}`);
    const real = (result.questions || []).filter(q => q && String(q.content || '').trim().length >= 4);
    console.log(`  判定: ${pass(result.question_count > 0)}  有题目返回`);
    console.log(`  判定: ${pass(real.length === result.question_count)}  题目内容非空且合法(${real.length}/${result.question_count})`);
  } else {
    console.log('\n【核心4】未拿到结果');
  }

  // ---------- 6. 完成后重复查询 ----------
  const after = await call('GET', `/assignments/generate/${taskId}`, null, token);
  console.log(`\n【边界2】完成后重复查询 -> ${after.status}`);
  console.log(`  判定: ${pass(after.status === 200 && after.data.result)}  结果可重复获取`);

  // ---------- 7. 任务结束后应能再次提交 ----------
  // 用非法题型让它立刻失败，只验证「拦截已解除」，不白烧一次 AI 额度
  const again = await call('POST', '/assignments/generate', { subject: '语文', mode: 'topic', topic: '拦截解除验证', type_specs: [{ question_type: '__invalid__', count: 1, difficulty: 'easy' }] }, token);
  console.log(`\n【边界3】前一个任务结束后再次提交 -> ${again.status} ${pass(again.status === 202)}  (应为 202，说明拦截已解除)`);

  console.log('\n测试结束');
  process.exit(0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
