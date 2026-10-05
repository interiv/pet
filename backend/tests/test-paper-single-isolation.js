/**
 * 单人登记「按学生隔离」测试
 *
 * 修复前的核心 bug：A 学生和 B 学生的照片会落进同一个批次，
 * 被当成一份卷子送去 AI 识别。本测试验证隔离是否真的生效。
 *
 * 前置：node src/server.js
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

const assignment = db.prepare("SELECT a.id, a.class_id, a.teacher_id FROM assignments a JOIN users u ON u.class_id = a.class_id AND u.role = 'student' GROUP BY a.id HAVING COUNT(u.id) >= 2 ORDER BY a.id DESC LIMIT 1").get();
const teacher = db.prepare("SELECT id, username, role FROM users WHERE id = ? OR id IN (SELECT teacher_id FROM class_teachers WHERE class_id = ?) LIMIT 1").get(assignment.teacher_id, assignment.class_id);
const students = db.prepare("SELECT id FROM users WHERE class_id = ? AND role='student' ORDER BY id LIMIT 3").all(assignment.class_id);
const outsider = db.prepare("SELECT id FROM users WHERE role='student' AND (class_id IS NULL OR class_id != ?) LIMIT 1").get(assignment.class_id);

let passCount = 0, failCount = 0;
const check = (ok, label) => { if (ok) passCount++; else failCount++; console.log(`  判定: ${pass(ok)}  ${label}`); };

const tpl = (n) => `/assignments/${assignment.id}/paper-scan${n}`;
const createdBatches = [];

function makeJpeg() {
  const dir = path.join(__dirname, '../data/uploads/tmp-single');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`);
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

(async () => {
  say(`教师 ${teacher.username} | 作业 #${assignment.id} | 学生 ${students.length} 人`);
  try {
    token = jwt.sign({ userId: teacher.id, username: teacher.username, role: teacher.role }, process.env.JWT_SECRET, { expiresIn: '2h' });

    const olds = db.prepare('SELECT id FROM paper_scan_batches WHERE assignment_id = ? AND student_id IS NOT NULL').all(assignment.id);
    olds.forEach((o) => { db.prepare('DELETE FROM paper_scan_images WHERE batch_id = ?').run(o.id); db.prepare('DELETE FROM paper_scan_batches WHERE id = ?').run(o.id); });

    say('测试 1：两个学生各自建批次');
    const r1 = await call('POST', tpl('/batches'), { group_size: 10, student_id: students[0].id });
    const b1 = r1.data.batch.batch_id;
    createdBatches.push(b1);
    check(r1.status === 200 && b1 > 0, `学生A(${students[0].id}) 批次已建`);
    check(r1.data.batch.student_id === students[0].id, '批次记录了 student_id');
    check(r1.data.reused === false, '首次创建，不是复用');

    const r2 = await call('POST', tpl('/batches'), { group_size: 10, student_id: students[1].id });
    const b2 = r2.data.batch.batch_id;
    createdBatches.push(b2);
    check(b2 !== b1, '两个学生拿到的是不同批次（修复前会混在一起）');
    check(r2.data.batch.student_id === students[1].id, 'B 的批次记录的是 B 的 student_id');

    say('测试 2：各自上传，照片不串');
    await uploadOne(b1, makeJpeg());
    await uploadOne(b2, makeJpeg());
    await uploadOne(b1, makeJpeg());
    const g1 = await call('GET', tpl(`/batches/${b1}`));
    const g2 = await call('GET', tpl(`/batches/${b2}`));
    check(g1.data.batch.total_images === 2, `A 批次有 2 张（实际 ${g1.data.batch.total_images}）`);
    check(g2.data.batch.total_images === 1, `B 批次有 1 张（实际 ${g2.data.batch.total_images}）`);
    check(g1.data.batch.student_id === students[0].id, 'A 批次仍属于 A');
    check(g2.data.batch.student_id === students[1].id, 'B 批次仍属于 B');

    say('测试 3：同一学生重复建批次会复用');
    const r3 = await call('POST', tpl('/batches'), { group_size: 10, student_id: students[0].id });
    check(r3.data.reused === true, '返回 reused=true');
    check(r3.data.batch.batch_id === b1, '复用了 A 原来的批次，没有新建空批次');

    say('测试 4：各学生进度汇总');
    const r4 = await call('GET', tpl('/student-progress'));
    const map = {};
    (r4.data.progress || []).forEach((p) => { map[p.student_id] = p; });
    check(r4.status === 200, '汇总接口可用');
    check(map[students[0].id]?.uploaded === 2, `A 已上传 2 张（实际 ${map[students[0].id]?.uploaded}）`);
    check(map[students[1].id]?.uploaded === 1, `B 已上传 1 张（实际 ${map[students[1].id]?.uploaded}）`);
    check(map[students[0].id]?.scanned === false, 'A 还没识别');
    check(map[students[0].id]?.registered === false, 'A 还没登记');

    say('测试 5：拒绝非本班学生');
    if (outsider) {
      const r5 = await call('POST', tpl('/batches'), { group_size: 10, student_id: outsider.id });
      check(r5.status === 400, `外班学生被拒（实际 ${r5.status}）`);
    } else {
      say('  库里没有其他班的学生，跳过');
    }

    say('测试 6：标记已登记');
    const r6 = await call('POST', tpl(`/batches/${b1}/registered`), {});
    check(r6.status === 200, '标记成功');
    check(r6.data.batch.registered === true, '批次被标记为已登记');
    const r6b = await call('GET', tpl('/student-progress'));
    const map2 = {};
    (r6b.data.progress || []).forEach((p) => { map2[p.student_id] = p; });
    check(map2[students[0].id]?.registered === true, '汇总里能看到 A 已登记');
    const r6c = await call('POST', tpl('/batches'), { group_size: 10, student_id: students[0].id });
    check(r6c.data.reused === false && r6c.data.batch.batch_id !== b1, '已登记的学生不再复用旧批次');
    createdBatches.push(r6c.data.batch.batch_id);

  } catch (e) {
    console.error('测试异常:', e);
    failCount++;
  } finally {
    createdBatches.filter(Boolean).forEach((b) => {
      db.prepare('DELETE FROM paper_scan_images WHERE batch_id = ?').run(b);
      db.prepare('DELETE FROM paper_scan_batches WHERE id = ?').run(b);
    });
    try { fs.rmSync(path.join(__dirname, '../data/uploads/tmp-single'), { recursive: true, force: true }); } catch (e) { /* ignore */ }
    console.log(`\n通过 ${passCount} / 失败 ${failCount}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
})();
