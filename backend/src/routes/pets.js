const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 检查升级
function checkLevelUp(pet) {
  const levelThreshold = Math.floor(100 * Math.pow(pet.level, 1.5));
  
  if (pet.exp >= levelThreshold) {
    const newLevel = pet.level + 1;
    db.prepare(`
      UPDATE pets 
      SET level = ?, exp = exp - ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(newLevel, levelThreshold, pet.user_id);

    let newStage = pet.growth_stage;
    if (newLevel >= 5 && pet.growth_stage === '宠物蛋') {
      newStage = '初生期';
    } else if (newLevel >= 10 && pet.growth_stage === '初生期') {
      newStage = '幼年期';
    } else if (newLevel >= 20 && pet.growth_stage === '幼年期') {
      newStage = '成长期';
    } else if (newLevel >= 35 && pet.growth_stage === '成长期') {
      newStage = '成年期';
    } else if (newLevel >= 55 && pet.growth_stage === '成年期') {
      newStage = '完全体';
    } else if (newLevel >= 80 && pet.growth_stage === '完全体') {
      newStage = '究极体';
    }

    if (newStage !== pet.growth_stage) {
      db.prepare('UPDATE pets SET growth_stage = ? WHERE user_id = ?').run(newStage, pet.user_id);
    }

    return {
      leveledUp: true,
      newLevel,
      newStage: newStage !== pet.growth_stage ? newStage : null
    };
  }

  return { leveledUp: false };
}

// 获取所有学生的宠物
router.get('/all', (req, res) => {
  try {
    const pets = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls, u.username as owner_name
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      WHERE u.role = 'student'
    `).all();

    res.json({ pets });
  } catch (error) {
    console.error('获取所有宠物错误:', error);
    res.status(500).json({ error: '获取宠物列表失败' });
  }
});

// 获取所有宠物种类
router.get('/species', (req, res) => {
  try {
    const species = db.prepare('SELECT * FROM pet_species').all();
    res.json({ species });
  } catch (error) {
    console.error('获取宠物种类错误:', error);
    res.status(500).json({ error: '获取宠物种类失败' });
  }
});

// 获取用户的宠物
router.get('/my-pet', authenticateToken, (req, res) => {
  try {
    const pet = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      WHERE p.user_id = ?
    `).get(req.user.userId);

    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const equipments = db.prepare(`
      SELECT e.stats_bonus, ue.level
      FROM user_equipment ue
      JOIN equipment e ON ue.equipment_id = e.id
      WHERE ue.user_id = ? AND ue.equipped = 1
    `).all(req.user.userId);

    let bonusAttack = 0;
    let bonusDefense = 0;
    let bonusSpeed = 0;

    for (const eq of equipments) {
      try {
        const stats = JSON.parse(eq.stats_bonus);
        const multiplier = 1 + (eq.level - 1) * 0.2;
        if (stats.attack) bonusAttack += Math.floor(stats.attack * multiplier);
        if (stats.defense) bonusDefense += Math.floor(stats.defense * multiplier);
        if (stats.speed) bonusSpeed += Math.floor(stats.speed * multiplier);
      } catch (e) {}
    }

    pet.attack += bonusAttack;
    pet.defense += bonusDefense;
    pet.speed += bonusSpeed;

    res.json({ pet, bonus: { attack: bonusAttack, defense: bonusDefense, speed: bonusSpeed } });
  } catch (error) {
    console.error('获取宠物错误:', error);
    res.status(500).json({ error: '获取宠物失败' });
  }
});

// 创建新宠物（初次选择）
router.post('/create', authenticateToken, (req, res) => {
  try {
    const { name, species_id } = req.body;

    const existingPet = db.prepare('SELECT id FROM pets WHERE user_id = ?').get(req.user.userId);
    if (existingPet) {
      return res.status(400).json({ error: '已经拥有宠物了' });
    }

    const species = db.prepare('SELECT id FROM pet_species WHERE id = ?').get(species_id);
    if (!species) {
      return res.status(400).json({ error: '无效的宠物种类' });
    }

    const result = db.prepare(`
      INSERT INTO pets (user_id, name, species_id)
      VALUES (?, ?, ?)
    `).run(req.user.userId, name, species_id);

    const basicEquipments = db.prepare('SELECT id FROM equipment WHERE rarity = ?').all('common');
    const insertEquip = db.prepare('INSERT INTO user_equipment (user_id, equipment_id, equipped, level) VALUES (?, ?, 0, 1)');
    for (const eq of basicEquipments) {
      insertEquip.run(req.user.userId, eq.id);
    }

    const pet = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
      message: '宠物创建成功',
      pet
    });
  } catch (error) {
    console.error('创建宠物错误:', error);
    res.status(500).json({ error: '创建宠物失败' });
  }
});

// 更新宠物属性
router.put('/update', authenticateToken, (req, res) => {
  try {
    const { name, attack, defense, speed } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (attack !== undefined) {
      updates.push('attack = ?');
      values.push(attack);
    }
    if (defense !== undefined) {
      updates.push('defense = ?');
      values.push(defense);
    }
    if (speed !== undefined) {
      updates.push('speed = ?');
      values.push(speed);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }

    values.push(req.user.userId);
    db.prepare(`UPDATE pets SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(...values);

    res.json({ message: '更新成功' });
  } catch (error) {
    console.error('更新宠物错误:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 投喂宠物
router.post('/feed', authenticateToken, (req, res) => {
  try {
    const { item_id } = req.body;

    const userItem = db.prepare(`
      SELECT ui.*, i.effect_type, i.effect_value
      FROM user_items ui
      JOIN items i ON ui.item_id = i.id
      WHERE ui.user_id = ? AND ui.item_id = ? AND ui.quantity > 0
    `).get(req.user.userId, item_id);

    if (!userItem) {
      return res.status(400).json({ error: '没有足够的物品' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    let updateQuery = '';
    let updateValues = [];

    if (userItem.effect_type === 'exp') {
      updateQuery = 'exp = exp + ?';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'hunger') {
      updateQuery = 'hunger = MIN(100, hunger + ?)';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'mood') {
      updateQuery = 'mood = MIN(100, mood + ?)';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'health') {
      updateQuery = 'health = MIN(100, health + ?)';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'attack') {
      updateQuery = 'attack = attack + ?';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'defense') {
      updateQuery = 'defense = defense + ?';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'speed') {
      updateQuery = 'speed = speed + ?';
      updateValues = [userItem.effect_value];
    }

    if (updateQuery) {
      updateValues.push(req.user.userId);
      db.prepare(`UPDATE pets SET ${updateQuery}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(...updateValues);
    }

    db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?').run(req.user.userId, item_id);

    const updatedPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    const levelUp = checkLevelUp(updatedPet);

    res.json({
      message: '投喂成功',
      pet: updatedPet,
      levelUp
    });
  } catch (error) {
    console.error('投喂宠物错误:', error);
    res.status(500).json({ error: '投喂失败' });
  }
});

// 获取所有宠物（用于排行榜）
router.get('/all', authenticateToken, (req, res) => {
  try {
    const pets = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls,
             u.username as owner_name
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      ORDER BY p.level DESC, p.exp DESC
      LIMIT 50
    `).all();

    res.json({ pets });
  } catch (error) {
    console.error('获取宠物列表错误:', error);
    res.status(500).json({ error: '获取宠物列表失败' });
  }
});

// 获取其他用户的宠物详情
router.get('/user/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    
    const pet = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls, u.username as owner_name
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ?
    `).get(userId);

    if (!pet) {
      return res.status(404).json({ error: '该用户还没有宠物' });
    }

    const equipments = db.prepare(`
      SELECT e.*, ue.level
      FROM user_equipment ue
      JOIN equipment e ON ue.equipment_id = e.id
      WHERE ue.user_id = ? AND ue.equipped = 1
    `).all(userId);

    let bonusAttack = 0;
    let bonusDefense = 0;
    let bonusSpeed = 0;

    for (const eq of equipments) {
      try {
        const stats = JSON.parse(eq.stats_bonus);
        const multiplier = 1 + (eq.level - 1) * 0.2;
        if (stats.attack) bonusAttack += Math.floor(stats.attack * multiplier);
        if (stats.defense) bonusDefense += Math.floor(stats.defense * multiplier);
        if (stats.speed) bonusSpeed += Math.floor(stats.speed * multiplier);
      } catch (e) {}
    }

    pet.attack += bonusAttack;
    pet.defense += bonusDefense;
    pet.speed += bonusSpeed;

    res.json({ pet, equipments, bonus: { attack: bonusAttack, defense: bonusDefense, speed: bonusSpeed } });
  } catch (error) {
    console.error('获取用户宠物错误:', error);
    res.status(500).json({ error: '获取宠物详情失败' });
  }
});

module.exports = { router, checkLevelUp };
