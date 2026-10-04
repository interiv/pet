const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { requireFeature, isFeatureEnabled } = require('../middleware/featureFlags');
const { checkLevelUp } = require('./pets');
const { checkAndAwardAchievement } = require('./achievements');
const { elementMultiplier } = require('../utils/elements');

// 关闭「宠物战斗」时，入口和接口都要挡住
const battleOff = requireFeature('battle_enabled', { message: '宠物对战当前已关闭' });

/** 战斗体力消耗：原先硬编码 20，管理员在「网站设置 → 游戏参数」改了不生效。 */
function battleStaminaCost() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'battle_stamina_cost'`).get();
  const n = parseInt(row && row.value);
  return Number.isFinite(n) && n >= 0 ? n : 20;
}

// 取宠物的属性（element_type 存在 pet_species 上，pets 表里没有）
function getPetElement(petId) {
  const row = db
    .prepare(
      `SELECT ps.element_type AS element_type
       FROM pets p JOIN pet_species ps ON p.species_id = ps.id
       WHERE p.id = ?`
    )
    .get(petId);
  return row ? row.element_type : null;
}

// 防御减伤：伤害按 100/(100+防御) 折算，让 defense 真正参与战斗
// （原先只有 attack 参与伤害计算，堆防御完全没用）
function mitigateDamage(damage, defense) {
  const d = Number.isFinite(defense) && defense > 0 ? defense : 0;
  return Math.max(1, Math.round(damage * (100 / (100 + d))));
}

// 生成战斗日志：胜负由模拟结果决定，保证日志与最终判定一致
function generateBattleLog(myPet, opponentPet, myWinChance, moodCriticalBonus = 0) {
  const log = [];
  const maxRounds = 3;

  // 属性克制倍率：火→草→水→火，光↔暗
  const myElement = myPet.element_type || null;
  const opponentElement = opponentPet.element_type || null;
  const myElemVsOpponent = elementMultiplier(myElement, opponentElement);
  const opponentElemVsMe = elementMultiplier(opponentElement, myElement);

  let myHp = 100;
  let opponentHp = 100;

  for (let round = 1; round <= maxRounds; round++) {
    const rawMyDamage = Math.floor(myPet.attack * (0.8 + Math.random() * 0.4));
    const rawOpponentDamage = Math.floor(opponentPet.attack * (0.8 + Math.random() * 0.4));

    // 心情影响暴击率
    const baseCritChance = 0.1 + moodCriticalBonus;
    const isCritical = Math.random() < baseCritChance;
    const finalMyDamage = isCritical ? Math.floor(rawMyDamage * 1.5) : rawMyDamage;

    // 对手也有暴击判定
    const isOpponentCritical = Math.random() < 0.1;
    const finalOpponentDamage = isOpponentCritical ? Math.floor(rawOpponentDamage * 1.5) : rawOpponentDamage;

    // 伤害 = 攻击 → 暴击加成 → 属性克制 → 目标防御减伤
    const myDamage = mitigateDamage(
      Math.round(finalMyDamage * myElemVsOpponent.multiplier),
      opponentPet.defense
    );
    const opponentDamage = mitigateDamage(
      Math.round(finalOpponentDamage * opponentElemVsMe.multiplier),
      myPet.defense
    );

    opponentHp = Math.max(0, opponentHp - myDamage);
    myHp = Math.max(0, myHp - opponentDamage);

    log.push({
      round,
      myPet: { hp: myHp, damage: myDamage, critical: isCritical },
      opponent: { hp: opponentHp, damage: opponentDamage, critical: isOpponentCritical }
    });

    if (opponentHp <= 0 || myHp <= 0) break;
  }

  // 胜负完全由模拟结果决定（原先先用概率掷骰子定胜负、再单独模拟日志，
  // 两者独立，经常出现「日志里对手血已空、判定却是对方赢」）
  let winner;
  if (myHp > opponentHp) winner = 'myPet';
  else if (opponentHp > myHp) winner = 'opponent';
  else winner = (myPet.speed || 0) >= (opponentPet.speed || 0) ? 'myPet' : 'opponent'; // 平局由速度决出

  return {
    winner,
    myWinChance: Math.round(myWinChance * 100),
    elements: {
      mine: myElement,
      opponent: opponentElement,
      myRelation: myElemVsOpponent.relation,
      myMultiplier: myElemVsOpponent.multiplier,
      opponentMultiplier: opponentElemVsMe.multiplier,
    },
    rounds: log
  };
}

// 发起战斗
router.post('/start', authenticateToken, battleOff, (req, res) => {
  try {
    const { opponent_pet_id } = req.body;

    const myPet = db.prepare('SELECT * FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!myPet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const staminaCost = battleStaminaCost();

    if (myPet.stamina < staminaCost) {
      return res.status(400).json({ error: staminaCost > 0 ? `宠物体力不足（需要 ${staminaCost} 点），请休息后再来战斗！` : '宠物体力不足，无法战斗！' });
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

    if (myPet.id === opponentPet.id) {
      return res.status(400).json({ error: '不能与自己的宠物战斗' });
    }

    const result = db.prepare(`
      INSERT INTO battles (pet1_id, pet2_id, battle_type)
      VALUES (?, ?, '1v1')
    `).run(myPet.id, opponentPet.id);

    // 带上属性，供伤害倍率与战力评估使用
    myPet.element_type = getPetElement(myPet.id);
    opponentPet.element_type = getPetElement(opponentPet.id);

    const myPower = myPet.attack + myPet.defense + myPet.speed;
    const opponentPower = opponentPet.attack + opponentPet.defense + opponentPet.speed;

    // 心情影响胜率：心情每低10点，胜率-5%，心情>80时暴击率+5%
    const moodBonus = (myPet.mood - 50) * 0.001;
    const moodCriticalBonus = myPet.mood > 80 ? 0.05 : 0;

    // 属性克制纳入战力评估（仅影响展示用的胜率，实际胜负由模拟决定）
    const myElem = elementMultiplier(myPet.element_type, opponentPet.element_type);
    const elementBonus = (myElem.multiplier - 1) * 0.25;

    const powerDiff = myPower - opponentPower;
    const myWinChance = Math.max(0.1, Math.min(0.9, 0.5 + powerDiff * 0.001 + moodBonus + elementBonus));

    // 先跑模拟，由模拟结果决定胜负（myWinChance 仅作为战力评估展示给前端）
    const battleLog = generateBattleLog(myPet, opponentPet, myWinChance, moodCriticalBonus);
    const winner = battleLog.winner === 'myPet' ? myPet.id : opponentPet.id;

    const levelDiff = opponentPet.level - myPet.level;
    const baseExp = 30;

    let rewardExp = 0;
    let myExpGain = 0;
    let opponentExpGain = 0;

    if (winner === myPet.id) {
      rewardExp = Math.floor(baseExp * (1 + Math.max(0, levelDiff) * 0.1));
      myExpGain = rewardExp;
      opponentExpGain = Math.max(5, Math.floor(rewardExp * 0.3));
    } else {
      opponentExpGain = Math.floor(baseExp * (1 + Math.max(0, -levelDiff) * 0.1));
      rewardExp = opponentExpGain;
      myExpGain = Math.max(5, Math.floor(opponentExpGain * 0.3));
    }

    db.prepare(`
      UPDATE battles SET winner_id = ?, reward_exp = ?, reward_gold = 0, battle_log = ? WHERE id = ?
    `).run(winner, rewardExp, JSON.stringify(battleLog), result.lastInsertRowid);

    // 战斗后属性变化：消耗体力，心情变化
    let moodChange = winner === myPet.id ? 10 : -5;
    let newMood = Math.max(0, Math.min(100, myPet.mood + moodChange));

    db.prepare(`
      UPDATE pets SET
        stamina = stamina - ?,
        mood = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(staminaCost, newMood, myPet.id);

    if (winner === myPet.id) {
      db.prepare(`
        UPDATE pets
        SET win_count = win_count + 1,
            total_battles = total_battles + 1,
            exp = exp + ?,
            total_exp_earned = total_exp_earned + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(myExpGain, myExpGain, myPet.id);

      // 对手战败更新
      db.prepare('UPDATE pets SET total_battles = total_battles + 1, exp = exp + ? WHERE id = ?').run(opponentExpGain, opponentPet.id);
    } else {
      // 我方战败
      db.prepare('UPDATE pets SET total_battles = total_battles + 1, exp = exp + ? WHERE id = ?').run(myExpGain, myPet.id);

      // 对手获胜
      db.prepare(`
        UPDATE pets
        SET win_count = win_count + 1,
            total_battles = total_battles + 1,
            exp = exp + ?,
            total_exp_earned = total_exp_earned + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(opponentExpGain, opponentExpGain, opponentPet.id);
    }

    const updatedMyPet = db.prepare('SELECT * FROM pets WHERE id = ?').get(myPet.id);
    const myLevelUp = checkLevelUp(updatedMyPet);

    const updatedOpponent = db.prepare('SELECT * FROM pets WHERE id = ?').get(opponentPet.id);
    checkLevelUp(updatedOpponent);

    // 成就检查
    try {
      if (winner === myPet.id) {
        const winCount = db.prepare('SELECT win_count FROM pets WHERE id = ?').get(myPet.id)?.win_count || 0;
        checkAndAwardAchievement(req.user.userId, 'win_battle', winCount);
        // 连胜检查
        const recentBattles = db.prepare(`
          SELECT CASE WHEN winner_id = ? THEN 1 ELSE 0 END as is_win
          FROM battles WHERE pet1_id = ? OR pet2_id = ? ORDER BY battle_date DESC LIMIT 50
        `).all(myPet.id, myPet.id, myPet.id);
        let streak = 0;
        for (const b of recentBattles) { if (b.is_win) streak++; else break; }
        checkAndAwardAchievement(req.user.userId, 'win_streak', streak);
      } else {
        const totalBattles = db.prepare('SELECT total_battles FROM pets WHERE id = ?').get(myPet.id)?.total_battles || 0;
        const lossCount = totalBattles - (db.prepare('SELECT win_count FROM pets WHERE id = ?').get(myPet.id)?.win_count || 0);
        checkAndAwardAchievement(req.user.userId, 'lose_battle', lossCount);
      }
    } catch (e) { console.error('成就检查失败:', e); }

    res.json({
      message: '战斗结束',
      winner: winner === myPet.id ? '我' : '对手',
      // 原先战败时硬编码返回 10，与实际发放的 myExpGain 不符
      rewardExp: myExpGain,
      rewardGold: 0,
      moodChange,
      myWinChance: Math.round(myWinChance * 100),
      elements: battleLog.elements,
      levelUp: myLevelUp,
      battleLog
    });
  } catch (error) {
    console.error('发起战斗错误:', error);
    res.status(500).json({ error: '发起战斗失败' });
  }
});

// 获取战斗记录
router.get('/history', authenticateToken, battleOff, (req, res) => {
  try {
    const myPet = db.prepare('SELECT id FROM pets WHERE user_id = ?').get(req.user.userId);
    if (!myPet) {
      return res.status(404).json({ error: '还没有宠物' });
    }

    const battles = db.prepare(`
      SELECT b.id, b.pet1_id, b.pet2_id, b.winner_id, b.reward_exp, b.reward_gold, b.battle_log, b.battle_date, b.battle_type,
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
