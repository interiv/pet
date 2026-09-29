/**
 * 宠物属性克制关系
 *
 * README 承诺的克制规则：
 *   火 → 草 → 水 → 火（火克草、草克水、水克火）
 *   光 ↔ 暗（互相克制）
 * 无克制关系时伤害倍率为 1。
 *
 * 注意：pet_species.element_type 存的是英文（fire / water / grass / light / dark）。
 */

// A 克制 B
const BEATS = {
  fire: 'grass',
  grass: 'water',
  water: 'fire',
  light: 'dark',
  dark: 'light',
};

const ADVANTAGE = 1.25;   // 克制：伤害 +25%
const DISADVANTAGE = 0.8; // 被克：伤害 -20%
const NEUTRAL = 1;

const VALID = Object.keys(BEATS);

function normalizeElement(el) {
  const v = String(el || '').trim().toLowerCase();
  return VALID.includes(v) ? v : null;
}

/**
 * 计算伤害倍率与关系描述
 * @returns {{multiplier:number, relation:'advantage'|'disadvantage'|'neutral'}}
 */
function elementMultiplier(attackerElement, defenderElement) {
  const a = normalizeElement(attackerElement);
  const d = normalizeElement(defenderElement);
  if (!a || !d) return { multiplier: NEUTRAL, relation: 'neutral' };

  if (BEATS[a] === d) return { multiplier: ADVANTAGE, relation: 'advantage' };
  if (BEATS[d] === a) return { multiplier: DISADVANTAGE, relation: 'disadvantage' };
  return { multiplier: NEUTRAL, relation: 'neutral' };
}

module.exports = {
  BEATS,
  ADVANTAGE,
  DISADVANTAGE,
  NEUTRAL,
  elementMultiplier,
  normalizeElement,
};
