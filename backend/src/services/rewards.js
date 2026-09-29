/**
 * 统一奖励发放管道
 *
 * 背景：加金币 / 加经验的逻辑原先散落在 20 多处，每处各自写
 *   UPDATE users SET gold = gold + ? ...
 *   UPDATE pets  SET exp  = exp  + ? ...
 * 结果几乎每处都漏掉某一步——漏 checkLevelUp（经验涨了不升级）、
 * 漏 total_gold_earned（累计金币成就永远解锁不了）、漏流水记录、漏成就检查。
 * 以后再加一个发奖入口，同样的坑会原样再踩一遍。
 *
 * 用法：
 *   const { grantReward } = require('../services/rewards');
 *   grantReward(userId, { gold: 30, exp: 50, source: 'battle', reason: '战斗胜利' });
 *
 * 约定：
 *   - gold / exp 传负数即为扣减，但 total_gold_earned / total_exp_earned
 *     只统计正向累计（属于「生涯累计」口径，不因扣减而回退）
 *   - 内部统一处理：升级判定、累计金币成就、金币流水
 */

const { db } = require('../config/database');

function grantReward(userId, options = {}) {
  const { gold = 0, exp = 0, source = '', reason = '', petId = null, skipAchievementCheck = false } = options;
  const result = { user_id: Number(userId), gold: 0, exp: 0, petId: null, levelUp: null };

  const goldDelta = Number(gold) || 0;
  const expDelta = Number(exp) || 0;

  // ---------- 金币 ----------
  if (goldDelta !== 0) {
    db.prepare(
      'UPDATE users SET gold = gold + ?, total_gold_earned = total_gold_earned + ? WHERE id = ?'
    ).run(goldDelta, goldDelta > 0 ? goldDelta : 0, userId);
    result.gold = goldDelta;

    if (source) {
      try {
        db.prepare(
          'INSERT INTO gold_transactions (user_id, gold_change, reason, source) VALUES (?, ?, ?, ?)'
        ).run(userId, goldDelta, reason || source, source);
      } catch (e) {
        // 流水表不可用时不影响主流程
      }
    }
  }

  // ---------- 经验 ----------
  if (expDelta !== 0) {
    // 指定 petId 时先校验归属，避免把经验加到别人的宠物上；
    // 否则按 user_id 取，且不筛 status：宠物昏迷时经验也应入账
    // （原先 cards.js 只找 status='normal'，昏迷时会静默丢奖励）
    const pet = petId
      ? db.prepare('SELECT id FROM pets WHERE id = ? AND user_id = ?').get(petId, userId)
      : db.prepare('SELECT id FROM pets WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);

    if (pet) {
      result.petId = pet.id;
      db.prepare(
        'UPDATE pets SET exp = exp + ?, total_exp_earned = total_exp_earned + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(expDelta, expDelta > 0 ? expDelta : 0, pet.id);
      result.exp = expDelta;

      // 升级判定：原先多数调用点都漏了这一步
      try {
        const { checkLevelUp } = require('../routes/pets');
        const updatedPet = db.prepare('SELECT * FROM pets WHERE id = ?').get(pet.id);
        result.levelUp = checkLevelUp(updatedPet);
      } catch (e) {
        console.error('奖励发放后升级检查失败:', e.message);
      }
    }
  }

  // ---------- 累计金币成就 ----------
  // skipAchievementCheck：成就自身发奖时置 true，避免「金币成就 → 累计金币达标 → 又发金币」的连锁
  if (goldDelta > 0 && !skipAchievementCheck) {
    try {
      const { checkAndAwardAchievement } = require('../routes/achievements');
      const row = db.prepare('SELECT total_gold_earned FROM users WHERE id = ?').get(userId);
      if (row) checkAndAwardAchievement(userId, 'total_gold', row.total_gold_earned);
    } catch (e) {
      // 成就检查失败不影响奖励发放
    }
  }

  return result;
}

module.exports = { grantReward };
