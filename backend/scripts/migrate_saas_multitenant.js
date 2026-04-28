// SaaS 多租户化最小迁移：新增 schools 表、为 classes/posts/forum_threads 等补齐字段，
// 生成班级 slug 与默认学校，保证可重复执行（字段存在性判断）。
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '../data');
const dbPath = path.join(dataDir, 'database.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error('数据库不存在，请先运行 init_db.js');
  process.exit(1);
}

const db = new Database(dbPath);

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function addColumnIfAbsent(table, column, typeClause) {
  if (hasColumn(table, column)) {
    console.log(`   ⚠ ${table}.${column} 已存在，跳过`);
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeClause}`);
  console.log(`   ✓ ${table}.${column} 添加成功`);
}

function tableExists(name) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return !!row;
}

console.log('=== 数据库迁移：SaaS 多班级 / 多学校 ===\n');

// 1. schools 表
console.log('1. 创建 schools 表...');
db.exec(`
  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    city TEXT,
    region TEXT,
    admin_user_id INTEGER,
    logo TEXT,
    theme_color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(id)
  )
`);
console.log('   ✓ schools 表就绪\n');

// 2. classes 表补字段
console.log('2. 为 classes 表补字段...');
addColumnIfAbsent('classes', 'school_id', 'INTEGER REFERENCES schools(id)');
addColumnIfAbsent('classes', 'slug', 'TEXT');
addColumnIfAbsent('classes', 'description', 'TEXT');
addColumnIfAbsent('classes', 'cover_image', 'TEXT');
addColumnIfAbsent('classes', 'is_public', 'INTEGER DEFAULT 1');
console.log('');

// 3. posts 表补 class_id（init_db 中 posts 可能没有 class_id；scope 字段已有）
if (tableExists('posts')) {
  console.log('3. 为 posts 表补 class_id...');
  addColumnIfAbsent('posts', 'class_id', 'INTEGER REFERENCES classes(id)');
  addColumnIfAbsent('posts', 'scope', "TEXT DEFAULT 'class'");
  console.log('');
}

// 4. forum_threads / forum_posts / announcements 补 class_id
for (const t of ['forum_threads', 'forum_posts', 'announcements']) {
  if (tableExists(t)) {
    console.log(`4.${t} 表补 class_id...`);
    addColumnIfAbsent(t, 'class_id', 'INTEGER');
    console.log('');
  }
}

// 5. 默认学校 + 班级 slug 回填
console.log('5. 数据回填...');
let defaultSchool = db.prepare(`SELECT * FROM schools WHERE name = ?`).get('默认学校');
if (!defaultSchool) {
  const r = db
    .prepare(`INSERT INTO schools (name, city, theme_color) VALUES (?, ?, ?)`)
    .run('默认学校', '全国', '#1677ff');
  defaultSchool = { id: r.lastInsertRowid };
  console.log('   ✓ 已创建默认学校');
} else {
  console.log('   ⚠ 默认学校已存在');
}

const classes = db.prepare(`SELECT id, name, grade, school_id, slug FROM classes`).all();
const setSchool = db.prepare(`UPDATE classes SET school_id = ? WHERE id = ?`);
const setSlug = db.prepare(`UPDATE classes SET slug = ? WHERE id = ?`);

function genSlug(cls) {
  const base = (cls.grade || 'class')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
    .slice(0, 12);
  const rand = crypto.randomBytes(2).toString('hex');
  return `${base || 'c'}-${cls.id}-${rand}`;
}

let slugFixed = 0;
let schoolFixed = 0;
for (const c of classes) {
  if (!c.school_id) {
    setSchool.run(defaultSchool.id, c.id);
    schoolFixed++;
  }
  if (!c.slug) {
    let candidate = genSlug(c);
    // 去重
    let tries = 0;
    while (
      db.prepare(`SELECT id FROM classes WHERE slug = ? AND id != ?`).get(candidate, c.id)
    ) {
      candidate = genSlug(c);
      if (++tries > 5) {
        candidate = `${candidate}-${Date.now()}`;
        break;
      }
    }
    setSlug.run(candidate, c.id);
    slugFixed++;
  }
}
console.log(`   ✓ 已回填 school_id: ${schoolFixed} 条，slug: ${slugFixed} 条\n`);

// 6. 索引
console.log('6. 创建索引...');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_slug ON classes(slug)`);
if (tableExists('posts')) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_class_id ON posts(class_id)`);
}
if (tableExists('forum_threads')) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_forum_threads_class_id ON forum_threads(class_id)`);
}
console.log('   ✓ 索引就绪\n');

console.log('=== 迁移完成 ===\n');
console.log('说明：');
console.log('- schools 表：班级上层聚合，本期仅创建默认学校');
console.log('- classes.slug：班级 URL 片段（/c/:slug）');
console.log('- classes.is_public：未登录是否能看公开主页');
console.log('- posts/forum_threads/forum_posts/announcements.class_id：按班级隔离');

db.close();
