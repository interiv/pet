const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { getChinaDate } = require('../config/timezone');

function generateCardCode(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('gold', 'item', 'equipment', 'exp', 'mystery')),
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      reward_name TEXT,
      batch_id INTEGER,
      class_id INTEGER,
      created_by INTEGER NOT NULL,
      is_used INTEGER DEFAULT 0,
      used_by INTEGER,
      used_at DATETIME,
      expires_at DATETIME,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES card_batches(id),
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (used_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS card_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('gold', 'item', 'equipment', 'exp', 'mystery')),
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      reward_name TEXT,
      quantity INTEGER NOT NULL,
      class_id INTEGER,
      created_by INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS card_redemption_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      reward_name TEXT,
      redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (card_id) REFERENCES cards(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS classroom_quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      subject TEXT,
      class_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS classroom_quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (quiz_id) REFERENCES classroom_quizzes(id)
    );

    CREATE TABLE IF NOT EXISTS classroom_quiz_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      question_id INTEGER,
      student_id INTEGER NOT NULL,
      pet_id INTEGER,
      reward_type TEXT NOT NULL CHECK(reward_type IN ('gold', 'item', 'equipment', 'exp')),
      reward_value TEXT NOT NULL,
      reward_name TEXT,
      reason TEXT,
      awarded_by INTEGER NOT NULL,
      awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (quiz_id) REFERENCES classroom_quizzes(id),
      FOREIGN KEY (question_id) REFERENCES classroom_quiz_questions(id),
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (pet_id) REFERENCES pets(id),
      FOREIGN KEY (awarded_by) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cards_code ON cards(code);
    CREATE INDEX IF NOT EXISTS idx_cards_batch ON cards(batch_id);
    CREATE INDEX IF NOT EXISTS idx_cards_created_by ON cards(created_by);
    CREATE INDEX IF NOT EXISTS idx_cards_class ON cards(class_id);
    CREATE INDEX IF NOT EXISTS idx_card_batches_created ON card_batches(created_by);
    CREATE INDEX IF NOT EXISTS idx_card_redemption_user ON card_redemption_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_classroom_quizzes_class ON classroom_quizzes(class_id);
    CREATE INDEX IF NOT EXISTS idx_classroom_quiz_rewards_quiz ON classroom_quiz_rewards(quiz_id);
    CREATE INDEX IF NOT EXISTS idx_classroom_quiz_rewards_student ON classroom_quiz_rewards(student_id);
  `);
}

ensureTables();

// ==================== 卡管理（教师端） ====================

// 获取卡批次列表
router.get('/batches', authenticateToken, (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: '无权访问' });
    }
    const { class_id } = req.query;
    let sql = `SELECT cb.*, u.username as creator_name,
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
      SELECT c.*, u.username as used_by_name
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
          db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?')
            .run(rewardValue, rewardValue, req.user.userId);

          db.prepare(`INSERT INTO gold_transactions (user_id, gold_change, reason, source)
            VALUES (?, ?, ?, 'card')`)
            .run(req.user.userId, rewardValue, `兑换卡 ${cleanCode}: 获得 ${rewardValue} 金币`);
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
          const pet = db.prepare('SELECT * FROM pets WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT 1')
            .get(req.user.userId, 'normal');

          if (pet) {
            db.prepare('UPDATE pets SET exp = exp + ?, total_exp_earned = total_exp_earned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(rewardValue, rewardValue, pet.id);
          }
          break;
        }

        case 'mystery': {
          const roll = Math.random();
          if (roll < 0.4) {
            const goldAmount = Math.floor(Math.random() * 200) + 50;
            db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?')
              .run(goldAmount, goldAmount, req.user.userId);
            db.prepare(`INSERT INTO gold_transactions (user_id, gold_change, reason, source)
              VALUES (?, ?, ?, 'card')`)
              .run(req.user.userId, goldAmount, `神秘卡 ${cleanCode}: 获得 ${goldAmount} 金币`);
          } else if (roll < 0.7) {
            const expAmount = Math.floor(Math.random() * 100) + 30;
            const pet = db.prepare('SELECT * FROM pets WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT 1')
              .get(req.user.userId, 'normal');
            if (pet) {
              db.prepare('UPDATE pets SET exp = exp + ?, total_exp_earned = total_exp_earned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(expAmount, expAmount, pet.id);
            }
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
      SELECT rl.*, u.username as user_name
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
      SELECT cq.*, u.username as creator_name, c.name as class_name,
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
      SELECT cq.*, u.username as creator_name, c.name as class_name
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
      SELECT cqr.*, u.username as student_name, p.name as pet_name,
        a.username as awarder_name
      FROM classroom_quiz_rewards cqr
      JOIN users u ON cqr.student_id = u.id
      LEFT JOIN pets p ON cqr.pet_id = p.id
      JOIN users a ON cqr.awarded_by = a.id
      WHERE cqr.quiz_id = ?
      ORDER BY cqr.awarded_at DESC
    `).all(quizId);

    res.json({ quiz, questions, rewards });
  } catch (error) {
    console.error('获取课堂做题详情失败:', error);
    res.status(500).json({ error: '获取课堂做题详情失败' });
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
    const { student_id, pet_id, reward_type, reward_value, reward_name, question_id, reason } = req.body;

    if (!student_id || !reward_type || !reward_value) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const quiz = db.prepare('SELECT * FROM classroom_quizzes WHERE id = ?').get(quizId);
    if (!quiz) {
      return res.status(404).json({ error: '课堂做题不存在' });
    }

    const rewardTransaction = db.transaction(() => {
      const value = parseInt(reward_value) || 0;

      switch (reward_type) {
        case 'gold': {
          db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?')
            .run(value, value, student_id);

          db.prepare(`INSERT INTO gold_transactions (user_id, gold_change, reason, source)
            VALUES (?, ?, ?, 'classroom_quiz')`)
            .run(student_id, value, `课堂奖励: ${quiz.title} - ${reason || reward_name || ''}`);
          break;
        }

        case 'item': {
          const itemId = value;
          const existing = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ?')
            .get(student_id, itemId);

          if (existing) {
            db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE user_id = ? AND item_id = ?')
              .run(student_id, itemId);
          } else {
            db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, 1)')
              .run(student_id, itemId);
          }
          break;
        }

        case 'equipment': {
          db.prepare(`INSERT INTO user_equipment (user_id, equipment_id, equipped, obtained_at)
            VALUES (?, ?, 0, CURRENT_TIMESTAMP)`)
            .run(student_id, value);
          break;
        }

        case 'exp': {
          if (pet_id) {
            db.prepare('UPDATE pets SET exp = exp + ?, total_exp_earned = total_exp_earned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(value, value, pet_id);
          } else {
            const pet = db.prepare('SELECT * FROM pets WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT 1')
              .get(student_id, 'normal');
            if (pet) {
              db.prepare('UPDATE pets SET exp = exp + ?, total_exp_earned = total_exp_earned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(value, value, pet.id);
            }
          }
          break;
        }
      }

      db.prepare(`INSERT INTO classroom_quiz_rewards (quiz_id, question_id, student_id, pet_id, reward_type, reward_value, reward_name, reason, awarded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(quizId, question_id || null, student_id, pet_id || null, reward_type, String(reward_value), reward_name || null, reason || null, req.user.userId);

      db.prepare(`INSERT INTO user_activities (user_id, activity_type, metadata)
        VALUES (?, 'classroom_reward', ?)`)
        .run(student_id, JSON.stringify({ quiz_id: quizId, reward_type, reward_value, reward_name }));

      const notifyContent = `在课堂 "${quiz.title}" 中，你获得了奖励: ${reward_name || reward_type + ' x' + reward_value}。原因: ${reason || '课堂表现优秀'}`;

      db.prepare(`INSERT INTO notifications (user_id, type, title, content, source_type, source_id)
        VALUES (?, 'classroom_reward', '课堂奖励通知', ?, 'classroom_quiz', ?)`)
        .run(student_id, notifyContent, quizId);
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
      SELECT u.id, u.username, u.gold, u.avatar,
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
