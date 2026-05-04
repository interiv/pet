const path = require('path');
const Database = require('better-sqlite3');

console.log('=== 迁移：BOSS战答题记录与上限 ===\n');

const dbPath = path.join(__dirname, '../data/database.sqlite');
if (!require('fs').existsSync(dbPath)) {
  console.log('数据库文件不存在，跳过迁移。');
  process.exit(0);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const migrate = db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boss_battle_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boss_battle_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      is_correct INTEGER DEFAULT 0,
      answered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(boss_battle_id, user_id, question_id),
      FOREIGN KEY (boss_battle_id) REFERENCES boss_battles(id),
      FOREIGN KEY (question_id) REFERENCES question_bank(id)
    );
  `);
  console.log('   ✓ boss_battle_answers 表已创建');

  const hasColumn = db.prepare("PRAGMA table_info('boss_battles')").all()
    .some(col => col.name === 'max_questions_per_user');

  if (!hasColumn) {
    db.exec("ALTER TABLE boss_battles ADD COLUMN max_questions_per_user INTEGER DEFAULT 20");
    console.log('   ✓ boss_battles.max_questions_per_user 列已添加（默认20）');
  } else {
    console.log('   - max_questions_per_user 列已存在，跳过');
  }
});

migrate();
console.log('\n✅ 迁移完成');
process.exit(0);
