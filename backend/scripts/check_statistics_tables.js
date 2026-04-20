const { db } = require('../src/config/database');

console.log('检查数据库表结构...\n');

// 检查所有表
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('数据库表列表:');
tables.forEach(t => console.log('  - ' + t.name));

// 检查statistics API需要的表
const requiredTables = ['users', 'classes', 'pets', 'battles', 'user_activities', 'gold_transactions', 'user_items', 'items'];
console.log('\n检查必需的表:');
requiredTables.forEach(tableName => {
  const exists = tables.some(t => t.name === tableName);
  console.log(`  ${exists ? '✅' : '❌'} ${tableName}`);
});

// 测试statistics查询
console.log('\n测试statistics查询...');
try {
  const totalUsers = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
  console.log('✅ users表查询成功:', totalUsers);
} catch (e) {
  console.log('❌ users表查询失败:', e.message);
}

try {
  const totalClasses = db.prepare(`SELECT COUNT(*) as count FROM classes`).get().count;
  console.log('✅ classes表查询成功:', totalClasses);
} catch (e) {
  console.log('❌ classes表查询失败:', e.message);
}

try {
  const totalPets = db.prepare(`SELECT COUNT(*) as count FROM pets`).get().count;
  console.log('✅ pets表查询成功:', totalPets);
} catch (e) {
  console.log('❌ pets表查询失败:', e.message);
}

try {
  const totalBattles = db.prepare(`SELECT COUNT(*) as count FROM battles`).get().count;
  console.log('✅ battles表查询成功:', totalBattles);
} catch (e) {
  console.log('❌ battles表查询失败:', e.message);
}

try {
  const dailyActiveUsers = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count FROM user_activities
    WHERE DATE(created_at) = DATE('now', 'localtime')
  `).get();
  console.log('✅ user_activities表查询成功:', dailyActiveUsers);
} catch (e) {
  console.log('❌ user_activities表查询失败:', e.message);
}

try {
  const dailyGoldDistributed = db.prepare(`
    SELECT COALESCE(SUM(gold_change), 0) as total FROM gold_transactions
    WHERE DATE(created_at) = DATE('now', 'localtime') AND gold_change > 0
  `).get();
  console.log('✅ gold_transactions表查询成功:', dailyGoldDistributed);
} catch (e) {
  console.log('❌ gold_transactions表查询失败:', e.message);
}

try {
  const topSellingItems = db.prepare(`
    SELECT i.name, i.rarity, COUNT(ui.id) as purchase_count, SUM(ui.quantity) as total_quantity
    FROM user_items ui
    JOIN items i ON ui.item_id = i.id
    GROUP BY i.id
    ORDER BY purchase_count DESC
    LIMIT 10
  `).all();
  console.log('✅ user_items和items表查询成功');
} catch (e) {
  console.log('❌ user_items/items表查询失败:', e.message);
}
