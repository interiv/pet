/**
 * 纸质扫描端到端测试
 *
 * 走完整链路：建批次 → 传照片 → 触发识别 → 轮询 → 指派 → 登记。
 * 用 mock AI（tests/mock-ai-server.cjs）跑识别，不烧真实额度。
 *
 * 前置：
 *   node src/server.js
 *   MOCK_DELAY_MS=3000 node tests/mock-ai-server.cjs
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

function issueToken(user) {
  return jwt.sign({ userId: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '2h' });
}

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

// 必须挑「该作业班主任本人」：requireAssignmentOwner 会校验
// 是不是这个班的老师（class_teachers）或作业的 teacher_id，
// 随便取一个教师账号会直接403，测不到真正的流程。
const assignment = db.prepare(`
  SELECT a.id, a.title, a.class_id, a.teacher_id FROM assignments a
  JOIN users u ON u.class_id = a.class_id AND u.role = 'student'
  WHERE a.title NOT LIKE 'API测试%'
  GROUP BY a.id HAVING COUNT(u.id) >= 2
  ORDER BY a.id DESC LIMIT 1
`).get();
const teacher = db.prepare(
  "SELECT id, username, role FROM users WHERE id = ? OR id IN (SELECT teacher_id FROM class_teachers WHERE class_id = ?) LIMIT 1"
).get(assignment.teacher_id, assignment.class_id);
const students = db.prepare("SELECT id, real_name, username FROM users WHERE class_id = ? AND role='student' ORDER BY id LIMIT 3").all(assignment.class_id);

/** 造一张真的能当图片上传的小JPEG（1x1 像素） */
function makeJpeg(file) {
  // 最小合法 JPEG：SOI + APP0(JFIF) + EOI，multer 只看扩展名与声明的 mimetype
  const buf = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  fs.writeFileSync(file, buf);
  return buf;
}

(async () => {
  let passCount = 0, failCount = 0;
  const check = (ok, label) => { if (ok) passCount++; else failCount++; console.log(`  判定: ${pass(ok)}  ${label}`); };
  const tpl = (n) => `/assignments/${assignment.id}/paper-scan/batches/${batchId}${n}`;
  let batchId = 0;

  say(`教师 ${teacher.username} | 作业 #${assignment.id} | 学生 ${students.length} 人`);

  // 清掉这个作业的历史批次，模拟干净环境
  db.prepare('DELETE FROM paper_scan_images WHERE batch_id IN (SELECT id FROM paper_scan_batches WHERE assignment_id = ?)').run(assignment.id);
  db.prepare('DELETE FROM paper_scan_batches WHERE assignment_id = ?').run(assignment.id);

  try {
    token = issueToken(teacher);

    // ---- 1. 建批次（每人 1 张，2 份卷子）----
    say('测试 1：创建批次');
    const r1 = await call('POST', `/assignments/${assignment.id}/paper-scan/batches`, { group_size: 1 });
    batchId = r1.data?.batch?.batch_id;
    if (r1.status !== 200) {
      console.log(`  调试: 状态=${r1.status} 响应=${JSON.stringify(r1.data)}`);
    }
    check(r1.status === 200 && batchId > 0, '批次已创建');
    check(r1.data?.batch?.total_groups === 0, '空批次时 total_groups 为 0（不会立刻算出一堆组）');

    // ---- 2. 逐张上传 ----
    say('测试 2：逐张上传 2 张照片');
    const tmpDir = path.join(__dirname, '../data/uploads/tmp-test');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const imageIds = [];
    for (let i = 0; i < 2; i += 1) {
      const f = path.join(tmpDir, `scan-${Date.now()}-${i}.jpg`);
      makeJpeg(f);
      // 2a 补占位
      const meta = await call('POST', tpl('/images'), { file_name: `scan-${i}.jpg`, file_size: fs.statSync(f).size, mime_type: 'image/jpeg' });
      const iid = meta.data.image_id;
      imageIds.push(iid);
      // 2b 传文件
      // 用 Buffer 而不是 createReadStream：Node 的 FormData 只认 Blob/File，
      // 塞 ReadStream 会直接抛 "Expected value"。
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)], { type: 'image/jpeg' }), `scan-${i}.jpg`);
      const up = await fetch(`${BASE}${tpl(`/images/${iid}/file`)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      const upData = await up.json();
      check(up.status === 200, `第 ${i + 1} 张上传成功`);
      if (i === 1) {
        check(upData.batch.uploaded_images === 2, '已上传计数 = 2');
        check(upData.batch.upload_status === 'uploaded', '全部传完后状态变 uploaded');
        check(upData.batch.total_groups === 2, '每人1张→ 分成 2 份卷');
        check(upData.batch.images[0].group_no === 0 && upData.batch.images[1].group_no === 1, '每张被分到不同的组');
      }
    }

    // ---- 3. 读取缩略图（前端显示照片靠它）----
    say('测试 3：读取照片内容');
    const imgRes = await fetch(`${BASE}${tpl(`/images/${imageIds[0]}/file`)}`, { headers: { Authorization: `Bearer ${token}` } });
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    check(imgRes.status === 200, '照片可读取');
    check(imgBuf.length > 0 && imgBuf[0] === 0xff && imgBuf[1] === 0xd8, '返回的是真的 JPEG（FF D8 开头）');
    const noAuth = await fetch(`${BASE}${tpl(`/images/${imageIds[0]}/file`)}`);
    check(noAuth.status === 401, '未带 token 访问被拒（学生作答不能公开）');

    // ---- 4. 开始识别 ----
    say('测试 4：开始识别（mock AI）');
    const r4 = await call('POST', tpl('/start'), {});
    check(r4.status === 200, '识别已启动');
    const startedAt = Date.now();
    let cur = null;
    let lastStage = '';
    while (Date.now() - startedAt < 120000) {
      const r = await call('GET', tpl(''));
      cur = r.data.batch;
      if (cur.scan_status !== lastStage) { lastStage = cur.scan_status; say(`  状态: ${lastStage} 进度 ${cur.scanned_groups}/${cur.total_groups}`); }
      if (cur.scan_status === 'done' || cur.scan_status === 'failed') break;
      await sleep(1000);
    }
    check(cur.scan_status === 'done', '识别完成');
    check(cur.scanned_groups === cur.total_groups, '识别组数等于总组数');
    const donePapers = cur.result?.papers || [];
    check(donePapers.length > 0, `产出 ${donePapers.length} 份卷子`);
    check(!!donePapers[0]?.results?.length, `每份含逐题结果（${donePapers[0]?.results?.length} 题）`);

    // ---- 5. 刷新后仍在（这是本次要解决的核心）----
    say('测试 5：刷新后数据仍在');
    const r5 = await call('GET', tpl(''));
    check(r5.data.batch.result?.papers?.length === donePapers.length, '刷新后识别结果仍在');

    // ---- 6. 指派学生 ----
    say('测试 6：指派学生');
    const r6 = await call('POST', tpl('/groups/0/assign'), { student_id: students[0].id });
    check(r6.status === 200, '指派成功');
    const p0 = r6.data.batch.result.papers.find((p) => p.group_no === 0);
    check(p0?.student_id === students[0].id, 'student_id 已写入');
    check(p0?.matched === true, 'matched 已置 true');
    // 再拉一次确认持久化
    const r6b = await call('GET', tpl(''));
    check(r6b.data.batch.result.papers.find((p) => p.group_no === 0)?.student_id === students[0].id, '重新拉取仍在（持久化生效）');

    // ---- 7. 改判分 ----
    say('测试 7：修正判分');
    const firstQ = p0.results[0]?.question_id;
    if (firstQ) {
      const r7 = await call('PUT', tpl('/groups/0/results'), { results: [{ question_id: firstQ, is_correct: !p0.results[0].is_correct, score: 50 }] });
      const q7 = r7.data.batch.result.papers.find((p) => p.group_no === 0).results.find((r) => r.question_id === firstQ);
      check(r7.status === 200, '保存成功');
      check(q7?.score === 50, '分值已更新');
    } else {
      say('  没有识别到题目，跳过');
    }

    // ---- 8. 登记 ----
    say('测试 8：一键登记');
    const paper0 = r6b.data.batch.result.papers.find((p) => p.student_id);
    if (paper0) {
      const subs = [{
        student_id: paper0.student_id,
        results: paper0.results.map((r) => ({ question_id: r.question_id, is_correct: r.is_correct, student_answer: r.recognized_answer || '纸质作答' })),
      }];
      const r8 = await call('POST', `/assignments/${assignment.id}/paper-submit-batch`, { submissions: subs });
      console.log(`  状态 ${r8.status}${r8.data?.error ? ' ' + r8.data.error : ''}`);
      check(r8.status === 200, '登记接口调用成功');
    } else {
      say('  没有已指派的卷子，跳过');
    }

    // ---- 9. 丢弃批次后文件被清理 ----
    say('测试 9：丢弃批次');
    const scanDir = path.join(__dirname, '../data/uploads/paper-scan');
    const before = fs.existsSync(scanDir) ? fs.readdirSync(scanDir).length : 0;
    const r9 = await call('DELETE', tpl(''));
    const after = fs.existsSync(scanDir) ? fs.readdirSync(scanDir).length : 0;
    check(r9.status === 200, '批次已删除');
    check(after < before, `磁盘文件被清理（${before} → ${after}）`);

    // 清理临时图片
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  } catch (e) {
    console.error('测试异常:', e);
    failCount++;
  } finally {
    if (batchId) {
      db.prepare('DELETE FROM paper_scan_images WHERE batch_id = ?').run(batchId);
      db.prepare('DELETE FROM paper_scan_batches WHERE id = ?').run(batchId);
    }
    console.log(`\n通过 ${passCount} / 失败 ${failCount}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
})();
