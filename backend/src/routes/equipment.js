const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// 计算套装效果
function calculateSetBonus(userId) {
  const equipped = db.prepare(`
    SELECT e.set_id
    FROM user_equipment ue
    JOIN equipment e ON ue.equipment_id = e.id
    WHERE ue.user_id = ? AND ue.equipped = 1 AND e.set_id IS NOT NULL
  `).all(userId);

  if (!equipped || equipped.length === 0) {
    return { setBonus: null, totalBonus: { attack: 0, defense: 0, speed: 0 } };
  }

  const setCounts = {};
  equipped.forEach(e => {
    if (e.set_id) {
      setCounts[e.set_id] = (setCounts[e.set_id] || 0) + 1;
    }
  });

  let totalBonus = { attack: 0, defense: 0, speed: 0 };
  const activeSets = [];

  for (const [setId, count] of Object.entries(setCounts)) {
    if (count >= 2) {
      activeSets.push({ name: `套装${setId}`, pieces: count, tier: 'basic' });
      totalBonus.attack += 5;
      totalBonus.defense += 5;
      totalBonus.speed += 5;
    }
    if (count >= 4) {
      activeSets.push({ name: `套装${setId}`, pieces: count, tier: 'complete' });
      totalBonus.attack += 10;
      totalBonus.defense += 10;
      totalBonus.speed += 10;
    }
  }

  return { setBonus: activeSets, totalBonus };
}

router.get('/all', authenticateToken, authorizeRole('teacher', 'admin'), (req, res) => {
  try {
    const equipments = db.prepare('SELECT * FROM equipment ORDER BY rarity, id').all();
    res.json({ equipments });
  } catch (error) {
    console.error('获取装备列表失败:', error);
    res.status(500).json({ error: '获取装备列表失败' });
  }
});

router.get('/shop', authenticateToken, (req, res) => {
  try {
    const equipments = db.prepare('SELECT * FROM equipment ORDER BY slot, rarity, required_level').all();
    const userEquips = db.prepare('SELECT equipment_id FROM user_equipment WHERE user_id = ?').all(req.user.userId);
    const ownedIds = new Set(userEquips.map(e => e.equipment_id));
    const pet = db.prepare('SELECT level FROM pets WHERE user_id = ?').get(req.user.userId);
    const petLevel = pet ? pet.level : 1;

    const shopList = equipments.map(e => ({
      ...e,
      owned: ownedIds.has(e.id),
      can_buy: !ownedIds.has(e.id) && petLevel >= e.required_level,
      level_locked: petLevel < e.required_level
    }));

    res.json({ equipments: shopList, petLevel });
  } catch (error) {
    console.error('获取装备商店失败:', error);
    res.status(500).json({ error: '获取装备商店失败' });
  }
});

router.post('/buy', authenticateToken, (req, res) => {
  try {
    const { equipment_id } = req.body;

    const equip = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id);
    if (!equip) {
      return res.status(404).json({ error: '装备不存在' });
    }

    const existing = db.prepare('SELECT id FROM user_equipment WHERE user_id = ? AND equipment_id = ?').get(req.user.userId, equipment_id);
    if (existing) {
      return res.status(400).json({ error: '你已经拥有该装备' });
    }

    const pet = db.prepare('SELECT level FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!pet || pet.level < equip.required_level) {
      return res.status(400).json({ error: `宠物等级不足，需要 ${equip.required_level} 级` });
    }

    const user = db.prepare('SELECT gold FROM users WHERE id = ?').get(req.user.userId);
    if (!user || user.gold < equip.price) {
      return res.status(400).json({ error: `金币不足，需要 ${equip.price} 金币` });
    }

    const buyTransaction = db.transaction(() => {
      db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(equip.price, req.user.userId);
      db.prepare('INSERT INTO user_equipment (user_id, equipment_id, equipped, level) VALUES (?, ?, 0, 1)').run(req.user.userId, equipment_id);
    });
    buyTransaction();

    res.json({ message: `购买成功：${equip.name}`, equipment: equip });
  } catch (error) {
    console.error('购买装备失败:', error);
    res.status(500).json({ error: '购买装备失败' });
  }
});

router.post('/sell', authenticateToken, (req, res) => {
  try {
    const { user_equip_id } = req.body;

    const equip = db.prepare(`
      SELECT ue.*, e.name, e.price, e.slot, e.stats_bonus, e.rarity
      FROM user_equipment ue
      JOIN equipment e ON ue.equipment_id = e.id
      WHERE ue.id = ? AND ue.user_id = ?
    `).get(user_equip_id, req.user.userId);

    if (!equip) {
      return res.status(404).json({ error: '未找到该装备' });
    }

    if (equip.equipped === 1) {
      return res.status(400).json({ error: '请先卸下装备再出售' });
    }

    const levelMultiplier = 1 + (equip.level - 1) * 0.15;
    const sellPrice = Math.floor(equip.price * 0.4 * levelMultiplier);

    const sellTransaction = db.transaction(() => {
      db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(sellPrice, req.user.userId);
      db.prepare('DELETE FROM user_equipment WHERE id = ?').run(user_equip_id);
    });
    sellTransaction();

    res.json({ message: `出售成功：${equip.name}，获得 ${sellPrice} 金币`, sellPrice, equipmentName: equip.name });
  } catch (error) {
    console.error('出售装备失败:', error);
    res.status(500).json({ error: '出售装备失败' });
  }
});

// 获取我的装备
router.get('/my-equipment', authenticateToken, (req, res) => {
  try {
    const equipment = db.prepare(`
      SELECT ue.id as user_equip_id, ue.level, ue.equipped, e.*
      FROM user_equipment ue
      JOIN equipment e ON ue.equipment_id = e.id
      WHERE ue.user_id = ?
    `).all(req.user.userId);

    const setInfo = calculateSetBonus(req.user.userId);

    res.json({ equipment, setBonus: setInfo });
  } catch (error) {
    console.error('获取装备失败:', error);
    res.status(500).json({ error: '获取装备失败' });
  }
});

// 装备部件
router.post('/equip', authenticateToken, (req, res) => {
  try {
    const { user_equip_id } = req.body;
    
    // 获取该装备信息
    const equip = db.prepare(`
      SELECT ue.*, e.slot 
      FROM user_equipment ue
      JOIN equipment e ON ue.equipment_id = e.id
      WHERE ue.id = ? AND ue.user_id = ?
    `).get(user_equip_id, req.user.userId);
    
    if (!equip) {
      return res.status(404).json({ error: '未找到该装备' });
    }

    // 如果已经是穿戴状态，则执行卸下操作
    if (equip.equipped === 1) {
      db.prepare(`
        UPDATE user_equipment SET equipped = 0 WHERE id = ?
      `).run(user_equip_id);
      return res.json({ message: '装备已卸下', slot: equip.slot });
    }
    
    // 卸下同部位的其他装备
    db.prepare(`
      UPDATE user_equipment 
      SET equipped = 0 
      WHERE user_id = ? AND equipped = 1 AND equipment_id IN (
        SELECT id FROM equipment WHERE slot = ?
      )
    `).run(req.user.userId, equip.slot);
    
    // 穿上新装备
    db.prepare(`
      UPDATE user_equipment SET equipped = 1 WHERE id = ?
    `).run(user_equip_id);
    
    res.json({ message: '装备成功', slot: equip.slot });
  } catch (error) {
    console.error('装备部件失败:', error);
    res.status(500).json({ error: '装备部件失败' });
  }
});

// 升级部件
router.post('/upgrade', authenticateToken, (req, res) => {
  try {
    const { user_equip_id } = req.body;
    
    const equip = db.prepare(`
      SELECT ue.*, e.name, e.stats_bonus, e.rarity, e.price
      FROM user_equipment ue
      JOIN equipment e ON ue.equipment_id = e.id
      WHERE ue.id = ? AND ue.user_id = ?
    `).get(user_equip_id, req.user.userId);
    if (!equip) {
      return res.status(404).json({ error: '未找到该装备' });
    }
    
    const currentLevel = equip.level || 1;
    const maxLevel = 10;
    
    if (currentLevel >= maxLevel) {
      return res.status(400).json({ error: '装备已达到满级' });
    }

    const rarityMultiplier = { common: 1, rare: 1.5, epic: 2, legendary: 3 };
    const upgradeCost = Math.floor(currentLevel * 100 * (rarityMultiplier[equip.rarity] || 1));

    const user = db.prepare('SELECT gold FROM users WHERE id = ?').get(req.user.userId);
    if (!user || user.gold < upgradeCost) {
      return res.status(400).json({ error: `金币不足，升级需要 ${upgradeCost} 金币` });
    }

    let statsBefore, statsAfter;
    try {
      statsBefore = JSON.parse(equip.stats_bonus);
      const oldMultiplier = 1 + (currentLevel - 1) * 0.2;
      const newMultiplier = 1 + currentLevel * 0.2;
      statsAfter = {};
      for (const [key, baseValue] of Object.entries(statsBefore)) {
        statsAfter[key] = Math.floor(baseValue * newMultiplier);
      }
    } catch {
      statsBefore = {};
      statsAfter = {};
    }
    
    const upgradeTransaction = db.transaction(() => {
      db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(upgradeCost, req.user.userId);
      db.prepare('UPDATE user_equipment SET level = ? WHERE id = ?').run(currentLevel + 1, user_equip_id);
    });
    upgradeTransaction();

    res.json({ 
      message: `升级成功：${equip.name} Lv.${currentLevel} → Lv.${currentLevel + 1}`, 
      newLevel: currentLevel + 1,
      upgradeCost,
      statsBefore,
      statsAfter
    });
  } catch (error) {
    console.error('升级部件失败:', error);
    res.status(500).json({ error: '升级部件失败' });
  }
});

module.exports = router;
