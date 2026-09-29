/**
 * 属性克制规则单测：火→草→水→火，光↔暗
 * 运行： node tests/elements.test.js
 */
const assert = require('assert');
const {
  elementMultiplier,
  normalizeElement,
  ADVANTAGE,
  DISADVANTAGE,
  NEUTRAL,
} = require('../src/utils/elements');

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + ' :: ' + e.message);
    process.exitCode = 1;
  }
};

console.log('属性克制规则');

check('火克草', () => {
  const r = elementMultiplier('fire', 'grass');
  assert.strictEqual(r.relation, 'advantage');
  assert.strictEqual(r.multiplier, ADVANTAGE);
});

check('草克水', () => {
  assert.strictEqual(elementMultiplier('grass', 'water').relation, 'advantage');
});

check('水克火', () => {
  assert.strictEqual(elementMultiplier('water', 'fire').relation, 'advantage');
});

check('克制是单向的：草打火是被克', () => {
  const r = elementMultiplier('grass', 'fire');
  assert.strictEqual(r.relation, 'disadvantage');
  assert.strictEqual(r.multiplier, DISADVANTAGE);
});

check('光暗互相克制', () => {
  assert.strictEqual(elementMultiplier('light', 'dark').relation, 'advantage');
  assert.strictEqual(elementMultiplier('dark', 'light').relation, 'advantage');
});

check('同属性无克制', () => {
  assert.strictEqual(elementMultiplier('fire', 'fire').multiplier, NEUTRAL);
  assert.strictEqual(elementMultiplier('fire', 'fire').relation, 'neutral');
});

check('无关属性无克制（火 vs 光）', () => {
  assert.strictEqual(elementMultiplier('fire', 'light').multiplier, NEUTRAL);
});

check('未知/缺失属性按无克制处理', () => {
  assert.strictEqual(elementMultiplier(null, 'fire').multiplier, NEUTRAL);
  assert.strictEqual(elementMultiplier(undefined, undefined).multiplier, NEUTRAL);
  assert.strictEqual(elementMultiplier('未知', 'fire').multiplier, NEUTRAL);
});

check('大小写与空格容错', () => {
  assert.strictEqual(elementMultiplier(' Fire ', 'GRASS').relation, 'advantage');
});

check('normalizeElement 归一化', () => {
  assert.strictEqual(normalizeElement('FIRE'), 'fire');
  assert.strictEqual(normalizeElement('  water '), 'water');
  assert.strictEqual(normalizeElement('xxx'), null);
});

console.log(`\n${passed} 项通过`);
