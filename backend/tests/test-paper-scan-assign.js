/**
 * 纸质扫描「人工修正」接口本地测试
 *
 * 前置：后端已启动，且本地 .env 的 AI 指向 mock（识别结果可以用手写数据模拟，
 *      本测试只验人工修正接口本身，不真的调 AI）。
 *
 * 覆盖：
 *   1. 指派学生要校验「必须在本班」，别的班学生要被拒
 *   2. 指派后刷新页面（重新 GET 批次）仍能拿到——这是本次要解决的核心问题
 *   3. 逐题修正只覆盖传上来的题，其余保持原样
 *   4. 越权访问他人批次被拒
 *   5. 删批次时磁盘文件真的被清掉（之前路径拼错导致删不掉）
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

function issueToken(user) {
  return jwt.sign({ userId: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '2h' });
}

async function call(method, p, body, token) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 无 body */ }
  return { status: res.status, data };
}

// ===== 准备测试数据 =====
const teacher = db.prepare("SELECT id, username, role FROM users WHERE role='teacher' ORDER BY id DESC LIMIT 1").get();
const otherTeacher = db.prepare("SELECT id FROM users WHERE role='teacher' AND id != ? ORDER BY id DESC LIMIT 1").get(teacher.id);
if (!teacher) { console.error('没有教师账号'); process.exit(1); }

// 找一个有学生的班级 + 一个有学生的作业
const assignment = db.prepare(`
  SELECT a.id, a.title, a.class_id FROM assignments a
  JOIN users u ON u.class_id = a.class_id AND u.role = 'student'
  GROUP BY a.id HAVING COUNT(u.id) >= 2
  ORDER BY a.id DESC LIMIT 1
`).get();
if (!assignment) { console.error('没有带学生的作业，无法测试'); process.exit(1); }

const students = db.prepare("SELECT id, username, real_name FROM users WHERE class_id = ? AND role = 'student' ORDER BY id LIMIT 3").all(assignment.class_id);
const outsider = db.prepare("SELECT id, username FROM users WHERE role = 'student' AND (class_id IS NULL OR class_id != ?) LIMIT 1").get(assignment.class_id);

say(`教师 ${teacher.username} | 作业 #${assignment.id} | 本班学生 ${students.length} 人`);

// 建一个批次 + 2 张占位，并直接写入识别结果（模拟 AI 已识别完）
const batchId = db.prepare(
  "INSERT INTO paper_scan_batches (assignment_id, user_id, title, subject, group_size, upload_status, scan_status) VALUES (?, ?, ?, ?, 1, 'uploaded', 'done')"
).run(assignment.id, teacher.id, assignment.title, '语文').lastInsertRowid;

const mkImg = () => db.prepare(
  "INSERT INTO paper_scan_images (batch_id, group_no, seq, file_name, file_size, status) VALUES (?, ?, ?, ?, ?, 'done')"
).run(batchId, 0, 0, 'p.jpg', 1000).lastInsertRowid;
const img1 = mkImg();

// 第二张造到 group 1，凑两组
db.prepare('UPDATE paper_scan_batches SET total_images = 1, total_groups = 1 WHERE id = ?').run(batchId);

// 写识别结果：两组，各两题
const papers = [
  { group_no: 0, image_ids: [img1], student_id: null, student_name: '', raw_name: '张小明', matched: false,
    results: [ { question_id: 101, recognized_answer: 'A', is_correct: true, score: 100 },
               { question_id: 102, recognized_answer: 'B', is_correct: false, score: 0 } ] },
];
db.prepare('UPDATE paper_scan_batches SET result = ? WHERE id = ?').run(JSON.stringify({ papers }), batchId);

const token = issueToken(teacher);
const tpl = (n) => `/assignments/${assignment.id}/paper-scan/batches/${batchId}${n}`;

(async () => {
  let passCount = 0, failCount = 0;
  const check = (ok, label) => { if (ok) passCount++; else failCount++; console.log(`  判定: ${pass(ok)}  ${label}`); };

  try {
    // ---- 1. 指派本班学生 ----
    say('测试 1：指派本班学生');
    const r1 = await call('POST', tpl('/groups/0/assign'), { student_id: students[0].id }, token);
    console.log(`  状态 ${r1.status}`);
    const p0 = r1.data?.batch?.result?.papers?.find(p => p.group_no === 0);
    check(r1.status === 200, '指派成功');
    check(p0?.student_id === students[0].id, '结果快照里的 student_id 已更新');
    check(p0?.matched === true, 'matched 置为 true');
    const imgRow = db.prepare('SELECT student_id FROM paper_scan_images WHERE id = ?').get(img1);
    check(imgRow.student_id === students[0].id, '照片记录上的 student_id 也已更新（下次打开能带出来）');

    // ---- 2. 重新 GET 批次，验证持久化 ----
    say('测试 2：重新拉取批次，验证刷新后不丢');
    const r2 = await call('GET', tpl(''), null, token);
    const p2 = r2.data?.batch?.result?.papers?.find(p => p.group_no === 0);
    check(r2.status === 200, '批次详情可读');
    check(p2?.student_id === students[0].id, '刷新后 student_id 仍在（本次修复的核心）');
    const img2 = r2.data?.batch?.images?.find(i => i.image_id === img1);
    check(img2?.student_id === students[0].id, '刷新后照片上的归属仍在');

    // ---- 3. 拒绝外班学生 ----
    say('测试 3：拒绝非本班学生');
    if (outsider) {
      const r3 = await call('POST', tpl('/groups/0/assign'), { student_id: outsider.id }, token);
      console.log(`  状态 ${r3.status} ${JSON.stringify(r3.data)}`);
      check(r3.status === 400, '外班学生被拒（400）');
    } else {
      say('  库里没有其他班的学生，跳过');
    }

    // ---- 4. 逐题修正只覆盖传上来的题 ----
    say('测试 4：逐题修正');
    const r4 = await call('PUT', tpl('/groups/0/results'), {
      results: [{ question_id: 102, is_correct: true, score: 100 }],
    }, token);
    const p4 = r4.data?.batch?.result?.papers?.find(p => p.group_no === 0);
    const q101 = p4?.results?.find(r => r.question_id === 101);
    const q102 = p4?.results?.find(r => r.question_id === 102);
    check(r4.status === 200, '保存成功');
    check(q102?.is_correct === true && q102?.score === 100, '传上来的题已被修正');
    check(q101?.is_correct === true, '没传的题保持原样（未被冲掉）');

    // ---- 5. 取消指派 ----
    say('测试 5：取消指派');
    const r5 = await call('POST', tpl('/groups/0/assign'), { student_id: null }, token);
    const p5 = r5.data?.batch?.result?.papers?.find(p => p.group_no === 0);
    check(p5?.student_id === null, 'student_id 已清空');
    check(p5?.matched === false, 'matched 恢复 false');

    // ---- 6. 越权 ----
    if (otherTeacher) {
      say('测试 6：越权访问他人批次');
      const otherToken = issueToken({ id: otherTeacher.id, username: 'other', role: 'teacher' });
      const r6 = await call('POST', tpl('/groups/0/assign'), { student_id: students[0].id }, otherToken);
      console.log(`  状态 ${r6.status}`);
      // 老师不是该作业班主任时会被 requireAssignmentOwner 挡下(403)，否则 loadBatch 挡下
      check(r6.status === 403, '越权被拒（403）');
    }

    // ---- 7. 删批次时磁盘文件真的被清掉 ----
    say('测试 7：删除批次时清理磁盘文件');
    // 造一个真实文件挂在照片记录上
    const dir = path.join(__dirname, '../data/uploads/paper-scan');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const fname = `test-${Date.now()}.jpg`;
    const fpath = path.join(dir, fname);
    fs.writeFileSync(fpath, 'x');
    db.prepare('UPDATE paper_scan_images SET file_path = ? WHERE id = ?').run(fname, img1);
    check(fs.existsSync(fpath), '测试文件已创建');

    const r7 = await call('DELETE', tpl(''), null, token);
    check(r7.status === 200, '批次已删除');
    check(!fs.existsSync(fpath), '磁盘文件已被删除（修复前会残留孤儿文件）');

  } catch (e) {
    console.error('测试异常:', e);
    failCount++;
  } finally {
    // 清理
    db.prepare('DELETE FROM paper_scan_images WHERE batch_id = ?').run(batchId);
    db.prepare('DELETE FROM paper_scan_batches WHERE id = ?').run(batchId);
    console.log(`\n通过 ${passCount} / 失败 ${failCount}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
})();
