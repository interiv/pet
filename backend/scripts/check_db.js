const { db } = require('./src/config/database');

console.log('=== 检查数据库中的用户 ===\n');

const users = db.prepare('SELECT id, username, role, status FROM users').all();

if (users.length === 0) {
  console.log('数据库中没有用户！');
} else {
  console.log(`共找到 ${users.length} 个用户：\n`);
  
  users.forEach((user, index) => {
    console.log(`${index + 1}. 用户名: ${user.username}`);
    console.log(`   ID: ${user.id}`);
    console.log(`   角色: ${user.role}`);
    console.log(`   状态: ${user.status}`);
    console.log('');
  });
}

const pets = db.prepare('SELECT p.name, u.username as owner, p.level FROM pets p JOIN users u ON p.user_id = u.id').all();
console.log(`\n=== 宠物信息 (${pets.length} 只) ===`);
pets.forEach(pet => {
  console.log(`${pet.owner} 的宠物: ${pet.name} (Lv.${pet.level})`);
});
