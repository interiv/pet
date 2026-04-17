// 每日任务系统数据库迁移脚本
const { db } = require('../src/config/database');

console.log('开始创建每日任务相关表...');

try {
  // 创建每日任务表
  db.prepare(`
    CREATE TABLE IF NOT EXISTS daily_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,  -- YYYY-MM-DD 格式
      tasks_completed INTEGER DEFAULT 0,  -- 已完成任务数
      total_tasks INTEGER DEFAULT 4,  -- 总任务数
      streak_days INTEGER DEFAULT 0,  -- 连续完成天数
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date)
    )
  `).run();

  console.log('✓ daily_tasks 表创建成功');

  // 创建每日任务日志表（记录具体完成的任务）
  db.prepare(`
    CREATE TABLE IF NOT EXISTS daily_task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,  -- YYYY-MM-DD 格式
      task_type TEXT NOT NULL,  -- complete_assignment, correct_rate, feed_pet, login
      task_target INTEGER DEFAULT 0,  -- 任务目标值
      task_progress INTEGER DEFAULT 0,  -- 当前进度
      is_completed INTEGER DEFAULT 0,  -- 是否完成
      reward_claimed INTEGER DEFAULT 0,  -- 奖励是否已领取
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date, task_type)
    )
  `).run();

  console.log('✓ daily_task_logs 表创建成功');

  // 为现有用户创建今天的任务记录
  const users = db.prepare('SELECT id FROM users WHERE role = ?').all('student');
  const today = new Date().toISOString().split('T')[0];
  
  const insertTask = db.prepare(`
    INSERT OR IGNORE INTO daily_tasks (user_id, date, tasks_completed, total_tasks, streak_days)
    VALUES (?, ?, 0, 4, 0)
  `);

  for (const user of users) {
    insertTask.run(user.id, today);
  }

  console.log(`✓ 为 ${users.length} 个用户创建了今日任务记录`);
  console.log('每日任务系统数据库迁移完成！');

} catch (error) {
  console.error('迁移失败:', error);
  process.exit(1);
}
