const { db } = require('../src/config/database');

console.log('开始清理重复的测试班级E2E...\n');

// 先查看当前班级情况
const classes = db.prepare('SELECT id, name FROM classes WHERE name = ?').all('测试班级E2E');
console.log('找到的测试班级E2E:', classes.map(c => c.id));

// 检查这些班级的学生
classes.forEach(cls => {
  const students = db.prepare('SELECT id, username FROM users WHERE class_id = ?').all(cls.id);
  console.log(`班级 ${cls.id} 的学生:`, students.map(s => s.username));
});

// 保留第一个班级(id=4)，将其他班级的学生移到班级4
const keepId = 4;
const removeIds = classes.filter(c => c.id !== keepId).map(c => c.id);

if (removeIds.length > 0) {
  console.log(`\n保留班级: ${keepId}`);
  console.log(`将删除班级: ${removeIds.join(', ')}`);
  
  // 开始事务
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN TRANSACTION');
  
  try {
    // 将其他班级的学生移到保留的班级
    removeIds.forEach(id => {
      console.log(`\n处理班级 ${id}...`);
      
      // 更新学生班级
      const result = db.prepare('UPDATE users SET class_id = ? WHERE class_id = ?').run(keepId, id);
      console.log(`  移动了 ${result.changes} 个学生到班级 ${keepId}`);
      
      // 删除班级
      const deleteResult = db.prepare('DELETE FROM classes WHERE id = ?').run(id);
      console.log(`  删除了班级 ${id}`);
    });
    
    db.exec('COMMIT');
    console.log('\n✅ 清理完成！');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('\n❌ 清理失败:', error.message);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
} else {
  console.log('没有需要删除的重复班级');
}

// 验证结果
const finalClasses = db.prepare('SELECT id, name FROM classes ORDER BY id').all();
console.log('\n当前所有班级:');
finalClasses.forEach(c => console.log(`  ${c.id}: ${c.name}`));
