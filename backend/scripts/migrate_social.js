const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/database.sqlite');

let db;
try {
  db = new Database(dbPath);
  console.log('数据库连接成功');
} catch (err) {
  console.error('数据库连接失败:', err);
  process.exit(1);
}

console.log('=== 开始迁移：社交/社区功能表 ===\n');

// ==================== 1. 动态/留言板相关表 ====================
console.log('1. 创建动态/留言板表...');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    images TEXT,
    scope TEXT DEFAULT 'class',
    class_id INTEGER,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    is_top INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS post_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER,
    like_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE
  );
`);
console.log('   ✓ 动态/留言板表创建完成\n');

// ==================== 2. 聊天系统相关表 ====================
console.log('2. 创建聊天系统表...');

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    room_type TEXT NOT NULL,
    room_id INTEGER,
    target_user_id INTEGER,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'text',
    deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (room_id) REFERENCES classes(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chat_read_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    room_type TEXT,
    room_id INTEGER,
    target_user_id INTEGER,
    last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, room_type, room_id),
    UNIQUE(user_id, target_user_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id)
  );
`);
console.log('   ✓ 聊天系统表创建完成\n');

// ==================== 3. 论坛系统相关表 ====================
console.log('3. 创建论坛系统表...');

db.exec(`
  CREATE TABLE IF NOT EXISTS forums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS forum_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    forum_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    view_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    is_top INTEGER DEFAULT 0,
    is_essence INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    last_reply_user_id INTEGER,
    last_reply_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (forum_id) REFERENCES forums(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (last_reply_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS forum_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_id INTEGER,
    is_first_post INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES forum_posts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS forum_thread_tags (
    thread_id INTEGER NOT NULL,
    tag_name TEXT NOT NULL,
    PRIMARY KEY (thread_id, tag_name),
    FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS forum_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(thread_id, user_id),
    FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS forum_post_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS forum_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(thread_id, user_id),
    FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
console.log('   ✓ 论坛系统表创建完成\n');

// ==================== 4. 通知系统表 ====================
console.log('4. 创建通知系统表...');

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    source_type TEXT,
    source_id INTEGER,
    is_read INTEGER DEFAULT 0,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(user_id, type, created_at DESC);
`);
console.log('   ✓ 通知系统表创建完成\n');

// ==================== 5. 初始化论坛板块数据 ====================
console.log('5. 初始化论坛板块数据...');

const existingForums = db.prepare('SELECT COUNT(*) as cnt FROM forums').get().cnt;

if (existingForums === 0) {
  const insertForum = db.prepare(`
    INSERT INTO forums (name, description, icon, sort_order) VALUES (?, ?, ?, ?)
  `);

  const defaultForums = [
    { name: '学习交流', description: '分享学习心得、讨论学习方法', icon: '📚', sort_order: 1 },
    { name: '宠物养成', description: '交流宠物培养经验、展示进化成果', icon: '🐾', sort_order: 2 },
    { name: '战斗攻略', description: '战斗技巧、阵容搭配心得', icon: '⚔️', sort_order: 3 },
    { name: '作业求助', description: '遇到难题？来这里问问同学吧', icon: '❓', sort_order: 4 },
    { name: '闲聊灌水', description: '课余时间，随便聊聊', icon: '💬', sort_order: 5 },
    { name: '建议反馈', description: '对系统的建议和问题反馈', icon: '💡', sort_order: 6 },
    { name: '公告板', description: '官方公告和重要通知', icon: '📢', sort_order: 7 },
  ];

  defaultForums.forEach(f => {
    insertForum.run(f.name, f.description, f.icon, f.sort_order);
  });
  console.log(`   ✓ 初始化 ${defaultForums.length} 个论坛板块\n`);
} else {
  console.log('   论坛板块已存在，跳过初始化\n');
}

// ==================== 6. 创建索引优化查询 ====================
console.log('6. 创建数据库索引...');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_class ON posts(class_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_scope ON posts(scope, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_post_likes ON post_likes(post_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_post_comments ON post_comments(post_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_type, room_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_private ON chat_messages(user_id, target_user_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_forum_threads_forum ON forum_threads(forum_id, status, last_reply_at DESC);
  CREATE INDEX IF NOT EXISTS idx_forum_threads_hot ON forum_threads(status, (view_count + reply_count * 3 + like_count * 5) DESC);
  CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id, created_at ASC);
`);
console.log('   ✓ 索引创建完成\n');

// 验证
console.log('=== 迁移完成 ===\n');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('posts','chat_messages','forums','forum_threads','notifications')").all();
tables.forEach(t => {
  const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${t.name}`).get();
  console.log(`  ${t.name}: ${count.cnt} 条记录`);
});

console.log('\n✅ 社交/社区功能迁移全部完成！');
db.close();
