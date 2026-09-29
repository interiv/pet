const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { checkLevelUp } = require('./pets');
const { updateTaskProgress } = require('./daily-tasks');
const { checkAndAwardAchievement } = require('./achievements');
const { getChinaDate } = require('../config/timezone');
const { getPrompt, fillTemplate } = require('../config/prompts');
const { isAnswerCorrect } = require('../utils/answerCheck');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

try {
  const duplicateGroups = db.prepare(`
    SELECT variant_group_id, COUNT(DISTINCT subject || type) as group_count
    FROM question_bank
    WHERE variant_group_id IS NOT NULL
    GROUP BY variant_group_id
    HAVING group_count > 1
  `).all();
  
  if (duplicateGroups.length > 0) {
    const maxGroupId = db.prepare('SELECT MAX(variant_group_id) as max_id FROM question_bank').get();
    let nextGroupId = (maxGroupId?.max_id || 0) + 1;
    
    for (const dg of duplicateGroups) {
      const questionsInGroup = db.prepare(`
        SELECT id, subject, type FROM question_bank WHERE variant_group_id = ?
      `).all(dg.variant_group_id);
      
      const subjectTypeMap = {};
      for (const q of questionsInGroup) {
        const key = `${q.subject}_${q.type}`;
        if (!subjectTypeMap[key]) subjectTypeMap[key] = [];
        subjectTypeMap[key].push(q.id);
      }
      
      const keys = Object.keys(subjectTypeMap);
      for (let i = 1; i < keys.length; i++) {
        const ids = subjectTypeMap[keys[i]];
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`UPDATE question_bank SET variant_group_id = ? WHERE id IN (${placeholders})`).run(nextGroupId, ...ids);
        nextGroupId++;
      }
    }
    console.log(`已修复 ${duplicateGroups.length} 个重复的 variant_group_id`);
  }
} catch (e) {
  console.log('variant_group_id 修复检查跳过:', e.message);
}
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
  // fallback 到环境变量（数据库未配置时使用）
  if (!config.ai_api_key && process.env.AI_API_KEY) config.ai_api_key = process.env.AI_API_KEY;
  if (!config.ai_base_url && process.env.AI_BASE_URL) config.ai_base_url = process.env.AI_BASE_URL;
  if (!config.ai_model && process.env.AI_MODEL) config.ai_model = process.env.AI_MODEL;
  return config;
}

function isObjectiveType(type) {
  return ['choice_single', 'choice_multi', 'judgment', 'fill_blank'].includes(type);
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

function getSystemSetting(key, defaultVal) {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    return row ? parseInt(row.value) : defaultVal;
  } catch {
    return defaultVal;
  }
}

/**
 * 金币奖励统一算法：基础分 + 连对 Combo + 全对奖励。
 *
 * 提交作业（POST /:id/submit）与教师改答案后的重算（PATCH /questions/:id）
 * 必须共用这一套公式——原先两处各自实现且重算处漏掉了 Combo / 满分奖励，
 * 导致老师一改答案，学生的金币就被倒扣。
 *
 * @param {number} totalScore   百分制总分 0-100
 * @param {number} questionCount 作业题目总数
 * @param {Array<{is_correct:boolean}>} results 逐题结果（按题目顺序）
 * @param {number} maxExp       作业金币上限
 */
function calcGoldReward(totalScore, questionCount, results, maxExp) {
  const list = Array.isArray(results) ? results : [];
  const base = Math.floor((totalScore / 100) * (maxExp || 30));

  let bestStreak = 0;
  let streak = 0;
  for (const r of list) {
    if (r.is_correct) {
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
  }

  let combo = 0;
  if (bestStreak >= 10) combo = 20;
  else if (bestStreak >= 5) combo = 10;
  else if (bestStreak >= 3) combo = 5;

  const correctCount = list.filter(r => r.is_correct).length;
  const perfect = (questionCount >= 3 && correctCount === questionCount) ? 15 : 0;

  return { gold: base + combo + perfect, base, combo, perfect, bestStreak, correctCount };
}

router.post('/generate', authenticateToken, authorizeRole('teacher', 'admin'), async (req, res) => {
  try {
    // token_usage 表由 004 号迁移创建，不再在请求时动态建表
    const { subject, topic, difficulty = 'medium', question_type, count = 10, grade_level = '', mode = 'topic', requirements = '', raw_text = '' } = req.body;
    
    console.log('\n========== AI 生成作业请求 ==========');
    console.log('📥 请求参数:', JSON.stringify({ mode, subject, topic, difficulty, question_type, count, grade_level, requirements_len: String(requirements || '').length, raw_text_len: String(raw_text || '').length }, null, 2));
    console.log('👤 用户ID:', req.user.userId, '| 角色:', req.user.role);
    
    // 生成模式：topic=按知识点主题(原有) | requirements=按教师详细要求 | paste=粘贴题目AI整理
    const genMode = ['topic', 'requirements', 'paste'].includes(mode) ? mode : 'topic';
    const isPasteMode = genMode === 'paste';
    const isRequirementsMode = genMode === 'requirements';
    const noVariants = isPasteMode || !isObjectiveType(question_type);

    if (!subject || !question_type) {
      console.log('❌ 参数验证失败');
      return res.status(400).json({ error: '请填写科目和题型' });
    }
    if (genMode === 'topic' && !topic) {
      return res.status(400).json({ error: '请填写知识点主题' });
    }
    if (isRequirementsMode && !String(requirements || '').trim()) {
      return res.status(400).json({ error: '请填写详细的作业要求' });
    }
    if (isPasteMode && !String(raw_text || '').trim()) {
      return res.status(400).json({ error: '请粘贴题目内容' });
    }

    const maxQuestionsPerGen = getSystemSetting('max_questions_per_generation', 20);
    if (count > maxQuestionsPerGen) {
      return res.status(400).json({ error: `单次最多生成 ${maxQuestionsPerGen} 道题目` });
    }

    const { getChinaDate } = require('../config/timezone');
    const today = getChinaDate();

    const dailyTeacherLimit = getSystemSetting('daily_teacher_gen_limit', 5);
    const todayTeacherCount = db.prepare(`SELECT COUNT(*) as count FROM token_usage WHERE user_id = ? AND date = ?`).get(req.user.userId, today)?.count || 0;
    if (todayTeacherCount >= dailyTeacherLimit) {
      return res.status(429).json({ error: `今日生成次数已达上限（${dailyTeacherLimit}次），请明日0点后再试` });
    }

    const dailyGlobalTokenLimit = getSystemSetting('daily_global_token_limit', 2000000);
    const todayGlobalTokens = db.prepare(`SELECT COALESCE(SUM(completion_tokens), 0) as total FROM token_usage WHERE date = ?`).get(today)?.total || 0;
    if (todayGlobalTokens >= dailyGlobalTokenLimit) {
      return res.status(429).json({ error: '今日网站Token用量已达上限，请联系管理员或明日再试' });
    }

    const config = getAIConfig();
    if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
      console.log('❌ AI 配置未完成');
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }

    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;

    console.log('🔧 AI 配置:', {
      base_url: config.ai_base_url,
      model: config.ai_model,
      api_key: config.ai_api_key ? `${config.ai_api_key.slice(0, 8)}...${config.ai_api_key.slice(-4)}` : '未配置',
      timeout: timeoutMs / 1000 + '秒'
    });

    const typeLabel = typeLabels[question_type] || question_type;
    const actualCount = count * 3;

    const effectiveTopic = topic || (isRequirementsMode ? String(requirements).trim().slice(0, 30) : `${subject}${typeLabel}练习`);

    const taskDesc = fillTemplate(
      getPrompt(isRequirementsMode ? 'gen_task_requirements' : 'gen_task_topic'),
      { grade_level, effectiveTopic, subject, typeLabel, difficulty, requirements }
    );

    let prompt = '';
    if (isPasteMode) {
      let formatSample = '';
      let typeRules = '';
      if (question_type === 'choice_single') {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目内容","options":["选项A内容","选项B内容","选项C内容","选项D内容"],"answer":"A","explanation":"详细解析","analysis":"解题步骤/思路","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer为单个正确选项字母（如"A"）；若原题缺少选项，请根据题意补全A/B/C/D四个选项；若选项数量不足四个，保持原有选项数量即可';
      } else if (question_type === 'choice_multi') {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目内容","options":["选项A内容","选项B内容","选项C内容","选项D内容"],"answer":["A","C"],"explanation":"详细解析","analysis":"解题步骤","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer必须是由正确选项字母组成的数组（如["A","C"]）；若原题缺少选项，请根据题意补全选项';
      } else if (question_type === 'judgment') {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"判断题陈述内容","answer":true,"explanation":"为什么对或错的解析","analysis":"判断依据","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer必须是布尔值true或false，判断题不需要options字段';
      } else {
        formatSample = `{"topic":"整理后的主题(8-20字)","title":"建议的作业标题","description":"建议的作业描述","questions":[{"content":"题目要求","answer":"参考答案要点","explanation":"评分标准和解析","analysis":"答题思路指导","knowledge_point":"细粒度知识点"}]}`;
        typeRules = 'answer为参考答案要点，主观题不需要options字段';
      }
      const pasteVars = { subject, typeLabel, question_type, raw_text, formatSample, typeRules };
      const pasteKey = question_type === 'choice_single' ? 'gen_paste_choice_single'
        : question_type === 'choice_multi' ? 'gen_paste_choice_multi'
        : question_type === 'judgment' ? 'gen_paste_judgment'
        : 'gen_paste_essay';
      prompt = fillTemplate(getPrompt(pasteKey), pasteVars);
    } else if (question_type === 'choice_single') {
      prompt = fillTemplate(getPrompt('gen_choice_single'), { taskDesc, actualCount, count });
    } else if (question_type === 'choice_multi') {
      prompt = fillTemplate(getPrompt('gen_choice_multi'), { taskDesc, actualCount, count });
    } else if (question_type === 'judgment') {
      prompt = fillTemplate(getPrompt('gen_judgment'), { taskDesc, actualCount, count });
    } else if (question_type === 'essay') {
      prompt = fillTemplate(getPrompt('gen_essay'), { taskDesc, count });
    }

    console.log('\n📤 发送请求到 LLM 服务器...');
    console.log('🎯 目标地址:', `${config.ai_base_url}/chat/completions`);
    console.log('🤖 使用模型:', config.ai_model);
    console.log('📝 Prompt 长度:', prompt.length, '字符');
    console.log('⏱️ 超时设置:', timeoutMs / 1000, '秒');
    
    const maxTokensPerGen = getSystemSetting('max_tokens_per_generation', 18000);

    const startTime = Date.now();
    const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
      model: config.ai_model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokensPerGen
    }, {
      headers: {
        'Authorization': `Bearer ${config.ai_api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const usageData = response.data.usage || {};
    const promptTokens = usageData.prompt_tokens || 0;
    const completionTokens = usageData.completion_tokens || 0;
    const totalTokens = usageData.total_tokens || 0;

    try {
      db.prepare(`
        INSERT INTO token_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, model, subject, topic, question_type, question_count, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.user.userId, today, promptTokens, completionTokens, totalTokens, config.ai_model, subject, effectiveTopic, question_type, count, Date.now() - startTime);
    } catch (logErr) {
      console.error('⚠️ Token使用记录写入失败:', logErr.message);
    }

    if (completionTokens > 0) {
      const updatedGlobalTokens = db.prepare(`SELECT COALESCE(SUM(completion_tokens), 0) as total FROM token_usage WHERE date = ?`).get(today)?.total || 0;
      if (updatedGlobalTokens > dailyGlobalTokenLimit) {
        console.log('⚠️ 生成完成后，全局Token已超限，本次结果仍返回，但后续生成将被阻止');
      }
    }

    console.log('\n✅ LLM 服务器响应成功');
    console.log('⏱️ 耗时:', elapsed, '秒');
    console.log('📊 HTTP 状态码:', response.status);
    console.log('📦 响应数据大小:', JSON.stringify(response.data).length, '字节');
    console.log('📊 Token 使用: prompt=' + promptTokens + ', completion=' + completionTokens + ', total=' + totalTokens);

    const aiContent = response.data.choices[0].message.content;
    console.log('\n📄 AI 返回内容预览 (前500字符):');
    console.log(aiContent.slice(0, 500));
    console.log('📄 AI 返回内容总长度:', aiContent.length, '字符');
    let parsed;
    try {
      // 尝试直接解析
      parsed = JSON.parse(aiContent);
      console.log('✅ JSON 解析成功（直接解析）');
    } catch (e) {
      // 尝试提取JSON对象（支持嵌套大括号）
      console.log('⚠️ 直接解析失败，尝试提取JSON对象...');
      const jsonMatch = aiContent.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
          console.log('✅ JSON 解析成功（从文本中提取）');
        } catch (e2) {
          console.log('❌ JSON 解析失败');
          throw new Error('AI返回的JSON格式无效');
        }
      } else {
        console.log('❌ 未找到有效的JSON');
        throw new Error('AI返回格式错误，未找到有效的JSON');
      }
    }

    const questions = parsed.questions || [];
    console.log('\n📊 解析结果:');
    console.log('  - 题目数量:', questions.length);
    if (questions.length > 0) {
      console.log('  - 第一题预览:', questions[0].content?.slice(0, 50) + '...');
      console.log('  - 知识点分布:', [...new Set(questions.map(q => q.knowledge_point))].slice(0, 5).join(', '));
    }
    
    if (questions.length === 0) {
      console.log('❌ AI未能生成有效题目');
      return res.status(500).json({ error: 'AI未能生成有效题目，请调整提示词后重试' });
    }

    const maxGroupId = db.prepare('SELECT MAX(variant_group_id) as max_id FROM question_bank').get();
    let variantGroupId = (maxGroupId?.max_id || 0) + 1;
    const processedQuestions = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qIndex = noVariants ? i : Math.floor(i / 3);
      
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
        topic: effectiveTopic,
        difficulty,
        type: question_type,
        content: q.content,
        options: q.options ? JSON.stringify(q.options) : null,
        answer: answerStr,
        explanation: q.explanation || '',
        analysis: q.analysis || '',
        hint: q.hint || '',
        knowledge_point: (q.knowledge_point && String(q.knowledge_point).trim()) || effectiveTopic,
        variant_group_id: noVariants ? null : variantGroupId,
        variant_index: noVariants ? 0 : (i % 3),
        source: 'ai',
        created_by: req.user.userId
      });

      if (!noVariants && (i + 1) % 3 === 0) {
        variantGroupId++;
      }
    }

    const insertQ = db.prepare(`
      INSERT INTO question_bank (subject, topic, difficulty, type, content, options, answer, explanation, analysis, hint, knowledge_point, variant_group_id, variant_index, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    console.log('\n💾 正在将题目保存到数据库...');
    const transaction = db.transaction((qs) => {
      const ids = [];
      for (const q of qs) {
        const result = insertQ.run(
          q.subject, q.topic, q.difficulty, q.type, q.content,
          q.options, q.answer, q.explanation, q.analysis, q.hint,
          q.knowledge_point,
          q.variant_group_id, q.variant_index, q.source, q.created_by
        );
        ids.push(result.lastInsertRowid);
      }
      return ids;
    });

    const insertedIds = transaction(processedQuestions);
    console.log('✅ 数据库写入成功，共', insertedIds.length, '条记录');

    const displayQuestions = noVariants
      ? insertedIds.map((id, idx) => ({
          tempId: id,
          content: questions[idx].content,
          options: questions[idx].options ? (typeof questions[idx].options === 'string' ? JSON.parse(questions[idx].options) : questions[idx].options) : null,
          answer: questions[idx].answer !== undefined ? (Array.isArray(questions[idx].answer) ? questions[idx].answer.join(',') : String(questions[idx].answer)) : '',
          explanation: questions[idx].explanation || '',
          type: question_type,
          knowledge_point: processedQuestions[idx]?.knowledge_point || effectiveTopic,
          hasVariants: false
        }))
      : [];

    if (!noVariants) {
      for (let g = 0; g < count; g++) {
        const baseIdx = g * 3;
        const variants = [];
        for (let v = 1; v <= 2; v++) {
          const vIdx = baseIdx + v;
          if (vIdx < questions.length) {
            variants.push({
              tempId: insertedIds[vIdx],
              content: questions[vIdx].content,
              options: questions[vIdx].options ? (typeof questions[vIdx].options === 'string' ? JSON.parse(questions[vIdx].options) : questions[vIdx].options) : null,
              answer: questions[vIdx].answer !== undefined ? (Array.isArray(questions[vIdx].answer) ? questions[vIdx].answer.join(',') : String(questions[vIdx].answer)) : '',
              explanation: questions[vIdx].explanation || '',
              type: question_type,
              knowledge_point: processedQuestions[vIdx]?.knowledge_point || effectiveTopic
            });
          }
        }
        displayQuestions.push({
          tempId: insertedIds[baseIdx],
          variantIds: [insertedIds[baseIdx], insertedIds[baseIdx + 1], insertedIds[baseIdx + 2]],
          content: questions[baseIdx].content,
          options: questions[baseIdx].options ? (typeof questions[baseIdx].options === 'string' ? JSON.parse(questions[baseIdx].options) : questions[baseIdx].options) : null,
          answer: questions[baseIdx].answer !== undefined ? (Array.isArray(questions[baseIdx].answer) ? questions[baseIdx].answer.join(',') : String(questions[baseIdx].answer)) : '',
          explanation: questions[baseIdx].explanation || '',
          type: question_type,
          knowledge_point: processedQuestions[baseIdx]?.knowledge_point || effectiveTopic,
          hasVariants: true,
          variants
        });
      }
    }

    console.log('\n📤 返回结果给客户端...');
    console.log('========================================\n');
    
    const resultCount = isPasteMode ? questions.length : count;
    res.json({
      message: '生成成功',
      title: parsed.title || `${effectiveTopic} - ${typeLabel}练习`,
      description: parsed.description || `共${resultCount}道${effectiveTopic}相关${typeLabel}`,
      subject,
      question_type,
      question_count: resultCount,
      total_generated: insertedIds.length,
      questions: displayQuestions,
      allQuestionIds: insertedIds
    });

  } catch (error) {
    console.error('\n❌ AI 生成作业错误:', error.message);
    if (error.response) {
      console.error('📡 LLM 服务器响应状态:', error.response.status);
      console.error('📡 LLM 服务器响应数据:', JSON.stringify(error.response.data, null, 2));
    } else if (error.code === 'ECONNABORTED') {
      console.error('⏱️ 请求超时');
      return res.status(500).json({ error: 'AI请求超时，请稍后重试' });
    } else if (error.code === 'ECONNREFUSED') {
      console.error('🚫 无法连接到 LLM 服务器');
      return res.status(500).json({ error: '无法连接到 AI 服务器，请检查配置' });
    }
    console.error('========================================\n');
    res.status(500).json({ error: 'AI 生成作业失败: ' + (error.message || '未知错误') });
  }
});

// 更新题目（教师/管理员预览阶段调整）
router.patch('/questions/:id', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const qid = parseInt(req.params.id);
    const existing = db.prepare('SELECT id, variant_group_id, type, answer as old_answer FROM question_bank WHERE id = ?').get(qid);
    if (!existing) return res.status(404).json({ error: '题目不存在' });

    if (req.user.role === 'teacher') {
      // 必须遍历全部引用该题的作业：原先只取第一条匹配记录，只要有一条属于自己就放行，存在越权编辑他人题目
      const assignmentQs = db.prepare('SELECT a.teacher_id FROM assignment_questions aq JOIN assignments a ON aq.assignment_id = a.id WHERE aq.question_bank_id = ?').all(qid);
      if (assignmentQs.some(row => row.teacher_id !== req.user.userId)) {
        return res.status(403).json({ error: '只能编辑自己发布的作业题目' });
      }
    }

    const { content, options, answer, explanation, analysis, knowledge_point, difficulty, hint, sync_group } = req.body;
    const fields = [];
    const values = [];
    if (content !== undefined) { fields.push('content = ?'); values.push(content); }
    if (options !== undefined) { fields.push('options = ?'); values.push(options ? JSON.stringify(options) : null); }
    let newAnswerStr = null;
    if (answer !== undefined) {
      newAnswerStr = Array.isArray(answer) ? answer.join(',') : typeof answer === 'boolean' ? (answer ? 'true' : 'false') : String(answer);
      fields.push('answer = ?'); values.push(newAnswerStr);
    }
    if (explanation !== undefined) { fields.push('explanation = ?'); values.push(explanation); }
    if (analysis !== undefined) { fields.push('analysis = ?'); values.push(analysis); }
    if (knowledge_point !== undefined) { fields.push('knowledge_point = ?'); values.push(knowledge_point); }
    if (difficulty !== undefined) { fields.push('difficulty = ?'); values.push(difficulty); }
    if (hint !== undefined) { fields.push('hint = ?'); values.push(hint); }
    if (fields.length === 0) return res.json({ message: '无更新' });

    values.push(qid);
    db.prepare(`UPDATE question_bank SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // 同步同一变体组内的知识点与难度（避免学生重做时版本不一致）
    if (sync_group && existing.variant_group_id && (knowledge_point !== undefined || difficulty !== undefined)) {
      const groupFields = [];
      const groupValues = [];
      if (knowledge_point !== undefined) { groupFields.push('knowledge_point = ?'); groupValues.push(knowledge_point); }
      if (difficulty !== undefined) { groupFields.push('difficulty = ?'); groupValues.push(difficulty); }
      groupValues.push(existing.variant_group_id);
      db.prepare(`UPDATE question_bank SET ${groupFields.join(', ')} WHERE variant_group_id = ?`).run(...groupValues);
    }

    // 答案变更时，自动重算所有作答记录、错题本、提交分数，并通知受影响学生
    if (newAnswerStr !== null && newAnswerStr !== existing.old_answer) {
      const affectedAnswers = db.prepare(`
        SELECT qa.id, qa.submission_id, qa.student_answer, qa.is_correct, qa.score, qa.max_score,
               s.user_id, s.assignment_id, s.id as sub_id
        FROM question_answers qa
        JOIN submissions s ON qa.submission_id = s.id
        WHERE qa.question_bank_id = ?
      `).all(qid);

      const updatedQuestion = db.prepare('SELECT type, answer FROM question_bank WHERE id = ?').get(qid);
      const notifiedUsers = new Set();

      for (const qa of affectedAnswers) {
        const ua = qa.student_answer;
        // 主观题无法自动重判，跳过；客观题走统一判分口径
        if (!['choice_single', 'choice_multi', 'judgment', 'fill_blank'].includes(updatedQuestion.type)) {
          continue;
        }
        const newCorrect = isAnswerCorrect(updatedQuestion.type, ua, updatedQuestion.answer);

        const wasCorrect = qa.is_correct === 1;
        if (wasCorrect === newCorrect) continue;

        const newScore = newCorrect ? qa.max_score : 0;
        db.prepare('UPDATE question_answers SET is_correct = ?, score = ? WHERE id = ?')
          .run(newCorrect ? 1 : 0, newScore, qa.id);

        // 更新错题本
        if (wasCorrect && !newCorrect) {
          db.prepare(`
            INSERT OR IGNORE INTO wrong_questions (user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed, wrong_count)
            VALUES (?, ?, ?, ?, ?, '', 0, 1)
          `).run(qa.user_id, qa.assignment_id, qid, ua, updatedQuestion.answer);
        } else if (!wasCorrect && newCorrect) {
          db.prepare('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?')
            .run(qa.user_id, qid);
        }

        // 重新计算该提交的总分
        // 同一题可能存在多轮重做记录，只取每题最近一次作答，避免重复计分
        const attemptRows = db.prepare(
          'SELECT id, question_bank_id, attempt_number, score, max_score, is_correct FROM question_answers WHERE submission_id = ? ORDER BY attempt_number ASC'
        ).all(qa.submission_id);
        const latestByQ = new Map();
        for (const r of attemptRows) latestByQ.set(r.question_bank_id, r);
        const allQA = [...latestByQ.values()];

        const rawScore = allQA.reduce((sum, a) => sum + (a.score || 0), 0);
        const maxTotal = allQA.reduce((sum, a) => sum + (a.max_score || 0), 0);
        // 用真实满分归一化到百分制；maxTotal 为 0（异常数据）时退回 0 分，避免除零得到 NaN
        const totalScore = maxTotal > 0 ? Math.round((rawScore / maxTotal) * 100) : 0;

        const assignmentInfo = db.prepare('SELECT max_exp FROM assignments WHERE id = ?').get(qa.assignment_id);
        const maxExp = assignmentInfo?.max_exp || 30;
        const assignmentQuestionCount = db.prepare('SELECT COUNT(*) as c FROM assignment_questions WHERE assignment_id = ?').get(qa.assignment_id)?.c || allQA.length;
        // 与提交时共用同一套公式，保证 Combo / 满分奖励不会被算丢
        const newGoldReward = calcGoldReward(
          totalScore,
          assignmentQuestionCount,
          allQA.map(a => ({ is_correct: a.is_correct === 1 })),
          maxExp
        ).gold;
        const oldGold = db.prepare('SELECT gold_reward FROM submissions WHERE id = ?').get(qa.submission_id)?.gold_reward || 0;
        const goldDiff = newGoldReward - oldGold;

        db.prepare('UPDATE submissions SET total_score = ?, gold_reward = ? WHERE id = ?')
          .run(totalScore, newGoldReward, qa.submission_id);

        if (goldDiff > 0) {
          db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?')
            .run(goldDiff, goldDiff, qa.user_id);
        } else if (goldDiff < 0) {
          const loss = -goldDiff;
          db.prepare('UPDATE users SET gold = MAX(0, gold - ?), total_gold_earned = MAX(0, total_gold_earned - ?) WHERE id = ?')
            .run(loss, loss, qa.user_id);
        }

        // 通知受影响的学生
        if (!notifiedUsers.has(qa.user_id)) {
          notifiedUsers.add(qa.user_id);
          const direction = wasCorrect && !newCorrect ? '变更为错误' : '变更为正确';
          const assignmentTitle = db.prepare('SELECT title FROM assignments WHERE id = ?').get(qa.assignment_id)?.title || '作业';
          db.prepare(`
            INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
            VALUES (?, 'answer_changed', '题目答案已更正', ?, 'assignment', ?)
          `).run(qa.user_id, `「${assignmentTitle}」中有一道题目的标准答案被老师修改，你的作答结果${direction}，请查看最新成绩`, qa.assignment_id);
        }
      }
    }

    const updated = db.prepare('SELECT * FROM question_bank WHERE id = ?').get(qid);
    if (updated.options) { try { updated.options = JSON.parse(updated.options); } catch(e) {} }
    res.json({ message: '更新成功', question: updated });
  } catch (error) {
    console.error('更新题目错误:', error);
    res.status(500).json({ error: '更新题目失败: ' + error.message });
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

    // 校验：非管理员教师仅能为所属班级创建作业
    if (targetClassId && req.user.role !== 'admin') {
      const belongs = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(req.user.userId, targetClassId);
      if (!belongs) {
        return res.status(403).json({ error: '无权为该班级创建作业' });
      }
    }
    if (!targetClassId) {
      return res.status(400).json({ error: '请选择作业所属班级' });
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
    const { class_id, subject, date_from, date_to } = req.query;

    if (req.user.role === 'admin') {
      let sql = `
        SELECT a.*, COALESCE(u.real_name, u.username) as teacher_name, c.name as class_name,
          (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count,
          (SELECT COUNT(*) FROM users WHERE class_id = a.class_id AND role = 'student' AND status = 'active') as class_student_count,
          (SELECT COUNT(DISTINCT user_id) FROM submissions WHERE assignment_id = a.id) as submitted_count
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classes c ON a.class_id = c.id
        WHERE 1=1
      `;
      const params = [];
      if (class_id) { sql += ` AND a.class_id = ?`; params.push(class_id); }
      if (subject) { sql += ` AND a.subject = ?`; params.push(subject); }
      if (date_from) { sql += ` AND a.created_at >= ?`; params.push(date_from); }
      if (date_to) { sql += ` AND a.created_at <= ?`; params.push(date_to + ' 23:59:59'); }
      sql += ` ORDER BY a.created_at DESC`;
      assignments = db.prepare(sql).all(...params);
    } else if (req.user.role === 'teacher') {
      const teacherClasses = db.prepare(`SELECT class_id, role FROM class_teachers WHERE teacher_id = ?`).all(req.user.userId);
      const headTeacherClassIds = teacherClasses.filter(tc => tc.role === 'head_teacher').map(tc => tc.class_id);
      const allClassIds = teacherClasses.map(tc => tc.class_id);
      if (allClassIds.length === 0) return res.json({ assignments: [] });

      let sql = `
        SELECT a.*, COALESCE(u.real_name, u.username) as teacher_name, c.name as class_name,
          (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count,
          (SELECT COUNT(*) FROM users WHERE class_id = a.class_id AND role = 'student' AND status = 'active') as class_student_count,
          (SELECT COUNT(DISTINCT user_id) FROM submissions WHERE assignment_id = a.id) as submitted_count
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classes c ON a.class_id = c.id
        WHERE a.status != 'cancelled'
      `;
      const params = [];

      if (class_id) {
        sql += ` AND a.class_id = ?`;
        params.push(class_id);
        if (!headTeacherClassIds.includes(parseInt(class_id))) {
          sql += ` AND a.teacher_id = ?`;
          params.push(req.user.userId);
        }
      } else {
        const headPlaceholders = headTeacherClassIds.map(() => '?').join(',');
        const allPlaceholders = allClassIds.map(() => '?').join(',');
        sql += ` AND ((a.class_id IN (${headPlaceholders})) OR (a.class_id IN (${allPlaceholders}) AND a.teacher_id = ?))`;
        params.push(...headTeacherClassIds, ...allClassIds, req.user.userId);
      }

      if (subject) { sql += ` AND a.subject = ?`; params.push(subject); }
      if (date_from) { sql += ` AND a.created_at >= ?`; params.push(date_from); }
      if (date_to) { sql += ` AND a.created_at <= ?`; params.push(date_to + ' 23:59:59'); }
      sql += ` ORDER BY a.created_at DESC`;
      assignments = db.prepare(sql).all(...params);
    } else {
      const student = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
      if (!student || !student.class_id) return res.json({ assignments: [] });

      assignments = db.prepare(`
        SELECT a.*, COALESCE(u.real_name, u.username) as teacher_name, c.name as class_name,
          (SELECT COUNT(*) FROM assignment_questions WHERE assignment_id = a.id) as question_count,
          (SELECT id FROM submissions WHERE assignment_id = a.id AND user_id = ? LIMIT 1) as my_submission_id,
          (SELECT status FROM submissions WHERE assignment_id = a.id AND user_id = ? ORDER BY id DESC LIMIT 1) as my_submission_status,
          (SELECT MAX(total_score) FROM submissions WHERE assignment_id = a.id AND user_id = ?) as my_score,
          (SELECT SUM(gold_reward) FROM submissions WHERE assignment_id = a.id AND user_id = ?) as my_gold_reward
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classes c ON a.class_id = c.id
        WHERE a.class_id = ? AND a.status != 'cancelled'
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
      SELECT a.*, COALESCE(u.real_name, u.username) as teacher_name, c.name as class_name
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
             aq.sort_order, qb.variant_group_id, qb.difficulty, qb.knowledge_point, qb.subject, qb.topic
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

    if (!isStudent) {
      for (const q of questions) {
        if (q.variant_group_id) {
          const variants = db.prepare(`
            SELECT id, type, content, options, answer, explanation, analysis, variant_index, difficulty, knowledge_point
            FROM question_bank
            WHERE variant_group_id = ? AND variant_index > 0
            ORDER BY variant_index
          `).all(q.variant_group_id);
          for (const v of variants) {
            if (v.options) {
              try { v.options = JSON.parse(v.options); } catch(e) {}
            }
          }
          q.variants = variants;
        } else {
          q.variants = [];
        }
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

router.get('/:id/retry-questions', authenticateToken, (req, res) => {
  try {
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const submission = db.prepare('SELECT id, status, attempt_count FROM submissions WHERE assignment_id = ? AND user_id = ?')
      .get(req.params.id, req.user.userId);
    if (!submission || submission.status !== 'retry_available') {
      return res.status(400).json({ error: '当前无法重做错题' });
    }

    const wrongAnswers = db.prepare(`
      SELECT COALESCE(qb.variant_group_id, -qb.id) as group_key, qb.variant_group_id, MAX(qa.question_bank_id) as question_bank_id
      FROM question_answers qa
      JOIN question_bank qb ON qa.question_bank_id = qb.id
      WHERE qa.submission_id = ? AND qa.is_correct = 0
      GROUP BY group_key
    `).all(submission.id);

    const retryQuestions = [];
    for (const wa of wrongAnswers) {
      if (wa.variant_group_id) {
        const variants = db.prepare(`
          SELECT id, type, content, options, answer, explanation, analysis, variant_index, difficulty, knowledge_point, subject, topic
          FROM question_bank WHERE variant_group_id = ? ORDER BY variant_index
        `).all(wa.variant_group_id);

        const attemptedIds = db.prepare(`
          SELECT DISTINCT question_bank_id FROM question_answers WHERE submission_id = ?
        `).all(submission.id).map(r => r.question_bank_id);

        const unusedVariants = variants.filter(v => !attemptedIds.includes(v.id));
        const retryQuestion = unusedVariants.length > 0 ? unusedVariants[0] : variants[0];

        if (retryQuestion) {
          if (retryQuestion.options) {
            try { retryQuestion.options = JSON.parse(retryQuestion.options); } catch(e) {}
          }
          retryQuestion.original_question_id = wa.question_bank_id;
          retryQuestions.push(retryQuestion);
        }
      } else {
        const q = db.prepare(`
          SELECT id, type, content, options, answer, explanation, analysis, difficulty, knowledge_point, subject, topic
          FROM question_bank WHERE id = ?
        `).get(wa.question_bank_id);
        if (q) {
          if (q.options) {
            try { q.options = JSON.parse(q.options); } catch(e) {}
          }
          q.original_question_id = wa.question_bank_id;
          retryQuestions.push(q);
        }
      }
    }

    res.json({ retry_questions: retryQuestions, assignment_id: parseInt(req.params.id) });
  } catch (error) {
    console.error('获取重做错题错误:', error);
    res.status(500).json({ error: '获取重做错题失败' });
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
    if (assignment.status === 'cancelled') return res.status(400).json({ error: '该作业已被取消，无法提交' });
    // 截止时间校验（原先完全没有校验，作业过期后仍可无限提交）
    if (assignment.due_date && new Date() > new Date(assignment.due_date)) {
      return res.status(400).json({ error: '作业已过截止时间，无法提交' });
    }

    const student = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
    if (!student || student.class_id !== assignment.class_id) {
      return res.status(403).json({ error: '无法提交此作业' });
    }

    const existingSubmission = db.prepare('SELECT id, status, attempt_count FROM submissions WHERE assignment_id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (existingSubmission && existingSubmission.status !== 'retry_available') {
      return res.status(400).json({ error: '已经提交过作业' });
    }

    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.options, qb.answer, qb.explanation, qb.analysis, qb.variant_group_id, qb.knowledge_point
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);

    const isObj = isObjectiveType(assignment.question_type);
    const submissionId = existingSubmission ? existingSubmission.id : null;
    const isRetry = !!submissionId;
    // 重做模式专用：待重做的原始题目数、以及「本次作答题目 id → 本作业原始题目 id」的映射
    let retryWrongOriginalCount = 0;
    let originalOfRetry = {};

    if (isObj) {
      const results = [];
      let correctCount = 0;
      let wrongQuestions = [];

      if (isRetry) {
        // ============ 重做合法性校验 ============
        // 原实现只校验 question_id 是正整数，学生可用任意简单题替换错题；
        // 且 totalQuestionCount 取 answers.length，只提交 1 道会的题即可拿满分。
        // 这里白名单收敛为「最近一次作答仍答错的题 + 其变体组内未做过的变体」，并要求全部覆盖。

        const attemptRows = db.prepare(`
          SELECT qa.question_bank_id, qa.attempt_number, qa.is_correct, qb.variant_group_id
          FROM question_answers qa
          JOIN question_bank qb ON qa.question_bank_id = qb.id
          WHERE qa.submission_id = ?
        `).all(submissionId);

        // 同一题可能有多轮作答记录，只取最近一次的结果，避免历史错误作答被反复计入
        const latestByQ = new Map();
        for (const r of attemptRows) {
          const prev = latestByQ.get(r.question_bank_id);
          if (!prev || r.attempt_number > prev.attempt_number) latestByQ.set(r.question_bank_id, r);
        }

        // 本作业题目 id 集合；变体组 → 原始题目 id（用于把变体题折算回作业维度）
        const assignmentQIds = new Set(questions.map(q => q.id));
        const originalByGroup = new Map();
        for (const q of questions) {
          if (q.variant_group_id) originalByGroup.set(q.variant_group_id, q.id);
        }
        const resolveOriginalId = (qid, variantGroupId) =>
          assignmentQIds.has(qid) ? qid : (variantGroupId ? (originalByGroup.get(variantGroupId) || null) : null);

        const wrongOriginalIds = new Set();
        for (const r of latestByQ.values()) {
          if (r.is_correct === 1) continue;
          const oid = resolveOriginalId(r.question_bank_id, r.variant_group_id);
          if (oid != null) wrongOriginalIds.add(oid);
        }
        retryWrongOriginalCount = wrongOriginalIds.size;

        // 允许提交的题目 = 错题本体 + 该错题变体组内尚未作答过的变体
        const attemptedIds = new Set(attemptRows.map(r => r.question_bank_id));
        const allowedIds = new Set();
        const variantsByGroup = new Map();
        for (const oid of wrongOriginalIds) {
          allowedIds.add(oid);
          const grp = questions.find(q => q.id === oid)?.variant_group_id;
          if (!grp) continue;
          if (!variantsByGroup.has(grp)) {
            variantsByGroup.set(grp, db.prepare('SELECT id FROM question_bank WHERE variant_group_id = ?').all(grp));
          }
          for (const v of variantsByGroup.get(grp)) {
            if (!attemptedIds.has(v.id)) allowedIds.add(v.id);
          }
        }

        const submittedIds = [...new Set(answers.map(a => parseInt(a.question_id, 10)).filter(n => Number.isInteger(n)))];
        if (submittedIds.length === 0) {
          return res.status(400).json({ error: '请提交有效的答案' });
        }
        const illegalIds = submittedIds.filter(id => !allowedIds.has(id));
        if (illegalIds.length > 0) {
          return res.status(400).json({ error: '只能重做上次答错的题目' });
        }

        // 必须覆盖全部错题，否则可只挑会做的题提交来刷高分
        const coveredOriginals = new Set();
        for (const id of submittedIds) {
          const row = attemptRows.find(r => r.question_bank_id === id);
          const grp = row ? row.variant_group_id : questions.find(q => q.id === id)?.variant_group_id;
          const oid = resolveOriginalId(id, grp);
          if (oid != null) coveredOriginals.add(oid);
        }
        if ([...wrongOriginalIds].some(oid => !coveredOriginals.has(oid))) {
          return res.status(400).json({ error: '请完成全部错题的重做后再提交' });
        }

        const retryQuestionIds = submittedIds;
        const retryQuestions = db.prepare(`
            SELECT id, type, content, options, answer, explanation, analysis, variant_group_id, knowledge_point
            FROM question_bank WHERE id IN (${retryQuestionIds.map(() => '?').join(',')})
          `).all(...retryQuestionIds);

        const retryQuestionMap = {};
        for (const rq of retryQuestions) {
          retryQuestionMap[rq.id] = rq;
          const oid = resolveOriginalId(rq.id, rq.variant_group_id);
          if (oid != null) originalOfRetry[rq.id] = oid;
        }

        for (const ans of answers) {
          const q = retryQuestionMap[ans.question_id];
          if (!q) continue;

          const userAnswer = ans.answer;
          // 统一判分口径（原先此处不认「正确/错误」等中文答案写法）
          const isCorrect = isAnswerCorrect(q.type, userAnswer, q.answer);

          // 重做分支不在此处累加 correctCount，改在分支结束后统一按「作业全部题目」维度计算
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
              SELECT id, type, content, options, answer, explanation, analysis, variant_index
              FROM question_bank WHERE variant_group_id = ? ORDER BY variant_index
            `).all(q.variant_group_id);

            const attemptedIds = db.prepare(`
              SELECT DISTINCT question_bank_id FROM question_answers WHERE submission_id = ?
            `).all(submissionId).map(r => r.question_bank_id);
            attemptedIds.push(q.id);

            const unusedVariants = variants.filter(v => !attemptedIds.includes(v.id));
            const retryQuestion = unusedVariants.length > 0 ? unusedVariants[0] : variants[0];

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

          if (!isCorrect) {
            let existingWQ = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
              .get(req.user.userId, q.id);
            if (!existingWQ && q.variant_group_id) {
              const siblingIds = db.prepare('SELECT id FROM question_bank WHERE variant_group_id = ?').all(q.variant_group_id).map(r => r.id);
              for (const sid of siblingIds) {
                const sib = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
                  .get(req.user.userId, sid);
                if (sib) { existingWQ = sib; break; }
              }
            }
            if (existingWQ) {
              db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count + 1, wrong_answer = ?, correct_answer = ?, reviewed = 0 WHERE id = ?')
                .run(String(userAnswer), q.answer, existingWQ.id);
            } else {
              db.prepare(`
                INSERT OR IGNORE INTO wrong_questions (user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed, wrong_count)
                VALUES (?, ?, ?, ?, ?, ?, 0, 1)
              `).run(req.user.userId, req.params.id, q.id, String(userAnswer), q.answer, q.analysis);
            }
          } else {
            const idsToDelete = [q.id];
            if (q.variant_group_id) {
              const siblingIds = db.prepare('SELECT id FROM question_bank WHERE variant_group_id = ?').all(q.variant_group_id).map(r => r.id);
              idsToDelete.push(...siblingIds);
            }
            for (const did of idsToDelete) {
              db.prepare('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?')
                .run(req.user.userId, did);
            }
          }
        }
      } else {

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const userAnswer = answers.find(a => a.question_id === q.id)?.answer;
        // 统一判分口径（原先此处不认「正确/错误」等中文答案写法）
        const isCorrect = isAnswerCorrect(q.type, userAnswer, q.answer);

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
            SELECT id, type, content, options, answer, explanation, analysis, variant_index
            FROM question_bank WHERE variant_group_id = ? ORDER BY variant_index
          `).all(q.variant_group_id);

          const unusedVariants = variants.filter(v => v.id !== q.id);
          const retryQuestion = unusedVariants.length > 0 ? unusedVariants[0] : variants[0];

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
      } // end of else (non-retry)

      // 重做分支统一折算回「作业全部题目」维度：
      // 未重做的题（上次已答对）保持正确，重做的题以本次结果为准。
      if (isRetry) {
        const newlyCorrect = new Set();
        for (const r of results) {
          if (r.is_correct && originalOfRetry[r.question_id] != null) {
            newlyCorrect.add(originalOfRetry[r.question_id]);
          }
        }
        correctCount = Math.max(0, questions.length - retryWrongOriginalCount) + newlyCorrect.size;
      }

      // 分母恒为作业题目总数（原先重做时取 answers.length，可只提交 1 道题刷满分）
      const totalQuestionCount = questions.length;
      if (totalQuestionCount === 0) {
        return res.status(400).json({ error: '该作业没有题目，无法提交' });
      }
      const totalScore = Math.round((correctCount / totalQuestionCount) * 100);

      // 改用与「教师改答案重算」共用的统一公式，保证两处口径一致
      const reward = calcGoldReward(totalScore, totalQuestionCount, results, assignment.max_exp);
      const baseGoldReward = reward.base;
      const comboBonus = reward.combo;
      const perfectBonus = reward.perfect;
      const bestStreak = reward.bestStreak;
      const goldReward = reward.gold;
      const comboLabel = comboBonus > 0
        ? (bestStreak >= 10 ? `🔥 ${bestStreak} 连对！额外 +${comboBonus} 金币`
          : bestStreak >= 5 ? `⚡ ${bestStreak} 连对！额外 +${comboBonus} 金币`
            : `✨ ${bestStreak} 连对！额外 +${comboBonus} 金币`)
        : null;
      const hasWrongQuestions = wrongQuestions.length > 0;

      if (!submissionId) {
        const finalStatus = hasWrongQuestions ? 'retry_available' : 'completed';
        const result = db.prepare(`
          INSERT INTO submissions (assignment_id, user_id, answers, status, total_score, total_max_score, gold_reward, attempt_count, review_status)
          VALUES (?, ?, ?, ?, ?, 100, ?, 1, ?)
        `).run(req.params.id, req.user.userId, JSON.stringify(answers), finalStatus, totalScore, goldReward, finalStatus);

        // 发放金币
        if (goldReward > 0) {
          db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?').run(goldReward, goldReward, req.user.userId);
        }

        const newSubId = result.lastInsertRowid;
        const insertQA = db.prepare(`
          INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, is_correct, score, max_score, answered_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        for (const r of results) {
          insertQA.run(newSubId, r.question_id, r.user_answer, r.is_correct ? 1 : 0, r.score, 100 / totalQuestionCount);
        }

        for (const wq of wrongQuestions) {
          const r = results.find(r => r.question_id === wq.original_question_id);
          if (!r) continue;
          const existingWQ = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
            .get(req.user.userId, wq.original_question_id);
          if (existingWQ) {
            db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count + 1, wrong_answer = ?, correct_answer = ?, reviewed = 0 WHERE id = ?')
              .run(r.user_answer || '', r.correct_answer, existingWQ.id);
          } else {
            db.prepare(`
              INSERT OR IGNORE INTO wrong_questions (user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed, wrong_count)
              VALUES (?, ?, ?, ?, ?, ?, 0, 1)
            `).run(req.user.userId, req.params.id, wq.original_question_id, r.user_answer, r.correct_answer, r.analysis);
          }
        }
      } else {
        const retryFinalStatus = wrongQuestions.length > 0 ? 'retry_available' : 'completed';
        // 计算金币差额（本次应得金币 - 上次已得金币）
        const previousGoldReward = db.prepare('SELECT gold_reward FROM submissions WHERE id = ?').get(submissionId)?.gold_reward || 0;
        const goldRewardDiff = goldReward - previousGoldReward;

        db.prepare(`UPDATE submissions SET status = ?, total_score = ?, gold_reward = ?, attempt_count = attempt_count + 1 WHERE id = ?`)
          .run(retryFinalStatus, totalScore, goldReward, submissionId);

        const insertQA = db.prepare(`
          INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, is_correct, score, max_score, answered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        for (const r of results) {
          insertQA.run(submissionId, r.question_id, (existingSubmission?.attempt_count || 0) + 1, r.user_answer, r.is_correct ? 1 : 0, r.score, 100 / totalQuestionCount);
        }

        // 金币差额双向结算（原先只补发不收回，成绩下滑也能白拿金币）
        if (goldRewardDiff > 0) {
          db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?').run(goldRewardDiff, goldRewardDiff, req.user.userId);
        } else if (goldRewardDiff < 0) {
          const loss = -goldRewardDiff;
          db.prepare('UPDATE users SET gold = MAX(0, gold - ?), total_gold_earned = MAX(0, total_gold_earned - ?) WHERE id = ?').run(loss, loss, req.user.userId);
        }
      }

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
        const today = getChinaDate();
        const insertKnowledgePoint = db.prepare(`
          INSERT OR IGNORE INTO knowledge_point_stats (user_id, knowledge_point, date, total_attempts, correct_attempts, accuracy)
          VALUES (?, ?, ?, 1, ?, ?)
        `);
        const updateKnowledgePoint = db.prepare(`
          UPDATE knowledge_point_stats 
          SET total_attempts = total_attempts + 1,
              correct_attempts = correct_attempts + ?,
              accuracy = ROUND(CAST(correct_attempts + ? AS REAL) / (total_attempts + 1) * 100, 2),
              updated_at = CURRENT_TIMESTAMP
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
              updateKnowledgePoint.run(r.is_correct ? 1 : 0, r.is_correct ? 1 : 0, req.user.userId, question.knowledge_point, today);
            } else {
              insertKnowledgePoint.run(req.user.userId, question.knowledge_point, today, r.is_correct ? 1 : 0, r.is_correct ? 100 : 0);
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
        base_gold_reward: baseGoldReward,
        combo_bonus: comboBonus,
        combo_streak: bestStreak,
        combo_label: comboLabel,
        perfect_bonus: perfectBonus,
        correct_count: correctCount,
        total_count: totalQuestionCount,
        wrong_count: totalQuestionCount - correctCount,
        wrong_questions: wrongQuestions,
        can_retry: wrongQuestions.length > 0
      });

      // 成就检查
      try {
        const submitCount = db.prepare('SELECT COUNT(DISTINCT assignment_id) as c FROM submissions WHERE user_id = ?').get(req.user.userId)?.c || 0;
        checkAndAwardAchievement(req.user.userId, 'submit_assignment', submitCount);
        if (totalScore >= 90) {
          const highScoreCount = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE user_id = ? AND total_score >= 90").get(req.user.userId)?.c || 0;
          checkAndAwardAchievement(req.user.userId, 'high_score', highScoreCount);
        }
        if (totalScore === 100) {
          const perfectCount = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE user_id = ? AND total_score = 100").get(req.user.userId)?.c || 0;
          checkAndAwardAchievement(req.user.userId, 'perfect_score', perfectCount);
        }
        // 累计金币成就
        const totalGold = db.prepare('SELECT total_gold_earned FROM users WHERE id = ?').get(req.user.userId)?.total_gold_earned || 0;
        checkAndAwardAchievement(req.user.userId, 'total_gold', totalGold);
      } catch (e) { console.error('成就检查失败:', e); }

      // ✨ 向所在班级广播提交事件（教师端实时接收）
      try {
        const io = req.app.get('io');
        if (io && assignment.class_id) {
          io.to(`class:${assignment.class_id}`).emit('assignment-submitted', {
            class_id: assignment.class_id,
            assignment_id: assignment.id,
            assignment_title: assignment.title,
            user_id: req.user.userId,
            username: req.user.username,
            real_name: req.user.real_name,
            total_score: totalScore,
            correct_count: correctCount,
            total_count: questions.length,
            combo_streak: bestStreak,
            at: new Date().toISOString()
          });
        }
      } catch (e) {
        console.error('Socket 广播提交事件失败:', e);
      }

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
    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
    let totalScore = 0;
    const feedbackList = [];

    if (config.ai_api_key && config.ai_base_url && config.ai_model) {
      for (const qa of questionAnswers) {
        const reviewPrompt = fillTemplate(getPrompt('review_subjective'), {
          subject: submission.subject,
          question_content: qa.question_content,
          reference_answer: qa.reference_answer || '无',
          student_answer: qa.student_answer || '(未提供文字答案)'
        });

        try {
          const resp = await axios.post(`${config.ai_base_url}/chat/completions`, {
            model: config.ai_model,
            messages: [{ role: 'user', content: reviewPrompt }]
          }, {
            headers: { 'Authorization': `Bearer ${config.ai_api_key}`, 'Content-Type': 'application/json' },
            timeout: timeoutMs
          });

          const aiContent = resp.data.choices[0].message.content;
          let aiResult;
          try {
            aiResult = JSON.parse(aiContent);
          } catch (parseErr) {
            // 尝试提取JSON对象
            const jsonMatch = aiContent.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
            if (jsonMatch) {
              aiResult = JSON.parse(jsonMatch[0]);
            } else {
              throw new Error('AI返回格式错误');
            }
          }
          const score = Math.max(0, Math.min(100, aiResult.score || 60));
          totalScore += score;

          // 构建完整的反馈信息
          const feedbackData = {
            score: score,
            feedback: aiResult.feedback || '已评阅',
            key_points: aiResult.key_points || [],
            improvements: aiResult.improvements || []
          };

          db.prepare(`
            UPDATE question_answers SET score = ?, max_score = 100, feedback = ?, reviewed_at = CURRENT_TIMESTAMP, is_correct = ? WHERE id = ?
          `).run(score, JSON.stringify(feedbackData), score >= 60 ? 1 : 0, qa.id);

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

    db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?').run(goldReward, goldReward, userId);

    for (const qa of questionAnswers) {
      const qaRecord = db.prepare('SELECT is_correct, score FROM question_answers WHERE id = ?').get(qa.id);
      if (qaRecord && qaRecord.is_correct === 0) {
        db.prepare(`
          INSERT OR IGNORE INTO wrong_questions (user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(userId, assignmentId, qa.question_bank_id, qa.student_answer, qa.reference_answer || '', qa.analysis || qa.explanation || '');
      }
    }

    console.log(`主观题评阅完成: submission=${submissionId}, score=${avgScore}, gold=${goldReward}`);
  } catch (error) {
    console.error('主观题评阅错误:', error);
    // 兜底给 60 分并补发对应金币（原先只写 submissions.gold_reward，忘了 UPDATE users，
    // 导致评阅异常时学生一分钱都拿不到）
    const fallbackGold = Math.floor(0.6 * (db.prepare('SELECT max_exp FROM assignments WHERE id = ?').get(assignmentId)?.max_exp || 30));
    db.prepare("UPDATE submissions SET review_status = 'completed', total_score = 60, gold_reward = ? WHERE id = ?")
      .run(fallbackGold, submissionId);
    if (fallbackGold > 0) {
      try {
        db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?')
          .run(fallbackGold, fallbackGold, userId);
      } catch (goldErr) { console.error('兜底金币发放失败:', goldErr); }
    }
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
      SELECT qa.*, qb.content as question_content, qb.options, qb.answer as correct_answer, qb.explanation, qb.analysis, qb.type
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
    // 按学生去重：重做会产生多条 submission，直接 COUNT 会让提交人数与完成率超过 100%
    const submittedCount = db.prepare(
      'SELECT COUNT(DISTINCT user_id) as cnt FROM submissions WHERE assignment_id = ?'
    ).get(req.params.id)?.cnt || 0;

    // 本作业的全部提交 ID，用于把题目统计限定在本作业范围内
    const submissionIds = db.prepare('SELECT id FROM submissions WHERE assignment_id = ?')
      .all(req.params.id).map(s => s.id);

    const scoreStats = db.prepare(`
      SELECT AVG(total_score) as avg_score, MAX(total_score) as max_score, MIN(total_score) as min_score
      FROM submissions WHERE assignment_id = ? AND total_score IS NOT NULL
    `).get(req.params.id);

    const questions = db.prepare(`
      SELECT aq.question_bank_id, qb.content, qb.type, qb.answer
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);

    // 题目统计：只统计本作业内的作答，且每题只取该提交内最近一次（重做会留下多轮记录）。
    // 原先按 question_bank_id 统计全库作答，重做记录和其他作业的数据都会混进来。
    const questionStats = questions.map(q => {
      const base = {
        question_id: q.question_bank_id,
        content: String(q.content || '').substring(0, 50),
        type: q.type,
        answer: q.answer,
        total_answers: 0,
        correct_count: 0,
        correct_rate: 0,
        avg_score: 0
      };
      if (submissionIds.length === 0) return base;

      const placeholders = submissionIds.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT submission_id, attempt_number, is_correct, score
        FROM question_answers
        WHERE question_bank_id = ? AND submission_id IN (${placeholders})
      `).all(q.question_bank_id, ...submissionIds);

      const latest = new Map();
      for (const r of rows) {
        const prev = latest.get(r.submission_id);
        if (!prev || r.attempt_number > prev.attempt_number) latest.set(r.submission_id, r);
      }
      const counted = [...latest.values()];
      const totalAns = counted.length;
      if (totalAns === 0) return base;

      const correctAns = counted.filter(r => r.is_correct === 1).length;
      const avgScore = counted.reduce((sum, r) => sum + (r.score || 0), 0) / totalAns;

      return {
        ...base,
        total_answers: totalAns,
        correct_count: correctAns,
        correct_rate: Math.round((correctAns / totalAns) * 100),
        avg_score: Math.round(avgScore * 100) / 100
      };
    });

    // 学生成绩：每个学生只保留最新一次提交（按 id 递增取最后一条）
    const allSubmissions = db.prepare(`
      SELECT s.id as submission_id, u.id as user_id, u.username, u.real_name, s.total_score, s.gold_reward, s.submitted_at, s.review_status
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      WHERE s.assignment_id = ?
      ORDER BY s.id ASC
    `).all(req.params.id);
    const latestByUser = new Map();
    for (const row of allSubmissions) latestByUser.set(row.user_id, row);
    const studentResults = [...latestByUser.values()]
      .sort((a, b) => (b.total_score || 0) - (a.total_score || 0));

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

// 教师代登记纸质作业（住校生等无设备场景），数据与线上提交同源
router.post('/:id/paper-submit', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { student_id, results, note } = req.body;
    if (!student_id || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: '缺少学生或答题结果' });
    }

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });
    if (assignment.status === 'cancelled') return res.status(400).json({ error: '该作业已被取消' });

    const student = db.prepare('SELECT id, class_id, username, real_name FROM users WHERE id = ?').get(student_id);
    if (!student || student.class_id !== assignment.class_id) {
      return res.status(400).json({ error: '该学生不属于此作业的班级' });
    }

    const existing = db.prepare('SELECT id FROM submissions WHERE assignment_id = ? AND user_id = ?').get(req.params.id, student_id);
    if (existing) {
      return res.status(400).json({ error: '该学生已有提交记录（线上或纸质），不能重复登记' });
    }

    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.answer, qb.analysis, qb.knowledge_point
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);
    const qMap = {};
    for (const q of questions) qMap[q.id] = q;

    const perQuestionMax = 100 / questions.length;
    const rows = [];
    let totalScore = 0;
    for (const r of results) {
      const q = qMap[r.question_id];
      if (!q) continue;
      const isCorrect = r.is_correct ? 1 : 0;
      // 客观题：对=满分错=0分；主观题：允许教师给 0-100 的部分分（折算到本题占比）
      let score = 0;
      if (isCorrect) {
        score = perQuestionMax;
      } else if (typeof r.score === 'number' && r.score > 0) {
        score = Math.max(0, Math.min(1, r.score / 100)) * perQuestionMax;
      }
      totalScore += score;
      rows.push({
        question_id: q.id,
        student_answer: String(r.student_answer || '纸质作答'),
        is_correct: isCorrect,
        score,
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: '没有有效的题目结果' });
    }

    const finalScore = Math.round(totalScore);
    const goldReward = Math.floor((finalScore / 100) * (assignment.max_exp || 30));

    const submitTx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO submissions (assignment_id, user_id, answers, status, total_score, total_max_score, gold_reward, attempt_count, review_status)
        VALUES (?, ?, ?, 'completed', ?, 100, ?, 1, 'graded')
      `).run(
        req.params.id,
        student_id,
        JSON.stringify({ source: 'paper', note: note || '', results }),
        finalScore,
        goldReward
      );
      const submissionId = result.lastInsertRowid;

      if (goldReward > 0) {
        db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?')
          .run(goldReward, goldReward, student_id);
        db.prepare(`INSERT INTO gold_transactions (user_id, gold_change, reason, source)
          VALUES (?, ?, ?, 'paper_assignment')`)
          .run(student_id, goldReward, `纸质作业: ${assignment.title}`);
      }

      const insertQA = db.prepare(`
        INSERT INTO question_answers (submission_id, question_bank_id, attempt_number, student_answer, is_correct, score, max_score, answered_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      for (const row of rows) {
        insertQA.run(submissionId, row.question_id, row.student_answer, row.is_correct, row.score, perQuestionMax);
        if (!row.is_correct) {
          const q = qMap[row.question_id];
          const existingWQ = db.prepare('SELECT id, wrong_count FROM wrong_questions WHERE user_id = ? AND question_id = ?')
            .get(student_id, row.question_id);
          if (existingWQ) {
            db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count + 1, wrong_answer = ?, correct_answer = ?, reviewed = 0 WHERE id = ?')
              .run(row.student_answer, q.answer, existingWQ.id);
          } else {
            db.prepare(`
              INSERT OR IGNORE INTO wrong_questions (user_id, assignment_id, question_id, wrong_answer, correct_answer, analysis, reviewed, wrong_count)
              VALUES (?, ?, ?, ?, ?, ?, 0, 1)
            `).run(student_id, req.params.id, row.question_id, row.student_answer, q.answer, q.analysis);
          }
        }
      }

      db.prepare(`INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
        VALUES (?, 'paper_graded', '纸质作业已登记', ?, 'assignment', ?)`)
        .run(student_id, `作业「${assignment.title}」已由老师登记纸质作答，得分 ${finalScore} 分${goldReward > 0 ? `，获得 ${goldReward} 金币` : ''}。`, req.params.id);

      return submissionId;
    });

    const submissionId = submitTx();

    res.json({
      message: '纸质作答登记成功',
      submission_id: submissionId,
      total_score: finalScore,
      gold_reward: goldReward
    });
  } catch (error) {
    console.error('纸质作业登记失败:', error);
    res.status(500).json({ error: '纸质作业登记失败: ' + (error.message || '未知错误') });
  }
});

// 纸质作业照片 AI 识别判分（视觉模型，结果供教师确认后通过 paper-submit 入库）
router.post('/:id/ai-paper-judge', authenticateToken, authorizeRole('teacher', 'admin'), async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '请先上传作业照片' });
    }
    if (images.length > 6) {
      return res.status(400).json({ error: '一次最多识别6张照片' });
    }

    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const questions = db.prepare(`
      SELECT qb.id, qb.type, qb.content, qb.answer
      FROM assignment_questions aq
      JOIN question_bank qb ON aq.question_bank_id = qb.id
      WHERE aq.assignment_id = ?
      ORDER BY aq.sort_order
    `).all(req.params.id);
    if (questions.length === 0) {
      return res.status(400).json({ error: '该作业没有题目' });
    }

    const config = getAIConfig();
    if (!config.ai_api_key || !config.ai_base_url || !config.ai_model) {
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }
    const visionModel = (config.ai_vision_model && String(config.ai_vision_model).trim()) || config.ai_model;

    const tLabel = (t) => ({ choice_single: '单选题', choice_multi: '多选题', judgment: '判断题', fill_blank: '填空题', essay: '简答/主观题' }[t] || t);
    const questionList = questions.map((q, i) =>
      `ID:${q.id} 第${i + 1}题[${tLabel(q.type)}] 题目：${String(q.content).slice(0, 80)} 参考答案：${q.answer}`
    ).join('\n');

    const prompt = fillTemplate(getPrompt('judge_paper_assignment'), {
      subject: assignment.subject || '',
      question_list: questionList,
      count: questions.length,
      image_count: images.length
    });

    const content = [
      { type: 'text', text: prompt },
      ...images.map((img) => ({ type: 'image_url', image_url: { url: img } }))
    ];

    const axios = require('axios');
    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
    const startTime = Date.now();
    const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
      model: visionModel,
      messages: [{ role: 'user', content }],
      max_tokens: getSystemSetting('max_tokens_per_generation', 18000)
    }, {
      headers: {
        'Authorization': `Bearer ${config.ai_api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });

    try {
      const usage = response.data?.usage || {};
      const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'`).get();
      if (hasTable) {
        db.prepare(`
          INSERT INTO token_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, model, subject, topic, question_type, question_count, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(req.user.userId, getChinaDate(), usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.total_tokens || 0, visionModel, assignment.subject || '纸质识别', '纸质作业AI识别', assignment.question_type, questions.length, Date.now() - startTime);
      }
    } catch (e) {
      // 统计失败不影响识别
    }

    const aiContent = response.data.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(aiContent);
    } catch (e) {
      const m = aiContent.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (!m) return res.status(500).json({ error: 'AI返回格式错误，请重试' });
      parsed = JSON.parse(m[0]);
    }

    const qIds = new Set(questions.map(q => q.id));
    const results = (parsed.results || [])
      .map((r) => ({
        question_id: parseInt(r.question_id),
        recognized_answer: r.recognized_answer ? String(r.recognized_answer) : '',
        is_correct: r.is_correct === true || r.is_correct === 'true',
        score: Math.max(0, Math.min(100, parseInt(r.score) || 0)),
        comment: r.comment ? String(r.comment) : ''
      }))
      .filter((r) => qIds.has(r.question_id));

    if (results.length === 0) {
      return res.status(500).json({ error: 'AI未能识别出有效结果，请重新拍照（光线充足、字迹清晰）后再试' });
    }

    res.json({ results, model: visionModel });
  } catch (error) {
    console.error('纸质作业AI识别失败:', error.message);
    if (error.code === 'ECONNABORTED') {
      return res.status(500).json({ error: 'AI识别超时，请稍后重试' });
    }
    if (error.response) {
      console.error('视觉模型响应:', error.response.status, JSON.stringify(error.response.data).slice(0, 300));
      return res.status(500).json({ error: '视觉模型调用失败，请确认已配置支持图片的模型（AI设置→视觉模型）' });
    }
    res.status(500).json({ error: '纸质作业AI识别失败: ' + (error.message || '未知错误') });
  }
});

router.get('/wrong/my', authenticateToken, (req, res) => {
  try {
    const { subject } = req.query;
    let query = `
      SELECT wq.*, qb.content as question_content, qb.options, qb.answer as correct_answer, 
      qb.subject, qb.type as question_type, a.title as assignment_title, qb.explanation, qb.analysis,
      qb.knowledge_point, qb.hint, qb.difficulty
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
    // 累加今日复习错题任务进度
    try {
      const today = getChinaDate();
      const taskLog = db.prepare(`
        SELECT task_progress, task_target FROM daily_task_logs
        WHERE user_id = ? AND date = ? AND task_type = 'review_weak_point'
      `).get(req.user.userId, today);
      if (taskLog) {
        updateTaskProgress(req.user.userId, 'review_weak_point', (taskLog.task_progress || 0) + 1);
      }
    } catch (e) { /* ignore */ }

    // 成就检查
    try {
      const reviewedCount = db.prepare("SELECT COUNT(*) as c FROM wrong_questions WHERE user_id = ? AND reviewed = 1").get(req.user.userId)?.c || 0;
      checkAndAwardAchievement(req.user.userId, 'review_wrong', reviewedCount);
    } catch (e) { console.error('成就检查失败:', e); }

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

router.patch('/:id/cancel', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });
    if (assignment.status === 'cancelled') return res.status(400).json({ error: '作业已取消' });

    if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.userId) {
      return res.status(403).json({ error: '只能取消自己发布的作业' });
    }

    db.prepare("UPDATE assignments SET status = 'cancelled' WHERE id = ?").run(req.params.id);

    res.json({ message: '作业已取消，已提交的成绩保留，未提交的学生将无法继续作答' });
  } catch (error) {
    console.error('取消作业错误:', error);
    res.status(500).json({ error: '取消作业失败' });
  }
});

module.exports = router;
