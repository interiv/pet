const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/database.sqlite');
const db = new Database(dbPath);

console.log('开始知识点统计迁移...');

// 创建知识点统计表
db.prepare(`
  CREATE TABLE IF NOT EXISTS knowledge_point_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    knowledge_point TEXT NOT NULL,
    date TEXT NOT NULL,
    total_attempts INTEGER DEFAULT 0,
    correct_attempts INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, knowledge_point, date)
  )
`).run();

console.log('✅ knowledge_point_stats 表创建成功');

// 为question_bank表添加knowledge_point字段（如果不存在）
try {
  db.prepare(`ALTER TABLE question_bank ADD COLUMN knowledge_point TEXT`).run();
  console.log('✅ question_bank.knowledge_point 字段添加成功');
} catch (error) {
  if (error.message.includes('duplicate column')) {
    console.log('ℹ️ question_bank.knowledge_point 字段已存在');
  } else {
    console.error('❌ 添加字段失败:', error.message);
  }
}

// 创建知识点统计视图（计算正确率）
db.prepare(`
  CREATE VIEW IF NOT EXISTS knowledge_point_accuracy AS
  SELECT 
    user_id,
    knowledge_point,
    date,
    total_attempts,
    correct_attempts,
    ROUND(CAST(correct_attempts AS REAL) / total_attempts * 100, 2) as accuracy
  FROM knowledge_point_stats
  WHERE total_attempts > 0
`).run();

console.log('✅ knowledge_point_accuracy 视图创建成功');

// 更新现有记录的正确率
db.prepare(`
  UPDATE knowledge_point_stats 
  SET accuracy = ROUND(CAST(correct_attempts AS REAL) / total_attempts * 100, 2),
      updated_at = CURRENT_TIMESTAMP
  WHERE total_attempts > 0
`).run();

console.log('✅ 正确率更新完成');

// 关闭数据库
db.close();

console.log('\n🎉 知识点统计迁移完成！');
console.log('\n新增功能:');
console.log('  - knowledge_point_stats 表：记录每个知识点的练习情况');
console.log('  - question_bank.knowledge_point 字段：题目关联知识点');
console.log('  - knowledge_point_accuracy 视图：计算知识点正确率');
console.log('\n后续可以:');
console.log('  - 统计学生对各知识点的掌握情况');
console.log('  - 生成知识点热力图');
console.log('  - 针对性推荐练习题');
