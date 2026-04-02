const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../../data/database.sqlite'));

console.log('Running migration: add_gold_transactions_and_activities...');

db.exec(`
  CREATE TABLE IF NOT EXISTS gold_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    gold_change INTEGER NOT NULL,
    reason TEXT,
    source TEXT DEFAULT 'system',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_gold_transactions_user ON gold_transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_gold_transactions_created ON gold_transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_user_activities_user ON user_activities(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_activities_created ON user_activities(created_at);
`);

console.log('Migration completed: gold_transactions and user_activities tables created');

db.close();