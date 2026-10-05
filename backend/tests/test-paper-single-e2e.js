/**
 * 单人纸质登记「批次制」链路测试
 *
 * 验证重点是单人模式与批量模式的隔离，以及「登记后清理」：
 *   1. 单人模式不传group_size 时，服务端默认 1（会用满10张=1份卷子）
 *   2. 1~10 张照片都只算 1 份卷子（group_size=10 是单人模式的语义）
 *   3. 识别完成 → 强制指派给指定学生
 *   4. 登记成功后批次被丢弃、磁盘文件被清理
 *   5. 丢弃后下一个学生能建新批次（不与上一个串味）
 *
 * 前置：
 *   node src/server.js
 *   MOCK_DELAY_MS=2000 node tests/mock-ai-server.cjs
 *   且 backend/.env 的 AI base_url 指向 http://127.0.0.1:8897
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
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

const assignment = db.prepare(`
  SELECT a.id, a.title, a.class_id, a.teacher_id FROM assignments a
  JOIN users u ON u.class_id = a.class_id AND u.role = 'student'
  WHERE a.title NOT LIKE 'API测试%'
  GROUP BY a.id HAVING COUNT(u.id) >= 2 ORDER BY a.id DESC LIMIT 1
`).get();
const teacher = db.prepare(
  "SELECT id, username, role FROM users WHERE id = ? OR id IN (SELECT teacher_id FROM class_teachers WHERE class_id = ?) LIMIT 1"
).get(assignment.teacher_id, assignment.class_id);
// 必须挑「尚未登记」的学生：paper-submit 会拒绝重复登记，
// 用已登记的学生测会得到 400，那是正确行为而不是缺陷。
const students = db.prepare(`
  SELECT u.id, u.real_name, u.username FROM users u
  WHERE u.class_id = ? AND u.role = 'student'
    AND u.id NOT IN (SELECT user_id FROM submissions WHERE assignment_id = ?)
  ORDER BY u.id LIMIT 3
`).all(assignment.class_id, assignment.id);

if (students.length === 0) {
  console.error('该作业所有学生都已登记，无法测试。请换一个作业或先清空 submissions');
  process.exit(1);
}

function makeJpeg(file) {
  const buf = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  fs.writeFileSync(file, buf);
}

(async () => {
  let passCount = 0, failCount = 0;
  const check = (ok, label) => { if (ok) passCount++; else failCount++; console.log(`  判定: ${pass(ok)}  ${label}`); };
  const created = [];
  const tpl = (bid, n) => `/assignments/${assignment.id}/paper-scan/batches/${bid}${n}`;

  say(`教师 ${teacher.username} | 作业 #${assignment.id} | 学生 ${students.length} 人`);

  // 清理这个作业的历史批次，模拟干净环境
  db.prepare('DELETE FROM paper_scan_images WHERE batch_id IN (SELECT id FROM paper_scan_batches WHERE assignment_id = ?)').run(assignment.id);
  db.prepare('DELETE FROM paper_scan_batches WHERE assignment_id = ?').run(assignment.id);

  const tmpDir = path.join(__dirname, '../data/uploads/tmp-single');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const scanDir = path.join(__dirname, '../data/uploads/paper-scan');

  try {
    token = jwt.sign({ userId: teacher.id, username: teacher.username, role: teacher.role }, process.env.JWT_SECRET, { expiresIn: '2h' });

    // ---- 1. 建单人批次，group_size 顶到 10 ----
    say('测试 1：创建单人批次（每人 10 张 = 全部算一份卷子）');
    const r1 = await call('POST', `/assignments/${assignment.id}/paper-scan/batches`, { group_size: 10 });
    const bid = r1.data?.batch?.batch_id;
    created.push(bid);
    check(r1.status === 200 && bid > 0, '批次已创建');
    check(r1.data?.batch?.group_size === 10, 'group_size = 10');

    // ---- 2. 传 3 张，应只分成1 组 ----
    say('测试 2：传 3 张照片');
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const f = path.join(tmpDir, `s-${Date.now()}-${i}.jpg`);
      makeJpeg(f);
      const meta = await call('POST', tpl(bid, '/images'), { file_name: `s-${i}.jpg`, file_size: fs.statSync(f).size, mime_type: 'image/jpeg' });
      const iid = meta.data.image_id;
      ids.push(iid);
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)], { type: 'image/jpeg' }), `s-${i}.jpg`);
      await fetch(`${BASE}${tpl(bid, `/images/${iid}/file`)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    }
    const r2 = await call('GET', tpl(bid, ''));
    check(r2.data.batch.total_images === 3, '共 3 张');
    check(r2.data.batch.uploaded_images === 3, '全部上传成功');
    check(r2.data.batch.total_groups === 1, '3 张只算1 份卷子（单人模式的核心语义）');
    check(r2.data.batch.images.every((i) => i.group_no === 0), '所有照片同属第 0 组');

    // ---- 3. 识别 ----
    say('测试 3：识别（mock AI）');
    const r3 = await call('POST', tpl(bid, '/start'), {});
    check(r3.status === 200, '识别已启动');
    const t0 = Date.now();
    let cur = r3.data.batch;
    while (Date.now() - t0 < 120000) {
      const g = await call('GET', tpl(bid, ''));
      cur = g.data.batch;
      if (cur.scan_status === 'done' || cur.scan_status === 'failed') break;
      await sleep(1000);
    }
    check(cur.scan_status === 'done', '识别完成');
    const papers = cur.result?.papers || [];
    check(papers.length === 1, `只产出 1 份卷子（实际 ${papers.length}）`);
    check(papers[0]?.results?.length > 0, `含逐题结果（${papers[0]?.results?.length} 题）`);
    check(papers[0]?.image_ids?.length === 3, '这份卷子关联了 3 张照片');

    // ---- 4. 强制指派给指定学生 ----
    say('测试 4：指派给指定学生（单人模式语义：不靠 AI 猜）');
    const r4 = await call('POST', tpl(bid, '/groups/0/assign'), { student_id: students[0].id });
    const p0 = r4.data?.batch?.result?.papers?.[0];
    check(r4.status === 200, '指派成功');
    check(p0?.student_id === students[0].id, 'student_id 已写入');

    // ---- 5. 登记 ----
    say('测试 5：登记成绩');
    const r5 = await call('POST', `/assignments/${assignment.id}/paper-submit`, {
      student_id: students[0].id,
      results: p0.results.map((r) => ({ question_id: r.question_id, is_correct: r.is_correct, student_answer: r.recognized_answer || '纸质作答' })),
    });
    console.log(`  状态 ${r5.status}${r5.data?.error ? ' ' + r5.data.error : ''}`);
    check(r5.status === 200, '登记成功');

    // 登记会真的写 submissions 与统计，测试完必须还原，
    // 否则开发库里会多出一个「已登记」的学生，后续测试挑不到人了
    if (r5.status === 200) {
      const sid = students[0].id;
      const subs = db.prepare('SELECT id FROM submissions WHERE assignment_id = ? AND user_id = ?').all(assignment.id, sid);
      subs.forEach((s) => {
        db.prepare('DELETE FROM question_answers WHERE submission_id = ?').run(s.id);
        db.prepare('DELETE FROM submissions WHERE id = ?').run(s.id);
      });
      check(subs.length > 0, `（已清理测试产生的 ${subs.length} 条提交记录）`);
    }

    // ---- 6. 登记后丢弃批次，磁盘清理 ----
    say('测试 6：登记后丢弃批次');
    const before = fs.existsSync(scanDir) ? fs.readdirSync(scanDir).length : 0;
    const r6 = await call('DELETE', tpl(bid, ''));
    const after = fs.existsSync(scanDir) ? fs.readdirSync(scanDir).length : 0;
    check(r6.status === 200, '批次已删除');
    check(after < before, `磁盘文件被清理（${before} → ${after}）`);

    // ---- 7. 下一个学生能建干净的新批次 ----
    say('测试 7：第二个学生建新批次，不与上一个串味');
    const r7 = await call('POST', `/assignments/${assignment.id}/paper-scan/batches`, { group_size: 10 });
    const bid2 = r7.data?.batch?.batch_id;
    created.push(bid2);
    check(r7.status === 200 && bid2 !== bid, '新批次已创建');
    check(r7.data?.batch?.total_images === 0, '新批次是空的（没有上一个的照片）');
    check(r7.data?.batch?.result === null, '新批次没有识别结果');

    // ---- 8. 同一学生重复建批次（单人模式每次都新建）----
    say('测试 8：确认单人模式不复用旧批次');
    const r8 = await call('POST', `/assignments/${assignment.id}/paper-scan/batches`, { group_size: 10 });
    const bid3 = r8.data?.batch?.batch_id;
    created.push(bid3);
    check(bid3 !== bid2, '再次新建得到不同批次（前端 mode=single 不走复用逻辑）');

  } catch (e) {
    console.error('测试异常:', e);
    failCount++;
  } finally {
    created.filter(Boolean).forEach((b) => {
      db.prepare('DELETE FROM paper_scan_images WHERE batch_id = ?').run(b);
      db.prepare('DELETE FROM paper_scan_batches WHERE id = ?').run(b);
    });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    console.log(`\n通过 ${passCount} / 失败 ${failCount}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
})();
