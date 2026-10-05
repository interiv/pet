/**
 * 覆盖登记测试
 *
 * 验证：首次登记 / 重复被拒 / overwrite 覆盖 / 金币回滚 / 知识点回滚 / 外班老师被拒
 * 前置：node src/server.js
 */
require('dotenv').config();
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

const assignment = db.prepare("SELECT a.id, a.class_id, a.teacher_id FROM assignments a JOIN users u ON u.class_id = a.class_id AND u.role = 'student' GROUP BY a.id HAVING COUNT(u.id) >= 1 ORDER BY a.id DESC LIMIT 1").get();
const teacher = db.prepare("SELECT id, username, real_name, role FROM users WHERE id = ? OR id IN (SELECT teacher_id FROM class_teachers WHERE class_id = ?) LIMIT 1").get(assignment.teacher_id, assignment.class_id);
const student = db.prepare("SELECT id, real_name FROM users WHERE class_id = ? AND role='student' ORDER BY id LIMIT 1").get(assignment.class_id);
const questions = db.prepare("SELECT qb.id, qb.knowledge_point FROM assignment_questions aq JOIN question_bank qb ON aq.question_bank_id = qb.id WHERE aq.assignment_id = ? ORDER BY aq.sort_order").all(assignment.id);

let passCount = 0, failCount = 0;
const check = (ok, label) => { if (ok) passCount++; else failCount++; console.log(`  判定: ${pass(ok)}  ${label}`); };

const goldOf = (uid) => db.prepare('SELECT gold FROM users WHERE id = ?').get(uid).gold;
const kpOf = (uid, kp) => db.prepare('SELECT * FROM knowledge_point_stats WHERE user_id = ? AND knowledge_point = ? ORDER BY date DESC LIMIT 1').get(uid, kp);
const subOf = (uid) => db.prepare('SELECT * FROM submissions WHERE assignment_id = ? AND user_id = ?').get(assignment.id, uid);

(async () => {
  say(`教师 ${teacher.username} | 作业 #${assignment.id} | 学生 ${student.id} | 题目 ${questions.length}`);
  const goldBackup = goldOf(student.id);
  const kpBackups = {};
  questions.forEach((q) => { if (q.knowledge_point) kpBackups[q.knowledge_point] = kpOf(student.id, q.knowledge_point); });

  try {
    token = jwt.sign({ userId: teacher.id, username: teacher.username, role: teacher.role }, process.env.JWT_SECRET, { expiresIn: '2h' });
    const olds = db.prepare('SELECT id FROM submissions WHERE assignment_id = ? AND user_id = ?').all(assignment.id, student.id);
    olds.forEach((o) => { db.prepare('DELETE FROM question_answers WHERE submission_id = ?').run(o.id); db.prepare('DELETE FROM submissions WHERE id = ?').run(o.id); });

    const allRight = questions.map((q) => ({ question_id: q.id, is_correct: true, student_answer: 'A' }));
    const allWrong = questions.map((q) => ({ question_id: q.id, is_correct: false, student_answer: 'B' }));

    say('测试 1：首次登记');
    const gold0 = goldOf(student.id);
    const r1 = await call('POST', `/assignments/${assignment.id}/paper-submit`, { student_id: student.id, results: allRight });
    check(r1.status === 200, `登记成功（${r1.status}）`);
    check(r1.data.total_score === 100, `全对应 100 分（实际 ${r1.data.total_score}）`);
    const gold1 = goldOf(student.id);
    check(gold1 > gold0, `发放了金币：${gold0} -> ${gold1}`);
    const kp1 = questions[0].knowledge_point ? kpOf(student.id, questions[0].knowledge_point) : null;
    const kp1Attempts = kp1 ? kp1.total_attempts : 0;

    say('测试 2：已登记时重复提交（不带 overwrite）应被拒');
    const r2 = await call('POST', `/assignments/${assignment.id}/paper-submit`, { student_id: student.id, results: allRight });
    check(r2.status === 400, `被拒（${r2.status}）`);
    check(/已有提交记录/.test(r2.data?.error || ''), `提示正确：${r2.data?.error}`);

    say('测试 3：带 overwrite 覆盖为全错');
    const r3 = await call('POST', `/assignments/${assignment.id}/paper-submit`, { student_id: student.id, results: allWrong, overwrite: true });
    check(r3.status === 200, `覆盖成功（${r3.status}）`);
    check(r3.data.overwritten === true, '返回标记 overwritten=true');
    check(r3.data.total_score === 0, `全错应 0 分（实际 ${r3.data.total_score}）`);
    check(r3.data.rollback_gold > 0, `回滚了上次发放的金币：${r3.data.rollback_gold}`);
    check(goldOf(student.id) === gold0, `金币回到初始值（${gold0}）——不能覆盖刷金币`);

    const kp3 = questions[0].knowledge_point ? kpOf(student.id, questions[0].knowledge_point) : null;
    if (kp1Attempts > 0 && kp3) {
      check(kp3.total_attempts === kp1Attempts, `知识点统计已回滚（${kp1Attempts} -> ${kp3.total_attempts}），未随覆盖膨胀`);
    } else {
      say('  （无知识点数据，跳过统计校验）');
    }

    const subNow = subOf(student.id);
    check(!!subNow && subNow.total_score === 0, '数据库里是新成绩 0 分');
    const qaCount = db.prepare('SELECT COUNT(*) c FROM question_answers WHERE submission_id = ?').get(subNow.id).c;
    check(qaCount === questions.length, `答案记录条数正确（${qaCount}，期望 ${questions.length}，没有叠加）`);

    say('测试 4：再覆盖回全对，金币只发一次');
    const r4 = await call('POST', `/assignments/${assignment.id}/paper-submit`, { student_id: student.id, results: allRight, overwrite: true });
    check(r4.status === 200, '再次覆盖成功');
    check(r4.data.total_score === 100, `恢复 100 分（实际 ${r4.data.total_score}）`);
    check(goldOf(student.id) === gold1, `金币与首次登记一致（${gold1}）——没有多发也没有少发`);

    say('测试 5：非本班老师被拒（原先缺失的校验）');
    const other = db.prepare("SELECT id, username, role FROM users WHERE role='teacher' AND id != ? AND id NOT IN (SELECT teacher_id FROM class_teachers WHERE class_id = ?) LIMIT 1").get(teacher.id, assignment.class_id);
    if (other) {
      const mine = token;
      token = jwt.sign({ userId: other.id, username: other.username, role: other.role }, process.env.JWT_SECRET, { expiresIn: '2h' });
      const r5 = await call('POST', `/assignments/${assignment.id}/paper-submit`, { student_id: student.id, results: allRight, overwrite: true });
      token = mine;
      check(r5.status === 403, `外班老师被拒（${r5.status}）`);
      check(/任课老师/.test(r5.data?.error || ''), `提示正确：${r5.data?.error}`);
    } else {
      say('  库里没有其他班老师，跳过');
    }

  } catch (e) {
    console.error('测试异常:', e);
    failCount++;
  } finally {
    const olds = db.prepare('SELECT id FROM submissions WHERE assignment_id = ? AND user_id = ?').all(assignment.id, student.id);
    olds.forEach((o) => { db.prepare('DELETE FROM question_answers WHERE submission_id = ?').run(o.id); db.prepare('DELETE FROM submissions WHERE id = ?').run(o.id); });
    db.prepare('UPDATE users SET gold = ? WHERE id = ?').run(goldBackup, student.id);
    Object.keys(kpBackups).forEach((kp) => {
      if (kpBackups[kp]) {
        db.prepare('INSERT OR REPLACE INTO knowledge_point_stats (id, user_id, knowledge_point, date, total_attempts, correct_attempts, accuracy) VALUES (?,?,?,?,?,?,?)')
          .run(kpBackups[kp].id, kpBackups[kp].user_id, kpBackups[kp].knowledge_point, kpBackups[kp].date, kpBackups[kp].total_attempts, kpBackups[kp].correct_attempts, kpBackups[kp].accuracy);
      } else {
        db.prepare('DELETE FROM knowledge_point_stats WHERE user_id = ? AND knowledge_point = ?').run(student.id, kp);
      }
    });
    console.log(`\n通过 ${passCount} / 失败 ${failCount}`);
  }
  process.exit(failCount > 0 ? 1 : 0);
})();
