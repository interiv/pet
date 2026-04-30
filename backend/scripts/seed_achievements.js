/**
 * 单独初始化/刷新成就数据
 * 用法: node scripts/seed_achievements.js
 *
 * 不会删除现有数据库，只会在 achievements 表为空时插入默认数据。
 * 如果表中已有数据，使用 --force 参数覆盖：
 *   node scripts/seed_achievements.js --force
 */
const path = require('path');
const Database = require('better-sqlite3');
const achievements = require('./achievementData');

const dbPath = path.join(__dirname, '../data/database.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const force = process.argv.includes('--force');

const existingCount = db.prepare('SELECT COUNT(*) as c FROM achievements').get().c;

if (existingCount > 0 && !force) {
  console.log(`成就表中已有 ${existingCount} 条数据，跳过。使用 --force 参数覆盖。`);
  process.exit(0);
}

if (force) {
  db.prepare('DELETE FROM user_achievements').run();
  db.prepare('DELETE FROM achievements').run();
  console.log('已清空成就数据。');
}

const insertAchievement = db.prepare('INSERT INTO achievements (name, description, condition, reward_type, reward_value, category, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insertMany = db.transaction((items) => {
  for (const a of items) {
    insertAchievement.run(a.name, a.description, a.condition, a.reward_type, a.reward_value, a.category, a.icon, a.sort_order);
  }
});

insertMany(achievements);
console.log(`✓ 已插入 ${achievements.length} 个成就`);

// 统计各分类数量
const categories = {};
achievements.forEach(a => {
  categories[a.category] = (categories[a.category] || 0) + 1;
});
console.log('\n各分类成就数量:');
Object.entries(categories).forEach(([cat, count]) => {
  console.log(`  ${cat}: ${count} 个`);
});

db.close();
