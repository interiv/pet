const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
const dbPath = path.join(dataDir, 'database.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error('数据库不存在，请先运行 init_db.js');
  process.exit(1);
}

const db = new Database(dbPath);

console.log('=== 数据库迁移：班级申请表 ===\n');

console.log('1. 创建 class_applications 表...');
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'teacher')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id),
      UNIQUE(user_id, class_id)
    )
  `);
  console.log('   ✓ class_applications 表创建成功\n');
} catch (e) {
  if (e.message.includes('already exists')) {
    console.log('   ⚠ class_applications 表已存在，跳过\n');
  } else {
    throw e;
  }
}

console.log('\n=== 迁移完成 ===');
console.log('\n说明：');
console.log('- class_applications 表：存储用户申请加入班级的记录');
console.log('- status: pending(待审批), approved(已批准), rejected(已拒绝)');
console.log('- 学生注册时创建一条申请，教师注册时为每个申请的班级创建一条申请\n');

db.close();