/**
 * 课堂做题（课堂抢答）的公共逻辑
 *
 * 供两处调用，保证行为一致：
 *   1. 教师在页面里手动创建（/api/cards/classroom-quiz）
 *   2. AI 助手（WorkBuddy / CodeBuddy 等）直连提交（/api/agent/classroom-quizzes）
 */

const { db } = require('../config/database');

// 题目附带的 HTML 课件体积上限（200KB）：课件通常是单页小页面，过大会拖慢课堂加载
const MAX_COURSEWARE_LEN = 200 * 1024;
const MAX_QUESTION_LEN = 2000;
const MAX_TITLE_LEN = 100;
const MAX_QUESTIONS_PER_CALL = 50; // 单次提交最多 50 道题
const MAX_OPTION_LEN = 500;
const MAX_OPTIONS = 8;

/**
 * 允许的题型。
 * choice_single 单选 / choice_multi 多选 / judgment 判断 / fill_blank 填空 / essay 简答作文。
 * 前端 utils/questionTypes.ts 是同一份口径，改这里要同步改那里。
 */
const QUESTION_TYPES = ['choice_single', 'choice_multi', 'judgment', 'fill_blank', 'essay'];

/** 裁剪文本（超长截断，空值返回 null） */
function clipText(raw, maxLen) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

/**
 * 规整结构化选项：兼容 [{key,text}] 与 {A:'文本',B:'文本'} 两种写法。
 *
 * 为什么要单独规整：AI 出题、题库选题、老师手动录入三处的选项格式各不相同，
 * 而 options 要以同一形态落库，前端才能用同一套逻辑渲染按钮、判分。
 * 落库统一存 JSON 字符串 [{"key":"A","text":"..."}]。
 */
function normalizeOptions(raw) {
  if (!raw) return null;

  let list = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    try {
      list = JSON.parse(text);
    } catch (e) {
      return null; // 不是 JSON 就当作没有选项，判分自动退回 AI 流程
    }
  }
  if (!Array.isArray(list)) {
    // {A:'文本', B:'文本'} 形式
    if (list && typeof list === 'object') {
      list = Object.entries(list).map(([key, text]) => ({ key, text }));
    } else {
      return null;
    }
  }

  const out = [];
  const used = new Set();
  list.forEach((o, idx) => {
    if (!o) return;
    const text = clipText(o.text ?? o.label ?? o.content ?? o.value, MAX_OPTION_LEN);
    if (!text) return;
    let key = String(o.key ?? o.label_key ?? '').trim().toUpperCase();
    if (!key) key = String.fromCharCode(65 + idx); // 没给 key 就按顺序补 A/B/C…
    if (used.has(key)) return;
    used.add(key);
    out.push({ key, text });
  });

  return out.length ? out.slice(0, MAX_OPTIONS) : null;
}

/**
 * 从题干纯文本里识别并拆出结构化选项。
 * 实现放在 services/classroomQuestionText.js（纯函数、不依赖数据库），
 * 因为迁移脚本回填存量题时也要用同一套判据，而那里不能再开数据库连接。
 */
const { splitInlineOptions, looksLikeJudgment, inferTypeFromOptions } = require('./classroomQuestionText');

/**
 * 规整提交的题目：兼容纯字符串题干与 { question_text, answer_text, courseware_html,
 * question_type, options, explanation }。
 *
 * question_type/options/explanation 是本地判分的前提：
 * 课堂答题要能对客观题秒判对错，就必须知道题型、选项和标准答案，
 * 以前这三样都没有，只能把作答送去给 AI 判。
 *
 * 返回 { questions, warnings }，warnings 提示哪些内容被裁剪 / 忽略
 */
function normalizeQuestions(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const warnings = [];
  const questions = [];

  list.forEach((q, i) => {
    const isObj = q && typeof q === 'object';
    const rawText = isObj ? (q.question_text ?? q.text ?? q.content ?? q.stem) : q;
    const text = String(rawText ?? '').trim();
    if (!text) return;

    const coursewareRaw = isObj ? (q.courseware_html ?? q.courseware ?? q.html) : null;
    const courseware = clipText(coursewareRaw, MAX_COURSEWARE_LEN);
    if (coursewareRaw && !courseware) {
      warnings.push(`第 ${i + 1} 题的 HTML 课件内容为空，已忽略`);
    }

    // 题型：认不出来就留空（前端按简答处理，走原有 AI 判分，行为不变）
    const rawType = isObj ? (q.question_type ?? q.type) : null;
    let type = QUESTION_TYPES.includes(String(rawType)) ? String(rawType) : null;

    // 选项：优先用显式传入的；没有就从题干里拆。
    // 题干保留原样（选项也留在题干里，投屏时题干与选项一起看才完整），
    // options 只是额外多一份结构化数据，供控制台渲染按钮与本地判分。
    let options = normalizeOptions(isObj ? (q.options ?? q.option_list ?? q.choices) : null);
    if (!options) {
      const parsed = splitInlineOptions(text);
      if (parsed) {
        options = parsed.options;
        // 没显式指定题型时按选项形态推断：判断题是「正确/错误」两选项
        if (!type) type = inferTypeFromOptions(options);
      }
    }
    // 填空/简答不该有选项，防止脏数据把主观题误判成客观题
    if (type === 'fill_blank' || type === 'essay') options = null;

    if (type && type !== 'fill_blank' && type !== 'essay' && !options?.length) {
      warnings.push(`第 ${i + 1} 题是客观题但没有可用选项，将按简答处理（走 AI 判分）`);
    }

    questions.push({
      question_text: text.length > MAX_QUESTION_LEN ? text.slice(0, MAX_QUESTION_LEN) : text,
      answer_text: clipText(isObj ? (q.answer_text ?? q.answer ?? q.reference_answer) : null, 2000),
      courseware_html: courseware,
      question_type: type,
      options: options ? JSON.stringify(options) : null,
      explanation: clipText(isObj ? (q.explanation ?? q.analysis ?? q.explain) : null, 2000),
    });

    if (text.length > MAX_QUESTION_LEN) {
      warnings.push(`第 ${i + 1} 题题干超过 ${MAX_QUESTION_LEN} 字，已截断`);
    }
  });

  return { questions, warnings };
}

/** 教师可操作的班级（含身份与任教科目），班主任排前面 */
function listTeacherClasses(userId) {
  return db.prepare(`
    SELECT c.id, c.name, c.grade, c.slug, ct.role, ct.subject
    FROM class_teachers ct
    JOIN classes c ON c.id = ct.class_id
    WHERE ct.teacher_id = ?
    ORDER BY CASE ct.role WHEN 'head_teacher' THEN 0 ELSE 1 END, c.created_at DESC
  `).all(userId);
}

/** 教师在某个班里的任教科目（未设置返回 null） */
function getTeachingSubject(userId, classId) {
  if (!classId) return null;
  const row = db.prepare(`SELECT subject FROM class_teachers WHERE teacher_id = ? AND class_id = ?`)
    .get(userId, classId);
  return row ? (row.subject || null) : null;
}

/** 创建课堂做题，返回 quiz_id；questions 需先经 normalizeQuestions 处理 */
function createClassroomQuiz({ title, description, subject, classId, teacherId, questions }) {
  const result = db.prepare(`
    INSERT INTO classroom_quizzes (title, description, subject, class_id, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, description || null, subject || null, classId, teacherId);

  const quizId = result.lastInsertRowid;
  insertQuestions(quizId, questions, 1);
  return quizId;
}

/** 往已有课堂做题追加题目，sort_order 接着往后排；返回新增条数 */
function appendQuizQuestions(quizId, questions) {
  const last = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS last FROM classroom_quiz_questions WHERE quiz_id = ?`)
    .get(quizId);
  return insertQuestions(quizId, questions, (last?.last || 0) + 1);
}

function insertQuestions(quizId, questions, startOrder) {
  if (!questions.length) return 0;
  const stmt = db.prepare(`
    INSERT INTO classroom_quiz_questions
      (quiz_id, question_text, sort_order, courseware_html, answer_text, question_type, options, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  questions.forEach((q, i) => {
    stmt.run(
      quizId, q.question_text, startOrder + i,
      q.courseware_html || null, q.answer_text || null,
      q.question_type || null, q.options || null, q.explanation || null
    );
  });
  return questions.length;
}

/** 课堂做题概览（不含题目正文） */
function listClassroomQuizzes({ classId, status, limit = 20 }) {
  const params = [];
  let sql = `
    SELECT q.id, q.title, q.description, q.subject, q.class_id, q.status, q.created_at,
           c.name AS class_name,
           (SELECT COUNT(*) FROM classroom_quiz_questions WHERE quiz_id = q.id) AS question_count
    FROM classroom_quizzes q
    LEFT JOIN classes c ON c.id = q.class_id
    WHERE 1=1
  `;
  if (classId) { sql += ` AND q.class_id = ?`; params.push(classId); }
  if (status) { sql += ` AND q.status = ?`; params.push(status); }
  sql += ` ORDER BY q.created_at DESC LIMIT ?`;
  params.push(Math.min(50, Math.max(1, parseInt(limit) || 20)));
  return db.prepare(sql).all(...params);
}

function getClassroomQuiz(quizId) {
  const quiz = db.prepare(`
    SELECT q.*, c.name AS class_name
    FROM classroom_quizzes q
    LEFT JOIN classes c ON c.id = q.class_id
    WHERE q.id = ?
  `).get(quizId);
  if (!quiz) return null;
  const questions = db.prepare(`
    SELECT id, sort_order, question_text, answer_text, courseware_html,
           question_type, options, explanation
    FROM classroom_quiz_questions WHERE quiz_id = ? ORDER BY sort_order ASC, id ASC
  `).all(quizId);
  return { ...quiz, questions };
}

module.exports = {
  MAX_COURSEWARE_LEN,
  MAX_QUESTION_LEN,
  MAX_TITLE_LEN,
  MAX_QUESTIONS_PER_CALL,
  clipText,
  splitInlineOptions,
  looksLikeJudgment,
  normalizeQuestions,
  listTeacherClasses,
  getTeachingSubject,
  createClassroomQuiz,
  appendQuizQuestions,
  listClassroomQuizzes,
  getClassroomQuiz,
};
