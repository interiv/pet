const path = require('path');
const { db } = require('../config/database');

const SEEDS = path.join(__dirname, '..', '..', 'seeds');
const PETS_IMG_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'images', 'pets');
const STAGES = ['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'];

/**
 * 读取各基础表的数据源。
 * 直接 require seeds 里的模块（它们已导出数据数组），避免把定义写两遍。
 */
function load() {
  const pets = require(path.join(SEEDS, '01_pet_species.js'));
  return {
    pet_species: pets.buildSpeciesRows ? pets.buildSpeciesRows(PETS_IMG_DIR, STAGES) : [],
    items: require(path.join(SEEDS, '02_items.js')).items,
    equipment: require(path.join(SEEDS, '03_equipment.js')).equipment,
    skills: require(path.join(SEEDS, '04_skills.js')).skills,
    achievements: require(path.join(SEEDS, '..', 'scripts', 'achievementData')),
    // 注意：每日任务模板的表名是 tasks，daily_tasks 是「学生每日完成记录」
    tasks: require(path.join(SEEDS, '06_tasks.js')).tasks,
    forums: require(path.join(SEEDS, '07_forums.js')).forums,
  };
}

// 要兜底的表：[表名, 中文名]
const TABLES = [
  ['pet_species', '宠物种类'],
  ['items', '道具'],
  ['equipment', '装备'],
  ['skills', '技能'],
  ['achievements', '成就'],
  ['tasks', '每日任务模板'],
  ['forums', '论坛板块'],
];

function tableCount(table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  } catch (e) {
    return -1; // 表不存在（迁移还没跑）
  }
}

function insertRows(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const cols = Object.keys(rows[0]);
  const stmt = db.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  );
  const run = db.transaction((list) => {
    for (const row of list) stmt.run(...cols.map((c) => row[c]));
  });
  run(rows);
  return rows.length;
}

/**
 * 只补「空表」，绝不覆盖已有数据。
 * 这样既能让新装 / 漏跑 setup 的站点自动具备基础数据，
 * 又不会抹掉管理员在后台自定义的成就、道具、装备。
 */
function ensureBaseData() {
  const summary = [];
  let data = null;

  for (const [table, label] of TABLES) {
    const c = tableCount(table);
    if (c === -1) {
      summary.push({ table, label, status: 'skip', reason: '表不存在' });
      continue;
    }
    if (c > 0) {
      summary.push({ table, label, status: 'exists', count: c });
      continue;
    }
    try {
      if (!data) data = load();
      const inserted = insertRows(table, data[table]);
      summary.push({ table, label, status: 'filled', count: inserted });
      console.log(`  ✓ 基础数据兜底：${label}（${table}）补入 ${inserted} 条`);
    } catch (e) {
      summary.push({ table, label, status: 'failed', reason: e.message });
      console.error(`  ✗ 基础数据兜底失败：${label}（${table}）-`, e.message);
    }
  }
  return summary;
}

/** 只看不写，供管理后台「系统数据」页展示 */
function checkBaseData() {
  return TABLES.map(([table, label]) => {
    const c = tableCount(table);
    return { table, label, count: c, missing: c === 0, absent: c === -1 };
  });
}

module.exports = { load, ensureBaseData, checkBaseData, PETS_IMG_DIR, STAGES };
