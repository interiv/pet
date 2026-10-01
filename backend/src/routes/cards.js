const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getChinaDate } = require('../config/timezone');
const { getAIConfig, isAIConfigured } = require('../config/ai');
const { getPrompt, fillTemplate } = require('../config/prompts');
const { grantReward } = require('../services/rewards');
const { collectQuestions, normalizeQuestion } = require('../services/aiQuestion');
const { beginUsage, settleUsage, countBilledUsage } = require('../services/aiUsage');

function generateCardCode(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// 建表已收编到 knex 迁移：cards / card_batches / card_redemption_logs /
// classroom_quizzes / classroom_quiz_questions / classroom_quiz_rewards 见 001_initial_schema，
// classroom_quiz_answers 见 004_consolidate_runtime_tables。此处不再于模块加载时建表，
// 避免 require 早于迁移执行造成的双轨建表。

// ==================== 卡管理（教师端） ====================

// 获取卡批次列表
router.get('/batches', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权访问' });
    }
    const { class_id } = req.query;
    let sql = `SELECT cb.*, COALESCE(u.real_name, u.username) as creator_name,
      (SELECT COUNT(*) FROM cards WHERE batch_id = cb.id) as total_cards,
      (SELECT COUNT(*) FROM cards WHERE batch_id = cb.id AND is_used = 1) as used_cards
      FROM card_batches cb
      JOIN users u ON cb.created_by = u.id
      WHERE 1=1`;
    const params = [];

    if (class_id) {
      sql += ` AND cb.class_id = ?`;
      params.push(class_id);
    } else if (req.user.role === 'teacher') {
      sql += ` AND cb.created_by = ?`;
      params.push(req.user.userId);
    }

    sql += ` ORDER BY cb.created_at DESC`;
    const batches = db.prepare(sql).all(...params);
    res.json({ batches });
  } catch (error) {
    console.error('获取卡批次失败:', error);
    res.status(500).json({ error: '获取卡批次失败' });
  }
});

// 批量生成卡
router.post('/batches', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { name, type, reward_type, reward_value, reward_name, quantity, class_id, note } = req.body;

    if (!name || !type || !reward_type || !reward_value || !quantity) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    if (!['gold', 'item', 'equipment', 'exp', 'mystery'].includes(type)) {
      return res.status(400).json({ error: '无效的卡类型' });
    }

    const qty = parseInt(quantity);
    if (qty < 1 || qty > 500) {
      return res.status(400).json({ error: '数量必须在1-500之间' });
    }

    const insertBatch = db.prepare(`
      INSERT INTO card_batches (name, type, reward_type, reward_value, reward_name, quantity, class_id, created_by, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertBatch.run(name, type, reward_type, String(reward_value), reward_name || null, qty, class_id || null, req.user.userId, note || null);
    const batchId = result.lastInsertRowid;

    const insertCard = db.prepare(`
      INSERT INTO cards (code, type, reward_type, reward_value, reward_name, batch_id, class_id, created_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const expiresAt = req.body.expires_at || null;

    const insertMany = db.transaction(() => {
      const codes = [];
      for (let i = 0; i < qty; i++) {
        let code;
        let attempts = 0;
        do {
          code = generateCardCode();
          attempts++;
        } while (db.prepare('SELECT id FROM cards WHERE code = ?').get(code) && attempts < 10);

        insertCard.run(code, type, reward_type, String(reward_value), reward_name || null, batchId, class_id || null, req.user.userId, expiresAt);
        codes.push(code);
      }
      return codes;
    });

    const codes = insertMany();

    res.json({
      message: `成功生成 ${qty} 张卡`,
      batch_id: batchId,
      codes
    });
  } catch (error) {
    console.error('批量生成卡失败:', error);
    res.status(500).json({ error: '批量生成卡失败' });
  }
});

// 获取批次下的卡列表
router.get('/batches/:batchId/cards', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权访问' });
    }

    const { batchId } = req.params;
    const { page = 1, pageSize = 50, status } = req.query;
    const offset = (page - 1) * pageSize;

    let whereClause = `WHERE c.batch_id = ?`;
    const params = [batchId];

    if (status === 'used') {
      whereClause += ` AND c.is_used = 1`;
    } else if (status === 'unused') {
      whereClause += ` AND c.is_used = 0`;
    }

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM cards c ${whereClause}`).get(...params).cnt;

    const cards = db.prepare(`
      SELECT c.*, COALESCE(u.real_name, u.username) as used_by_name
      FROM cards c
      LEFT JOIN users u ON c.used_by = u.id
      ${whereClause}
      ORDER BY c.id ASC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(pageSize), parseInt(offset));

    res.json({ cards, total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (error) {
    console.error('获取卡列表失败:', error);
    res.status(500).json({ error: '获取卡列表失败' });
  }
});

// 删除批次
router.delete('/batches/:batchId', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { batchId } = req.params;
    const batch = db.prepare('SELECT * FROM card_batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: '批次不存在' });
    }

    if (req.user.role === 'teacher' && batch.created_by !== req.user.userId) {
      return res.status(403).json({ error: '无权删除他人的批次' });
    }

    db.prepare('DELETE FROM cards WHERE batch_id = ?').run(batchId);
    db.prepare('DELETE FROM card_batches WHERE id = ?').run(batchId);

    res.json({ message: '批次已删除' });
  } catch (error) {
    console.error('删除批次失败:', error);
    res.status(500).json({ error: '删除批次失败' });
  }
});

// 作废单张卡
router.put('/:cardId/invalidate', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { cardId } = req.params;
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
    if (!card) {
      return res.status(404).json({ error: '卡不存在' });
    }

    db.prepare('UPDATE cards SET is_active = 0 WHERE id = ?').run(cardId);
    res.json({ message: '卡已作废' });
  } catch (error) {
    console.error('作废卡失败:', error);
    res.status(500).json({ error: '作废卡失败' });
  }
});

// ==================== 卡兑换（学生端） ====================

// 兑换卡
router.post('/redeem', authenticateToken, (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: '请输入有效的卡号' });
    }

    const cleanCode = code.trim().toUpperCase();

    const card = db.prepare(`
      SELECT * FROM cards WHERE code = ? AND is_active = 1
    `).get(cleanCode);

    if (!card) {
      return res.status(404).json({ error: '卡号不存在或已失效' });
    }

    if (card.is_used === 1) {
      return res.status(400).json({ error: '该卡已被使用' });
    }

    if (card.expires_at) {
      const now = getChinaDate();
      if (new Date(card.expires_at) < now) {
        return res.status(400).json({ error: '该卡已过期' });
      }
    }

    const rewardValue = parseInt(card.reward_value) || 0;
    const rewardName = card.reward_name || '';

    const redeemTransaction = db.transaction(() => {
      switch (card.reward_type) {
        case 'gold': {
          grantReward(req.user.userId, {
            gold: rewardValue,
            source: 'card',
            reason: `兑换卡 ${cleanCode}: 获得 ${rewardValue} 金币`,
          });
          break;
        }

        case 'item': {
          const itemId = rewardValue;
          const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
          if (!item) {
            throw new Error('物品不存在');
          }

          const existing = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ?')
            .get(req.user.userId, itemId);

          if (existing) {
            db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE user_id = ? AND item_id = ?')
              .run(req.user.userId, itemId);
          } else {
            db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, 1)')
              .run(req.user.userId, itemId);
          }
          break;
        }

        case 'equipment': {
          const equipId = rewardValue;
          const equip = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipId);
          if (!equip) {
            throw new Error('装备不存在');
          }

          db.prepare(`INSERT INTO user_equipment (user_id, equipment_id, equipped, obtained_at)
            VALUES (?, ?, 0, CURRENT_TIMESTAMP)`)
            .run(req.user.userId, equipId);
          break;
        }

        case 'exp': {
          // 统一管道内部不筛 status（宠物昏迷时经验也应入账），并负责升级判定
          grantReward(req.user.userId, {
            exp: rewardValue,
            source: 'card',
            reason: `兑换卡 ${cleanCode}: 获得 ${rewardValue} 经验`,
          });
          break;
        }

        case 'mystery': {
          const roll = Math.random();
          if (roll < 0.4) {
            const goldAmount = Math.floor(Math.random() * 200) + 50;
            grantReward(req.user.userId, {
              gold: goldAmount,
              source: 'card',
              reason: `神秘卡 ${cleanCode}: 获得 ${goldAmount} 金币`,
            });
          } else if (roll < 0.7) {
            const expAmount = Math.floor(Math.random() * 100) + 30;
            grantReward(req.user.userId, {
              exp: expAmount,
              source: 'card',
              reason: `神秘卡 ${cleanCode}: 获得 ${expAmount} 经验`,
            });
          } else {
            const itemIds = db.prepare('SELECT id FROM items ORDER BY RANDOM() LIMIT 1').all();
            if (itemIds.length > 0) {
              const randomItemId = itemIds[0].id;
              const existing = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ?')
                .get(req.user.userId, randomItemId);
              if (existing) {
                db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE user_id = ? AND item_id = ?')
                  .run(req.user.userId, randomItemId);
              } else {
                db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, 1)')
                  .run(req.user.userId, randomItemId);
              }
            }
          }
          break;
        }
      }

      db.prepare('UPDATE cards SET is_used = 1, used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(req.user.userId, card.id);

      db.prepare(`INSERT INTO card_redemption_logs (card_id, code, user_id, type, reward_type, reward_value, reward_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(card.id, cleanCode, req.user.userId, card.type, card.reward_type, String(card.reward_value), rewardName);

      db.prepare(`INSERT INTO user_activities (user_id, activity_type, metadata)
        VALUES (?, 'card_redeem', ?)`)
        .run(req.user.userId, JSON.stringify({ code: cleanCode, type: card.type, reward_type: card.reward_type, reward_value: card.reward_value }));

      db.prepare(`INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
        VALUES (?, 'card', '卡兑换成功', ?, 'card', ?)`)
        .run(req.user.userId, `你成功兑换了卡 ${cleanCode}，获得: ${rewardName || card.reward_type + ' x' + card.reward_value}`, card.id);
    });

    redeemTransaction();

    const updatedCard = db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id);

    res.json({
      message: '兑换成功',
      card: {
        code: updatedCard.code,
        type: updatedCard.type,
        reward_type: updatedCard.reward_type,
        reward_value: updatedCard.reward_value,
        reward_name: updatedCard.reward_name
      }
    });
  } catch (error) {
    console.error('兑换卡失败:', error);
    res.status(500).json({ error: error.message || '兑换失败' });
  }
});

// 获取兑换记录
router.get('/redemption-logs', authenticateToken, (req, res) => {
  try {
    const { page = 1, pageSize = 20, user_id } = req.query;
    const offset = (page - 1) * pageSize;

    let whereClause = `WHERE 1=1`;
    const params = [];

    if (req.user.role === 'student') {
      whereClause += ` AND rl.user_id = ?`;
      params.push(req.user.userId);
    } else if (user_id) {
      whereClause += ` AND rl.user_id = ?`;
      params.push(user_id);
    }

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM card_redemption_logs rl ${whereClause}`).get(...params).cnt;

    const logs = db.prepare(`
      SELECT rl.*, COALESCE(u.real_name, u.username) as user_name
      FROM card_redemption_logs rl
      JOIN users u ON rl.user_id = u.id
      ${whereClause}
      ORDER BY rl.redeemed_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(pageSize), parseInt(offset));

    res.json({ logs, total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (error) {
    console.error('获取兑换记录失败:', error);
    res.status(500).json({ error: '获取兑换记录失败' });
  }
});

// ==================== 课堂做题 ====================

// 课堂做题：AI 快速出题（返回题目供教师选择，不入题库、不计入作业）
router.post('/classroom-quiz/ai-generate', authenticateToken, async (req, res) => {
  // 额度记录句柄提升到函数作用域：流程失败时要在 catch 里把它退还
  let usageId = 0;
  let usageStartedAt = 0;
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { subject, topic, question_type = 'choice_single', count = 5, difficulty = 'medium', grade_level = '', mode = 'topic', requirements = '', raw_text = '' } = req.body;

    // 出题模式：topic=按知识点 | requirements=按详细要求 | paste=粘贴题目整理
    const genMode = ['topic', 'requirements', 'paste'].includes(mode) ? mode : 'topic';
    if (!subject) {
      return res.status(400).json({ error: '请选择科目' });
    }
    if (genMode === 'topic' && !topic) {
      return res.status(400).json({ error: '请填写知识点主题' });
    }
    if (genMode === 'requirements' && !String(requirements || '').trim()) {
      return res.status(400).json({ error: '请填写详细的出题要求' });
    }
    if (genMode === 'paste' && !String(raw_text || '').trim()) {
      return res.status(400).json({ error: '请粘贴题目内容' });
    }
    const n = Math.min(20, Math.max(1, parseInt(count) || 5));

    // 每日生成次数与全站Token额度校验（与发布作业共用额度）
    const hasUsageTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'`).get();
    const today = getChinaDate();
    if (hasUsageTable) {
      const dailyTeacherLimit = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'daily_teacher_gen_limit'`).get()?.value || '20');
      const todayCount = countBilledUsage(req.user.userId, today);
      if (todayCount >= dailyTeacherLimit) {
        return res.status(429).json({ error: `今日生成次数已达上限（${dailyTeacherLimit}次），请明日0点后再试` });
      }
      const dailyGlobalTokenLimit = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'daily_global_token_limit'`).get()?.value || '2000000');
      const todayGlobalTokens = db.prepare(`SELECT COALESCE(SUM(completion_tokens), 0) as total FROM token_usage WHERE date = ?`).get(today)?.total || 0;
      if (todayGlobalTokens >= dailyGlobalTokenLimit) {
        return res.status(429).json({ error: '今日网站Token用量已达上限，请联系管理员或明日再试' });
      }
    }

    const config = getAIConfig();
    if (!isAIConfigured(config)) {
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }

    const typeLabels = { choice_single: '单选题', choice_multi: '多选题', judgment: '判断题', fill_blank: '填空题', essay: '简答题' };
    const typeLabel = typeLabels[question_type] || '题目';
    const promptKey = genMode === 'topic' ? 'gen_classroom'
      : genMode === 'requirements' ? 'gen_classroom_requirements'
      : 'gen_classroom_paste';
    const effectiveTopic = topic || String(requirements || '').trim().slice(0, 30) || '粘贴题目';

    const buildPrompt = (ask, note) => {
      const base = fillTemplate(getPrompt(promptKey), {
        grade_level, topic, subject, typeLabel, difficulty,
        count: ask || n, requirements, raw_text
      });
      return note ? `${base}\n\n${note}` : base;
    };

    usageStartedAt = Date.now();
    usageId = beginUsage(req.user.userId, today, {
      model: config.ai_model, subject, topic: effectiveTopic, question_type, count: n
    });
    const usageTokens = { prompt: 0, completion: 0, total: 0 };

    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
    const maxTokensPerGen = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'max_tokens_per_generation'`).get()?.value || '18000');

    const genResult = await collectQuestions({
      config,
      timeoutMs,
      maxTokens: maxTokensPerGen,
      type: question_type,
      // 课堂做题是学生口头/书面作答、AI 判分，只要题干能用就收，
      // 答案格式不合规时保留原文而不是直接丢题。
      normalize: (raw, type) => {
        const content = String(raw?.content ?? '').trim();
        if (content.length < 2) return { ok: false, reason: '题干为空' };
        const strict = normalizeQuestion(raw, type);
        return {
          ok: true,
          question: {
            content,
            answer: strict.ok ? strict.question.answer : String(raw?.answer ?? '').trim(),
            options: strict.ok ? strict.question.options : null,
            explanation: String(raw?.explanation ?? '').trim(),
            analysis: String(raw?.analysis ?? '').trim(),
            knowledge_point: String(raw?.knowledge_point ?? '').trim(),
          }
        };
      },
      // paste 模式题量由素材决定
      target: genMode === 'paste' ? 0 : n,
      variants: 1,
      maxRounds: 3,
      buildPrompt,
      onTokens: (u) => {
        usageTokens.prompt += u.prompt_tokens || 0;
        usageTokens.completion += u.completion_tokens || 0;
        usageTokens.total += u.total_tokens || 0;
      },
      logger: (m) => console.log(m)
    });

    const questions = genResult.questions;
    if (questions.length === 0) {
      settleUsage(usageId, 'failed', { ...usageTokens, duration: Date.now() - usageStartedAt });
      const detail = genResult.lastError ? `：${genResult.lastError}` : '';
      return res.status(500).json({
        error: `AI 未能生成有效题目${detail}，本次未消耗生成次数，请稍后重试`,
        quota_refunded: true
      });
    }

    settleUsage(usageId, 'ok', {
      ...usageTokens,
      question_count: questions.length,
      duration: Date.now() - usageStartedAt
    });

    res.json({
      questions: questions.map((q) => ({
        content: q.content,
        answer: q.answer,
        explanation: q.explanation
      }))
    });
  } catch (error) {
    console.error('课堂AI出题失败:', error.message);
    settleUsage(usageId, 'failed', { duration: usageStartedAt ? Date.now() - usageStartedAt : 0 });
    if (error.code === 'ECONNABORTED') {
      return res.status(500).json({ error: 'AI请求超时，请稍后重试（本次未消耗生成次数）', quota_refunded: true });
    }
    res.status(500).json({
      error: ('课堂AI出题失败: ' + (error.message || '未知错误')) + '（本次未消耗生成次数）',
      quota_refunded: true
    });
  }
});

// 创建课堂做题
router.post('/classroom-quiz', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { title, description, subject, class_id, questions } = req.body;

    if (!title || !class_id) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 校验班级归属：原先不校验，教师可为任意班级创建课堂做题
    if (req.user.role !== 'admin') {
      const belongs = db.prepare('SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?').get(req.user.userId, class_id);
      if (!belongs) {
        return res.status(403).json({ error: '无权为该班级创建课堂做题' });
      }
    }

    const result = db.prepare(`
      INSERT INTO classroom_quizzes (title, description, subject, class_id, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, description || null, subject || null, class_id, req.user.userId);

    const quizId = result.lastInsertRowid;

    if (questions && Array.isArray(questions)) {
      const insertQ = db.prepare(`
        INSERT INTO classroom_quiz_questions (quiz_id, question_text, sort_order)
        VALUES (?, ?, ?)
      `);

      questions.forEach((q, index) => {
        insertQ.run(quizId, q.question_text || q, index + 1);
      });
    }

    res.json({
      message: '课堂做题创建成功',
      quiz_id: quizId
    });
  } catch (error) {
    console.error('创建课堂做题失败:', error);
    res.status(500).json({ error: '创建课堂做题失败' });
  }
});

// 获取课堂做题列表
router.get('/classroom-quiz', authenticateToken, (req, res) => {
  try {
    const { class_id, status } = req.query;

    let whereClause = `WHERE 1=1`;
    const params = [];

    if (class_id) {
      whereClause += ` AND cq.class_id = ?`;
      params.push(class_id);
    }

    if (status) {
      whereClause += ` AND cq.status = ?`;
      params.push(status);
    }

    if (req.user.role === 'teacher') {
      whereClause += ` AND cq.created_by = ?`;
      params.push(req.user.userId);
    }

    const quizzes = db.prepare(`
      SELECT cq.*, COALESCE(u.real_name, u.username) as creator_name, c.name as class_name,
        (SELECT COUNT(*) FROM classroom_quiz_questions WHERE quiz_id = cq.id) as question_count,
        (SELECT COUNT(*) FROM classroom_quiz_rewards WHERE quiz_id = cq.id) as reward_count
      FROM classroom_quizzes cq
      JOIN users u ON cq.created_by = u.id
      LEFT JOIN classes c ON cq.class_id = c.id
      ${whereClause}
      ORDER BY cq.created_at DESC
    `).all(...params);

    res.json({ quizzes });
  } catch (error) {
    console.error('获取课堂做题列表失败:', error);
    res.status(500).json({ error: '获取课堂做题列表失败' });
  }
});

// 获取课堂做题详情（含题目和奖励记录）
router.get('/classroom-quiz/:quizId', authenticateToken, (req, res) => {
  try {
    const { quizId } = req.params;

    const quiz = db.prepare(`
      SELECT cq.*, COALESCE(u.real_name, u.username) as creator_name, c.name as class_name
      FROM classroom_quizzes cq
      JOIN users u ON cq.created_by = u.id
      LEFT JOIN classes c ON cq.class_id = c.id
      WHERE cq.id = ?
    `).get(quizId);

    if (!quiz) {
      return res.status(404).json({ error: '课堂做题不存在' });
    }

    const questions = db.prepare(`
      SELECT * FROM classroom_quiz_questions
      WHERE quiz_id = ?
      ORDER BY sort_order ASC
    `).all(quizId);

    const rewards = db.prepare(`
      SELECT cqr.*, COALESCE(u.real_name, u.username) as student_name, p.name as pet_name,
        COALESCE(a.real_name, a.username) as awarder_name
      FROM classroom_quiz_rewards cqr
      JOIN users u ON cqr.student_id = u.id
      LEFT JOIN pets p ON cqr.pet_id = p.id
      JOIN users a ON cqr.awarded_by = a.id
      WHERE cqr.quiz_id = ?
      ORDER BY cqr.awarded_at DESC
    `).all(quizId);

    const hasAnswersTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='classroom_quiz_answers'`).get();
    const answers = hasAnswersTable ? db.prepare(`
      SELECT cqa.*, COALESCE(u.real_name, u.username) as student_name
      FROM classroom_quiz_answers cqa
      JOIN users u ON cqa.student_id = u.id
      WHERE cqa.quiz_id = ?
      ORDER BY cqa.created_at DESC
    `).all(quizId) : [];

    res.json({ quiz, questions, rewards, answers });
  } catch (error) {
    console.error('获取课堂做题详情失败:', error);
    res.status(500).json({ error: '获取课堂做题详情失败' });
  }
});

// 课堂答题：AI 评判（不占每日生成次数，仅记录token用量）
router.post('/classroom-quiz/ai-judge', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { subject, question_text, reference_answer = '', student_answer } = req.body;
    if (!question_text || !student_answer || !String(student_answer).trim()) {
      return res.status(400).json({ error: '缺少题目或学生回答' });
    }

    const config = getAIConfig();
    if (!isAIConfigured(config)) {
      return res.status(500).json({ error: 'AI 配置未完成，请联系管理员' });
    }

    const prompt = fillTemplate(getPrompt('judge_classroom_answer'), {
      subject: subject || '',
      question_text,
      reference_answer: reference_answer || '无',
      student_answer
    });

    const axios = require('axios');
    const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
    const startTime = Date.now();
    const response = await axios.post(`${config.ai_base_url}/chat/completions`, {
      model: config.ai_model,
      messages: [{ role: 'user', content: prompt }]
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
        `).run(req.user.userId, getChinaDate(), usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.total_tokens || 0, config.ai_model, subject || '课堂答题', 'AI评判', 'essay', 1, Date.now() - startTime);
      }
    } catch (e) {
      // 统计写入失败不影响评判
    }

    const content = response.data.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const m = content.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/);
      if (!m) return res.status(500).json({ error: 'AI返回格式错误，请重试' });
      parsed = JSON.parse(m[0]);
    }

    res.json({
      is_correct: parsed.is_correct === true || parsed.is_correct === 'true',
      score: Math.max(0, Math.min(100, parseInt(parsed.score) || 0)),
      comment: parsed.comment || '',
      correct_answer: parsed.correct_answer ? String(parsed.correct_answer) : ''
    });
  } catch (error) {
    console.error('课堂答题AI评判失败:', error.message);
    if (error.code === 'ECONNABORTED') {
      return res.status(500).json({ error: 'AI评判超时，请重试' });
    }
    res.status(500).json({ error: '课堂答题AI评判失败: ' + (error.message || '未知错误') });
  }
});

// 课堂答题：保存答题记录（写入学生个人档案）
router.post('/classroom-quiz/:quizId/answers', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { quizId } = req.params;
    const { question_id, student_id, answer_text, judged_by_ai, is_correct, score, coin_rewarded } = req.body;
    if (!student_id) {
      return res.status(400).json({ error: '缺少答题学生' });
    }

    const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='classroom_quiz_answers'`).get();
    if (!hasTable) {
      return res.status(500).json({ error: '答题记录表未初始化' });
    }

    const result = db.prepare(`
      INSERT INTO classroom_quiz_answers (quiz_id, question_id, student_id, answer_text, judged_by_ai, is_correct, score, coin_rewarded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      quizId,
      question_id || null,
      parseInt(student_id),
      answer_text || null,
      judged_by_ai ? 1 : 0,
      is_correct === true || is_correct === 1 ? 1 : 0,
      Math.max(0, Math.min(100, parseInt(score) || 0)),
      Math.max(0, parseInt(coin_rewarded) || 0)
    );

    res.json({ message: '答题记录已保存', answer_id: result.lastInsertRowid });
  } catch (error) {
    console.error('保存课堂答题记录失败:', error);
    res.status(500).json({ error: '保存答题记录失败' });
  }
});

// 更新课堂答题记录的金币发放数额（发奖后回填）
router.put('/classroom-quiz/answers/:answerId', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }
    const answerId = parseInt(req.params.answerId);
    const answer = db.prepare(`
      SELECT cqa.id, cq.created_by, cq.class_id
      FROM classroom_quiz_answers cqa
      JOIN classroom_quizzes cq ON cqa.quiz_id = cq.id
      WHERE cqa.id = ?
    `).get(answerId);
    if (!answer) return res.status(404).json({ error: '答题记录不存在' });

    // 归属校验：原先无校验，任何教师都能改任意班级的答题奖励金额
    if (req.user.role !== 'admin' && answer.created_by !== req.user.userId) {
      const isHeadTeacher = db.prepare(
        "SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'"
      ).get(req.user.userId, answer.class_id);
      if (!isHeadTeacher) return res.status(403).json({ error: '无权修改该答题记录' });
    }

    db.prepare('UPDATE classroom_quiz_answers SET coin_rewarded = ? WHERE id = ?')
      .run(Math.max(0, parseInt(coin_rewarded) || 0), answerId);
    res.json({ message: '已更新' });
  } catch (error) {
    console.error('更新课堂答题记录失败:', error);
    res.status(500).json({ error: '更新答题记录失败' });
  }
});

// 更新课堂做题状态
router.put('/classroom-quiz/:quizId', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { quizId } = req.params;
    const { status } = req.body;

    const quiz = db.prepare('SELECT created_by, class_id FROM classroom_quizzes WHERE id = ?').get(quizId);
    if (!quiz) return res.status(404).json({ error: '课堂做题不存在' });

    // 归属校验：原先无校验，任何教师都能改别人创建的课堂做题状态
    if (req.user.role !== 'admin' && quiz.created_by !== req.user.userId) {
      const isHeadTeacher = db.prepare(
        "SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'"
      ).get(req.user.userId, quiz.class_id);
      if (!isHeadTeacher) return res.status(403).json({ error: '无权修改该课堂做题' });
    }

    // 状态值白名单（与表 CHECK 约束保持一致）
    if (!['active', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: '无效的课堂做题状态' });
    }

    if (status === 'completed') {
      db.prepare('UPDATE classroom_quizzes SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(status, quizId);
    } else {
      db.prepare('UPDATE classroom_quizzes SET status = ? WHERE id = ?')
        .run(status, quizId);
    }

    res.json({ message: '状态更新成功' });
  } catch (error) {
    console.error('更新课堂做题状态失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 发放奖励（教师端）
router.post('/classroom-quiz/:quizId/reward', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权操作' });
    }

    const { quizId } = req.params;
    const { student_id, student_ids, pet_id, reward_type, reward_value, reward_name, question_id, reason } = req.body;

    // 支持批量：student_ids 数组优先，兼容旧的 student_id 单人
    const targetIds = Array.isArray(student_ids) && student_ids.length > 0
      ? [...new Set(student_ids.map((id) => parseInt(id)).filter((id) => id > 0))]
      : (student_id ? [parseInt(student_id)] : []);

    if (targetIds.length === 0 || !reward_type || reward_value === undefined || reward_value === '') {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    if (targetIds.length > 100) {
      return res.status(400).json({ error: '一次最多发放100名学生' });
    }

    const quiz = db.prepare('SELECT * FROM classroom_quizzes WHERE id = ?').get(quizId);
    if (!quiz) {
      return res.status(404).json({ error: '课堂做题不存在' });
    }

    // 权限校验：原先完全不校验归属，任何教师都能给任意班级的任意学生发奖励。
    // 放行条件：管理员 / 该课堂做题的创建者 / 该班班主任。
    if (req.user.role !== 'admin' && quiz.created_by !== req.user.userId) {
      const isHeadTeacher = db.prepare(
        "SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'"
      ).get(req.user.userId, quiz.class_id);
      if (!isHeadTeacher) {
        return res.status(403).json({ error: '无权为该课堂做题发放奖励' });
      }
    }

    // 学生必须属于该课堂做题所在班级
    const classStudentIds = new Set(
      db.prepare("SELECT id FROM users WHERE class_id = ? AND role = 'student'").all(quiz.class_id).map(r => r.id)
    );
    if (targetIds.some(id => !classStudentIds.has(id))) {
      return res.status(400).json({ error: '存在不属于该班级的学生' });
    }

    // 奖励对象必须真实存在，避免把不存在的 id 写进背包/装备表
    if (reward_type === 'item') {
      if (!db.prepare('SELECT id FROM items WHERE id = ?').get(parseInt(reward_value) || 0)) {
        return res.status(400).json({ error: '物品不存在' });
      }
    } else if (reward_type === 'equipment') {
      if (!db.prepare('SELECT id FROM equipment WHERE id = ?').get(parseInt(reward_value) || 0)) {
        return res.status(400).json({ error: '装备不存在' });
      }
    }

    const rewardTransaction = db.transaction(() => {
      const value = parseInt(reward_value) || 0;

      for (const sid of targetIds) {
        switch (reward_type) {
          case 'gold': {
            grantReward(sid, {
              gold: value,
              source: 'classroom_quiz',
              reason: `课堂奖励: ${quiz.title} - ${reason || reward_name || ''}`,
            });
            break;
          }

          case 'item': {
            const itemId = value;
            const existing = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ?')
              .get(sid, itemId);

            if (existing) {
              db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE user_id = ? AND item_id = ?')
                .run(sid, itemId);
            } else {
              db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, 1)')
                .run(sid, itemId);
            }
            break;
          }

          case 'equipment': {
            db.prepare(`INSERT INTO user_equipment (user_id, equipment_id, equipped, obtained_at)
              VALUES (?, ?, 0, CURRENT_TIMESTAMP)`)
              .run(sid, value);
            break;
          }

          case 'exp': {
            // 单人发放且显式指定了宠物时，走指定宠物（管道内部会校验归属）
            grantReward(sid, {
              exp: value,
              petId: pet_id && targetIds.length === 1 ? pet_id : null,
              source: 'classroom_quiz',
              reason: `课堂奖励: ${quiz.title} - ${reason || reward_name || ''}`,
            });
            break;
          }
        }

        db.prepare(`INSERT INTO classroom_quiz_rewards (quiz_id, question_id, student_id, pet_id, reward_type, reward_value, reward_name, reason, awarded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(quizId, question_id || null, sid, pet_id || null, reward_type, String(reward_value), reward_name || null, reason || null, req.user.userId);

        db.prepare(`INSERT INTO user_activities (user_id, activity_type, metadata)
          VALUES (?, 'classroom_reward', ?)`)
          .run(sid, JSON.stringify({ quiz_id: quizId, reward_type, reward_value, reward_name }));

        const notifyContent = `在课堂 "${quiz.title}" 中，你获得了奖励: ${reward_name || reward_type + ' x' + reward_value}。原因: ${reason || '课堂表现优秀'}`;

        db.prepare(`INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
          VALUES (?, 'classroom_reward', '课堂奖励通知', ?, 'classroom_quiz', ?)`)
          .run(sid, notifyContent, quizId);
      }
    });

    rewardTransaction();

    res.json({ message: '奖励发放成功' });
  } catch (error) {
    console.error('发放奖励失败:', error);
    res.status(500).json({ error: '发放奖励失败' });
  }
});

// 获取班级学生列表（含宠物信息，用于奖励选择）
router.get('/classroom-quiz/students/:classId', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权访问' });
    }

    const { classId } = req.params;

    const students = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.gold, u.avatar,
        p.id as pet_id, p.name as pet_name, p.level as pet_level,
        p.species_id, ps.name as species_name, p.growth_stage,
        p.image_id, p.current_equipment
      FROM users u
      LEFT JOIN pets p ON p.user_id = u.id AND p.status = 'normal'
      LEFT JOIN pet_species ps ON p.species_id = ps.id
      WHERE u.role = 'student' AND u.class_id = ? AND u.status = 'active'
      ORDER BY u.username ASC
    `).all(classId);

    res.json({ students });
  } catch (error) {
    console.error('获取学生列表失败:', error);
    res.status(500).json({ error: '获取学生列表失败' });
  }
});

module.exports = router;
