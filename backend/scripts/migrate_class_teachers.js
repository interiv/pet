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

console.log('=== 数据库迁移：支持班级多老师 ===\n');

console.log('1. 创建 class_teachers 表...');
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS class_teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      role TEXT DEFAULT 'teacher',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, teacher_id),
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (teacher_id) REFERENCES users(id)
    )
  `);
  console.log('   ✓ class_teachers 表创建成功\n');
} catch (e) {
  if (e.message.includes('already exists')) {
    console.log('   ⚠ class_teachers 表已存在，跳过\n');
  } else {
    throw e;
  }
}

console.log('2. 为 assignments 表添加 class_id 字段...');
try {
  db.exec(`ALTER TABLE assignments ADD COLUMN class_id INTEGER REFERENCES classes(id)`);
  console.log('   ✓ class_id 字段添加成功\n');
} catch (e) {
  if (e.message.includes('duplicate column')) {
    console.log('   ⚠ class_id 字段已存在，跳过\n');
  } else {
    throw e;
  }
}

console.log('3. 更新 assignments 表的 class_id 数据...');
const assignmentsWithTeacher = db.prepare(`
  SELECT a.id, a.teacher_id, u.class_id
  FROM assignments a
  JOIN users u ON a.teacher_id = u.id
  WHERE a.class_id IS NULL AND u.class_id IS NOT NULL
`).all();

if (assignmentsWithTeacher.length > 0) {
  const updateStmt = db.prepare('UPDATE assignments SET class_id = ? WHERE id = ?');
  const updateMany = db.transaction((assignments) => {
    for (const a of assignments) {
      updateStmt.run(a.class_id, a.id);
    }
  });
  updateMany(assignmentsWithTeacher);
  console.log(`   ✓ 已更新 ${assignmentsWithTeacher.length} 条作业记录\n`);
} else {
  console.log('   ⚠ 没有需要更新的作业记录\n');
}

console.log('4. 迁移 classes.teacher_id 到 class_teachers...');
const classesWithTeacher = db.prepare(`
  SELECT id, teacher_id FROM classes WHERE teacher_id IS NOT NULL
`).all();

if (classesWithTeacher.length > 0) {
  const insertStmt = db.prepare('INSERT OR IGNORE INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, ?)');
  const migrate = db.transaction((classes) => {
    for (const c of classes) {
      insertStmt.run(c.id, c.teacher_id, 'head_teacher');
    }
  });
  migrate(classesWithTeacher);
  console.log(`   ✓ 已迁移 ${classesWithTeacher.length} 个班级的班主任到 class_teachers\n`);
} else {
  console.log('   ⚠ 没有需要迁移的班主任记录\n');
}

console.log('5. 迁移现有的 class_id 到 class_teachers...');
const studentsInClass = db.prepare(`
  SELECT DISTINCT class_id, id as user_id FROM users WHERE class_id IS NOT NULL AND role = 'student'
`).all();

console.log('\n=== 迁移完成 ===');
console.log('\n说明：');
console.log('- class_teachers 表：存储班级和老师的对应关系（一个班级可以有多个老师）');
console.log('- assignments.class_id：标识作业所属的班级');
console.log('- 班主任信息保留在 classes.teacher_id 中（用于显示）');
console.log('- 实际权限判断请使用 class_teachers 表\n');

db.close();