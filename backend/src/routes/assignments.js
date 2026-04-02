const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { checkLevelUp } = require('./pets');
const axios = require('axios');

// AI 生成作业（仅教师）
router.post('/generate', authenticateToken, authorizeRole('teacher', 'admin'), async (req, res) => {
  try {
    const { subject, grade_level, topic, difficulty } = req.body;

    // 获取管理员设置的 AI 模型配置
    const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
    const config = {};
    settings.forEach(s => config[s.key] = s.value);

    if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }

    const prompt = `请生成一份关于"${topic}"的${subject}作业，难度为${difficulty}，适合${grade_level}。
要求：
1. 包含 3-5 道题目
2. 题目类型可以是单选题、判断题或简答题
3. 以 JSON 格式返回，格式如下：
{
  "title": "作业标题",
  "description": "作业描述",
  "questions": [
    {
      "type": "choice",
      "content": "问题内容",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "正确选项"
    }
  ]
}`;

    const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
      model: config.ai_model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" }
    }, {
      headers: {
        'Authorization': `Bearer ${config.ai_api_key}`,
        'Content-Type': 'application/json'
      }
    });

    const aiContent = response.data.choices[0].message.content;
    const generatedAssignment = JSON.parse(aiContent);

    res.json({
      message: '生成成功',
      assignment: generatedAssignment
    });

  } catch (error) {
    console.error('AI 生成作业错误:', error);
    res.status(500).json({ error: 'AI 生成作业失败，请检查配置或稍后再试' });
  }
});

// 创建作业（仅教师）
router.post('/', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { title, description, subject, question_type, questions, max_exp, due_date, ai_config } = req.body;

    const result = db.prepare(`
      INSERT INTO assignments (teacher_id, title, description, subject, question_type, questions, max_exp, due_date, ai_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.userId, title, description, subject, question_type, JSON.stringify(questions), max_exp, due_date, JSON.stringify(ai_config));

    res.status(201).json({
      message: '作业创建成功',
      assignment: {
        id: result.lastInsertRowid,
        title,
        description,
        subject,
        question_type,
        max_exp,
        due_date
      }
    });
  } catch (error) {
    console.error('创建作业错误:', error);
    res.status(500).json({ error: '创建作业失败' });
  }
});

// 获取作业列表
router.get('/', authenticateToken, (req, res) => {
  try {
    const assignments = db.prepare(`
      SELECT a.*, u.username as teacher_name
      FROM assignments a
      JOIN users u ON a.teacher_id = u.id
      ORDER BY a.created_at DESC
    `).all();

    res.json({ assignments });
  } catch (error) {
    console.error('获取作业列表错误:', error);
    res.status(500).json({ error: '获取作业列表失败' });
  }
});

// 获取单个作业详情
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const assignment = db.prepare(`
      SELECT a.*, u.username as teacher_name
      FROM assignments a
      JOIN users u ON a.teacher_id = u.id
      WHERE a.id = ?
    `).get(req.params.id);

    if (!assignment) {
      return res.status(404).json({ error: '作业不存在' });
    }

    res.json({ assignment });
  } catch (error) {
    console.error('获取作业详情错误:', error);
    res.status(500).json({ error: '获取作业详情失败' });
  }
});

// 提交作业
router.post('/:id/submit', authenticateToken, (req, res) => {
  try {
    const { answers, attachments } = req.body;

    // 检查作业是否存在
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) {
      return res.status(404).json({ error: '作业不存在' });
    }

    // 检查是否已提交
    const existing = db.prepare('SELECT id FROM submissions WHERE assignment_id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (existing) {
      return res.status(400).json({ error: '已经提交过作业' });
    }

    const result = db.prepare(`
      INSERT INTO submissions (assignment_id, user_id, answers, attachments)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, req.user.userId, JSON.stringify(answers), JSON.stringify(attachments));

    res.status(201).json({
      message: '作业提交成功',
      submission: {
        id: result.lastInsertRowid,
        assignment_id: req.params.id,
        submitted_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('提交作业错误:', error);
    res.status(500).json({ error: '提交作业失败' });
  }
});

// 批改作业（AI 批改）
router.post('/:id/grade', authenticateToken, authorizeRole('teacher', 'admin'), async (req, res) => {
  try {
    const submissionId = req.body.submission_id;
    
    const submission = db.prepare(`
      SELECT s.*, a.questions, a.max_exp
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.id = ?
    `).get(submissionId);

    if (!submission) {
      return res.status(404).json({ error: '提交记录不存在' });
    }

    const settings = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`).all();
    const config = {};
    settings.forEach(s => config[s.key] = s.value);

    let aiScore, aiFeedback;

    if (config.ai_api_key && config.ai_base_url && config.ai_model) {
      try {
        const prompt = `请批改以下学生作业：
作业标题：${submission.title || '无标题'}
题目：${submission.questions}
学生答案：${submission.answers}

请以 JSON 格式返回，格式如下：
{
  "score": 分数(0-100),
  "feedback": "总体评价",
  "suggestions": ["建议1", "建议2"]
}`;

        const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
          model: config.ai_model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: "json_object" }
        }, {
          headers: {
            'Authorization': `Bearer ${config.ai_api_key}`,
            'Content-Type': 'application/json'
          }
        });

        const aiContent = response.data.choices[0].message.content;
        const result = JSON.parse(aiContent);
        aiScore = Math.max(0, Math.min(100, result.score || 0));
        aiFeedback = {
          comments: result.feedback || 'AI 批改完成',
          suggestions: result.suggestions || ['继续加油']
        };
      } catch (aiError) {
        console.log('AI 批改失败，使用随机评分:', aiError.message);
        aiScore = Math.random() * 100;
        aiFeedback = {
          comments: 'AI 批改示例',
          suggestions: ['继续加油', '注意细节']
        };
      }
    } else {
      aiScore = Math.random() * 100;
      aiFeedback = {
        comments: 'AI 批改示例',
        suggestions: ['继续加油', '注意细节']
      };
    }

    const goldReward = Math.floor((aiScore / 100) * (submission.max_exp || 100));

    // 随机掉落物品 - 分数越高掉落概率越大
    let droppedItem = null;
    const dropChance = aiScore / 100;
    if (Math.random() < dropChance) {
      // 随机选择一个物品
      const items = db.prepare('SELECT * FROM items WHERE rarity IN (?, ?, ?) ORDER BY RANDOM() LIMIT 1').all('common', 'rare', 'epic');
      if (items.length > 0) {
        droppedItem = items[0];
        // 检查用户是否已有该物品
        const existing = db.prepare('SELECT id, quantity FROM user_items WHERE user_id = ? AND item_id = ?').get(submission.user_id, droppedItem.id);
        if (existing) {
          db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE id = ?').run(existing.id);
        } else {
          db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, 1)').run(submission.user_id, droppedItem.id);
        }
      }
    }

    // 更新批改状态
    db.prepare(`
      UPDATE submissions
      SET status = 'graded', ai_score = ?, ai_feedback = ?, exp_reward = 0, graded_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(aiScore, JSON.stringify(aiFeedback), submissionId);

    // 给用户增加金币（作业只有金币奖励）
    db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(goldReward, submission.user_id);

    // 检查宠物升级（通过其他方式获取经验，这里不再通过作业）
    const updatedPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(submission.user_id);
    const levelUp = checkLevelUp(updatedPet);

    res.json({
      message: '批改完成',
      score: aiScore,
      goldReward,
      droppedItem,
      feedback: aiFeedback,
      levelUp: null
    });
  } catch (error) {
    console.error('批改作业错误:', error);
    res.status(500).json({ error: '批改作业失败' });
  }
});

module.exports = router;
