const { db } = require('../src/config/database');

console.log('开始迁移好友系统到申请-接受模式...\n');

// 1. 创建新的好友请求表
console.log('1. 创建 friend_requests 表...');
db.exec(`
  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id),
    UNIQUE(sender_id, receiver_id)
  );
`);
console.log('   ✓ friend_requests 表创建完成\n');

// 2. 为 friends 表添加 status 字段
console.log('2. 为 friends 表添加 status 字段...');
try {
  db.exec(`ALTER TABLE friends ADD COLUMN status TEXT DEFAULT 'active'`);
  console.log('   ✓ status 字段添加完成\n');
} catch (e) {
  console.log('   ⚠ status 字段可能已存在，跳过\n');
}

// 3. 创建索引
console.log('3. 创建索引...');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id, status);
  CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id, status);
  CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(user_id, status);
`);
console.log('   ✓ 索引创建完成\n');

// 4. 将现有的双向好友记录标记为 active
console.log('4. 更新现有好友关系状态...');
db.exec(`
  UPDATE friends SET status = 'active' WHERE status IS NULL OR status = '';
`);
console.log('   ✓ 现有好友关系已更新\n');

console.log('=== 迁移完成 ===\n');
console.log('新的好友系统功能：');
console.log('  ✓ 发送好友请求（需要对方接受）');
console.log('  ✓ 接收/拒绝/忽略好友请求');
console.log('  ✓ 只有双方都接受后才成为真正的好友');
console.log('  ✓ 待审核的好友不会显示在好友列表中\n');

db.close();
