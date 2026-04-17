const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/database.sqlite');
const db = new Database(dbPath);

console.log('开始班级BOSS战系统迁移...');

// 创建BOSS表
db.prepare(`
  CREATE TABLE IF NOT EXISTS boss_battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    boss_name TEXT NOT NULL,
    boss_description TEXT,
    boss_icon TEXT,
    boss_hp INTEGER NOT NULL,
    boss_max_hp INTEGER NOT NULL,
    boss_level INTEGER NOT NULL,
    knowledge_point TEXT,
    source_question_id INTEGER,
    status TEXT DEFAULT 'active',
    created_by INTEGER,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

console.log('✅ boss_battles 表创建成功');

// 创建BOSS战参与记录表
db.prepare(`
  CREATE TABLE IF NOT EXISTS boss_battle_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boss_battle_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    pet_id INTEGER,
    damage_dealt INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    total_attempts INTEGER DEFAULT 0,
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_attack_at TEXT,
    UNIQUE(boss_battle_id, user_id)
  )
`).run();

console.log('✅ boss_battle_participants 表创建成功');

// 创建BOSS战奖励表
db.prepare(`
  CREATE TABLE IF NOT EXISTS boss_battle_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boss_battle_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reward_type TEXT NOT NULL,
    reward_value INTEGER NOT NULL,
    claimed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(boss_battle_id, user_id, reward_type)
  )
`).run();

console.log('✅ boss_battle_rewards 表创建成功');

// 创建索引
db.prepare(`CREATE INDEX IF NOT EXISTS idx_boss_class ON boss_battles(class_id, status)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_boss_participant ON boss_battle_participants(boss_battle_id, user_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_boss_rewards ON boss_battle_rewards(boss_battle_id, user_id)`).run();

console.log('✅ 索引创建成功');

// 关闭数据库
db.close();

console.log('\n🎉 班级BOSS战系统迁移完成！');
console.log('\n新增表:');
console.log('  - boss_battles: BOSS战主表');
console.log('  - boss_battle_participants: 参与记录表');
console.log('  - boss_battle_rewards: 奖励记录表');
console.log('\nBOSS战机制:');
console.log('  - BOSS由班级错题生成(错误率最高的知识点)');
console.log('  - 学生提交正确答案对BOSS造成伤害');
console.log('  - 击败BOSS后全班获得奖励');
console.log('  - 伤害排行榜激励竞争');
