const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { checkLevelUp } = require('./pets');

// 生成战斗日志
function generateBattleLog(myPet, opponentPet, winner, myWinChance, moodCriticalBonus = 0) {
  const log = [];
  const maxRounds = 3;

  let myHp = 100;
  let opponentHp = 100;

  for (let round = 1; round <= maxRounds; round++) {
    const myDamage = Math.floor(myPet.attack * (0.8 + Math.random() * 0.4));
    const opponentDamage = Math.floor(opponentPet.attack * (0.8 + Math.random() * 0.4));

    const baseCritChance = 0.1 + moodCriticalBonus;
    const isCritical = Math.random() < baseCritChance;
    const finalMyDamage = isCritical ? Math.floor(myDamage * 1.5) : myDamage;

    opponentHp = Math.max(0, opponentHp - finalMyDamage);
    myHp = Math.max(0, myHp - opponentDamage);

    log.push({
      round,
      myPet: { hp: myHp, damage: finalMyDamage, critical: isCritical },
      opponent: { hp: opponentHp, damage: opponentDamage }
    });

    if (opponentHp <= 0 || myHp <= 0) break;
  }

  return {
    winner: winner === myPet.id ? 'myPet' : 'opponent',
    myWinChance: Math.round(myWinChance * 100),
    rounds: log
  };
}

// 发起战斗
router.post('/start', authenticateToken, (req, res) => {
  try {
    const { opponent_pet_id } = req.body;

    const myPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!myPet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    if (myPet.stamina < 20) {
      return res.status(400).json({ error: '宠物体力不足，需要休息后才能战斗！' });
    }

    if (myPet.mood < 10) {
      return res.status(400).json({ error: '宠物心情太差，无法战斗！请先喂食或恢复心情' });
    }

    if (myPet.health <= 20) {
      return res.status(400).json({ error: '宠物处于濒死状态，无法战斗' });
    }

    const opponentPet = db.prepare('SELECT * FROM pets WHERE id = ?').get(opponent_pet_id);
    if (!opponentPet) {
      return res.status(404).json({ error: '对方宠物不存在' });
    }

    const result = db.prepare(`
      INSERT INTO battles (pet1_id, pet2_id, battle_type)
      VALUES (?, ?, '1v1')
    `).run(myPet.id, opponentPet.id);

    const myPower = myPet.attack + myPet.defense + myPet.speed;
    const opponentPower = opponentPet.attack + opponentPet.defense + opponentPet.speed;

    // 心情影响胜率：心情每低10点，胜率-5%，心情>80时暴击率+5%
    const moodBonus = (myPet.mood - 50) * 0.001;
    const moodCriticalBonus = myPet.mood > 80 ? 0.05 : 0;

    const powerDiff = myPower - opponentPower;
    const myWinChance = Math.max(0.1, Math.min(0.9, 0.5 + powerDiff * 0.001 + moodBonus));

    const winner = Math.random() < myWinChance ? myPet.id : opponentPet.id;

    const levelDiff = opponentPet.level - myPet.level;
    const baseExp = 30;

    let rewardExp = 0;
    let myExpGain = 0;
    let opponentExpGain = 0;

    if (winner === myPet.id) {
      rewardExp = Math.floor(baseExp * (1 + Math.max(0, levelDiff) * 0.1));
      myExpGain = rewardExp;
    } else {
      rewardExp = 10;
      opponentExpGain = Math.floor(baseExp * (1 + Math.max(0, -levelDiff) * 0.1));
    }

    const battleLog = generateBattleLog(myPet, opponentPet, winner, myWinChance, moodCriticalBonus);

    db.prepare(`
      UPDATE battles SET winner_id = ?, reward_exp = ?, reward_gold = 0, battle_log = ? WHERE id = ?
    `).run(winner, rewardExp, JSON.stringify(battleLog), result.lastInsertRowid);

    // 战斗后属性变化：消耗体力，心情变化
    let moodChange = winner === myPet.id ? 10 : -5;
    let newMood = Math.max(0, Math.min(100, myPet.mood + moodChange));

    db.prepare(`
      UPDATE pets SET
        stamina = stamina - 20,
        mood = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newMood, myPet.id);

    if (winner === myPet.id) {
      db.prepare(`
        UPDATE pets
        SET win_count = win_count + 1,
            total_battles = total_battles + 1,
            exp = exp + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(myExpGain, myPet.id);
    } else {
      db.prepare('UPDATE pets SET total_battles = total_battles + 1, exp = exp + 10 WHERE id = ?').run(myPet.id);
    }

    if (opponentExpGain > 0) {
      db.prepare('UPDATE pets SET exp = exp + ? WHERE id = ?').run(opponentExpGain, opponentPet.id);
      const updatedOpponent = db.prepare('SELECT * FROM pets WHERE id = ?').get(opponentPet.id);
      checkLevelUp(updatedOpponent);
    }

    const updatedMyPet = db.prepare('SELECT * FROM pets WHERE id = ?').get(myPet.id);
    const myLevelUp = checkLevelUp(updatedMyPet);

    res.json({
      message: '战斗结束',
      winner: winner === myPet.id ? '我' : '对手',
      rewardExp: winner === myPet.id ? myExpGain : 10,
      rewardGold: 0,
      moodChange,
      myWinChance: Math.round(myWinChance * 100),
      levelUp: myLevelUp,
      battleLog
    });
  } catch (error) {
    console.error('发起战斗错误:', error);
    res.status(500).json({ error: '发起战斗失败' });
  }
});

// 获取战斗记录
router.get('/history', authenticateToken, (req, res) => {
  try {
    const myPet = db.prepare('SELECT id FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!myPet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const battles = db.prepare(`
      SELECT b.*, 
             p1.name as pet1_name, p2.name as pet2_name,
             pw.name as winner_name
      FROM battles b
      JOIN pets p1 ON b.pet1_id = p1.id
      JOIN pets p2 ON b.pet2_id = p2.id
      LEFT JOIN pets pw ON b.winner_id = pw.id
      WHERE b.pet1_id = ? OR b.pet2_id = ?
      ORDER BY b.battle_date DESC
      LIMIT 20
    `).all(myPet.id, myPet.id);

    res.json({ battles });
  } catch (error) {
    console.error('获取战斗记录错误:', error);
    res.status(500).json({ error: '获取战斗记录失败' });
  }
});

module.exports = router;
