/**
 * 主观题AI 评阅（含图片）测试
 *
 * 验证六件事：
 *   1. 图片路径解析与安全（路径穿越必须被挡）
 *   2. 每道题单独评阅（不是合并成一个 prompt）
 *   3. 图片真正进了 AI 请求
 *   4. 未作答给 0 分，而不是原来的 60 分兜底
 *   5. AI 不可用时不写兜底分，状态留在 pending
 *   6. 能续跑：已评过的题不重复调 AI
 *
 * 前置：
 *   MOCK_DELAY_MS=1500 node tests/mock-ai-server.cjs
 *   且 backend/.env 的 AI base_url 指向 http://127.0.0.1:8897
 * 直接跑本文件即可（不需要起后端服务，它调的是服务模块本身）。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db } = require('../src/config/database');
const { reviewSubmission, resolveAnswerImage } = require('../src/services/subjectiveReview');

const stamp = () => new Date().toISOString().slice(11, 19);
const say = (s) => console.log(`[${stamp()}] ${s}`);
const pass = (ok) => (ok ? 'PASS' : 'FAIL');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passCount = 0, failCount = 0;
const check = (ok, label) => { if (ok) passCount++; else failCount++; console.log(`  判定: ${pass(ok)}  ${label}`); };

const student = db.prepare("SELECT id, username FROM users WHERE role='student' ORDER BY id DESC LIMIT 1").get();
if (!student) { console.error('库里没有学生账号，无法测试'); process.exit(1); }

// 开发库里可能没有含主观题的作业，这里自己造一份，跑完删掉。
// 不依赖既有数据，测试才可重复运行。
const TEST_ASSIGNMENT = (() => {
  const found = db.prepare(`
    SELECT a.id, a.title, a.max_exp FROM assignments a
    JOIN assignment_questions aq ON aq.assignment_id = a.id
    JOIN question_bank qb ON aq.question_bank_id = qb.id
    WHERE qb.type IN ('essay', 'composition')
    GROUP BY a.id ORDER BY a.id DESC LIMIT 1
  `).get();
  if (found) return { ...found, created: false };

  const classRow = db.prepare("SELECT id FROM classes WHERE id IN (SELECT class_id FROM users WHERE role='student' AND class_id IS NOT NULL) LIMIT 1").get();
  if (!classRow) { console.error('库里没有带学生的班级，无法造测试数据'); process.exit(1); }
  const teacher = db.prepare("SELECT id FROM users WHERE role='teacher' LIMIT 1").get();

  const aInfo = db.prepare(`
    INSERT INTO assignments (class_id, teacher_id, title, subject, question_type, assignment_type, status, max_exp)
    VALUES (?, ?, '【测试】主观题评阅用作业', '语文', 'mixed', 'homework', 'active', 30)
  `).run(classRow.id, teacher.id);
  const aid = aInfo.lastInsertRowid;

  // 三道主观题
  const qIns = db.prepare(`
    INSERT INTO question_bank (subject, type, content, answer, explanation, created_at, is_public, review_status)
    VALUES ('语文', ?, ?, ?, '测试用题目', CURRENT_TIMESTAMP, 1, 'approved')
  `);
  const qids = [];
  ['essay', 'essay', 'composition'].forEach((t, i) => {
    const r = qIns.run(t, `测试主观题第 ${i + 1} 题：请简述你的观点。`, '参考答案（mock）');
    qids.push(r.lastInsertRowid);
  });
  const aqIns = db.prepare('INSERT INTO assignment_questions (assignment_id, question_bank_id, sort_order) VALUES (?, ?, ?)');
  qids.forEach((qid, i) => aqIns.run(aid, qid, i + 1));

  return { id: aid, title: '【测试】主观题评阅用作业', max_exp: 30, created: true, qids };
})();

const assignment = TEST_ASSIGNMENT;
const essayQuestions = TEST_ASSIGNMENT.created
  ? TEST_ASSIGNMENT.qids.map((id) => ({ id }))
  : db.prepare(`
      SELECT qb.id, qb.type, qb.content FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ? AND qb.type IN ('essay','composition')
    `).all(assignment.id);

say(`作业 #${assignment.id} | 学生 ${student.username} | 主观题 ${essayQuestions.length} 道`);

function makeSubmission(answers) {
  const info = db.prepare(`
    INSERT INTO submissions (assignment_id, user_id, answers, status, total_max_score, review_status)
    VALUES (?, ?, ?, 'submitted', 100, 'pending')
  `).run(assignment.id, student.id, JSON.stringify(answers));
  const sid = info.lastInsertRowid;
  const ins = db.prepare(`
    INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, image_url, answered_at)
    VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
  `);
  answers.forEach((a) => ins.run(sid, a.question_id, a.answer || '', a.image_url || ''));
  return sid;
}

function makeImageFile() {
  const dir = path.join(__dirname, '../data/uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fname = `test-review-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
  fs.writeFileSync(path.join(dir, fname), Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'));
  return `/uploads/${fname}`;
}

function readFb(row) {
  if (!row || !row.feedback) return null;
  try { return typeof row.feedback === 'string' ? JSON.parse(row.feedback) : row.feedback; } catch (e) { return null; }
}

const cleanup = (sids) => {
  sids.forEach((s) => {
    db.prepare('DELETE FROM question_answers WHERE submission_id = ?').run(s);
    db.prepare('DELETE FROM submissions WHERE id = ?').run(s);
  });
  const dir = path.join(__dirname, '../data/uploads');
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).filter((f) => f.startsWith('test-review-'))
      .forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ } });
  }
};

(async () => {
  const created = [];
  const progress = [];
  const oldBaseUrl = (db.prepare("SELECT value FROM settings WHERE key='ai_base_url'").get() || {}).value || '';

  try {
    // ---- 1. 图片路径解析与安全 ----
    say('测试 1：image_url 解析与安全');
    const url = makeImageFile();
    const resolved = resolveAnswerImage(url);
    check(!!resolved && fs.existsSync(resolved.abs), '正常 URL 能解析到真实文件');
    check(resolveAnswerImage('/uploads/../../secret.txt') === null, '路径穿越被挡住');
    check(resolveAnswerImage('/uploads/not-exist-zzz.jpg') === null, '不存在的文件返回 null');
    check(resolveAnswerImage('') === null, '空值返回 null');
    check(resolveAnswerImage(null) === null, 'null 返回 null');

    // ---- 2. 逐题独立评阅 ----
    say('测试 2：三道题各有文字答案');
    const answers1 = essayQuestions.slice(0, 3).map((q) => ({
      question_id: q.id, answer: `这是第 ${q.id} 题的学生作答内容，mock 测试用。`,
    }));
    const sid1 = makeSubmission(answers1);
    created.push(sid1);

    const r1 = await reviewSubmission(sid1, assignment.id, student.id, {
      onProgress: (p) => progress.push(p),
    });
    check(r1.total === answers1.length, `识别到 ${r1.total} 道主观题`);
    check(r1.failed.length === 0, '没有失败题');
    check(r1.avgScore === 85, `平均分 85（mock 对有文字答案给 85 分），实际 ${r1.avgScore}`);
    check(progress.filter((p) => !p.skipped).length === answers1.length,
      `收到 ${answers1.length} 次进度回报（证明是逐题处理，不是批量一次）`);

    const sub1 = db.prepare('SELECT review_status, total_score, graded_at FROM submissions WHERE id = ?').get(sid1);
    check(sub1.review_status === 'completed', 'review_status = completed');
    check(typeof sub1.total_score === 'number' && sub1.total_score > 0, `总分已写入 (${sub1.total_score})`);
    check(!!sub1.graded_at, 'graded_at 已写入');

    const qas1 = db.prepare('SELECT score, is_correct, reviewed_at FROM question_answers WHERE submission_id = ?').all(sid1);
    check(qas1.length === answers1.length, '每题都有记录');
    check(qas1.every((q) => q.reviewed_at), '每题都写了 reviewed_at（这是能续跑的前提）');
    check(qas1.every((q) => q.score === 85), '每题分数正确');
    check(qas1.every((q) => q.is_correct === 1), '85 分判为正确');

    // ---- 3. 续跑 ----
    say('测试 3：重复调用时跳过已评过的题');
    const progress2 = [];
    const r2 = await reviewSubmission(sid1, assignment.id, student.id, {
      onProgress: (p) => progress2.push(p),
    });
    check(r2.skipped === true, '已完成的提交直接跳过（不会重复烧 token）');

    // ---- 4. 只有照片没文字 ----
    say('测试 4：只有作答照片、没有文字');
    const imgUrl = makeImageFile();
    const sid2 = makeSubmission([{ question_id: essayQuestions[0].id, answer: '', image_url: imgUrl }]);
    created.push(sid2);
    const r3 = await reviewSubmission(sid2, assignment.id, student.id, {});
    check(r3.failed.length === 0, '评阅成功');
    check(r3.avgScore === 70,
      `得 70 分——mock 只有在prompt 里看到「仅提交了手写作答照片」时才给 70 分，` +
      `能拿到 70 就说明图片真的进了 AI 请求。实际 ${r3.avgScore}`);
    const qaImg = db.prepare('SELECT image_url, feedback FROM question_answers WHERE submission_id = ?').get(sid2);
    check(qaImg.image_url === imgUrl, 'image_url 仍保留在库中');
    const fbImg = readFb(qaImg);
    check(fbImg && fbImg.feedback && fbImg.feedback.includes('照片'),
      '评语记录了「已从照片读出内容」');

    // ---- 5. 完全未作答 ----
    say('测试 5：完全未作答不应得兜底分');
    const sid3 = makeSubmission([{ question_id: essayQuestions[0].id, answer: '', image_url: '' }]);
    created.push(sid3);
    const r4 = await reviewSubmission(sid3, assignment.id, student.id, {});
    check(r4.avgScore === 0, `得 0 分（修复前会给 60 分），实际 ${r4.avgScore}`);
    const qa3 = db.prepare('SELECT score, feedback FROM question_answers WHERE submission_id = ?').get(sid3);
    check(qa3.score === 0, '数据库里记 0 分');
    const fb3 = readFb(qa3);
    check(fb3 && fb3.feedback && fb3.feedback.includes('未作答'), '评语记录了「未作答」');

    // ---- 6. AI 不可用 ----
    say('测试 6：AI 不可用时不写兜底分，状态留在 pending');
    if (oldBaseUrl) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_base_url'").run('http://127.0.0.1:59999');
    } else {
      db.prepare("INSERT INTO settings (key, value) VALUES ('ai_base_url', 'http://127.0.0.1:59999')").run();
    }
    const sid4 = makeSubmission([{ question_id: essayQuestions[0].id, answer: '测试内容' }]);
    created.push(sid4);
    const r5 = await reviewSubmission(sid4, assignment.id, student.id, {});
    check(r5.failed.length === 1, '该题被标记为失败');
    const sub4 = db.prepare('SELECT review_status, total_score FROM submissions WHERE id = ?').get(sid4);
    check(sub4.review_status === 'pending', '状态留在 pending（待人工批改），不是 completed');
    check(!sub4.total_score, '没有凭空给分');
    const qa4 = db.prepare('SELECT score, feedback FROM question_answers WHERE submission_id = ?').get(sid4);
    check(!qa4.score, '该题分数为空（不是 0 也不是 60，等老师人工给）');
    const fb4 = readFb(qa4);
    check(fb4 && fb4.error, `失败原因已记录：${fb4 && fb4.error ? fb4.error.slice(0, 40) : '(空)'}`);

  } catch (e) {
    console.error('测试异常:', e);
    failCount++;
  } finally {
    if (oldBaseUrl) db.prepare("UPDATE settings SET value = ? WHERE key = 'ai_base_url'").run(oldBaseUrl);
    else db.prepare("DELETE FROM settings WHERE key = 'ai_base_url'").run();
    cleanup(created);
    // 自建的测试作业与题目也要删掉，否则会污染开发库
    if (TEST_ASSIGNMENT.created) {
      db.prepare('DELETE FROM assignment_questions WHERE assignment_id = ?').run(assignment.id);
      db.prepare('DELETE FROM assignments WHERE id = ?').run(assignment.id);
      (TEST_ASSIGNMENT.qids || []).forEach((qid) => {
        db.prepare('DELETE FROM question_bank WHERE id = ? AND content LIKE ?').run(qid, '测试主观题%');
      });
    }
    console.log(`\n通过 ${passCount} / 失败 ${failCount}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
})();
