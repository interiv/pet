const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'database.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

console.log('开始迁移 question_bank 表...\n');

const columns = [
  { name: 'grade_level', type: 'TEXT' },
  { name: 'tags', type: 'TEXT' },
  { name: 'estimated_time', type: 'INTEGER DEFAULT 60' },
  { name: 'default_score', type: 'REAL DEFAULT 5' },
  { name: 'is_public', type: 'INTEGER DEFAULT 1' },
  { name: 'review_status', type: "TEXT DEFAULT 'approved'" },
  { name: 'updated_at', type: 'DATETIME' },
];

const existingColumns = db.prepare('PRAGMA table_info(question_bank)').all().map(c => c.name);

for (const col of columns) {
  if (existingColumns.includes(col.name)) {
    console.log(`  ✓ 字段 ${col.name} 已存在，跳过`);
  } else {
    try {
      db.exec(`ALTER TABLE question_bank ADD COLUMN ${col.name} ${col.type}`);
      console.log(`  + 添加字段 ${col.name} ${col.type}`);
    } catch (e) {
      console.error(`  ✗ 添加字段 ${col.name} 失败: ${e.message}`);
    }
  }
}

console.log('\n迁移完成！');
db.close();
