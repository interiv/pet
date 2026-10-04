/**
 * AI 助手直连接口（WorkBuddy / CodeBuddy / 任意能发 HTTP 请求的 AI Agent）
 *
 * 与 /api/cards 的区别：这里不用「登录 + JWT」，而是每个教师自己发一个长期令牌，
 * AI 带 X-Agent-Token 请求头即可代表该教师身份查询身份、提交课堂做题题目。
 * 目的：老师对 AI 说「出 5 道题并带上课件」，AI 直接调接口落库，不用复制粘贴。
 *
 * 设计原则（方便 AI 自主调用）：
 *   - 每个响应都带 ok 字段与中文提示，错误也给出下一步该怎么做
 *   - 写接口支持 dry_run=true：先预检不落库，AI 可先校验再正式提交
 *   - GET / 会返回接口自述，AI 读一次就知道有哪些能力、题目格式是什么
 */

const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateAgent } = require('../middleware/agentAuth');
const { getChinaDate } = require('../config/timezone');
const { countBilledUsage } = require('../services/aiUsage');
const {
  MAX_QUESTION_LEN, MAX_TITLE_LEN, MAX_QUESTIONS_PER_CALL, MAX_COURSEWARE_LEN,
  normalizeQuestions, listTeacherClasses, getTeachingSubject,
  createClassroomQuiz, appendQuizQuestions, listClassroomQuizzes, getClassroomQuiz,
} = require('../services/classroomQuiz');

// 整个 /api/agent 都要求令牌
router.use(authenticateAgent);

const ok = (res, data = {}) => res.json({ ok: true, ...data });

/** 教师今天还能用几次 AI 生成（AI 出题是本系统的功能，直连提交题目不消耗额度） */
function remainingGenQuota(userId) {
  try {
    const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'`).get();
    if (!hasTable) return null;
    const limit = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'daily_teacher_gen_limit'`).get()?.value || '20');
    const used = countBilledUsage(userId, getChinaDate());
    return { daily_limit: limit, daily_used: used, daily_remaining: Math.max(0, limit - used) };
  } catch (e) {
    return null;
  }
}

/** 校验并解析班级：缺省时若老师只带一个班就自动选中 */
function resolveClassId(req, requestedId) {
  const classes = listTeacherClasses(req.agent.user.id);
  if (requestedId) {
    const id = parseInt(requestedId, 10);
    const target = classes.find((c) => c.id === id);
    if (!target) {
      return { error: `无权操作班级 #${requestedId}`, classes };
    }
    return { classId: id, classes };
  }
  if (classes.length === 0) {
    return { error: '当前账号还没有任教班级，请先让管理员分配班级', classes };
  }
  if (classes.length > 1) {
    return { error: `你在 ${classes.length} 个班任教，请通过 class_id 指定本次要写入的班级`, classes };
  }
  return { classId: classes[0].id, classes };
}

// ===== 接口自述：AI 先读这个就知道能做什么 =====
router.get('/', (req, res) => {
  ok(res, {
    service: '课堂宠物系统 · AI 直连接口',
    version: 1,
    auth: '所有接口都需要请求头 X-Agent-Token: <令牌>（教师在「课堂做题 → 创建 → AI 工具录入 → 方式一：AI 直连」生成）',
    recommended_flow: [
      '1. GET /whoami 拿到老师身份、任教班级、任教科目（提交时 subject 建议直接用 default_subject）',
      '2. POST /classroom-quizzes?dry_run=true 先预检（不落库），确认没问题',
      '3. POST /classroom-quizzes 正式创建课堂做题',
      '4. 需要补题时 POST /classroom-quizzes/{quiz_id}/questions 追加',
    ],
    endpoints: [
      { method: 'GET', path: '/whoami', desc: '当前令牌代表的老师身份 + 任教班级（含科目）+ 今日 AI 生成额度' },
      { method: 'GET', path: '/classes', desc: '可写入的班级列表' },
      { method: 'GET', path: '/classroom-quizzes', desc: '课堂做题列表（?class_id=&status=&limit=）' },
      { method: 'GET', path: '/classroom-quizzes/{id}', desc: '课堂做题详情（含题目与课件标记）' },
      { method: 'POST', path: '/classroom-quizzes', desc: '创建课堂做题（支持 dry_run）' },
      { method: 'POST', path: '/classroom-quizzes/{id}/questions', desc: '给已有课堂做题追加题目（支持 dry_run）' },
      { method: 'GET', path: '/question-bank', desc: '检索题库现成题目（?subject=&keyword=&limit=）' },
    ],
    question_format: {
      question_text: '必填，题干纯文本，最长 ' + MAX_QUESTION_LEN + ' 字',
      answer_text: '可选，参考答案，只给老师看',
      courseware_html: '可选，完整独立的 HTML 文档字符串（以 <!DOCTYPE html> 开头），上限 ' + Math.round(MAX_COURSEWARE_LEN / 1024) + 'KB',
    },
    limits: {
      max_questions_per_call: MAX_QUESTIONS_PER_CALL,
      courseware_note: '课件不是必须的；HTML 必须离线可用，不要引用外部网络资源',
    },
    examples: {
      create_quiz: {
        method: 'POST',
        url: '/api/agent/classroom-quizzes',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Token': '<令牌>' },
        body: {
          title: '分数加减法随堂练习',
          subject: '数学',
          class_id: 7,
          description: '课堂抢答，答对发宠物道具',
          questions: [
            { question_text: '一个三角形有几个角？', answer_text: '3 个' },
            { question_text: '计算 1/2 + 1/3 = ?', answer_text: '5/6', courseware_html: '<!DOCTYPE html>...</html>' },
          ],
        },
      },
    },
  });
});

// ===== 身份 =====
router.get('/whoami', (req, res) => {
  const user = req.agent.user;
  const classes = listTeacherClasses(user.id);
  const subject = getTeachingSubject(user.id, classes[0]?.id);
  ok(res, {
    teacher: { id: user.id, username: user.username, real_name: user.real_name, role: user.role },
    classes,
    default_class_id: classes.length === 1 ? classes[0].id : null,
    default_subject: subject,
    gen_quota: remainingGenQuota(user.id),
    token: { id: req.agent.tokenId, name: req.agent.tokenName, last_used_at: req.agent.lastUsedAt },
  });
});

router.get('/classes', (req, res) => {
  const classes = listTeacherClasses(req.agent.user.id);
  ok(res, { classes, count: classes.length });
});

// ===== 课堂做题 =====
router.get('/classroom-quizzes', (req, res) => {
  const { class_id, status } = req.query;
  const mine = listTeacherClasses(req.agent.user.id).map((c) => c.id);
  let target = class_id ? parseInt(class_id, 10) : null;
  if (target && !mine.includes(target)) {
    return res.status(403).json({ ok: false, error: `无权查看班级 #${class_id}`, classes: mine });
  }
  if (!target && mine.length === 1) target = mine[0];
  // 只返回自己班级的数据
  const rows = listClassroomQuizzes({ classId: target, status, limit: req.query.limit })
    .filter((q) => mine.includes(q.class_id));
  ok(res, { quizzes: rows, count: rows.length });
});

router.get('/classroom-quizzes/:id', (req, res) => {
  const mine = listTeacherClasses(req.agent.user.id).map((c) => c.id);
  const quiz = getClassroomQuiz(parseInt(req.params.id, 10));
  if (!quiz) return res.status(404).json({ ok: false, error: '课堂做题不存在' });
  if (!mine.includes(quiz.class_id)) {
    return res.status(403).json({ ok: false, error: '这不是你任教班级的课堂做题' });
  }
  ok(res, {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      subject: quiz.subject,
      class_id: quiz.class_id,
      class_name: quiz.class_name,
      status: quiz.status,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        order: q.sort_order,
        question_text: q.question_text,
        answer_text: q.answer_text,
        has_courseware: !!q.courseware_html,
        courseware_size: q.courseware_html ? q.courseware_html.length : 0,
      })),
    },
  });
});

/** 提交前预检：把 AI 要提交的内容规范化后回显，不落库 */
function buildDryRunResult(questions) {
  return {
    dry_run: true,
    question_count: questions.length,
    with_courseware: questions.filter((q) => q.courseware_html).length,
    warnings: questions.__warnings || [],
    questions: questions.map((q) => ({
      question_text: q.question_text,
      question_length: q.question_text.length,
      answer_text: q.answer_text || null,
      courseware_size: q.courseware_html ? q.courseware_html.length : 0,
    })),
  };
}

router.post('/classroom-quizzes', (req, res) => {
  try {
    const user = req.agent.user;
    const { title, description, subject, class_id, questions, dry_run } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ ok: false, error: '缺少课堂做题标题 title' });
    }
    const resolved = resolveClassId(req, class_id);
    if (resolved.error) {
      return res.status(400).json({ ok: false, error: resolved.error, classes: resolved.classes });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ ok: false, error: 'questions 不能为空，至少 1 道题' });
    }
    if (questions.length > MAX_QUESTIONS_PER_CALL) {
      return res.status(400).json({
        ok: false,
        error: `一次最多提交 ${MAX_QUESTIONS_PER_CALL} 道题，当前 ${questions.length} 道，请分批提交`,
      });
    }

    const { questions: normalized, warnings } = normalizeQuestions(questions);
    if (normalized.length === 0) {
      return res.status(400).json({ ok: false, error: '所有题目的题干都是空的' });
    }
    normalized.__warnings = warnings;

    if (dry_run) {
      return res.json({ ok: true, ...buildDryRunResult(normalized) });
    }

    const finalSubject = String(subject || '').trim() || getTeachingSubject(user.id, resolved.classId) || null;
    const quizId = createClassroomQuiz({
      title: String(title).trim().slice(0, MAX_TITLE_LEN),
      description: description ? String(description).slice(0, 500) : null,
      subject: finalSubject,
      classId: resolved.classId,
      teacherId: user.id,
      questions: normalized,
    });

    ok(res, {
      message: '课堂做题已创建',
      quiz_id: quizId,
      title: String(title).trim().slice(0, MAX_TITLE_LEN),
      class_id: resolved.classId,
      subject: finalSubject,
      question_count: normalized.length,
      with_courseware: normalized.filter((q) => q.courseware_html).length,
      warnings,
      next_step: `可在「课堂做题」列表打开第 ${quizId} 场，进入课堂控制台使用`,
    });
  } catch (error) {
    console.error('AI 直连创建课堂做题失败:', error);
    res.status(500).json({ ok: false, error: '创建课堂做题失败：' + (error.message || '未知错误') });
  }
});

router.post('/classroom-quizzes/:id/questions', (req, res) => {
  try {
    const mine = listTeacherClasses(req.agent.user.id).map((c) => c.id);
    const quiz = getClassroomQuiz(parseInt(req.params.id, 10));
    if (!quiz) return res.status(404).json({ ok: false, error: '课堂做题不存在' });
    if (!mine.includes(quiz.class_id)) {
      return res.status(403).json({ ok: false, error: '这不是你任教班级的课堂做题' });
    }

    const { questions, dry_run } = req.body || {};
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ ok: false, error: 'questions 不能为空，至少 1 道题' });
    }
    if (questions.length > MAX_QUESTIONS_PER_CALL) {
      return res.status(400).json({
        ok: false,
        error: `一次最多追加 ${MAX_QUESTIONS_PER_CALL} 道题，当前 ${questions.length} 道，请分批追加`,
      });
    }

    const { questions: normalized, warnings } = normalizeQuestions(questions);
    if (normalized.length === 0) {
      return res.status(400).json({ ok: false, error: '所有题目的题干都是空的' });
    }
    normalized.__warnings = warnings;

    if (dry_run) {
      return res.json({ ok: true, ...buildDryRunResult(normalized) });
    }

    appendQuizQuestions(quiz.id, normalized);
    ok(res, {
      message: `已给《${quiz.title}》追加 ${normalized.length} 道题`,
      quiz_id: quiz.id,
      added: normalized.length,
      total_questions: quiz.questions.length + normalized.length,
      with_courseware: normalized.filter((q) => q.courseware_html).length,
      warnings,
    });
  } catch (error) {
    console.error('AI 直连追加题目失败:', error);
    res.status(500).json({ ok: false, error: '追加题目失败：' + (error.message || '未知错误') });
  }
});

// ===== 题库检索：让 AI 优先复用现成题目 =====
router.get('/question-bank', (req, res) => {
  const { subject, keyword } = req.query;
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const params = [];
  let sql = `SELECT id, subject, topic, difficulty, type, content, answer, explanation, knowledge_point
             FROM question_bank WHERE 1=1`;
  if (subject) { sql += ` AND subject = ?`; params.push(String(subject)); }
  if (keyword) {
    sql += ` AND (content LIKE ? OR knowledge_point LIKE ? OR topic LIKE ?)`;
    const like = `%${String(keyword)}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  const questions = db.prepare(sql).all(...params);
  ok(res, { questions, count: questions.length });
});

module.exports = router;
