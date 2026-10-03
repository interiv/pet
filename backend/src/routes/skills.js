const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { recordGoldChange, recordItemChange } = require('../services/rewards');

// 宠物技能槽上限
const MAX_SKILL_SLOTS = 4;

// 已占用的技能槽
function usedSkillSlots(petId) {
  return db.prepare('SELECT slot FROM pet_skills WHERE pet_id = ?').all(petId)
    .map((r) => r.slot)
    .filter((s) => Number.isInteger(s));
}

function countPetSkills(petId) {
  return db.prepare('SELECT COUNT(*) as c FROM pet_skills WHERE pet_id = ?').get(petId)?.c || 0;
}

// 分配技能槽：取 1..MAX_SKILL_SLOTS 中最小的空位。
// 原先 pets.js 用「已有数量 + 1」，遗忘中间槽位后再学会产生重复槽号。
function allocateSkillSlot(petId) {
  const used = usedSkillSlots(petId);
  for (let i = 1; i <= MAX_SKILL_SLOTS; i++) {
    if (!used.includes(i)) return i;
  }
  return null;
}

// 获取所有可用技能
router.get('/available', authenticateToken, (req, res) => {
  try {
    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    // 获取所有技能
    const allSkills = db.prepare('SELECT * FROM skills ORDER BY required_level').all();

    // 获取用户已学习的技能
    const learnedSkills = db.prepare(`
      SELECT ps.*, s.name, s.description, s.icon, s.skill_type, s.subject
      FROM pet_skills ps
      JOIN skills s ON ps.skill_id = s.id
      WHERE ps.pet_id = ?
    `).all(pet.id);

    const learnedMap = new Map(learnedSkills.map((s) => [s.skill_id, s]));

    // 检查每个技能是否可学习
    const skills = allSkills.map(skill => {
      const learned = learnedMap.get(skill.id) || null;
      const isLearned = !!learned;

      // 检查解锁条件：等级 + 知识点掌握度 + 该学科正确率（seeds 里定义的门槛）
      let lockReason = '';
      if (pet.level < (skill.required_level || 1)) {
        lockReason = `需要宠物达到 ${skill.required_level} 级`;
      } else if (skill.required_knowledge_point) {
        // knowledge_point_stats 用 accuracy（0~1）表示掌握度
        const kp = db.prepare(
          `SELECT AVG(accuracy) AS acc, SUM(total_attempts) AS attempts
             FROM knowledge_point_stats
            WHERE user_id = ? AND knowledge_point = ?`
        ).get(req.user.userId, skill.required_knowledge_point);
        const attempts = kp && kp.attempts ? kp.attempts : 0;
        const acc = kp && kp.acc != null ? kp.acc : 0;
        if (attempts === 0 || acc < 0.6) {
          lockReason = `需要掌握知识点「${skill.required_knowledge_point}」（正确率 60%）`;
        }
      } else if (skill.required_accuracy) {
        // question_answers 没有 subject 列，需经 submissions 关联
        const params = skill.subject ? [req.user.userId, skill.subject] : [req.user.userId];
        const acc = db.prepare(
          `SELECT AVG(CASE WHEN qa.is_correct = 1 THEN 1.0 ELSE 0 END) AS rate
             FROM question_answers qa
             JOIN submissions s ON s.id = qa.submission_id
            WHERE s.user_id = ? ${skill.subject ? 'AND s.assignment_id IN (SELECT id FROM assignments WHERE subject = ?)' : ''}`
        ).get(...params);
        const rate = acc && acc.rate != null ? acc.rate : 0;
        if (rate < skill.required_accuracy) {
          lockReason = `需要${skill.subject || '该学科'}正确率达到 ${Math.round(skill.required_accuracy * 100)}%`;
        }
      }

      const canUnlock = !isLearned && !lockReason;

      return {
        ...skill,
        isLearned,
        canUnlock,
        lockReason,
        locked: !isLearned && !canUnlock,
        // 已学习的技能要带上 pet_skills 的等级/精通度/使用次数，
        // 否则前端会显示 Lv.undefined、精通度恒为 0%
        level: learned ? learned.level : 0,
        mastery: learned ? learned.mastery : 0,
        use_count: learned ? learned.use_count : 0,
        learned_at: learned ? learned.learned_at : null,
      };
    });

    res.json({
      skills,
      learnedCount: learnedSkills.length,
      pet: {
        id: pet.id,
        name: pet.name,
        level: pet.level
      }
    });
  } catch (error) {
    console.error('获取技能列表失败:', error);
    res.status(500).json({ error: '获取技能列表失败' });
  }
});

// 学习技能
router.post('/learn', authenticateToken, (req, res) => {
  try {
    const { skill_id } = req.body;
    if (!skill_id) {
      return res.status(400).json({ error: '请提供技能ID' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skill_id);
    if (!skill) {
      return res.status(404).json({ error: '技能不存在' });
    }

    // 检查是否已学习
    const existing = db.prepare('SELECT id FROM pet_skills WHERE pet_id = ? AND skill_id = ?').get(pet.id, skill_id);
    if (existing) {
      return res.status(400).json({ error: '已学习该技能' });
    }

    // 检查解锁条件
    if (pet.level < skill.required_level) {
      return res.status(400).json({ error: `宠物等级不足，需要等级 ${skill.required_level}` });
    }

    // 技能槽上限校验（原先本接口完全没有校验，可无限学技能）
    const slot = allocateSkillSlot(pet.id);
    if (slot === null) {
      return res.status(400).json({ error: `技能槽已满（最多 ${MAX_SKILL_SLOTS} 个），请先遗忘一个技能` });
    }

    db.prepare(`
      INSERT INTO pet_skills (pet_id, skill_id, slot, level, mastery)
      VALUES (?, ?, ?, 1, 0)
    `).run(pet.id, skill_id, slot);

    res.json({
      message: `成功学习技能: ${skill.name}`,
      skill
    });
  } catch (error) {
    console.error('学习技能失败:', error);
    res.status(500).json({ error: '学习技能失败' });
  }
});

// 升级技能
router.post('/upgrade', authenticateToken, (req, res) => {
  try {
    const { skill_id } = req.body;
    if (!skill_id) {
      return res.status(400).json({ error: '请提供技能ID' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const petSkill = db.prepare('SELECT * FROM pet_skills WHERE pet_id = ? AND skill_id = ?').get(pet.id, skill_id);
    if (!petSkill) {
      return res.status(404).json({ error: '未学习该技能' });
    }

    if (petSkill.level >= 10) {
      return res.status(400).json({ error: '技能已达最高等级' });
    }

    // 升级需要消耗金币
    const goldCost = petSkill.level * 50;
    const user = db.prepare('SELECT gold FROM users WHERE id = ?').get(req.user.userId);
    
    if (user.gold < goldCost) {
      return res.status(400).json({ error: `金币不足，需要 ${goldCost} 金币` });
    }

    // 扣除金币并升级技能
    db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(goldCost, req.user.userId);
    const skillName = (db.prepare('SELECT name FROM skills WHERE id = ?').get(skill_id) || {}).name || `技能#${skill_id}`;
    recordGoldChange(req.user.userId, -goldCost, `升级技能：${skillName} Lv.${petSkill.level}`, 'upgrade_skill');
    db.prepare('UPDATE pet_skills SET level = level + 1 WHERE id = ?').run(petSkill.id);

    const updatedPetSkill = db.prepare('SELECT * FROM pet_skills WHERE id = ?').get(petSkill.id);
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skill_id);

    res.json({
      message: `技能升级成功: ${skill.name} Lv.${updatedPetSkill.level}`,
      skill: updatedPetSkill,
      goldCost
    });
  } catch (error) {
    console.error('升级技能失败:', error);
    res.status(500).json({ error: '升级技能失败' });
  }
});

// 使用技能（在战斗中）
router.post('/use', authenticateToken, (req, res) => {
  try {
    // battle_id 目前未参与任何校验（原实现接收后即丢弃），保留仅为兼容旧前端传参
    const { skill_id, battle_id: _battleId } = req.body;
    if (!skill_id) {
      return res.status(400).json({ error: '请提供技能ID' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    // 显式列出字段并给 skills 的同名列加别名。
    // 原先写 SELECT ps.*, s.* ，s.* 会覆盖 ps.id / ps.level，
    // 导致下面 UPDATE pet_skills WHERE id = ? 用到的是 skills 表的 id，改到别的记录上。
    const petSkill = db.prepare(`
      SELECT
        ps.id            AS pet_skill_id,
        ps.pet_id        AS pet_id,
        ps.skill_id      AS skill_id,
        ps.level         AS pet_skill_level,
        ps.mastery       AS mastery,
        ps.use_count     AS use_count,
        ps.last_used     AS last_used,
        s.id             AS skill_row_id,
        s.name           AS name,
        s.description    AS description,
        s.icon           AS icon,
        s.skill_type     AS skill_type,
        s.subject        AS subject,
        s.required_level AS required_level,
        s.cooldown       AS cooldown,
        s.base_damage    AS base_damage,
        s.base_defense   AS base_defense,
        s.base_speed     AS base_speed
      FROM pet_skills ps
      JOIN skills s ON ps.skill_id = s.id
      WHERE ps.pet_id = ? AND ps.skill_id = ?
    `).get(pet.id, skill_id);

    if (!petSkill) {
      return res.status(404).json({ error: '未学习该技能' });
    }

    // 检查冷却时间（简化处理）
    if (petSkill.last_used) {
      const lastUsed = new Date(petSkill.last_used);
      const now = new Date();
      const hoursSinceLastUse = (now - lastUsed) / (1000 * 60 * 60);
      
      if (hoursSinceLastUse < petSkill.cooldown) {
        return res.status(400).json({ 
          error: `技能冷却中，还需等待 ${Math.ceil(petSkill.cooldown - hoursSinceLastUse)} 小时` 
        });
      }
    }

    // 使用技能（注意用别名后的 pet_skill_id，避免误用 skills 表 id）
    db.prepare(`
      UPDATE pet_skills 
      SET last_used = CURRENT_TIMESTAMP, use_count = use_count + 1, mastery = mastery + 1
      WHERE id = ?
    `).run(petSkill.pet_skill_id);

    // 计算技能效果（用宠物自身技能等级，而非技能模板等级）
    const levelBonus = petSkill.pet_skill_level * 0.1;
    const effect = {
      damage: Math.round(petSkill.base_damage * (1 + levelBonus)),
      defense: Math.round(petSkill.base_defense * (1 + levelBonus)),
      speed: Math.round(petSkill.base_speed * (1 + levelBonus))
    };

    res.json({
      message: `使用了技能: ${petSkill.name}`,
      skill: petSkill.name,
      icon: petSkill.icon,
      effect,
      mastery: petSkill.mastery + 1
    });
  } catch (error) {
    console.error('使用技能失败:', error);
    res.status(500).json({ error: '使用技能失败' });
  }
});

module.exports = router;
module.exports.MAX_SKILL_SLOTS = MAX_SKILL_SLOTS;
module.exports.allocateSkillSlot = allocateSkillSlot;
module.exports.countPetSkills = countPetSkills;
