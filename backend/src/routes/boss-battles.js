const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// 获取班级当前BOSS
router.get('/current/:classId', authenticateToken, (req, res) => {
  try {
    const boss = db.prepare(`
      SELECT * FROM boss_battles 
      WHERE class_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(req.params.classId);

    if (!boss) {
      return res.json({ boss: null, message: '当前没有活跃的BOSS' });
    }

    // 获取参与者和伤害排行
    const participants = db.prepare(`
      SELECT 
        bbp.*,
        u.username,
        p.name as pet_name,
        p.level as pet_level,
        p.image_urls as pet_image_urls
      FROM boss_battle_participants bbp
      JOIN users u ON bbp.user_id = u.id
      LEFT JOIN pets p ON bbp.pet_id = p.id
      WHERE bbp.boss_battle_id = ?
      ORDER BY bbp.damage_dealt DESC
    `).all(boss.id);

    const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);
    const progress = Math.round((totalDamage / boss.boss_max_hp) * 100);

    res.json({
      boss: {
        ...boss,
        current_hp: boss.boss_max_hp - totalDamage,
        progress,
        participant_count: participants.length
      },
      participants,
      leaderboard: participants.slice(0, 10)
    });
  } catch (error) {
    console.error('获取BOSS信息失败:', error);
    res.status(500).json({ error: '获取BOSS信息失败' });
  }
});

// 创建BOSS (教师)
router.post('/create', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { class_id, boss_name, boss_level, knowledge_point, duration_hours = 24 } = req.body;
    
    if (!class_id || !boss_name || !boss_level) {
      return res.status(400).json({ error: '请提供完整信息' });
    }

    // 权限：教师必须属于该班级（admin 直通）
    if (req.user.role !== 'admin') {
      const belongs = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(req.user.userId, class_id);
      if (!belongs) {
        return res.status(403).json({ error: '无权为该班级创建 BOSS' });
      }
    }

    // 检查是否有活跃的BOSS
    const existingBoss = db.prepare(`
      SELECT id FROM boss_battles WHERE class_id = ? AND status = 'active'
    `).get(class_id);

    if (existingBoss) {
      return res.status(400).json({ error: '班级已有活跃的BOSS' });
    }

    // 计算BOSS血量 (等级 * 1000)
    const bossHp = boss_level * 1000;

    // 计算过期时间
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + duration_hours);

    const result = db.prepare(`
      INSERT INTO boss_battles (
        class_id, boss_name, boss_description, boss_icon,
        boss_hp, boss_max_hp, boss_level, knowledge_point,
        created_by, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      class_id,
      boss_name,
      `来自${knowledge_point || '未知'}的强大BOSS`,
      '👹',
      bossHp,
      bossHp,
      boss_level,
      knowledge_point || null,
      req.user.userId,
      expiresAt.toISOString()
    );

    res.json({
      message: 'BOSS创建成功',
      boss_id: result.lastInsertRowid
    });
  } catch (error) {
    console.error('创建BOSS失败:', error);
    res.status(500).json({ error: '创建BOSS失败' });
  }
});

// 自动从错题生成BOSS
router.post('/auto-generate', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { class_id } = req.body;
    if (!class_id) {
      return res.status(400).json({ error: '请提供班级ID' });
    }

    // 权限：教师必须属于该班级（admin 直通）
    if (req.user.role !== 'admin') {
      const belongs = db.prepare(
        `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
      ).get(req.user.userId, class_id);
      if (!belongs) {
        return res.status(403).json({ error: '无权为该班级生成 BOSS' });
      }
    }

    // 查找班级错误率最高的知识点
    const weakPoint = db.prepare(`
      SELECT 
        wq.question_id,
        COUNT(*) as error_count
      FROM wrong_questions wq
      JOIN users u ON wq.user_id = u.id
      WHERE u.class_id = ?
      GROUP BY wq.question_id
      ORDER BY error_count DESC
      LIMIT 1
    `).get(class_id);

    if (!weakPoint) {
      return res.status(404).json({ error: '暂无错题数据' });
    }

    // 获取题目信息
    const question = db.prepare('SELECT * FROM question_bank WHERE id = ?').get(weakPoint.question_id);
    
    // 计算BOSS等级 (基于错误率)
    const totalStudents = db.prepare('SELECT COUNT(*) as count FROM users WHERE class_id = ?').get(class_id).count;
    const bossLevel = Math.min(20, Math.max(5, Math.round(weakPoint.error_count / totalStudents * 10)));

    // 创建BOSS
    const bossHp = bossLevel * 1000;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48); // 48小时

    const result = db.prepare(`
      INSERT INTO boss_battles (
        class_id, boss_name, boss_description, boss_icon,
        boss_hp, boss_max_hp, boss_level, knowledge_point,
        source_question_id, created_by, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      class_id,
      `${question.topic || '错题'}之王`,
      `由${weakPoint.error_count}道错题凝聚而成的强大BOSS`,
      '👑',
      bossHp,
      bossHp,
      bossLevel,
      question.topic || null,
      question.id,
      req.user.userId,
      expiresAt.toISOString()
    );

    res.json({
      message: 'BOSS自动生成成功',
      boss_id: result.lastInsertRowid,
      boss_level: bossLevel,
      error_count: weakPoint.error_count
    });
  } catch (error) {
    console.error('自动生成BOSS失败:', error);
    res.status(500).json({ error: '生成BOSS失败' });
  }
});

// 获取Boss关联题目 (答题攻击用)
router.get('/:bossId/question', authenticateToken, (req, res) => {
  try {
    const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ? AND status = \'active\'').get(req.params.bossId);

    if (!boss) {
      return res.status(404).json({ error: 'BOSS不存在或已被击败' });
    }

    if (new Date() > new Date(boss.expires_at)) {
      return res.status(400).json({ error: 'BOSS已过期' });
    }

    // 选取题目：优先从Boss关联知识点选取，否则随机选取客观题
    let question;
    if (boss.knowledge_point) {
      question = db.prepare(`
        SELECT id, subject, topic, difficulty, type, content, options, hint
        FROM question_bank
        WHERE topic = ? AND type IN ('choice_single', 'choice_multi', 'judgment', 'fill_blank')
        ORDER BY RANDOM()
        LIMIT 1
      `).get(boss.knowledge_point);
    }

    // 如果没有找到关联题目，从任意客观题中选取
    if (!question) {
      question = db.prepare(`
        SELECT id, subject, topic, difficulty, type, content, options, hint
        FROM question_bank
        WHERE type IN ('choice_single', 'choice_multi', 'judgment', 'fill_blank')
        ORDER BY RANDOM()
        LIMIT 1
      `).get();
    }

    if (!question) {
      return res.status(404).json({ error: '题库中没有可用的题目' });
    }

    // 解析options
    let options = null;
    if (question.options) {
      try {
        options = typeof question.options === 'string' ? JSON.parse(question.options) : question.options;
      } catch (e) {
        options = null;
      }
    }

    res.json({
      question_id: question.id,
      content: question.content,
      type: question.type,
      difficulty: question.difficulty,
      options,
      hint: question.hint
    });
  } catch (error) {
    console.error('获取Boss题目失败:', error);
    res.status(500).json({ error: '获取题目失败' });
  }
});

// 攻击BOSS (答题后造成伤害)
router.post('/:bossId/attack', authenticateToken, (req, res) => {
  try {
    const { question_id, answer } = req.body;

    if (!question_id || answer === undefined || answer === null || answer === '') {
      return res.status(400).json({ error: '请先回答问题' });
    }

    const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ? AND status = \'active\'').get(req.params.bossId);

    if (!boss) {
      return res.status(404).json({ error: 'BOSS不存在或已被击败' });
    }

    // 检查是否过期
    if (new Date() > new Date(boss.expires_at)) {
      db.prepare('UPDATE boss_battles SET status = \'expired\' WHERE id = ?').run(boss.id);
      return res.status(400).json({ error: 'BOSS已过期' });
    }

    const user = db.prepare('SELECT class_id FROM users WHERE id = ?').get(req.user.userId);
    if (user.class_id !== boss.class_id) {
      return res.status(403).json({ error: '只能攻击自己班级的BOSS' });
    }

    const pet = db.prepare('SELECT id, level FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    // 攻击冷却检查（30秒）
    let participant = db.prepare(
      'SELECT * FROM boss_battle_participants WHERE boss_battle_id = ? AND user_id = ?'
    ).get(boss.id, req.user.userId);

    if (participant && participant.last_attack_at) {
      // SQLite CURRENT_TIMESTAMP returns UTC, append 'Z' for correct parsing
      const lastAttack = new Date(participant.last_attack_at + 'Z').getTime();
      const now = Date.now();
      const cooldownMs = 30 * 1000;
      const elapsed = now - lastAttack;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
        return res.status(429).json({ error: `攻击冷却中，请等待${remaining}秒`, cooldown_remaining: remaining });
      }
    }

    // 获取题目并验证答案
    const question = db.prepare('SELECT * FROM question_bank WHERE id = ?').get(question_id);
    if (!question) {
      return res.status(404).json({ error: '题目不存在' });
    }

    // 验证答案正确性
    let isCorrect = false;
    const correctAnswer = question.answer;
    const studentAnswer = String(answer).trim();

    if (question.type === 'choice_single' || question.type === 'judgment') {
      isCorrect = studentAnswer.toUpperCase() === String(correctAnswer).toUpperCase();
    } else if (question.type === 'choice_multi') {
      const correctSet = new Set(String(correctAnswer).toUpperCase().split('').sort());
      const answerSet = new Set(String(studentAnswer).toUpperCase().split('').sort());
      isCorrect = correctSet.size === answerSet.size && [...correctSet].every(a => answerSet.has(a));
    } else if (question.type === 'fill_blank') {
      isCorrect = studentAnswer === String(correctAnswer).trim();
    }

    // 计算伤害
    const difficultyMultiplier = { easy: 0.5, medium: 1.0, hard: 1.5 };
    const baseDamage = pet.level * 10;
    const multiplier = difficultyMultiplier[question.difficulty] || 1.0;
    const totalDamage = isCorrect ? Math.round(baseDamage * multiplier) : 0;

    // 首次参与则创建记录
    if (!participant) {
      db.prepare(`
        INSERT INTO boss_battle_participants (boss_battle_id, user_id, pet_id)
        VALUES (?, ?, ?)
      `).run(boss.id, req.user.userId, pet.id);

      participant = db.prepare(
        'SELECT * FROM boss_battle_participants WHERE boss_battle_id = ? AND user_id = ?'
      ).get(boss.id, req.user.userId);
    }

    // 更新参与记录
    db.prepare(`
      UPDATE boss_battle_participants
      SET damage_dealt = damage_dealt + ?,
          total_attempts = total_attempts + 1,
          correct_answers = correct_answers + ?,
          last_attack_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalDamage, isCorrect ? 1 : 0, participant.id);

    // 检查BOSS是否被击败
    const totalDamageDealt = db.prepare(`
      SELECT SUM(damage_dealt) as total FROM boss_battle_participants
      WHERE boss_battle_id = ?
    `).get(boss.id).total || 0;

    let bossDefeated = false;
    if (totalDamageDealt >= boss.boss_max_hp) {
      db.prepare(`
        UPDATE boss_battles
        SET status = 'defeated', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(boss.id);
      bossDefeated = true;
      distributeRewards(boss.id, boss.class_id);
    }

    // 获取当前排行
    const leaderboard = db.prepare(`
      SELECT
        bbp.*,
        u.username,
        p.name as pet_name,
        p.level as pet_level
      FROM boss_battle_participants bbp
      JOIN users u ON bbp.user_id = u.id
      LEFT JOIN pets p ON bbp.pet_id = p.id
      WHERE bbp.boss_battle_id = ?
      ORDER BY bbp.damage_dealt DESC
      LIMIT 10
    `).all(boss.id);

    res.json({
      is_correct: isCorrect,
      correct_answer: isCorrect ? null : correctAnswer,
      explanation: isCorrect ? null : (question.explanation || question.analysis || null),
      message: bossDefeated ? '🎉 BOSS被击败了！' : (isCorrect ? `答对了！造成 ${totalDamage} 点伤害` : '答错了，未能造成伤害'),
      damage: totalDamage,
      boss_defeated: bossDefeated,
      boss_current_hp: Math.max(0, boss.boss_max_hp - totalDamageDealt),
      boss_max_hp: boss.boss_max_hp,
      leaderboard
    });
  } catch (error) {
    console.error('攻击BOSS失败:', error);
    res.status(500).json({ error: '攻击BOSS失败' });
  }
});

// 领取奖励
router.post('/:bossId/claim-reward', authenticateToken, (req, res) => {
  try {
    const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ? AND status = \'defeated\'').get(req.params.bossId);
    
    if (!boss) {
      return res.status(404).json({ error: 'BOSS未被击败或不存在' });
    }

    const reward = db.prepare(
      'SELECT * FROM boss_battle_rewards WHERE boss_battle_id = ? AND user_id = ?'
    ).get(boss.id, req.user.userId);

    if (!reward) {
      return res.status(404).json({ error: '没有可领取的奖励' });
    }

    if (reward.claimed) {
      return res.status(400).json({ error: '奖励已领取' });
    }

    // 发放奖励
    if (reward.reward_type === 'gold') {
      db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(reward.reward_value, req.user.userId);
    } else if (reward.reward_type === 'exp') {
      db.prepare('UPDATE pets SET exp = exp + ? WHERE user_id = ?').run(reward.reward_value, req.user.userId);
    }

    // 标记已领取
    db.prepare('UPDATE boss_battle_rewards SET claimed = 1 WHERE id = ?').run(reward.id);

    res.json({
      message: `领取成功: ${reward.reward_value} ${reward.reward_type === 'gold' ? '金币' : '经验'}`,
      reward
    });
  } catch (error) {
    console.error('领取奖励失败:', error);
    res.status(500).json({ error: '领取奖励失败' });
  }
});

// 辅助函数：发放奖励
function distributeRewards(bossId, classId) {
  const participants = db.prepare(`
    SELECT user_id, damage_dealt FROM boss_battle_participants
    WHERE boss_battle_id = ?
  `).all(bossId);

  const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);
  const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ?').get(bossId);

  // 基础奖励池
  const goldPool = boss.boss_level * 100;
  const expPool = boss.boss_level * 50;

  for (const participant of participants) {
    // 按伤害比例分配（防止除零）
    const damageRatio = totalDamage > 0 ? participant.damage_dealt / totalDamage : 1 / participants.length;
    const goldReward = Math.round(goldPool * damageRatio);
    const expReward = Math.round(expPool * damageRatio);

    // 参与奖
    db.prepare(`
      INSERT OR IGNORE INTO boss_battle_rewards (boss_battle_id, user_id, reward_type, reward_value)
      VALUES (?, ?, 'gold', ?)
    `).run(bossId, participant.user_id, Math.max(10, goldReward));

    db.prepare(`
      INSERT OR IGNORE INTO boss_battle_rewards (boss_battle_id, user_id, reward_type, reward_value)
      VALUES (?, ?, 'exp', ?)
    `).run(bossId, participant.user_id, Math.max(5, expReward));
  }
}

module.exports = router;
