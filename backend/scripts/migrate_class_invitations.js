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

console.log('=== 数据库迁移：班级邀请系统 ===\n');

// 1. 创建 class_invitations 表
console.log('1. 创建 class_invitations 表...');
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      invitation_code TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      role_filter TEXT DEFAULT 'any' CHECK(role_filter IN ('student', 'teacher', 'any')),
      max_uses INTEGER DEFAULT NULL,
      used_count INTEGER DEFAULT 0,
      expires_at DATETIME DEFAULT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
  console.log('   ✓ class_invitations 表创建成功\n');
} catch (e) {
  if (e.message.includes('already exists')) {
    console.log('   ⚠ class_invitations 表已存在，跳过\n');
  } else {
    throw e;
  }
}

// 2. 为 classes 表添加 head_teacher_id 字段
console.log('2. 为 classes 表添加 head_teacher_id 字段...');
try {
  const columnExists = db.prepare(`
    SELECT COUNT(*) as count FROM pragma_table_info('classes') WHERE name='head_teacher_id'
  `).get();
  
  if (columnExists.count === 0) {
    db.exec(`ALTER TABLE classes ADD COLUMN head_teacher_id INTEGER REFERENCES users(id)`);
    console.log('   ✓ head_teacher_id 字段添加成功\n');
  } else {
    console.log('   ⚠ head_teacher_id 字段已存在，跳过\n');
  }
} catch (e) {
  console.error('   ✗ 添加字段失败:', e.message, '\n');
}

console.log('\n=== 迁移完成 ===');
console.log('\n说明：');
console.log('- class_invitations 表：存储班级邀请码');
console.log('- invitation_code: 唯一邀请码');
console.log('- role_filter: 限制邀请对象（student/teacher/any）');
console.log('- max_uses: 最大使用次数（NULL表示无限制）');
console.log('- used_count: 已使用次数');
console.log('- expires_at: 过期时间');
console.log('- is_active: 是否启用');
console.log('- classes.head_teacher_id: 班主任ID\n');

db.close();
