/**
 * 基础数据自检脚本
 *
 * 用途：
 *   1) 报告 7 张基础数据表各有多少条，一眼看出缺什么；
 *   2) 报告 seed 文件是「新版（只补空表）」还是「旧版（会删数据）」，
 *      避免旧版 seed 在有数据的站上直接把外键撑爆。
 *
 * 用法：node scripts/check-base-data.js
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../src/config/database');

const SEEDS_DIR = path.join(__dirname, '..', 'seeds');
const TABLES = [
  ['pet_species', '宠物种类', '01_pet_species.js'],
  ['items', '道具', '02_items.js'],
  ['equipment', '装备', '03_equipment.js'],
  ['skills', '技能', '04_skills.js'],
  ['achievements', '成就', '05_achievements.js'],
  ['tasks', '每日任务模板', '06_tasks.js'],
  ['forums', '论坛板块', '07_forums.js'],
];

function count(table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  } catch (e) {
    return -1;
  }
}

console.log('');
console.log('=== 基础数据检查 ===');
let missing = 0;
let outdated = 0;
for (const [table, label, file] of TABLES) {
  const c = count(table);
  const cText = c < 0 ? '表不存在' : c === 0 ? '空表' : c + ' 条';
  if (c === 0) missing += 1;

  let flag = '';
  try {
    const src = fs.readFileSync(path.join(SEEDS_DIR, file), 'utf8');
    if (/\.del\(\)/.test(src)) {
      flag = '  ⚠️ seed 是旧版（会先删数据，有外键会报错）';
      outdated += 1;
    }
  } catch (e) { /* 文件不存在 */ }

  const mark = c > 0 ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(12, '　')} ${cText}${flag}`);
}

console.log('');
if (missing > 0) {
  console.log(`⚠️ 有 ${missing} 张表是空的。修复方式（任选其一）：`);
  console.log('   1) 重启后端（推荐，启动时自动补空表）');
  console.log('   2) cd backend; npm run seed');
} else {
  console.log('✅ 基础数据完整，无需处理');
}
if (outdated > 0) {
  console.log('');
  console.log(`⚠️ 有 ${outdated} 个 seed 文件还是旧版（会先 del 再 insert）。`);
  console.log('   旧版在「已有业务数据」的站上执行会报 FOREIGN KEY constraint failed，');
  console.log('   请从最新代码里同步 seeds/ 目录，或直接用上面的「重启后端」方式补数据。');
}
console.log('');
