const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '../data/database.sqlite');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

console.log('=== 删除 student2 的宠物 ===\n');

const user = db.prepare(`SELECT id, username FROM users WHERE username = 'student2'`).get();
if (!user) {
  console.log('❌ student2 用户不存在');
  db.close();
  process.exit(1);
}

console.log(`找到用户: ${user.username} (id=${user.id})`);

const pet = db.prepare(`SELECT id, name FROM pets WHERE user_id = ?`).get(user.id);
if (!pet) {
  console.log('❌ 该用户还没有宠物');
  db.close();
  process.exit(0);
}

console.log(`找到宠物: ${pet.name} (id=${pet.id})`);

db.prepare(`DELETE FROM pet_skills WHERE pet_id = ?`).run(pet.id);
console.log('  ✓ 已删除宠物技能');

db.prepare(`DELETE FROM pets WHERE id = ?`).run(pet.id);
console.log('  ✓ 已删除宠物');

db.prepare(`DELETE FROM user_equipment WHERE user_id = ?`).run(user.id);
console.log('  ✓ 已删除用户装备');

db.prepare(`DELETE FROM user_items WHERE user_id = ?`).run(user.id);
console.log('  ✓ 已删除用户背包物品');

console.log('\n✅ student2 的宠物及相关数据已删除完成！');
db.close();
