/**
 * 追加照片 + 多学生并发识别测试
 *
 * 回答两个问题：
 *   Q1 登记完/识别完后，能不能追加新照片再重新识别？
 *   Q2 A 识别期间，能不能同时上传并识别 B、C、D？
 *
 * 前置：
 *   node src/server.js
 *   MOCK_DELAY_MS=4000 node tests/mock-ai-server.cjs   （延迟调大才看得出并发）
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { db } = require('../src/config/database');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3001/api';
const stamp = () => new Date().toISOString().slice(11, 19);
const say = (s) => console.log(`[${stamp()}] ${s}`);
const pass = (ok) => (ok ? 'PASS' : 'FAIL');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token = '';
async function call(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, data };
}

const assignment = db.prepare("SELECT a.id, a.class_id, a.teacher_id FROM assignments a JOIN users u ON u.class_id = a.class_id AND u.role = 'student' GROUP BY a.id HAVING COUNT(u.id) >= 4 ORDER BY a.id DESC LIMIT 1").get();
if (!assignment) { console.error('需要至少 4 名学生的作业'); process.exit(1); }
const teacher = db.prepare("SELECT id, username, role FROM users WHERE id = ? OR id IN (SELECT teacher_id FROM class_teachers WHERE class_id = ?) LIMIT 1").get(assignment.teacher_id, assignment.class_id);
const students = db.prepare("SELECT id FROM users WHERE class_id = ? AND role='student' ORDER BY id LIMIT 4").all(assignment.class_id);
if (students.length < 4) { console.error(`本班只有 ${students.length} 名学生，不足 4 名`); process.exit(1); }

let passCount = 0, failCount = 0;
const check = (ok, label) => { if (ok) passCount++; else failCount++; console.log(`  判定: ${pass(ok)}  ${label}`); };

const tpl = (n) => `/assignments/${assignment.id}/paper-scan${n}`;
const createdBatches = [];

function makeJpeg() {
  const dir = path.join(__dirname, '../data/uploads/tmp-append');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `a-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`);
  fs.writeFileSync(f, Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'));
  return f;
}

async function uploadOne(bid, f) {
  const meta = await call('POST', tpl(`/batches/${bid}/images`), { file_name: path.basename(f), file_size: fs.statSync(f).size, mime_type: 'image/jpeg' });
  const iid = meta.data.image_id;
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(f)], { type: 'image/jpeg' }), path.basename(f));
  await fetch(`${BASE}${tpl(`/batches/${bid}/images/${iid}/file`)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return iid;
}

async function waitScan(bid, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await call('GET', tpl(`/batches/${bid}`));
    const s = r.data.batch.scan_status;
    if (s === 'done' || s === 'failed' || s === 'cancelled') return r.data.batch;
    await sleep(800);
  }
  return (await call('GET', tpl(`/batches/${bid}`))).data.batch;
}

(async () => {
  say(`教师 ${teacher.username} | 作业 #${assignment.id} | 学生 ${students.length} 人`);
  try {
    token = jwt.sign({ userId: teacher.id, username: teacher.username, role: teacher.role }, process.env.JWT_SECRET, { expiresIn: '2h' });
    const olds = db.prepare('SELECT id FROM paper_scan_batches WHERE assignment_id = ? AND student_id IS NOT NULL').all(assignment.id);
    olds.forEach((o) => { db.prepare('DELETE FROM paper_scan_images WHERE batch_id = ?').run(o.id); db.prepare('DELETE FROM paper_scan_batches WHERE id = ?').run(o.id); });

    // ===== Q1: 追加照片 =====
    say('Q1 测试：识别完再追加照片，重新识别');
    const bA = (await call('POST', tpl('/batches'), { group_size: 10, student_id: students[0].id })).data.batch.batch_id;
    createdBatches.push(bA);
    await uploadOne(bA, makeJpeg());
    await call('POST', tpl(`/batches/${bA}/start`), {});
    const done1 = await waitScan(bA);
    check(done1.scan_status === 'done', `首次识别完成（实际 ${done1.scan_status}）`);
    check(done1.total_images === 1, '首次 1 张');

    // 追加 2 张
    await uploadOne(bA, makeJpeg());
    await uploadOne(bA, makeJpeg());
    const after = await call('GET', tpl(`/batches/${bA}`));
    check(after.data.batch.total_images === 3, `追加后变 3 张（实际 ${after.data.batch.total_images}）`);
    check(after.data.batch.batch_id === bA, '还在原批次上，没有新建（照片没分家）');

    // 重新识别
    const rs = await call('POST', tpl(`/batches/${bA}/start`), { restart: 'all' });
    check(rs.status === 200, '重新识别已启动');
    const done2 = await waitScan(bA);
    check(done2.scan_status === 'done', '重新识别完成');
    check(done2.total_images === 3, '重新识别用的是全部 3 张');
    const p2 = done2.result?.papers?.[0];
    check(!!p2, '产出 1 份卷子（3 张合为一份）');
    check((p2?.image_ids || []).length === 3, `这份卷子含 3 张（实际 ${(p2?.image_ids || []).length}）`);

    // 登记后追加
    say('Q1b 测试：登记后再追加');
    await call('POST', tpl(`/batches/${bA}/registered`), {});
    const re = await call('POST', tpl('/batches'), { group_size: 10, student_id: students[0].id });
    check(re.data.batch.batch_id === bA, '已登记的学生仍复用原批次（追加不会分家）');
    await uploadOne(bA, makeJpeg());
    const after2 = await call('GET', tpl(`/batches/${bA}`));
    check(after2.data.batch.total_images === 4, `登记后追加到 4 张（实际 ${after2.data.batch.total_images}）`);

    // 重新识别应清掉登记标记
    await call('POST', tpl(`/batches/${bA}/start`), { restart: 'all' });
    const done3 = await waitScan(bA);
    check(done3.registered === false, '重新识别后登记标记被撤销（状态不矛盾）');

    // ===== Q2: 并发识别 =====
    say('Q2 测试：4 个学生同时识别');
    const bids = [];
    for (let i = 1; i < 4; i++) {
      const b = (await call('POST', tpl('/batches'), { group_size: 10, student_id: students[i].id })).data.batch.batch_id;
      createdBatches.push(b);
      bids.push(b);
      await uploadOne(b, makeJpeg());
    }
    const t0 = Date.now();
    for (const b of bids) await call('POST', tpl(`/batches/${b}/start`), {});
    const startedAll = Date.now() - t0;
    check(startedAll < 3000, `4 个识别几乎同时启动（耗时 ${startedAll}ms）`);

    // 立刻查进度：应该多个都是 running
    const prog1 = await call('GET', tpl('/student-progress'));
    const runningCount = (prog1.data.progress || []).filter((p) => p.running).length;
    check(runningCount >= 2, `有 ${runningCount} 人同时在识别（证明可并发）`);

    // 等待全部完成
    const results = await Promise.all(bids.map((b) => waitScan(b)));
    const totalMs = Date.now() - t0;
    check(results.every((r) => r.scan_status === 'done'), `4 人全部识别完成（${results.map((r) => r.scan_status).join(',')}）`);
    check(results.every((r) => (r.result?.papers || []).length === 1), '每人都产出 1 份卷子（互不干扰）');
    // 串行的话总耗时 ≈ 4×单次；并发应远小于
    say(`  4 人并发总耗时 ${(totalMs / 1000).toFixed(1)}s`);

  } catch (e) {
    console.error('测试异常:', e);
    failCount++;
  } finally {
    createdBatches.filter(Boolean).forEach((b) => {
      db.prepare('DELETE FROM paper_scan_images WHERE batch_id = ?').run(b);
      db.prepare('DELETE FROM paper_scan_batches WHERE id = ?').run(b);
    });
    try { fs.rmSync(path.join(__dirname, '../data/uploads/tmp-append'), { recursive: true, force: true }); } catch (e) { /* ignore */ }
    console.log(`\n通过 ${passCount} / 失败 ${failCount}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
})();
