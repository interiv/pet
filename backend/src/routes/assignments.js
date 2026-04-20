const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { checkLevelUp } = require('./pets');
const { updateTaskProgress } = require('./daily-tasks');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('仅支持图片格式(jpg/png/gif/webp)'));
    }
  }
});

function getAIConfig() {
  const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
  const config = {};
  settings.forEach(s => config[s.key] = s.value);
  return config;
}

function isObjectiveType(type) {
  return ['choice_single', 'choice_multi', 'judgment'].includes(type);
}

// 题型中文映射
const typeLabels = {
  choice_single: '单选题',
  choice_multi: '多选题',
  judgment: '判断题',
  fill_blank: '填空题',
  essay: '简答题',
  composition: '作文'
};

router.post('/generate', authenticateToken, authorizeRole('teacher', 'admin'), async (req, res) => {
  try {
    const { subject, topic, difficulty = 'medium', question_type, count = 10, grade_level = '' } = req.body;
    
    if (!subject || !topic || !question_type) {
      return res.status(400).json({ error: '请填写科目、主题和题型' });
    }

    const config = getAIConfig();
    if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }

    const typeLabel = typeLabels[question_type] || question_type;
    const actualCount = count * 3;

    let prompt = '';
    if (question_type === 'choice_single') {
      prompt = `请为${grade_level}学生生成一份关于"${topic}"的${subject}${typeLabel}作业，难度${difficulty}。
要求生成${actualCount}道题目（每道题有A/B/C/D四个选项），同时为每道题生成：
- 正确答案（单选只有一个正确选项）
- 详细解析（解题思路和步骤）
- 解题分析过程

以JSON数组格式返回，每道题格式：
{
  "questions": [
    {
      "content": "题目内容",
      "options": ["选项A内容", "选项B内容", "选项C内容", "选项D内容"],
      "answer": "A",
      "explanation": "详细解析",
      "analysis": "解题步骤/思路"
    },
    ...
  ]
}
注意：
1. ${actualCount}道题中，每3道为一组变体，考查相同知识点但数字/表述略有不同
2. 确保所有答案都在options范围内
3. 返回纯JSON，不要其他文字`;
    } else if (question_type === 'choice_multi') {
      prompt = `请为${grade_level}学生生成一份关于"${topic}"的${subject}${typeLabel}作业，难度${difficulty}。
要求生成${actualCount}道多选题（每道题有A/B/C/D四个选项，可能有多个正确答案），同时生成详细解析。

JSON格式：
{
  "questions": [
    {
      "content": "题目内容",
      "options": ["A","B","C","D"],
      "answer": ["A","C"], // 数组形式，多个正确答案
      "explanation": "详细解析",
      "analysis": "解题步骤"
    },
    ...
  ]
}
注意：每3道题为同一知识点的变体，返回纯JSON`;
    } else if (question_type === 'judgment') {
      prompt = `请为${grade_level}学生生成一份关于"${topic}"的${subject}${typeLabel}作业，难度${difficulty}。
要求生成${actualCount}道判断题，同时生成详细解析。

JSON格式：
{
  "questions": [
    {
      "content": "判断题陈述内容",
      "answer": true, // 或 false
      "explanation": "为什么对或错的解析",
      "analysis": "判断依据"
    },
    ...  
  ]
}
注意：每3道题为同一知识点的变体，返回纯JSON`;
    } else if (question_type === 'essay') {
      prompt = `请为${grade_level}学生生成一份关于"${topic}"的${subject}${typeLabel}作业，难度${difficulty}。
要求生成${count}道简答题/作文题，同时为每道题生成参考答案和评分标准。

JSON格式：
{
  "questions": [
    {
      "content": "题目要求",
      "answer": "参考答案要点",
      "explanation": "评分标准和解析",
      "analysis": "答题思路指导"
    },
    ...
  ],
  "title": "建议的作业标题",
  "description": "建议的作业描述"
}
注意：主观题不需要变体，返回纯JSON`;
    }

    const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
      model: config.ai_model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" }
    }, {
      headers: {
        'Authorization': `Bearer ${config.ai_api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    });

    const aiContent = response.data.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(aiContent);
    } catch (e) {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('AI返回格式错误');
      }
    }

    const questions = parsed.questions || [];
    if (questions.length === 0) {
      return res.status(500).json({ error: 'AI未能生成有效题目，请调整提示词后重试' });
    }

    let variantGroupId = 1;
    const processedQuestions = [];
    const isSubjective = !isObjectiveType(question_type);

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qIndex = isSubjective ? i : Math.floor(i / 3);
      
      let answerStr;
      if (Array.isArray(q.answer)) {
        answerStr = q.answer.join(',');
      } else if (typeof q.answer === 'boolean') {
        answerStr = q.answer ? 'true' : 'false';
      } else {
        answerStr = String(q.answer);
      }

      processedQuestions.push({
        subject,
        topic,
        difficulty,
        type: question_type,
        content: q.content,
        options: q.options ? JSON.stringify(q.options) : null,
        answer: answerStr,
        explanation: q.explanation || '',
        analysis: q.analysis || '',
        hint: q.hint || '',
        variant_group_id: isSubjective ? null : variantGroupId,
        variant_index: isSubjective ? 0 : (i % 3),
        source: 'ai',
        created_by: req.user.userId
      });

      if (!isSubjective && (i + 1) % 3 === 0) {
        variantGroupId++;
      }
    }

    const insertQ = db.prepare(`
      INSERT INTO question_bank (subject, topic, difficulty, type, content, options, answer, explanation, analysis, hint, variant_group_id, variant_index, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((qs) => {
      const ids = [];
      for (const q of qs) {
        const result = insertQ.run(
          q.subject, q.topic, q.difficulty, q.type, q.content,
          q.options, q.answer, q.explanation, q.analysis, q.hint,
          q.variant_group_id, q.variant_index, q.source, q.created_by
        );
        ids.push(result.lastInsertRowid);
      }
      return ids;
    });

    const insertedIds = transaction(processedQuestions);

    const displayQuestions = isSubjective
      ? insertedIds.map((id, idx) => ({
          tempId: id,
          content: questions[idx].content,
          options: questions[idx].options ? (typeof questions[idx].options === 'string' ? JSON.parse(questions[idx].options) : questions[idx].options) : null,
          type: question_type,
          hasVariants: false
        }))
      : [];

    if (!isSubjective) {
      for (let g = 0; g < count; g++) {
        const baseIdx = g * 3;
        displayQuestions.push({
          tempId: insertedIds[baseIdx],
          variantIds: [insertedIds[baseIdx], insertedIds[baseIdx + 1], insertedIds[baseIdx + 2]],
          content: questions[baseIdx].content,
          options: questions[baseIdx].options ? JSON.parse(questions[baseIdx].options) : null,
          type: question_type,
          hasVariants: true
        });
      }
    }

    res.json({
      message: '生成成功',
      title: parsed.title || `${topic} - ${typeLabel}练习`,
      description: parsed.description || `共${count}道${topic}相关${typeLabel}`,
      question_type,
      question_count: count,
      total_generated: insertedIds.length,
      questions: displayQuestions,
      allQuestionIds: insertedIds
    });

  } catch (error) {
    console.error('AI 生成作业错误:', error);
    if (error.code === 'ECONNABORTED') {
      return res.status(500).json({ error: 'AI请求超时，请稍后重试' });
    }
    res.status(500).json({ error: 'AI 生成作业失败: ' + (error.message || '未知错误') });
  }
});

router.post('/', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { title, description, subject, question_type, max_exp, due_date, class_id, question_ids, ai_config } = req.body;

    if (!title || !subject || !question_type || !due_date) {
      return res.status(400).json({ error: '请填写必要信息' });
    }

    let targetClassId = class_id;
    if (!targetClassId && req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ? LIMIT 1`).all(req.user.userId);
      if (teacherClasses.length > 0) {
        targetClassId = teacherClasses[0].class_id;
      }
    }

    const result = db.prepare(`
      INSERT INTO assignments (teacher_id, title, description, subject, question_type, max_exp, due_date, ai_config, class_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.userId, title, description, subject, question_type, max_exp, new Date(due_date).toISOString(), JSON.stringify(ai_config || {}), targetClassId);

    const assignmentId = result.lastInsertRowid;

    if (question_ids && question_ids.length > 0) {
      const insertAQ = db.prepare(`
        INSERT INTO assignment_questions (assignment_id, question_bank_id, sort_order)
        VALUES (?, ?, ?)
      `);
      const insertTransaction = db.transaction((ids) => {
        ids.forEach((qid, idx) => {
          insertAQ.run(assignmentId, qid, idx + 1);
        });
      });
      insertTransaction(question_ids);

      db.prepare(`UPDATE question_bank SET usage_count = usage_count + 1 WHERE id IN (${question_ids.map(() => '?').join(',')})`).run(...question_ids);
    }

    res.status(201).json({
      message: '作业创建成功',
      assignment: {
        id: assignmentId,
        title,
        subject,
        question_type,
        max_exp,
        due_date,
        class_id: targetClassId,
        question_count: question_ids ? question_ids.length : 0
      }
    });
  } catch (error) {
    console.error('创建作业错误:', error);
    res.status(500).json({ error: '创建作业失败: ' + error.message });
  }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    let assignments;
    const { class_id } = req.query;

    if (req.user.role === 'admin') {
      if (class_id) {
        assignments = db.prepare(`
          SELECT a.*, u.username as teacher_name, c.name as class_name,
            (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count
          FROM assignments a
          JOIN users u ON a.teacher_id = u.id
          LEFT JOIN classes c ON a.class_id = c.id
          WHERE a.class_id = ?
          ORDER BY a.created_at DESC
        `).all(class_id);
      } else {
        assignments = db.prepare(`
          SELECT a.*, u.username as teacher_name, c.name as class_name,
            (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count
          FROM assignments a
          JOIN users u ON a.teacher_id = u.id
          LEFT JOIN classes c ON a.class_id = c.id
          ORDER BY a.created_at DESC
        `).all();
      }
    } else if (req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(req.user.userId);
      const classIds = teacherClasses.map(tc => tc.class_id);
      if (classIds.length === 0) return res.json({ assignments: [] });

      const placeholders = classIds.map(() => '?').join(',');
      assignments = db.prepare(`
        SELECT a.*, u.username as teacher_name, c.name as class_name,
          (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classes c ON a.class_id = c.id
        WHERE a.class_id IN (${placeholders})
        ORDER BY a.created_at DESC
      `).all(...classIds);
    } else {
      const student = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
      if (!student || !student.class_id) return res.json({ assignments: [] });

      assignments = db.prepare(`
        SELECT a.*, u.username as teacher_name, c.name as class_name,
          (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count,
          (SELECT id FROM submissions WHERE assignment_id = a.id AND user_id = ? LIMIT 1) as my_submission_id,
          (SELECT status FROM submissions WHERE assignment_id = a.id AND user_id = ? ORDER BY id DESC LIMIT 1) as my_submission_status,
          (SELECT MAX(total_score) FROM submissions WHERE assignment_id = a.id AND user_id = ?) as my_score,
          (SELECT SUM(gold_reward) FROM submissions WHERE assignment_id = a.id AND user_id = ?) as my_gold_reward
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classes c ON a.class_id = c.id
        WHERE a.class_id = ?
        ORDER BY a.created_at DESC
      `).all(req.user.userId, req.user.userId, req.user.userId, req.user.userId, student.class_id);
    }

    res.json({ assignments });
  } catch (error) {
    console.error('获取作业列表错误:', error);
    res.status(500).json({ error: '获取作业列表失败' });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const assignment = db.prepare(`
      SELECT a.*, u.username as teacher_name, c.name as class_name
      FROM assignments a
      JOIN users u ON a.teacher_id = u.id
      LEFT JOIN classes c ON a.class_id = c.id
      WHERE a.id = ?
    `).get(req.params.id);

    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    if (req.user.role === 'student') {
      const student = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
      if (!student || student.class_id !== assignment.class_id) {
        return res.status(403).json({ error: '无法访问此作业' });
      }
    } else if (req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`SELECT class_id FROM class_teachers WHERE teacher_id = ?`).all(req.user.userId);
      const classIds = teacherClasses.map(tc => tc.class_id);
      if (!classIds.includes(assignment.class_id)) {
        return res.status(403).json({ error: '无法访问此作业' });
      }
    }

    const isStudent = req.user.role === 'student';
    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.options, qb.hint,
             ${isStudent ? 'NULL as answer, NULL as explanation, NULL as analysis' : 'qb.answer, qb.explanation, qb.analysis'},
             aq.sort_order, qb.variant_group_id, qb.difficulty
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);

    for (const q of questions) {
      if (q.options) {
        try { q.options = JSON.parse(q.options); } catch(e) {}
      }
    }

    res.json({
      assignment: { ...assignment, questions }
    });
  } catch (error) {
    console.error('获取作业详情错误:', error);
    res.status(500).json({ error: '获取作业详情失败' });
  }
});

router.post('/:id/submit', authenticateToken, async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: '请提交有效的答案' });
    }

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const student = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
    if (!student || student.class_id !== assignment.class_id) {
      return res.status(403).json({ error: '无法提交此作业' });
    }

    const existingSubmission = db.prepare('SELECT id, status, attempt_count FROM submissions WHERE assignment_id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (existingSubmission && existingSubmission.status !== 'retry_available') {
      return res.status(400).json({ error: '已经提交过作业' });
    }

    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.options, qb.answer, qb.explanation, qb.analysis, qb.variant_group_id
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);

    const isObj = isObjectiveType(assignment.question_type);
    const submissionId = existingSubmission ? existingSubmission.id : null;

    if (isObj) {
      const results = [];
      let correctCount = 0;
      let wrongQuestions = [];

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const userAnswer = answers.find(a => a.question_id === q.id)?.answer;
        
        let isCorrect = false;
        if (q.type === 'choice_single' || q.type === 'fill_blank') {
          isCorrect = String(userAnswer).trim().toLowerCase() === String(q.answer).trim().toLowerCase();
        } else if (q.type === 'choice_multi') {
          const correctSet = q.answer.split(',').map(s => s.trim().toLowerCase()).sort().join(',');
          const userSet = (Array.isArray(userAnswer) ? userAnswer : [userAnswer]).map(s => String(s).trim().toLowerCase()).sort().join(',');
          isCorrect = correctSet === userSet;
        } else if (q.type === 'judgment') {
          const ua = String(userAnswer).trim().toLowerCase();
          const ca = String(q.answer).trim().toLowerCase();
          isCorrect = ua === ca || (ua === 'true' && ca === 'true') || (ua === 'false' && ca === 'false');
        }

        if (isCorrect) correctCount++;

        results.push({
          question_id: q.id,
          question_content: q.content,
          user_answer: userAnswer,
          correct_answer: q.answer,
          is_correct: isCorrect,
          score: isCorrect ? (100 / questions.length) : 0,
          explanation: q.explanation,
          analysis: q.analysis
        });

        if (!isCorrect && q.variant_group_id) {
          const variants = db.prepare(`
            SELECT id, content, options, answer, explanation, analysis, variant_index
            FROM question_bank WHERE variant_group_id = ? ORDER BY variant_index
          `).all(q.variant_group_id);

          const nextVariantIndex = ((existingSubmission?.attempt_count || 0)) % 3;
          const retryQuestion = variants[nextVariantIndex] && variants[nextVariantIndex].id !== q.id
            ? variants[nextVariantIndex]
            : variants[(nextVariantIndex + 1) % 3];

          if (retryQuestion) {
            if (retryQuestion.options) {
              try { retryQuestion.options = JSON.parse(retryQuestion.options); } catch(e) {}
            }
            wrongQuestions.push({
              original_question_id: q.id,
              retry_question: retryQuestion
            });
          }
        }
      }

      const totalScore = Math.round((correctCount / questions.length) * 100);
      const goldReward = Math.floor((totalScore / 100) * (assignment.max_exp || 30));
      const hasWrongQuestions = wrongQuestions.length > 0;

      if (!submissionId) {
        const finalStatus = hasWrongQuestions ? 'retry_available' : 'completed';
        const result = db.prepare(`
          INSERT INTO submissions (assignment_id, user_id, answers, status, total_score, total_max_score, gold_reward, attempt_count, review_status)
          VALUES (?, ?, ?, ?, ?, 100, ?, 1, ?)
        `).run(req.params.id, req.user.userId, JSON.stringify(answers), finalStatus, totalScore, goldReward, finalStatus);

        const newSubId = result.lastInsertRowid;
        const insertQA = db.prepare(`
          INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, is_correct, score, max_score, answered_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        for (const r of results) {
          insertQA.run(newSubId, r.question_id, r.user_answer, r.is_correct ? 1 : 0, r.score, 100 / questions.length);
        }

        for (const wq of wrongQuestions) {
          const r = results.find(r => r.question_id === wq.original_question_id);
          if (!r) continue;
          const existingWQ = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
            .get(req.user.userId, wq.original_question_id);
          if (existingWQ) {
            db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count + 1 WHERE id = ?').run(existingWQ.id);
          } else {
            db.prepare(`
              INSERT INTO wrong_questions (user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed, wrong_count)
              VALUES (?, ?, ?, ?, ?, ?, 0, 1)
            `).run(req.user.userId, req.params.id, wq.original_question_id, r.user_answer, r.correct_answer, r.analysis);
          }
        }
      } else {
        const retryFinalStatus = wrongQuestions.length > 0 ? 'retry_available' : 'completed';
        db.prepare(`UPDATE submissions SET status = ?, total_score = ?, gold_reward = gold_reward + ?, attempt_count = attempt_count + 1 WHERE id = ?`)
          .run(retryFinalStatus, totalScore, goldReward, submissionId);

        const insertQA = db.prepare(`
          INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, is_correct, score, max_score, answered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        for (const r of results) {
          insertQA.run(submissionId, r.question_id, (existingSubmission?.attempt_count || 0) + 1, r.user_answer, r.is_correct ? 1 : 0, r.score, 100 / questions.length);
        }
      }

      db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(goldReward, req.user.userId);

      // 更新每日任务进度
      try {
        // 完成作业任务
        updateTaskProgress(req.user.userId, 'complete_assignment', 1);
        
        // 正确率达标任务
        if (totalScore >= 80) {
          updateTaskProgress(req.user.userId, 'correct_rate', totalScore);
        }
      } catch (error) {
        console.error('更新每日任务进度失败:', error);
      }

      // 更新知识点统计
      try {
        const today = new Date().toISOString().split('T')[0];
        const insertKnowledgePoint = db.prepare(`
          INSERT OR IGNORE INTO knowledge_point_stats (user_id, knowledge_point, date, total_attempts, correct_attempts)
          VALUES (?, ?, ?, 1, ?)
        `);
        const updateKnowledgePoint = db.prepare(`
          UPDATE knowledge_point_stats 
          SET total_attempts = total_attempts + 1, correct_attempts = correct_attempts + ?
          WHERE user_id = ? AND knowledge_point = ? AND date = ?
        `);
        
        // 从题目中提取知识点（如果有）
        for (const r of results) {
          const question = questions.find(q => q.id === r.question_id);
          if (question && question.knowledge_point) {
            const existing = db.prepare(
              'SELECT id FROM knowledge_point_stats WHERE user_id = ? AND knowledge_point = ? AND date = ?'
            ).get(req.user.userId, question.knowledge_point, today);
            
            if (existing) {
              updateKnowledgePoint.run(r.is_correct ? 1 : 0, req.user.userId, question.knowledge_point, today);
            } else {
              insertKnowledgePoint.run(req.user.userId, question.knowledge_point, today, r.is_correct ? 1 : 0);
            }
          }
        }
      } catch (error) {
        console.error('更新知识点统计失败:', error);
      }

      res.json({
        success: true,
        message: '批改完成',
        results,
        total_score: totalScore,
        total_max_score: 100,
        gold_reward: goldReward,
        correct_count: correctCount,
        total_count: questions.length,
        wrong_count: questions.length - correctCount,
        wrong_questions: wrongQuestions,
        can_retry: wrongQuestions.length > 0
      });

    } else {
      if (existingSubmission) {
        return res.status(400).json({ error: '主观题只能提交一次' });
      }

      const result = db.prepare(`
        INSERT INTO submissions (assignment_id, user_id, answers, attachments, status, total_max_score, review_status)
        VALUES (?, ?, ?, ?, 'submitted', 100, 'pending')
      `).run(req.params.id, req.user.userId, JSON.stringify(answers), JSON.stringify(req.body.attachments || []));

      const newSubId = result.lastInsertRowid;

      const insertQA = db.prepare(`
        INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, image_url, answered_at)
        VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
      `);
      for (const ans of answers) {
        insertQA.run(newSubId, ans.question_id, ans.answer || '', ans.image_url || '');
      }

      setImmediate(async () => {
        await reviewSubjectiveAssignment(newSubId, req.params.id, req.user.userId);
      });

      res.json({
        success: true,
        message: '已提交，等待AI评阅',
        submission_id: newSubId
      });
    }
  } catch (error) {
    console.error('提交作业错误:', error);
    res.status(500).json({ error: '提交作业失败: ' + error.message });
  }
});

async function reviewSubjectiveAssignment(submissionId, assignmentId, userId) {
  try {
    const submission = db.prepare(`
      SELECT s.*, a.max_exp, a.subject
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.id = ?
    `).get(submissionId);

    if (!submission || submission.review_status !== 'pending') return;

    db.prepare("UPDATE submissions SET review_status = 'reviewing' WHERE id = ?").run(submissionId);

    const questionAnswers = db.prepare(`
      SELECT qa.id, qa.question_bank_id, qa.student_answer, qa.image_url,
      qb.content as question_content, qb.answer as reference_answer, qb.explanation, qb.analysis
      FROM question_answers qa
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      WHERE qa.submission_id = ?
    `).all(submissionId);

    const config = getAIConfig();
    let totalScore = 0;
    const feedbackList = [];

    if (config.ai_api_key && config.ai_base_url && config.ai_model) {
      for (const qa of questionAnswers) {
        const reviewPrompt = `请评阅以下${submission.subject}主观题作答：

【题目】
${qa.question_content}

【参考答案】
${qa.reference_answer || '无'}

【学生作答】
${qa.student_answer || '(未提供文字答案)'}

请以JSON格式返回评分结果：
{
  "score": 分数(0-100),
  "feedback": "具体评价和建议（50字以内）",
  "key_points": ["得分点1", "得分点2"],
  "improvements": ["改进建议1"]
}`;

        try {
          const resp = await axios.post(`${config.ai_base_url}/chat/completions`, {
            model: config.ai_model,
            messages: [{ role: 'user', content: reviewPrompt }],
            response_format: { type: "json_object" }
          }, {
            headers: { 'Authorization': `Bearer ${config.ai_api_key}`, 'Content-Type': 'application/json' },
            timeout: 60000
          });

          const aiResult = JSON.parse(resp.data.choices[0].message.content);
          const score = Math.max(0, Math.min(100, aiResult.score || 60));
          totalScore += score;

          db.prepare(`
            UPDATE question_answers SET score = ?, max_score = 100, feedback = ?, reviewed_at = CURRENT_TIMESTAMP, is_correct = ? WHERE id = ?
          `).run(score, 100, JSON.stringify(aiResult), score >= 60 ? 1 : 0, qa.id);

          feedbackList.push({
            question_id: qa.question_bank_id,
            score,
            feedback: aiResult.feedback || '已评阅',
            is_correct: score >= 60
          });
        } catch (e) {
          totalScore += 60;
          db.prepare(`UPDATE question_answers SET score = 60, max_score = 100, feedback = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(JSON.stringify({ feedback: '自动评分', suggestions: ['继续努力'] }), qa.id);
        }
      }
    } else {
      totalScore = questionAnswers.length * 60;
      for (const qa of questionAnswers) {
        db.prepare(`UPDATE question_answers SET score = 60, max_score = 100, feedback = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(JSON.stringify({ feedback: '默认评分' }), qa.id);
      }
    }

    const avgScore = questionAnswers.length > 0 ? Math.round(totalScore / questionAnswers.length) : 0;
    const goldReward = Math.floor((avgScore / 100) * (submission.max_exp || 30));

    db.prepare(`
      UPDATE submissions SET total_score = ?, gold_reward = ?, review_status = 'completed', graded_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(avgScore, goldReward, submissionId);

    db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(goldReward, userId);

    for (const qa of questionAnswers) {
      const qaRecord = db.prepare('SELECT is_correct, score FROM question_answers WHERE id = ?').get(qa.id);
      if (qaRecord && qaRecord.is_correct === 0) {
        db.prepare(`
          INSERT OR IGNORE INTO wrong_questions (user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(userId, assignmentId, qa.question_bank_id, qa.student_answer, '', qa.analysis || qa.explanation || '');
      }
    }

    console.log(`主观题评阅完成: submission=${submissionId}, score=${avgScore}, gold=${goldReward}`);
  } catch (error) {
    console.error('主观题评阅错误:', error);
    db.prepare("UPDATE submissions SET review_status = 'completed', total_score = 60, gold_reward = ? WHERE id = ?")
      .run(Math.floor(0.6 * (db.prepare('SELECT max_exp FROM assignments WHERE id = ?').get(assignmentId)?.max_exp || 30)), submissionId);
  }
}

router.get('/submissions/:id', authenticateToken, (req, res) => {
  try {
    const submission = db.prepare(`
      SELECT s.*, a.title, a.subject, a.max_exp, a.question_type
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.id = ? AND s.user_id = ?
    `).get(req.params.id, req.user.userId);

    if (!submission) return res.status(404).json({ error: '提交记录不存在' });

    const answers = db.prepare(`
      qa.*, qb.content as question_content, qb.options, qb.answer as correct_answer, qb.explanation, qb.analysis, qb.type
      FROM question_answers qa
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      WHERE qa.submission_id = ?
      ORDER BY qa.id
    `).all(req.params.id);

    for (const a of answers) {
      if (a.options) {
        try { a.options = JSON.parse(a.options); } catch(e) {}
      }
      if (a.feedback) {
        try { a.feedback = JSON.parse(a.feedback); } catch(e) {}
      }
    }

    res.json({ submission, answers });
  } catch (error) {
    console.error('获取提交详情错误:', error);
    res.status(500).json({ error: '获取提交详情失败' });
  }
});

router.get('/:id/statistics', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const totalStudents = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE class_id = ? AND role = \'student\'').get(assignment.class_id)?.cnt || 0;
    const submittedCount = db.prepare('SELECT COUNT(*) as cnt FROM submissions WHERE assignment_id = ?').get(req.params.id)?.cnt || 0;

    const scoreStats = db.prepare(`
      SELECT AVG(total_score) as avg_score, MAX(total_score) as max_score, MIN(total_score) as min_score
      FROM submissions WHERE assignment_id = ? AND total_score IS NOT NULL
    `).get(req.params.id);

    const questions = db.prepare(`
      aq.question_bank_id, qb.content, qb.type, qb.answer
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);

    const questionStats = questions.map(q => {
      const totalAns = db.prepare('SELECT COUNT(*) as cnt FROM question_answers WHERE question_bank_id = ?').get(q.question_bank_id)?.cnt || 0;
      const correctAns = db.prepare('SELECT COUNT(*) as cnt FROM question_answers WHERE question_bank_id = ? AND is_correct = 1').get(q.question_bank_id)?.cnt || 0;
      return {
        question_id: q.question_bank_id,
        content: q.content.substring(0, 50),
        type: q.type,
        total_answers: totalAns,
        correct_count: correctAns,
        correct_rate: totalAns > 0 ? Math.round((correctAns / totalAns) * 100) : 0,
        avg_score: db.prepare('SELECT AVG(score) as avg FROM question_answers WHERE question_bank_id = ? AND score IS NOT NULL').get(q.question_bank_id)?.avg || 0
      };
    });

    const studentResults = db.prepare(`
      s.id as submission_id, u.id as user_id, u.username, s.total_score, s.gold_reward, s.submitted_at, s.review_status
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      WHERE s.assignment_id = ?
      ORDER BY s.total_score DESC, s.submitted_at ASC
    `).all(req.params.id);

    res.json({
      assignment_id: parseInt(req.params.id),
      total_students: totalStudents,
      submitted_count: submittedCount,
      completion_rate: totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0,
      average_score: Math.round(scoreStats.avg_score || 0),
      highest_score: scoreStats.max_score || 0,
      lowest_score: scoreStats.min_score || 0,
      question_stats: questionStats,
      student_results: studentResults
    });
  } catch (error) {
    console.error('获取统计错误:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
});

router.get('/wrong/my', authenticateToken, (req, res) => {
  try {
    const { subject } = req.query;
    let query = `
      SELECT wq.*, qb.content as question_content, qb.options, qb.answer as correct_answer, 
      qb.subject, qb.type as question_type, a.title as assignment_title, qb.explanation, qb.analysis
      FROM wrong_questions wq
      JOIN question_bank qb ON wq.question_id = qb.id
      LEFT JOIN assignments a ON wq.assignment_id = a.id
      WHERE wq.user_id = ?
    `;
    const params = [req.user.userId];

    if (subject) {
      query += ` AND qb.subject = ?`;
      params.push(subject);
    }

    query += ` ORDER BY wq.id DESC`;

    const wrongQuestions = db.prepare(query).all(...params);
    for (const wq of wrongQuestions) {
      if (wq.options) {
        try { wq.options = JSON.parse(wq.options); } catch(e) {}
      }
    }

    res.json({ wrong_questions: wrongQuestions });
  } catch (error) {
    console.error('获取错题错误:', error);
    res.status(500).json({ error: '获取错题失败' });
  }
});

router.post('/wrong/:id/review', authenticateToken, (req, res) => {
  try {
    const result = db.prepare('UPDATE wrong_questions SET reviewed = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: '错题记录不存在' });
    }
    res.json({ message: '标记复习成功' });
  } catch (error) {
    res.status(500).json({ error: '操作失败' });
  }
});

router.post('/upload/image', authenticateToken, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择要上传的图片' });
    }

    const result = db.prepare(`
      INSERT INTO upload_files (user_id, original_name, stored_name, file_path, file_size, mime_type, upload_type)
      VALUES (?, ?, ?, ?, ?, ?, 'assignment')
    `).run(req.user.userId, req.file.originalname, req.file.filename, `/uploads/${req.file.filename}`, req.file.size, req.file.mimetype);

    res.json({
      url: `/uploads/${req.file.filename}`,
      file_id: result.lastInsertRowid,
      original_name: req.file.originalname
    });
  } catch (error) {
    console.error('上传错误:', error);
    res.status(500).json({ error: '上传失败: ' + error.message });
  }
});

module.exports = router;
