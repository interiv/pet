/**
 * 班级测试数据初始化脚本
 * 用法: node scripts/setup_classes.js
 *
 * 功能：
 *   - 创建班级1班和2班
 *   - 为每个班级分配班主任、科任教师和学生
 *   - 生成班级邀请码
 *
 * 说明：
 *   - 此脚本为一次性使用的临时脚本，用于初始化测试数据
 *   - 运行前需确保已通过 init_db.js 初始化数据库并创建测试用户
 *   - 重复运行会导致重复插入班级数据，请谨慎使用
 */
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '../data/database.sqlite');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function generateSlug(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'class'}-${suffix}`;
}

console.log('=== 设置班级和成员 ===\n');

const usedSlugs = new Set(db.prepare('SELECT slug FROM classes WHERE slug IS NOT NULL').all().map(r => r.slug));

function uniqueSlug(name) {
  let slug;
  do {
    slug = generateSlug(name);
  } while (usedSlugs.has(slug));
  usedSlugs.add(slug);
  return slug;
}

// ==================== 班级1班 ====================
console.log('--- 创建班级1班 ---');
const slug1 = uniqueSlug('1班');
const class1Result = db.prepare(`
  INSERT INTO classes (name, grade, slug, head_teacher_id, student_count, total_exp, created_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
`).run('1班', null, slug1, null, 0, 0);
const class1Id = class1Result.lastInsertRowid;
console.log(`  ✓ 班级"1班"创建成功 (id=${class1Id})`);

// teacher1 作为班主任
const teacher1 = db.prepare(`SELECT id FROM users WHERE username = 'teacher1'`).get();
db.prepare(`UPDATE classes SET head_teacher_id = ? WHERE id = ?`).run(teacher1.id, class1Id);
db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'head_teacher')`).run(class1Id, teacher1.id);
console.log(`  ✓ teacher1 (id=${teacher1.id}) 设为班主任`);

// teacher2-7 作为教师加入班级1
for (let i = 2; i <= 7; i++) {
  const t = db.prepare(`SELECT id FROM users WHERE username = ?`).get(`teacher${i}`);
  db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'teacher')`).run(class1Id, t.id);
  console.log(`  ✓ teacher${i} (id=${t.id}) 加入班级1班`);
}

// student1-30 加入班级1
let class1StudentCount = 0;
for (let i = 1; i <= 30; i++) {
  const s = db.prepare(`SELECT id FROM users WHERE username = ?`).get(`student${i}`);
  db.prepare(`UPDATE users SET class_id = ?, status = 'active' WHERE id = ?`).run(class1Id, s.id);
  class1StudentCount++;
}
db.prepare(`UPDATE classes SET student_count = ? WHERE id = ?`).run(class1StudentCount, class1Id);
console.log(`  ✓ student1~30 (${class1StudentCount}人) 加入班级1班`);

// 为班级1生成邀请码
const invite1 = crypto.randomBytes(4).toString('hex').toUpperCase();
db.prepare(`
  INSERT INTO class_invitations (class_id, invitation_code, created_by, role_filter, is_active)
  VALUES (?, ?, ?, 'any', 1)
`).run(class1Id, invite1, teacher1.id);
console.log(`  ✓ 班级1班邀请码: ${invite1}`);

// ==================== 班级2班 ====================
console.log('\n--- 创建班级2班 ---');
const slug2 = uniqueSlug('2班');
const class2Result = db.prepare(`
  INSERT INTO classes (name, grade, slug, head_teacher_id, student_count, total_exp, created_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
`).run('2班', null, slug2, null, 0, 0);
const class2Id = class2Result.lastInsertRowid;
console.log(`  ✓ 班级"2班"创建成功 (id=${class2Id})`);

// teacher2 作为班主任
const teacher2 = db.prepare(`SELECT id FROM users WHERE username = 'teacher2'`).get();
db.prepare(`UPDATE classes SET head_teacher_id = ? WHERE id = ?`).run(teacher2.id, class2Id);
db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'head_teacher')`).run(class2Id, teacher2.id);
console.log(`  ✓ teacher2 (id=${teacher2.id}) 设为班主任`);

// teacher1, teacher5-9 作为教师加入班级2
const class2TeacherUsernames = ['teacher1', 'teacher5', 'teacher6', 'teacher7', 'teacher8', 'teacher9'];
class2TeacherUsernames.forEach(username => {
  const t = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
  const existing = db.prepare(`SELECT id FROM class_teachers WHERE class_id = ? AND teacher_id = ?`).get(class2Id, t.id);
  if (!existing) {
    db.prepare(`INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'teacher')`).run(class2Id, t.id);
    console.log(`  ✓ ${username} (id=${t.id}) 加入班级2班`);
  }
});

// student31-50 加入班级2
let class2StudentCount = 0;
for (let i = 31; i <= 50; i++) {
  const s = db.prepare(`SELECT id FROM users WHERE username = ?`).get(`student${i}`);
  db.prepare(`UPDATE users SET class_id = ?, status = 'active' WHERE id = ?`).run(class2Id, s.id);
  class2StudentCount++;
}
db.prepare(`UPDATE classes SET student_count = ? WHERE id = ?`).run(class2StudentCount, class2Id);
console.log(`  ✓ student31~50 (${class2StudentCount}人) 加入班级2班`);

// 为班级2生成邀请码
const invite2 = crypto.randomBytes(4).toString('hex').toUpperCase();
db.prepare(`
  INSERT INTO class_invitations (class_id, invitation_code, created_by, role_filter, is_active)
  VALUES (?, ?, ?, 'any', 1)
`).run(class2Id, invite2, teacher2.id);
console.log(`  ✓ 班级2班邀请码: ${invite2}`);

// ==================== 汇总 ====================
console.log('\n========================================');
console.log('班级设置完成！汇总：');
console.log('========================================');

const classes = db.prepare(`
  SELECT c.id, c.name, c.slug, c.student_count,
    (SELECT username FROM users WHERE id = c.head_teacher_id) AS head_teacher
  FROM classes c
`).all();

classes.forEach(cls => {
  const teachers = db.prepare(`
    SELECT u.username, ct.role FROM class_teachers ct
    JOIN users u ON ct.teacher_id = u.id
    WHERE ct.class_id = ?
    ORDER BY CASE ct.role WHEN 'head_teacher' THEN 0 ELSE 1 END
  `).all(cls.id);
  const students = db.prepare(`
    SELECT username FROM users WHERE class_id = ? AND role = 'student' ORDER BY id
  `).all(cls.id);

  console.log(`\n【${cls.name}】(id=${cls.id}, slug=${cls.slug})`);
  console.log(`  班主任: ${cls.head_teacher}`);
  console.log(`  教师: ${teachers.map(t => `${t.username}(${t.role === 'head_teacher' ? '班主任' : '科任'})`).join(', ')}`);
  console.log(`  学生(${students.length}人): ${students.map(s => s.username).join(', ')}`);
});

db.close();
console.log('\n✅ 完成！');
