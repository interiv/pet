// 用 API 验证「课堂做题 — 学生作答记录」链路（不经过 AI 判分，避免消耗 token）
const BASE = 'http://localhost:3000';
const { db } = require('D:/参赛用/2026-创AI/pet/backend/src/config/database');

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json };
}

(async () => {
  try {
    const lg = await call('POST', '/api/auth/login', null, { username: 'demo_teacher1', password: '111111' });
    const token = lg.json?.token;
    if (!token) { console.log('登录失败:', JSON.stringify(lg.json)); return; }

    const quiz = db.prepare('select id, class_id, title from classroom_quizzes where title like ? order by id desc').get('%QA自动化测试%');
    if (!quiz) { console.log('没有找到 QA 测试课堂做题'); return; }
    console.log('课堂做题:', quiz.id, quiz.title, 'class_id =', quiz.class_id);

    const q = db.prepare('select id, question_text from classroom_quiz_questions where quiz_id = ? order by sort_order').get(quiz.id);
    const stu = db.prepare("select id, username from users where username = 'demo_student1'").get();
    console.log('题目:', q?.id, String(q?.question_text || '').slice(0, 30), '| 学生:', stu?.id, stu?.username);

    const saved = await call('POST', `/api/cards/classroom-quiz/${quiz.id}/answers`, token, {
      question_id: q.id, student_id: stu.id, answer_text: 'x = 2', is_correct: 1, score: 10,
    });
    console.log('保存作答:', saved.status, JSON.stringify(saved.json).slice(0, 300));

    const det = await call('GET', `/api/cards/classroom-quiz/${quiz.id}`, token);
    const answers = det.json?.answers || det.json?.quiz_answers || [];
    console.log('详情接口答题记录数 =', answers.length, answers[0] ? `示例: student=${answers[0].student_id} text=${answers[0].answer_text}` : '');
  } catch (e) {
    console.error('异常:', e.message);
  }
})();
