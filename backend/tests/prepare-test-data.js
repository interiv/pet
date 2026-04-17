const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/database.sqlite');
const db = new Database(dbPath);

console.log('🔧 准备测试数据...\n');

// 1. 创建测试班级
console.log('1️⃣ 创建测试班级...');
const classResult = db.prepare(`
  INSERT OR IGNORE INTO classes (name, teacher_id, grade)
  VALUES ('测试班级', 1, '三年级')
`).run();
console.log('✅ 测试班级创建成功');

// 2. 获取班级ID
const testClass = db.prepare('SELECT * FROM classes WHERE name = ?').get('测试班级');
console.log(`   班级ID: ${testClass.id}`);

// 3. 创建班级邀请码
console.log('\n2️⃣ 创建班级邀请码...');
db.prepare(`
  INSERT OR IGNORE INTO class_invitations (class_id, invitation_code, created_by, role_filter)
  VALUES (?, 'TEST2026', 1, 'any')
`).run(testClass.id);
console.log('✅ 邀请码 TEST2026 创建成功');

// 3. 创建测试用户(学生)
console.log('\n3️⃣ 创建测试用户...');
const bcrypt = require('bcryptjs');
const hashedPassword = bcrypt.hashSync('Test123456', 10);

const userResult = db.prepare(`
  INSERT OR REPLACE INTO users (username, password, email, role, class_id)
  VALUES ('test_student', ?, 'test@example.com', 'student', ?)
`).run(hashedPassword, testClass.id);
console.log('✅ 测试学生用户创建成功');

// 4. 创建测试教师用户
const teacherResult = db.prepare(`
  INSERT OR REPLACE INTO users (username, password, email, role)
  VALUES ('test_teacher', ?, 'teacher@example.com', 'teacher')
`).run(hashedPassword);
console.log('✅ 测试教师用户创建成功');

// 5. 将教师关联到班级
db.prepare(`
  UPDATE classes SET head_teacher_id = ? WHERE id = ?
`).run(teacherResult.lastInsertRowid || db.prepare('SELECT id FROM users WHERE username = ?').get('test_teacher')?.id, testClass.id);
console.log('✅ 教师班级关联成功');

// 6. 确保宠物种类存在
console.log('\n4️⃣ 检查宠物种类...');
const speciesCount = db.prepare('SELECT COUNT(*) as count FROM pet_species').get().count;
if (speciesCount === 0) {
  console.log('   需要运行 init_db.js 初始化宠物种类');
} else {
  console.log(`✅ 已有 ${speciesCount} 种宠物`);
}

// 7. 确保技能数据存在
console.log('\n5️⃣ 检查技能数据...');
const skillsCount = db.prepare('SELECT COUNT(*) as count FROM skills').get().count;
if (skillsCount === 0) {
  console.log('   需要运行 migrate_pet_skills.js');
} else {
  console.log(`✅ 已有 ${skillsCount} 个技能`);
}

// 8. 检查每日任务
console.log('\n6️⃣ 检查每日任务...');
const tasksCount = db.prepare('SELECT COUNT(*) as count FROM daily_tasks').get().count;
if (tasksCount === 0) {
  console.log('   需要运行 migrate_daily_tasks.js');
} else {
  console.log(`✅ 已有 ${tasksCount} 个任务`);
}

db.close();

console.log('\n✅ 测试数据准备完成!');
console.log('\n测试账号:');
console.log('  学生: test_student / Test123456');
console.log('  教师: test_teacher / Test123456');
console.log('  班级邀请码: TEST2026');
