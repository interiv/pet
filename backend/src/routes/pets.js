const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { updateTaskProgress } = require('./daily-tasks');
const { checkAndAwardAchievement } = require('./achievements');
// 技能槽规则统一复用 skills.js 的实现，避免两个学习接口口径不一致
const { allocateSkillSlot, countPetSkills, MAX_SKILL_SLOTS } = require('./skills');
const { recordItemChange } = require('../services/rewards');

// 取道具名（user_items 查询不一定带出 items.name，缺省回退成「道具#id」）
function itemNameOf(userItem, itemId) {
  return (userItem && (userItem.item_name || userItem.name)) || `道具#${itemId}`;
}

// feed_count 已由 001_initial_schema 创建，缺失时由 004 号迁移兜底，不再在运行时 ALTER

// 检查升级（支持一次连续升多级）
function checkLevelUp(pet) {
  // 以库里的当前值为准，避免调用方传入的 pet 对象已过期导致经验被算错
  const row = db.prepare('SELECT level, exp, growth_stage FROM pets WHERE id = ?').get(pet.id);
  if (!row) return { leveledUp: false };

  let newLevel = row.level;
  let newStage = row.growth_stage;
  let restExp = row.exp;
  let levelsGained = 0;

  // 一次获得大量经验（作业/BOSS奖励/经验卡）时可能连升多级，
  // 原先只升一级，多余经验会被卡住，必须等到下一次操作才继续升。
  // guard 防止阈值异常时死循环。
  for (let guard = 0; guard < 200; guard++) {
    const levelThreshold = Math.floor(100 * Math.pow(newLevel, 1.5));
    if (restExp < levelThreshold) break;

    restExp -= levelThreshold;
    newLevel += 1;
    levelsGained += 1;

    // 每升一级都重新判定成长阶段
    if (newLevel >= 5 && newStage === '宠物蛋') newStage = '初生期';
    else if (newLevel >= 10 && newStage === '初生期') newStage = '幼年期';
    else if (newLevel >= 20 && newStage === '幼年期') newStage = '成长期';
    else if (newLevel >= 35 && newStage === '成长期') newStage = '成年期';
    else if (newLevel >= 55 && newStage === '成年期') newStage = '完全体';
    else if (newLevel >= 80 && newStage === '完全体') newStage = '究极体';
  }

  if (levelsGained === 0) return { leveledUp: false };

  db.prepare(`
    UPDATE pets
    SET level = ?, exp = ?, growth_stage = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newLevel, restExp, newStage, pet.id);

  try {
    checkAndAwardAchievement(pet.user_id, 'pet_level', newLevel);
    // total_exp_earned 已在调用方更新，这里检查累计经验成就
    const updatedPet = db.prepare('SELECT total_exp_earned FROM pets WHERE id = ?').get(pet.id);
    if (updatedPet) checkAndAwardAchievement(pet.user_id, 'total_exp', updatedPet.total_exp_earned);
  } catch (e) { console.error('成就检查失败:', e); }

  return {
    leveledUp: true,
    newLevel,
    levelsGained,
    newStage: newStage !== row.growth_stage ? newStage : null
  };
}

// 获取学生宠物（必须按班级过滤，防止跨校数据泄露）
router.get('/all', authenticateToken, (req, res) => {
  try {
    const classId = parseInt(req.query.class_id, 10);
    if (!classId) {
      return res.json({ pets: [] });
    }

    // 非管理员：需验证班级成员身份
    if (req.user.role !== 'admin') {
      const asStudent = db.prepare(`SELECT 1 FROM users WHERE id = ? AND class_id = ?`).get(req.user.userId, classId);
      const asTeacher = db.prepare(`SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?`).get(req.user.userId, classId);
      if (!asStudent && !asTeacher) {
        return res.status(403).json({ error: '无权访问该班级宠物' });
      }
    }

    const pets = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls, COALESCE(u.real_name, u.username) as owner_name, u.class_id
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      JOIN users u ON p.user_id = u.id
      WHERE u.role = 'student' AND u.class_id = ?
      ORDER BY p.level DESC, p.exp DESC
    `).all(classId);
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
      SELECT e.stats_bonus, e.set_id, ue.level
      FROM user_equipment ue
      JOIN equipment e ON ue.equipment_id = e.id
      WHERE ue.user_id = ? AND ue.equipped = 1
    `).all(req.user.userId);

    let bonusAttack = 0;
    let bonusDefense = 0;
    let bonusSpeed = 0;
    let setBonusAttack = 0;
    let setBonusDefense = 0;
    let setBonusSpeed = 0;

    const setCounts = {};
    for (const eq of equipments) {
      try {
        const stats = JSON.parse(eq.stats_bonus);
        const multiplier = 1 + (eq.level - 1) * 0.2;
        if (stats.attack) bonusAttack += Math.floor(stats.attack * multiplier);
        if (stats.defense) bonusDefense += Math.floor(stats.defense * multiplier);
        if (stats.speed) bonusSpeed += Math.floor(stats.speed * multiplier);
        if (eq.set_id) {
          setCounts[eq.set_id] = (setCounts[eq.set_id] || 0) + 1;
        }
      } catch (e) {}
    }

    for (const [setName, count] of Object.entries(setCounts)) {
      if (count >= 2) {
        setBonusAttack += 5;
        setBonusDefense += 5;
        setBonusSpeed += 5;
      }
      if (count >= 4) {
        setBonusAttack += 10;
        setBonusDefense += 10;
        setBonusSpeed += 10;
      }
    }

    pet.attack += bonusAttack + setBonusAttack;
    pet.defense += bonusDefense + setBonusDefense;
    pet.speed += bonusSpeed + setBonusSpeed;

    res.json({
      pet,
      bonus: {
        equipment: { attack: bonusAttack, defense: bonusDefense, speed: bonusSpeed },
        set: { attack: setBonusAttack, defense: setBonusDefense, speed: setBonusSpeed }
      }
    });
  } catch (error) {
    console.error('获取宠物错误:', error);
    res.status(500).json({ error: '获取宠物失败' });
  }
});

// 创建新宠物（初次选择）
router.post('/create', authenticateToken, (req, res) => {
  try {
    const { name, species_id } = req.body;

    // 每用户最大宠物数：原先硬编码「一人一只」，管理员改max_pets_per_user 不生效
    const maxPetsRow = db.prepare(`SELECT value FROM settings WHERE key = 'max_pets_per_user'`).get();
    const maxPets = Math.max(1, parseInt(maxPetsRow && maxPetsRow.value) || 1);
    const ownedPets = db.prepare('SELECT COUNT(*) as c FROM pets WHERE user_id = ?').get(req.user.userId)?.c || 0;
    if (ownedPets >= maxPets) {
      return res.status(400).json({
        error: maxPets === 1 ? '已经拥有宠物了' : `最多只能拥有 ${maxPets} 只宠物`
      });
    }

    const species = db.prepare('SELECT * FROM pet_species WHERE id = ?').get(species_id);
    if (!species) {
      return res.status(400).json({ error: '无效的宠物种类' });
    }

    let baseStats = { attack: 10, defense: 10, speed: 10 };
    try {
      if (species.base_stats) {
        const parsed = JSON.parse(species.base_stats);
        baseStats.attack = parsed.attack || 10;
        baseStats.defense = parsed.defense || 10;
        baseStats.speed = parsed.speed || 10;
      }
    } catch (e) { /* 使用默认值 */ }

    const result = db.prepare(`
      INSERT INTO pets (user_id, name, species_id, attack, defense, speed)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.userId, name, species_id, baseStats.attack, baseStats.defense, baseStats.speed);

    const basicEquipments = db.prepare('SELECT id FROM equipment WHERE rarity = ?').all('common');
    const insertEquip = db.prepare('INSERT INTO user_equipment (user_id, equipment_id, equipped, level) VALUES (?, ?, 0, 1)');
    for (const eq of basicEquipments) {
      insertEquip.run(req.user.userId, eq.id);
    }

    // 赠送新手初始道具：3个普通粮食
    const starterItem = db.prepare('SELECT id, name FROM items WHERE name = ?').get('普通粮食');
    if (starterItem) {
      db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, ?)').run(req.user.userId, starterItem.id, 3);
      recordItemChange(req.user.userId, {
        refType: 'item', refId: starterItem.id, name: starterItem.name,
        quantity: 3, reason: '新手赠送道具', source: 'create_pet',
      });
    }

    const pet = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls
      FROM pets p
      JOIN pet_species ps ON p.species_id = ps.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid);

    // 预置入门技能：否则新宠物一个技能都没有，技能页看起来是空的
    // （技能只能手动学，若不预置，学生永远不知道还有「技能培养」这回事）
    try {
      const starterSkill = db.prepare(
        'SELECT id, name FROM skills ORDER BY required_level ASC, id ASC LIMIT 1'
      ).get();
      if (starterSkill) {
        const has = db.prepare('SELECT id FROM pet_skills WHERE pet_id = ? AND skill_id = ?')
          .get(pet.id, starterSkill.id);
        if (!has) {
          db.prepare('INSERT INTO pet_skills (pet_id, skill_id, level, mastery, use_count) VALUES (?, ?, 1, 0, 0)')
            .run(pet.id, starterSkill.id);
          recordItemChange(req.user.userId, {
            refType: 'skill', refId: starterSkill.id, name: starterSkill.name,
            change: 1, reason: '新手预置技能', source: 'create_pet',
          });
        }
      }
    } catch (e) {
      console.error('预置新手技能失败（不影响创建宠物）:', e.message);
    }

    try {
      checkAndAwardAchievement(req.user.userId, 'create_pet', 1);
      const equipCount = db.prepare('SELECT COUNT(*) as c FROM user_equipment WHERE user_id = ?').get(req.user.userId)?.c || 0;
      checkAndAwardAchievement(req.user.userId, 'collect_equipment', equipCount);
    } catch (e) { console.error('成就检查失败:', e); }

    res.status(201).json({
      message: '宠物创建成功',
      pet
    });
  } catch (error) {
    console.error('创建宠物错误:', error);
    res.status(500).json({ error: '创建宠物失败' });
  }
});

// 更新宠物名称（仅允许改名，属性不可直接修改）
router.put('/update', authenticateToken, (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '请输入宠物名称' });
    }

    if (name.trim().length > 20) {
      return res.status(400).json({ error: '宠物名称不能超过20个字符' });
    }

    db.prepare(`UPDATE pets SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(name.trim(), req.user.userId);

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
      SELECT ui.*, i.effect_type, i.effect_value, i.name as item_name
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
    let specialEffect = null;

    if (userItem.effect_type === 'exp') {
      updateQuery = 'exp = exp + ?, total_exp_earned = total_exp_earned + ?';
      updateValues = [userItem.effect_value, userItem.effect_value];
    } else if (userItem.effect_type === 'hunger') {
      updateQuery = 'hunger = MIN(100, hunger + ?)';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'mood') {
      updateQuery = 'mood = MIN(100, mood + ?)';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'health') {
      updateQuery = 'health = MIN(100, health + ?)';
      updateValues = [userItem.effect_value];
    } else if (userItem.effect_type === 'stamina') {
      updateQuery = 'stamina = MIN(100, stamina + ?)';
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
    } else if (userItem.effect_type === 'rename') {
      specialEffect = 'rename';
    } else if (userItem.effect_type === 'reincarnate') {
      specialEffect = 'reincarnate';
    } else if (userItem.effect_type === 'double_exp') {
      specialEffect = 'double_exp';
    } else if (userItem.effect_type === 'luck') {
      specialEffect = 'luck';
    } else if (userItem.effect_type === 'shield') {
      specialEffect = 'shield';
    } else if (userItem.effect_type.startsWith('buff_')) {
      specialEffect = userItem.effect_type;
    } else {
      return res.status(400).json({ error: '该物品无法投喂' });
    }

    if (specialEffect) {
      return res.status(400).json({ error: '该物品需要在对应功能中使用，无法直接投喂' });
    }

    if (updateQuery) {
      updateValues.push(req.user.userId);
      let fullQuery = `UPDATE pets SET ${updateQuery}`;
      let finalValues = [...updateValues];

      if (userItem.effect_type === 'hunger') {
        fullQuery += ', mood = MIN(100, mood + 5)';
      } else if (userItem.effect_type === 'stamina') {
        fullQuery += ', mood = MIN(100, mood + 3)';
      }

      const bonusEffects = {
        '万灵药': ', hunger = 100, mood = 100',
        '营养套餐': ', mood = MIN(100, mood + 30)',
        '满汉全席': ', mood = 100, stamina = 100',
        '灵丹妙药': ', health = 100, mood = 100'
      };
      if (bonusEffects[userItem.item_name]) {
        fullQuery += bonusEffects[userItem.item_name];
      }

      fullQuery += ', feed_count = feed_count + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?';
      db.prepare(fullQuery).run(...finalValues);
    }

    db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?').run(req.user.userId, item_id);
    recordItemChange(req.user.userId, {
      refType: 'item', refId: item_id, name: userItem.item_name || `道具#${item_id}`,
      change: -1, reason: '投喂宠物', source: 'feed_pet',
    });

    // 更新每日任务进度
    try {
      updateTaskProgress(req.user.userId, 'feed_pet', 1);
    } catch (error) {
      console.error('更新每日任务进度失败:', error);
    }

    const updatedPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    checkPetStatus(updatedPet);
    const levelUp = checkLevelUp(updatedPet);

    try {
      const feedCount = db.prepare('SELECT feed_count FROM pets WHERE user_id = ?').get(req.user.userId)?.feed_count || 0;
      checkAndAwardAchievement(req.user.userId, 'feed_pet', feedCount);
    } catch (e) { console.error('成就检查失败:', e); }

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
router.get('/leaderboard', authenticateToken, (req, res) => {
  try {
    const pets = db.prepare(`
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls,
             COALESCE(u.real_name, u.username) as owner_name
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
      SELECT p.*, ps.name as species_name, ps.element_type, ps.image_urls, COALESCE(u.real_name, u.username) as owner_name
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

// 获取所有可用技能
router.get('/all-skills', (req, res) => {
  try {
    const skills = db.prepare('SELECT * FROM skills').all();
    res.json({ skills });
  } catch (error) {
    console.error('获取技能列表错误:', error);
    res.status(500).json({ error: '获取技能列表失败' });
  }
});

// 检查宠物是否濒死/死亡状态
function checkPetStatus(pet) {
  if (pet.hunger <= 0 || pet.health <= 0) {
    if (pet.status !== 'unconscious') {
      db.prepare("UPDATE pets SET status = 'unconscious' WHERE id = ?").run(pet.id);
    }
    return true;
  }
  if (pet.status === 'unconscious') {
    db.prepare("UPDATE pets SET status = 'normal' WHERE id = ?").run(pet.id);
  }
  return false;
}

// 复活宠物
router.post('/revive', authenticateToken, (req, res) => {
  try {
    const { item_id } = req.body;

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    if (pet.status !== 'unconscious') {
      return res.status(400).json({ error: '宠物不需要复活' });
    }

    // 必须消耗复活道具：原先 item_id 可省略，不传即可零成本复活，复活道具形同虚设
    if (!item_id) {
      return res.status(400).json({ error: '复活需要消耗复活道具' });
    }
    const userItem = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ? AND quantity > 0').get(req.user.userId, item_id);
    if (!userItem) {
      return res.status(400).json({ error: '没有复活道具' });
    }
    db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?').run(req.user.userId, item_id);
    recordItemChange(req.user.userId, {
      refType: 'item', refId: item_id, name: itemNameOf(userItem, item_id),
      change: -1, reason: '复活宠物', source: 'revive_pet',
    });

    const penalty = 0.1 + Math.random() * 0.05;
    const newAttack = Math.floor(pet.attack * (1 - penalty));
    const newDefense = Math.floor(pet.defense * (1 - penalty));
    const newSpeed = Math.floor(pet.speed * (1 - penalty));

    db.prepare(`
      UPDATE pets SET
        status = 'normal',
        hunger = 50,
        health = 50,
        mood = 50,
        attack = ?,
        defense = ?,
        speed = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(newAttack, newDefense, newSpeed, req.user.userId);

    const updatedPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);

    res.json({
      message: `复活成功，属性下降 ${Math.floor(penalty * 100)}%`,
      pet: updatedPet
    });
  } catch (error) {
    console.error('复活宠物错误:', error);
    res.status(500).json({ error: '复活失败' });
  }
});

// 宠物转生
router.post('/rebirth', authenticateToken, (req, res) => {
  try {
    const { item_id } = req.body;

    if (!item_id) {
      return res.status(400).json({ error: '需要提供转生道具' });
    }

    const userItem = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ? AND quantity > 0').get(req.user.userId, item_id);
    if (!userItem) {
      return res.status(400).json({ error: '没有转生丹' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const multiplier = 1.2;
    const newAttack = Math.floor(pet.attack * multiplier);
    const newDefense = Math.floor(pet.defense * multiplier);
    const newSpeed = Math.floor(pet.speed * multiplier);

    db.prepare(`
      UPDATE pets SET
        level = 1,
        exp = 0,
        attack = ?,
        defense = ?,
        speed = ?,
        growth_stage = '宠物蛋',
        stamina = 100,
        hunger = 100,
        mood = 100,
        health = 100,
        rebirth_count = rebirth_count + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newAttack, newDefense, newSpeed, pet.id);

    db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?').run(req.user.userId, item_id);
    recordItemChange(req.user.userId, {
      refType: 'item', refId: item_id, name: itemNameOf(userItem, item_id),
      change: -1, reason: '宠物转生', source: 'rebirth_pet',
    });

    const updatedPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);

    res.json({
      message: '转生成功，基础属性永久提升20%',
      pet: updatedPet
    });
  } catch (error) {
    console.error('转生错误:', error);
    res.status(500).json({ error: '转生失败' });
  }
});

// 学习技能
router.post('/learn-skill', authenticateToken, (req, res) => {
  try {
    const { skill_id } = req.body;

    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skill_id);
    if (!skill) {
      return res.status(404).json({ error: '技能不存在' });
    }

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    // 与 skills.js /learn 保持同一套规则：等级门槛 + 4 槽上限 + 最小空位分配
    if (skill.required_level && pet.level < skill.required_level) {
      return res.status(400).json({ error: `宠物等级不足，需要等级 ${skill.required_level}` });
    }

    const slot = allocateSkillSlot(pet.id);
    if (slot === null) {
      return res.status(400).json({ error: `技能槽已满（最多 ${MAX_SKILL_SLOTS} 个），请先遗忘一个技能` });
    }

    const alreadyLearned = db.prepare('SELECT * FROM pet_skills WHERE pet_id = ? AND skill_id = ?').get(pet.id, skill_id);
    if (alreadyLearned) {
      return res.status(400).json({ error: '已经学会这个技能了' });
    }

    db.prepare('INSERT INTO pet_skills (pet_id, skill_id, slot, level, mastery) VALUES (?, ?, ?, 1, 0)').run(pet.id, skill_id, slot);

    res.json({ message: `学会技能：${skill.name}`, skill });
  } catch (error) {
    console.error('学习技能错误:', error);
    res.status(500).json({ error: '学习技能失败' });
  }
});

// 遗忘技能
router.post('/forget-skill', authenticateToken, (req, res) => {
  try {
    const { skill_id } = req.body;

    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const petSkill = db.prepare('SELECT * FROM pet_skills WHERE pet_id = ? AND skill_id = ?').get(pet.id, skill_id);
    if (!petSkill) {
      return res.status(400).json({ error: '宠物没有学会这个技能' });
    }

    db.prepare('DELETE FROM pet_skills WHERE pet_id = ? AND skill_id = ?').run(pet.id, skill_id);

    res.json({ message: '遗忘技能成功' });
  } catch (error) {
    console.error('遗忘技能错误:', error);
    res.status(500).json({ error: '遗忘技能失败' });
  }
});

// 获取宠物技能列表
router.get('/skills', authenticateToken, (req, res) => {
  try {
    const pet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const skills = db.prepare(`
      SELECT s.*, ps.slot
      FROM pet_skills ps
      JOIN skills s ON ps.skill_id = s.id
      WHERE ps.pet_id = ?
      ORDER BY ps.slot
    `).all(pet.id);

    res.json({ skills });
  } catch (error) {
    console.error('获取技能列表错误:', error);
    res.status(500).json({ error: '获取技能列表失败' });
  }
});

module.exports = { router, checkLevelUp };
