const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { checkAndAwardAchievement } = require('./achievements');

const BOSS_ICONS = ['👹', '👑', '🐉', '👿', '🦹', '💀', '🧌', '👹', '🔥', '⚡'];
const BOSS_NAMES_PREFIX = ['暗影', '烈焰', '寒冰', '雷霆', '混沌', '深渊', '虚空', '毁灭', '末日', '永恒'];

function checkHeadTeacher(userId, classId) {
  const row = db.prepare(
    `SELECT role FROM class_teachers WHERE teacher_id = ? AND class_id = ?`
  ).get(userId, classId);
  return row && row.role === 'head_teacher';
}

function isAdmin(userId) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  return user && user.role === 'admin';
}

function requireHeadTeacher(req, res, next) {
  const { class_id } = req.body;
  if (!class_id) return res.status(400).json({ error: '请提供班级ID' });
  if (isAdmin(req.user.userId)) return next();
  if (checkHeadTeacher(req.user.userId, class_id)) return next();
  return res.status(403).json({ error: '只有班主任才能操作本班的BOSS战' });
}

router.get('/list/:classId', authenticateToken, (req, res) => {
  try {
    const bosses = db.prepare(`
      SELECT bb.*, 
        (SELECT COUNT(*) FROM boss_battle_participants WHERE boss_battle_id = bb.id) as participant_count,
        (SELECT COALESCE(SUM(damage_dealt), 0) FROM boss_battle_participants WHERE boss_battle_id = bb.id) as total_damage
      FROM boss_battles bb
      WHERE bb.class_id = ?
      ORDER BY bb.created_at DESC
    `).all(req.params.classId);
    res.json({ bosses });
  } catch (error) {
    console.error('获取BOSS列表失败:', error);
    res.status(500).json({ error: '获取BOSS列表失败' });
  }
});

router.get('/current/:classId', authenticateToken, (req, res) => {
  try {
    let boss = db.prepare(`
      SELECT * FROM boss_battles 
      WHERE class_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(req.params.classId);

    let myRewards = [];
    let bossStatus = boss ? 'active' : null;

    if (boss && boss.expires_at && new Date() > new Date(boss.expires_at)) {
      db.prepare('UPDATE boss_battles SET status = ? WHERE id = ?').run('expired', boss.id);
      boss = null;
      bossStatus = null;
    }

    if (!boss) {
      boss = db.prepare(`
        SELECT * FROM boss_battles 
        WHERE class_id = ? AND status = 'defeated'
        ORDER BY completed_at DESC
        LIMIT 1
      `).get(req.params.classId);

      if (boss) {
        myRewards = db.prepare(`
          SELECT * FROM boss_battle_rewards 
          WHERE boss_battle_id = ? AND user_id = ?
        `).all(boss.id, req.user.userId);

        const allClaimed = myRewards.length > 0 && myRewards.every((r) => r.claimed);
        if (allClaimed) {
          boss = null;
        } else {
          bossStatus = 'defeated';
        }
      }
    }

    if (!boss) {
      return res.json({ boss: null, message: '当前没有活跃的BOSS' });
    }

    const participants = db.prepare(`
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
    `).all(boss.id);

    const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);
    const progress = Math.round((totalDamage / boss.boss_max_hp) * 1000) / 10;

    const myAnswerCount = db.prepare(`
      SELECT COUNT(*) as count FROM boss_battle_answers
      WHERE boss_battle_id = ? AND user_id = ?
    `).get(boss.id, req.user.userId).count;

    const maxQuestions = boss.max_questions_per_user || 20;

    res.json({
      boss: {
        ...boss,
        current_hp: Math.max(0, boss.boss_max_hp - totalDamage),
        progress: Math.min(100, progress),
        participant_count: participants.length,
        status: bossStatus,
        max_questions_per_user: maxQuestions,
      },
      participants,
      leaderboard: participants.slice(0, 10),
      myRewards: myRewards.map((r) => ({
        id: r.id,
        type: r.reward_type,
        value: r.reward_value,
        claimed: !!r.claimed,
      })),
      myAnswerStats: {
        answered: myAnswerCount,
        max: maxQuestions,
        remaining: Math.max(0, maxQuestions - myAnswerCount),
      },
    });
  } catch (error) {
    console.error('获取BOSS信息失败:', error);
    res.status(500).json({ error: '获取BOSS信息失败' });
  }
});

router.get('/history/:classId', authenticateToken, (req, res) => {
  try {
    const bosses = db.prepare(`
      SELECT * FROM boss_battles 
      WHERE class_id = ? AND status IN ('defeated', 'expired')
      ORDER BY COALESCE(completed_at, expires_at) DESC
    `).all(req.params.classId);

    const result = bosses.map((boss) => {
      const participants = db.prepare(`
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
      `).all(boss.id);

      const participantsWithRewards = participants.map((p) => {
        const rewards = db.prepare(`
          SELECT reward_type, reward_value, claimed FROM boss_battle_rewards 
          WHERE boss_battle_id = ? AND user_id = ?
        `).all(boss.id, p.user_id);
        return { ...p, rewards };
      });

      const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);

      const myRewards = db.prepare(`
        SELECT * FROM boss_battle_rewards 
        WHERE boss_battle_id = ? AND user_id = ?
      `).all(boss.id, req.user.userId);

      const rewardConfig = db.prepare(`
        SELECT * FROM boss_battle_reward_config WHERE boss_battle_id = ?
      `).all(boss.id);

      return {
        ...boss,
        current_hp: Math.max(0, boss.boss_max_hp - totalDamage),
        progress: Math.min(100, Math.round((totalDamage / boss.boss_max_hp) * 1000) / 10),
        participant_count: participants.length,
        total_damage: totalDamage,
        participants: participantsWithRewards.slice(0, 20),
        myRewards: myRewards.map((r) => ({
          id: r.id,
          type: r.reward_type,
          value: r.reward_value,
          claimed: !!r.claimed,
        })),
        rewardConfig,
      };
    });

    res.json({ bosses: result });
  } catch (error) {
    console.error('获取BOSS历史失败:', error);
    res.status(500).json({ error: '获取BOSS历史失败' });
  }
});

router.get('/wrong-questions/:classId', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const classId = req.params.classId;
    if (!isAdmin(req.user.userId) && !checkHeadTeacher(req.user.userId, classId)) {
      return res.status(403).json({ error: '只有班主任才能查看班级错题' });
    }

    const {
      page = 1,
      pageSize = 20,
      subject,
      type,
      difficulty,
      keyword,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize)));
    const offset = (pageNum - 1) * pageSizeNum;

    const conditions = ['u.class_id = ?'];
    const params = [classId];

    if (subject) {
      conditions.push('qb.subject = ?');
      params.push(subject);
    }
    if (type) {
      conditions.push('qb.type = ?');
      params.push(type);
    }
    if (difficulty) {
      conditions.push('qb.difficulty = ?');
      params.push(difficulty);
    }
    if (keyword) {
      conditions.push('(qb.content LIKE ? OR qb.knowledge_point LIKE ? OR qb.topic LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(DISTINCT wq.question_id) as total
      FROM wrong_questions wq
      JOIN users u ON wq.user_id = u.id
      JOIN question_bank qb ON wq.question_id = qb.id
      WHERE ${whereClause}
    `;
    const { total } = db.prepare(countSql).get(...params);

    const dataSql = `
      SELECT 
        wq.id as wrong_id,
        wq.question_id,
        wq.wrong_count,
        qb.subject,
        qb.topic,
        qb.difficulty,
        qb.type,
        qb.content,
        qb.options,
        qb.answer,
        qb.knowledge_point,
        COUNT(DISTINCT wq.user_id) as error_student_count
      FROM wrong_questions wq
      JOIN users u ON wq.user_id = u.id
      JOIN question_bank qb ON wq.question_id = qb.id
      WHERE ${whereClause}
      GROUP BY wq.question_id
      ORDER BY error_student_count DESC, wq.wrong_count DESC
      LIMIT ? OFFSET ?
    `;

    const wrongQuestions = db.prepare(dataSql).all(...params, pageSizeNum, offset);

    const subjects = db.prepare(`
      SELECT DISTINCT qb.subject FROM wrong_questions wq
      JOIN users u ON wq.user_id = u.id
      JOIN question_bank qb ON wq.question_id = qb.id
      WHERE u.class_id = ? ORDER BY qb.subject
    `).all(classId).map(r => r.subject);

    const types = db.prepare(`
      SELECT DISTINCT qb.type FROM wrong_questions wq
      JOIN users u ON wq.user_id = u.id
      JOIN question_bank qb ON wq.question_id = qb.id
      WHERE u.class_id = ? ORDER BY qb.type
    `).all(classId).map(r => r.type);

    res.json({
      wrongQuestions,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
      filters: { subjects, types },
    });
  } catch (error) {
    console.error('获取错题列表失败:', error);
    res.status(500).json({ error: '获取错题列表失败' });
  }
});

router.get('/questions', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      subject,
      type,
      difficulty,
      keyword,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize)));
    const offset = (pageNum - 1) * pageSizeNum;

    const conditions = [];
    const params = [];

    if (subject) {
      conditions.push('subject = ?');
      params.push(subject);
    }
    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }
    if (difficulty) {
      conditions.push('difficulty = ?');
      params.push(difficulty);
    }
    if (keyword) {
      conditions.push('(content LIKE ? OR knowledge_point LIKE ? OR topic LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const { total } = db.prepare(`SELECT COUNT(*) as total FROM question_bank ${whereClause}`).get(...params);

    const questions = db.prepare(`
      SELECT id, subject, topic, difficulty, type, content, knowledge_point, created_at
      FROM question_bank ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSizeNum, offset);

    const subjects = db.prepare('SELECT DISTINCT subject FROM question_bank ORDER BY subject').all().map(r => r.subject);
    const types = db.prepare('SELECT DISTINCT type FROM question_bank ORDER BY type').all().map(r => r.type);

    res.json({
      questions,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
      filters: { subjects, types },
    });
  } catch (error) {
    console.error('获取题库列表失败:', error);
    res.status(500).json({ error: '获取题库列表失败' });
  }
});

router.post('/create', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const {
      class_id, boss_name, boss_level, boss_icon, boss_description,
      knowledge_point, duration_hours = 168,
      boss_hp, reward_gold, reward_exp, reward_equipment_id,
      question_source = 'knowledge',
      question_ids,
      max_questions_per_user = 20,
    } = req.body;

    if (!class_id || !boss_name || !boss_level) {
      return res.status(400).json({ error: '请提供完整信息' });
    }

    if (!isAdmin(req.user.userId) && !checkHeadTeacher(req.user.userId, class_id)) {
      return res.status(403).json({ error: '只有班主任才能为本班创建BOSS战' });
    }

    const existingBoss = db.prepare(`
      SELECT id FROM boss_battles WHERE class_id = ? AND status = 'active'
    `).get(class_id);

    if (existingBoss) {
      return res.status(400).json({ error: '班级已有活跃的BOSS' });
    }

    const finalHp = boss_hp || boss_level * 1000;
    const finalIcon = boss_icon || BOSS_ICONS[Math.floor(Math.random() * BOSS_ICONS.length)];
    const finalDesc = boss_description || `来自${knowledge_point || '未知领域'}的强大BOSS`;

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + duration_hours);

    const result = db.prepare(`
      INSERT INTO boss_battles (
        class_id, boss_name, boss_description, boss_icon,
        boss_hp, boss_max_hp, boss_level, knowledge_point,
        created_by, expires_at, max_questions_per_user
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      class_id,
      boss_name,
      finalDesc,
      finalIcon,
      finalHp,
      finalHp,
      boss_level,
      knowledge_point || null,
      req.user.userId,
      expiresAt.toISOString(),
      max_questions_per_user
    );

    const bossId = result.lastInsertRowid;

    const isSelectedSource = question_source === 'wrong_questions' || question_source === 'question_bank' || question_source === 'selected';
    if (isSelectedSource && question_ids && question_ids.length > 0) {
      for (const qId of question_ids) {
        db.prepare(`
          INSERT OR IGNORE INTO boss_battle_questions (boss_battle_id, question_id) VALUES (?, ?)
        `).run(bossId, qId);
      }
    }

    if (reward_gold) {
      db.prepare(`
        INSERT INTO boss_battle_reward_config (boss_battle_id, reward_type, reward_value) VALUES (?, 'gold', ?)
      `).run(bossId, reward_gold);
    }
    if (reward_exp) {
      db.prepare(`
        INSERT INTO boss_battle_reward_config (boss_battle_id, reward_type, reward_value) VALUES (?, 'exp', ?)
      `).run(bossId, reward_exp);
    }

    let finalEquipmentId = reward_equipment_id;
    if (!finalEquipmentId) {
      const randomEquip = db.prepare('SELECT id FROM equipment ORDER BY RANDOM() LIMIT 1').get();
      if (randomEquip) {
        finalEquipmentId = randomEquip.id;
      }
    }
    if (finalEquipmentId) {
      db.prepare(`
        INSERT INTO boss_battle_reward_config (boss_battle_id, reward_type, reward_value) VALUES (?, 'equipment', ?)
      `).run(bossId, finalEquipmentId);
    }

    res.json({
      message: 'BOSS创建成功',
      boss_id: bossId
    });
  } catch (error) {
    console.error('创建BOSS失败:', error);
    res.status(500).json({ error: '创建BOSS失败' });
  }
});

router.post('/auto-generate', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const { class_id, duration_hours = 168, max_questions_per_user = 20 } = req.body;
    if (!class_id) {
      return res.status(400).json({ error: '请提供班级ID' });
    }

    if (!isAdmin(req.user.userId) && !checkHeadTeacher(req.user.userId, class_id)) {
      return res.status(403).json({ error: '只有班主任才能为本班生成BOSS战' });
    }

    const existingBoss = db.prepare(`
      SELECT id FROM boss_battles WHERE class_id = ? AND status = 'active'
    `).get(class_id);
    if (existingBoss) {
      return res.status(400).json({ error: '班级已有活跃的BOSS' });
    }

    const weakPoints = db.prepare(`
      SELECT 
        wq.question_id,
        qb.topic,
        qb.knowledge_point,
        COUNT(DISTINCT wq.user_id) as error_student_count,
        SUM(wq.wrong_count) as total_wrong_count
      FROM wrong_questions wq
      JOIN users u ON wq.user_id = u.id
      JOIN question_bank qb ON wq.question_id = qb.id
      WHERE u.class_id = ?
      GROUP BY wq.question_id
      ORDER BY error_student_count DESC, total_wrong_count DESC
      LIMIT 20
    `).all(class_id);

    if (!weakPoints || weakPoints.length === 0) {
      return res.status(404).json({ error: '暂无错题数据，无法生成BOSS' });
    }

    const topWeakPoint = weakPoints[0];
    const totalStudents = db.prepare('SELECT COUNT(*) as count FROM users WHERE class_id = ? AND role = \'student\'').get(class_id).count || 1;
    const bossLevel = Math.min(20, Math.max(3, Math.round(topWeakPoint.error_student_count / totalStudents * 15)));
    const bossHp = bossLevel * 1000;
    const bossIcon = BOSS_ICONS[Math.floor(Math.random() * BOSS_ICONS.length)];
    const bossNamePrefix = BOSS_NAMES_PREFIX[Math.floor(Math.random() * BOSS_NAMES_PREFIX.length)];
    const knowledgePoint = topWeakPoint.knowledge_point || topWeakPoint.topic || '综合';

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + duration_hours);

    const result = db.prepare(`
      INSERT INTO boss_battles (
        class_id, boss_name, boss_description, boss_icon,
        boss_hp, boss_max_hp, boss_level, knowledge_point,
        source_question_id, created_by, expires_at, max_questions_per_user
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      class_id,
      `${bossNamePrefix}${knowledgePoint}之王`,
      `由${topWeakPoint.error_student_count}位同学的${weakPoints.length}道错题凝聚而成的强大BOSS`,
      bossIcon,
      bossHp,
      bossHp,
      bossLevel,
      knowledgePoint,
      topWeakPoint.question_id,
      req.user.userId,
      expiresAt.toISOString(),
      max_questions_per_user
    );

    const bossId = result.lastInsertRowid;

    for (const wp of weakPoints) {
      db.prepare(`
        INSERT OR IGNORE INTO boss_battle_questions (boss_battle_id, question_id) VALUES (?, ?)
      `).run(bossId, wp.question_id);
    }

    res.json({
      message: 'BOSS自动生成成功',
      boss_id: bossId,
      boss_name: `${bossNamePrefix}${knowledgePoint}之王`,
      boss_level: bossLevel,
      boss_hp: bossHp,
      error_count: weakPoints.length,
      error_student_count: topWeakPoint.error_student_count,
      knowledge_point: knowledgePoint,
    });
  } catch (error) {
    console.error('自动生成BOSS失败:', error);
    res.status(500).json({ error: '生成BOSS失败' });
  }
});

router.get('/:bossId/detail', authenticateToken, (req, res) => {
  try {
    const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ?').get(req.params.bossId);
    if (!boss) {
      return res.status(404).json({ error: 'BOSS不存在' });
    }

    const participants = db.prepare(`
      SELECT bbp.*, u.username, p.name as pet_name, p.level as pet_level
      FROM boss_battle_participants bbp
      JOIN users u ON bbp.user_id = u.id
      LEFT JOIN pets p ON bbp.pet_id = p.id
      WHERE bbp.boss_battle_id = ?
      ORDER BY bbp.damage_dealt DESC
    `).all(boss.id);

    const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);

    const rewardConfig = db.prepare(`
      SELECT * FROM boss_battle_reward_config WHERE boss_battle_id = ?
    `).all(boss.id);

    const rewards = db.prepare(`
      SELECT * FROM boss_battle_rewards WHERE boss_battle_id = ?
    `).all(boss.id);

    const classStudents = db.prepare(`
      SELECT id, username FROM users WHERE class_id = ? AND role = 'student' AND status = 'active'
    `).all(boss.class_id);

    const participantUserIds = new Set(participants.map(p => p.user_id));
    const nonParticipants = classStudents.filter(s => !participantUserIds.has(s.id));

    const totalAttempts = participants.reduce((sum, p) => sum + p.total_attempts, 0);
    const totalCorrect = participants.reduce((sum, p) => sum + p.correct_answers, 0);
    const avgAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    res.json({
      boss: {
        ...boss,
        current_hp: Math.max(0, boss.boss_max_hp - totalDamage),
        total_damage: totalDamage,
        participant_count: participants.length,
        class_student_count: classStudents.length,
        participation_rate: classStudents.length > 0 ? Math.round((participants.length / classStudents.length) * 100) : 0,
        avg_accuracy: avgAccuracy,
      },
      participants,
      non_participants: nonParticipants,
      reward_config: rewardConfig,
      rewards,
    });
  } catch (error) {
    console.error('获取BOSS详情失败:', error);
    res.status(500).json({ error: '获取BOSS详情失败' });
  }
});

router.post('/:bossId/terminate', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ?').get(req.params.bossId);
    if (!boss) {
      return res.status(404).json({ error: 'BOSS不存在' });
    }

    if (boss.status !== 'active') {
      return res.status(400).json({ error: '只能终止进行中的BOSS' });
    }

    if (!isAdmin(req.user.userId) && !checkHeadTeacher(req.user.userId, boss.class_id)) {
      return res.status(403).json({ error: '只有班主任才能终止本班的BOSS战' });
    }

    const totalDamage = db.prepare(`
      SELECT COALESCE(SUM(damage_dealt), 0) as total FROM boss_battle_participants WHERE boss_battle_id = ?
    `).get(boss.id).total;

    if (totalDamage >= boss.boss_max_hp) {
      db.prepare(`
        UPDATE boss_battles SET status = 'defeated', completed_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(boss.id);
      distributeRewards(boss.id, boss.class_id);
    } else {
      db.prepare(`
        UPDATE boss_battles SET status = 'expired', completed_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(boss.id);
    }

    res.json({ message: 'BOSS战已终止' });
  } catch (error) {
    console.error('终止BOSS失败:', error);
    res.status(500).json({ error: '终止BOSS失败' });
  }
});

router.delete('/:bossId', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ?').get(req.params.bossId);
    if (!boss) {
      return res.status(404).json({ error: 'BOSS不存在' });
    }

    if (boss.status === 'active') {
      return res.status(400).json({ error: '请先终止进行中的BOSS战再删除' });
    }

    if (!isAdmin(req.user.userId) && !checkHeadTeacher(req.user.userId, boss.class_id)) {
      return res.status(403).json({ error: '只有班主任才能删除本班的BOSS记录' });
    }

    db.prepare('DELETE FROM boss_battle_rewards WHERE boss_battle_id = ?').run(boss.id);
    db.prepare('DELETE FROM boss_battle_participants WHERE boss_battle_id = ?').run(boss.id);
    db.prepare('DELETE FROM boss_battles WHERE id = ?').run(boss.id);

    res.json({ message: 'BOSS记录已删除' });
  } catch (error) {
    console.error('删除BOSS失败:', error);
    res.status(500).json({ error: '删除BOSS失败' });
  }
});

router.get('/:bossId/question', authenticateToken, (req, res) => {
  try {
    const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ? AND status = \'active\'').get(req.params.bossId);

    if (!boss) {
      return res.status(404).json({ error: 'BOSS不存在或已被击败' });
    }

    if (new Date() > new Date(boss.expires_at)) {
      db.prepare('UPDATE boss_battles SET status = \'expired\' WHERE id = ?').run(boss.id);
      return res.status(400).json({ error: 'BOSS已过期' });
    }

    const userId = req.user.userId;
    const maxQuestions = boss.max_questions_per_user || 20;

    const answeredCount = db.prepare(`
      SELECT COUNT(*) as count FROM boss_battle_answers
      WHERE boss_battle_id = ? AND user_id = ?
    `).get(boss.id, userId).count;

    if (answeredCount >= maxQuestions) {
      return res.status(400).json({
        error: `已达到答题上限（${maxQuestions}题）`,
        answered_count: answeredCount,
        max_questions: maxQuestions,
      });
    }

    const answeredIds = db.prepare(`
      SELECT question_id FROM boss_battle_answers
      WHERE boss_battle_id = ? AND user_id = ?
    `).all(boss.id, userId).map(r => r.question_id);

    let question = null;

    const lastAnswer = db.prepare(`
      SELECT ba.question_id, ba.is_correct, qb.knowledge_point, qb.topic
      FROM boss_battle_answers ba
      JOIN question_bank qb ON ba.question_id = qb.id
      WHERE ba.boss_battle_id = ? AND ba.user_id = ?
      ORDER BY ba.answered_at DESC LIMIT 1
    `).get(boss.id, userId);

    const bossQuestions = db.prepare(`
      SELECT question_id FROM boss_battle_questions WHERE boss_battle_id = ?
    `).all(boss.id);

    const buildExcludeClause = (excludeIds) => {
      if (excludeIds.length === 0) return '';
      return `AND id NOT IN (${excludeIds.map(() => '?').join(',')})`;
    };

    const tryGetQuestion = (whereExtra, params) => {
      const excludeClause = buildExcludeClause(answeredIds);
      const allParams = [...params, ...answeredIds];

      if (bossQuestions.length > 0) {
        const qIds = bossQuestions.map(bq => bq.question_id);
        const inClause = qIds.map(() => '?').join(',');
        return db.prepare(`
          SELECT id, subject, topic, difficulty, type, content, options, hint, knowledge_point
          FROM question_bank
          WHERE id IN (${inClause})
            AND type IN ('choice_single', 'choice_multi', 'judgment', 'fill_blank')
            ${whereExtra}
            ${excludeClause}
          ORDER BY RANDOM()
          LIMIT 1
        `).get(...qIds, ...allParams);
      }

      if (boss.knowledge_point) {
        return db.prepare(`
          SELECT id, subject, topic, difficulty, type, content, options, hint, knowledge_point
          FROM question_bank
          WHERE topic = ?
            AND type IN ('choice_single', 'choice_multi', 'judgment', 'fill_blank')
            ${whereExtra}
            ${excludeClause}
          ORDER BY RANDOM()
          LIMIT 1
        `).get(boss.knowledge_point, ...allParams);
      }

      return db.prepare(`
        SELECT id, subject, topic, difficulty, type, content, options, hint, knowledge_point
        FROM question_bank
        WHERE type IN ('choice_single', 'choice_multi', 'judgment', 'fill_blank')
          ${whereExtra}
          ${excludeClause}
        ORDER BY RANDOM()
        LIMIT 1
      `).get(...allParams);
    };

    if (lastAnswer && !lastAnswer.is_correct && lastAnswer.knowledge_point) {
      question = tryGetQuestion('AND knowledge_point = ?', [lastAnswer.knowledge_point]);
    }

    if (!question && lastAnswer && !lastAnswer.is_correct && lastAnswer.topic) {
      question = tryGetQuestion('AND topic = ?', [lastAnswer.topic]);
    }

    if (!question) {
      question = tryGetQuestion('', []);
    }

    if (!question) {
      return res.status(404).json({
        error: '题库中没有更多可用的题目',
        answered_count: answeredCount,
        max_questions: maxQuestions,
      });
    }

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
      hint: question.hint,
      answered_count: answeredCount,
      max_questions: maxQuestions,
      remaining: maxQuestions - answeredCount,
    });
  } catch (error) {
    console.error('获取Boss题目失败:', error);
    res.status(500).json({ error: '获取题目失败' });
  }
});

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

    let participant = db.prepare(
      'SELECT * FROM boss_battle_participants WHERE boss_battle_id = ? AND user_id = ?'
    ).get(boss.id, req.user.userId);

    if (participant && participant.last_attack_at) {
      const lastAttack = new Date(participant.last_attack_at + 'Z').getTime();
      const now = Date.now();
      const cooldownMs = 30 * 1000;
      const elapsed = now - lastAttack;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
        return res.status(429).json({ error: `攻击冷却中，请等待${remaining}秒`, cooldown_remaining: remaining });
      }
    }

    const question = db.prepare('SELECT * FROM question_bank WHERE id = ?').get(question_id);
    if (!question) {
      return res.status(404).json({ error: '题目不存在' });
    }

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

    const difficultyMultiplier = { easy: 0.5, medium: 1.0, hard: 1.5 };
    const baseDamage = pet.level * 10;
    const multiplier = difficultyMultiplier[question.difficulty] || 1.0;
    const totalDamage = isCorrect ? Math.round(baseDamage * multiplier) : 0;

    db.prepare(`
      INSERT OR IGNORE INTO boss_battle_answers (boss_battle_id, user_id, question_id, is_correct)
      VALUES (?, ?, ?, ?)
    `).run(boss.id, req.user.userId, question_id, isCorrect ? 1 : 0);

    if (!participant) {
      db.prepare(`
        INSERT INTO boss_battle_participants (boss_battle_id, user_id, pet_id)
        VALUES (?, ?, ?)
      `).run(boss.id, req.user.userId, pet.id);

      participant = db.prepare(
        'SELECT * FROM boss_battle_participants WHERE boss_battle_id = ? AND user_id = ?'
      ).get(boss.id, req.user.userId);
    }

    db.prepare(`
      UPDATE boss_battle_participants
      SET damage_dealt = damage_dealt + ?,
          total_attempts = total_attempts + 1,
          correct_answers = correct_answers + ?,
          last_attack_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(totalDamage, isCorrect ? 1 : 0, participant.id);

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

    try {
      const myTotalDamage = participant.damage_dealt + totalDamage;
      checkAndAwardAchievement(req.user.userId, 'boss_damage', myTotalDamage);
      if (bossDefeated) {
        const killCount = db.prepare("SELECT COUNT(*) as c FROM boss_battles WHERE status = 'defeated' AND id IN (SELECT boss_battle_id FROM boss_battle_participants WHERE user_id = ?)").get(req.user.userId)?.c || 0;
        checkAndAwardAchievement(req.user.userId, 'boss_kill', killCount);
      }
    } catch (e) { console.error('成就检查失败:', e); }
  } catch (error) {
    console.error('攻击BOSS失败:', error);
    res.status(500).json({ error: '攻击BOSS失败' });
  }
});

router.post('/:bossId/claim-reward', authenticateToken, (req, res) => {
  try {
    const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ? AND status = \'defeated\'').get(req.params.bossId);
    
    if (!boss) {
      return res.status(404).json({ error: 'BOSS未被击败或不存在' });
    }

    const rewards = db.prepare(
      'SELECT * FROM boss_battle_rewards WHERE boss_battle_id = ? AND user_id = ?'
    ).all(boss.id, req.user.userId);

    if (!rewards || rewards.length === 0) {
      return res.status(404).json({ error: '没有可领取的奖励' });
    }

    const unclaimed = rewards.filter(r => !r.claimed);
    if (unclaimed.length === 0) {
      return res.status(400).json({ error: '奖励已全部领取' });
    }

    let totalGold = 0;
    let totalExp = 0;
    let equipmentGiven = null;

    for (const reward of unclaimed) {
      if (reward.reward_type === 'gold') {
        db.prepare('UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?').run(reward.reward_value, reward.reward_value, req.user.userId);
        totalGold += reward.reward_value;
      } else if (reward.reward_type === 'exp') {
        db.prepare('UPDATE pets SET exp = exp + ?, total_exp_earned = total_exp_earned + ? WHERE user_id = ?').run(reward.reward_value, reward.reward_value, req.user.userId);
        totalExp += reward.reward_value;
      } else if (reward.reward_type === 'equipment') {
        const equip = db.prepare('SELECT * FROM equipment WHERE id = ?').get(reward.reward_value);
        if (equip) {
          db.prepare('INSERT OR IGNORE INTO user_equipment (user_id, equipment_id, equipped) VALUES (?, ?, 0)').run(req.user.userId, equip.id);
          equipmentGiven = equip;
        }
      }
      db.prepare('UPDATE boss_battle_rewards SET claimed = 1 WHERE id = ?').run(reward.id);
    }

    const parts = [];
    if (totalGold > 0) parts.push(`${totalGold} 金币`);
    if (totalExp > 0) parts.push(`${totalExp} 经验`);
    if (equipmentGiven) parts.push(`装备: ${equipmentGiven.name}`);

    res.json({
      message: `领取成功: ${parts.join(', ')}`,
      rewards: { gold: totalGold, exp: totalExp, equipment: equipmentGiven }
    });
  } catch (error) {
    console.error('领取奖励失败:', error);
    res.status(500).json({ error: '领取奖励失败' });
  }
});

function distributeRewards(bossId, classId) {
  const participants = db.prepare(`
    SELECT user_id, damage_dealt FROM boss_battle_participants
    WHERE boss_battle_id = ?
  `).all(bossId);

  if (participants.length === 0) return;

  const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);
  const boss = db.prepare('SELECT * FROM boss_battles WHERE id = ?').get(bossId);

  const customRewards = db.prepare(`
    SELECT * FROM boss_battle_reward_config WHERE boss_battle_id = ?
  `).all(bossId);

  let goldPool, expPool;

  if (customRewards.length > 0) {
    const goldConfig = customRewards.find(r => r.reward_type === 'gold');
    const expConfig = customRewards.find(r => r.reward_type === 'exp');
    goldPool = goldConfig ? goldConfig.reward_value : boss.boss_level * 100;
    expPool = expConfig ? expConfig.reward_value : boss.boss_level * 50;
  } else {
    goldPool = boss.boss_level * 100;
    expPool = boss.boss_level * 50;
  }

  const allEquipment = db.prepare('SELECT id FROM equipment').all();
  const equipmentIds = allEquipment.map(e => e.id);

  for (const participant of participants) {
    const damageRatio = totalDamage > 0 ? participant.damage_dealt / totalDamage : 1 / participants.length;
    const goldReward = Math.round(goldPool * damageRatio);
    const expReward = Math.round(expPool * damageRatio);

    db.prepare(`
      INSERT OR IGNORE INTO boss_battle_rewards (boss_battle_id, user_id, reward_type, reward_value)
      VALUES (?, ?, 'gold', ?)
    `).run(bossId, participant.user_id, Math.max(10, goldReward));

    db.prepare(`
      INSERT OR IGNORE INTO boss_battle_rewards (boss_battle_id, user_id, reward_type, reward_value)
      VALUES (?, ?, 'exp', ?)
    `).run(bossId, participant.user_id, Math.max(5, expReward));

    if (equipmentIds.length > 0) {
      const randomEquipId = equipmentIds[Math.floor(Math.random() * equipmentIds.length)];
      db.prepare(`
        INSERT OR IGNORE INTO boss_battle_rewards (boss_battle_id, user_id, reward_type, reward_value)
        VALUES (?, ?, 'equipment', ?)
      `).run(bossId, participant.user_id, randomEquipId);
    }
  }
}

module.exports = router;
