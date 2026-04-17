const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

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

    const learnedSkillIds = new Set(learnedSkills.map(s => s.skill_id));

    // 检查每个技能是否可学习
    const skills = allSkills.map(skill => {
      const isLearned = learnedSkillIds.has(skill.id);
      
      // 检查解锁条件
      const canUnlock = !isLearned && 
        pet.level >= skill.required_level &&
        (!skill.required_knowledge_point || checkKnowledgePointRequirement(req.user.userId, skill));

      return {
        ...skill,
        isLearned,
        canUnlock,
        locked: !isLearned && !canUnlock
      };
    });

    res.json({
      skills,
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

    if (skill.required_knowledge_point && !checkKnowledgePointRequirement(req.user.userId, skill)) {
      return res.status(400).json({ error: `知识点掌握度不足，需要掌握: ${skill.required_knowledge_point}` });
    }

    // 学习技能
    db.prepare(`
      INSERT INTO pet_skills (pet_id, skill_id, level, mastery)
      VALUES (?, ?, 1, 0)
    `).run(pet.id, skill_id);

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
    const { skill_id, battle_id } = req.body;
    if (!skill_id) {
      return res.status(400).json({ error: '请提供技能ID' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const petSkill = db.prepare(`
      SELECT ps.*, s.*
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

    // 使用技能
    db.prepare(`
      UPDATE pet_skills 
      SET last_used = CURRENT_TIMESTAMP, use_count = use_count + 1, mastery = mastery + 1
      WHERE id = ?
    `).run(petSkill.id);

    // 计算技能效果
    const levelBonus = petSkill.level * 0.1;
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

// 辅助函数：检查知识点掌握度
function checkKnowledgePointRequirement(userId, skill) {
  if (!skill.required_knowledge_point) return true;
  
  const stats = db.prepare(`
    SELECT accuracy
    FROM knowledge_point_stats
    WHERE user_id = ? AND knowledge_point = ?
    ORDER BY date DESC
    LIMIT 1
  `).get(userId, skill.required_knowledge_point);

  if (!stats) return false;
  
  return stats.accuracy >= skill.required_accuracy;
}

module.exports = router;
