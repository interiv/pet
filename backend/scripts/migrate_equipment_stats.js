const path = require('path');
const Database = require('better-sqlite3');

console.log('=== 迁移装备属性数据 ===\n');

const dbPath = path.join(__dirname, '../data/database.sqlite');
if (!require('fs').existsSync(dbPath)) {
  console.log('数据库文件不存在，跳过迁移。');
  process.exit(0);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const updates = {
  '铁剑': JSON.stringify({ attack: 5, defense: 2, speed: 1 }),
  '钢剑': JSON.stringify({ attack: 10, defense: 3, speed: 2 }),
  '火焰之剑': JSON.stringify({ attack: 20, defense: 5, speed: 3 }),
  '精灵之弓': JSON.stringify({ attack: 15, defense: 3, speed: 10 }),
  '雷霆法杖': JSON.stringify({ attack: 25, defense: 4, speed: 5 }),
  '圣光十字剑': JSON.stringify({ attack: 40, defense: 10, speed: 5 }),
  '暗影匕首': JSON.stringify({ attack: 18, defense: 2, speed: 20 }),
  '布衣': JSON.stringify({ defense: 5, attack: 2, speed: 1 }),
  '铁甲': JSON.stringify({ defense: 10, attack: 3, speed: 1 }),
  '龙鳞甲': JSON.stringify({ defense: 20, attack: 5, speed: 3 }),
  '精灵长袍': JSON.stringify({ defense: 12, attack: 3, speed: 8 }),
  '玄冰重甲': JSON.stringify({ defense: 35, attack: 5, speed: -5 }),
  '星光守护铠': JSON.stringify({ defense: 50, attack: 5, speed: 3 }),
  '皮帽': JSON.stringify({ defense: 3, attack: 1, speed: 1 }),
  '铁盔': JSON.stringify({ defense: 8, attack: 2, speed: 1 }),
  '学士帽': JSON.stringify({ defense: 5, attack: 3, speed: 5 }),
  '精灵王冠': JSON.stringify({ defense: 10, attack: 5, speed: 5 }),
  '魔法头巾': JSON.stringify({ defense: 8, attack: 10, speed: 3 }),
  '烈焰角盔': JSON.stringify({ defense: 15, attack: 15, speed: 5 }),
  '幸运项链': JSON.stringify({ attack: 3, defense: 3, speed: 3, crit_rate: 0.05 }),
  '力量戒指': JSON.stringify({ attack: 8, defense: 3, speed: 2 }),
  '精灵护符': JSON.stringify({ attack: 3, defense: 3, speed: 15 }),
  '风暴之翼': JSON.stringify({ speed: 30, attack: 10, defense: 5 }),
  '生命宝石': JSON.stringify({ defense: 15, attack: 3, speed: 5 }),
  '学霸眼镜': JSON.stringify({ attack: 5, defense: 5, speed: 5 })
};

const updateStmt = db.prepare('UPDATE equipment SET stats_bonus = ? WHERE name = ?');

const migrate = db.transaction(() => {
  let updated = 0;
  for (const [name, stats] of Object.entries(updates)) {
    const result = updateStmt.run(stats, name);
    if (result.changes > 0) {
      updated++;
      console.log(`  ✓ 更新 ${name}: ${stats}`);
    }
  }
  return updated;
});

try {
  const count = migrate();
  console.log(`\n✓ 迁移完成，共更新 ${count} 件装备属性`);
} catch (error) {
  console.error('迁移失败:', error);
  process.exit(1);
}

db.close();
