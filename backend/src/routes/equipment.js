const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// 计算套装效果
function calculateSetBonus(userId) {
  const equipped = db.prepare(`
    SELECT e.set_name
    FROM user_equipment ue
    JOIN equipment e ON ue.equipment_id = e.id
    WHERE ue.user_id = ? AND ue.equipped = 1 AND e.set_name IS NOT NULL
  `).all(userId);

  if (!equipped || equipped.length === 0) {
    return { setBonus: null, totalBonus: { attack: 0, defense: 0, speed: 0 } };
  }

  const setCounts = {};
  equipped.forEach(e => {
    if (e.set_name) {
      setCounts[e.set_name] = (setCounts[e.set_name] || 0) + 1;
    }
  });

  let totalBonus = { attack: 0, defense: 0, speed: 0 };
  const activeSets = [];

  for (const [setName, count] of Object.entries(setCounts)) {
    if (count >= 2) {
      activeSets.push({ name: setName, pieces: count, tier: 'basic' });
      totalBonus.attack += 5;
      totalBonus.defense += 5;
      totalBonus.speed += 5;
    }
    if (count >= 4) {
      activeSets.push({ name: setName, pieces: count, tier: 'complete' });
      totalBonus.attack += 10;
      totalBonus.defense += 10;
      totalBonus.speed += 10;
    }
  }

  return { setBonus: activeSets, totalBonus };
}

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
    
    const equip = db.prepare('SELECT * FROM user_equipment WHERE id = ? AND user_id = ?').get(user_equip_id, req.user.userId);
    if (!equip) {
      return res.status(404).json({ error: '未找到该装备' });
    }
    
    const currentLevel = equip.level || 1;
    const maxLevel = 10;
    
    if (currentLevel >= maxLevel) {
      return res.status(400).json({ error: '装备已达到满级' });
    }
    
    const upgradeCost = currentLevel * 100;
    const user = db.prepare('SELECT gold FROM users WHERE id = ?').get(req.user.userId);
    if (!user || user.gold < upgradeCost) {
      return res.status(400).json({ error: `金币不足，升级需要 ${upgradeCost} 金币` });
    }
    
    db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(upgradeCost, req.user.userId);
    db.prepare('UPDATE user_equipment SET level = ? WHERE id = ?').run(currentLevel + 1, user_equip_id);
    
    res.json({ message: '升级成功', newLevel: currentLevel + 1 });
  } catch (error) {
    console.error('升级部件失败:', error);
    res.status(500).json({ error: '升级部件失败' });
  }
});

module.exports = router;
