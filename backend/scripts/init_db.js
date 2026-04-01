const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

console.log('=== 初始化数据库 ===\n');

const dataDir = path.join(__dirname, '../data');
const dbPath = path.join(dataDir, 'database.sqlite');

// 1. 删除旧数据库
if (fs.existsSync(dbPath)) {
  console.log('1. 删除旧数据库...');
  fs.unlinkSync(dbPath);
  console.log('   ✓ 旧数据库已删除');
} else {
  console.log('1. 数据库不存在，跳过删除');
}

// 2. 创建新数据库
console.log('\n2. 创建新数据库...');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
console.log('   ✓ 数据库创建成功');

// 3. 创建表结构
console.log('\n3. 创建表结构...');

db.exec(`
  -- 用户表
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'student',
    class_id INTEGER,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    status TEXT DEFAULT 'active'
  );

  -- 宠物种类表
  CREATE TABLE pet_species (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    element_type TEXT,
    base_stats TEXT,
    growth_rate REAL DEFAULT 1.0,
    unlock_condition TEXT,
    image_urls TEXT,
    description TEXT
  );

  -- 宠物表
  CREATE TABLE pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    species_id INTEGER NOT NULL,
    level INTEGER DEFAULT 1,
    exp INTEGER DEFAULT 0,
    hunger INTEGER DEFAULT 100,
    mood INTEGER DEFAULT 100,
    health INTEGER DEFAULT 100,
    stamina INTEGER DEFAULT 100,
    attack INTEGER DEFAULT 10,
    defense INTEGER DEFAULT 10,
    speed INTEGER DEFAULT 10,
    crit_rate REAL DEFAULT 0.05,
    image_id INTEGER,
    current_equipment TEXT,
    growth_stage TEXT DEFAULT '宠物蛋',
    friendship_points INTEGER DEFAULT 0,
    win_count INTEGER DEFAULT 0,
    total_battles INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (species_id) REFERENCES pet_species(id)
  );

  -- 物品表
  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT,
    effect_type TEXT,
    effect_value INTEGER,
    price INTEGER DEFAULT 0,
    description TEXT,
    image_url TEXT,
    rarity TEXT DEFAULT 'common'
  );

  -- 用户物品表
  CREATE TABLE user_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (item_id) REFERENCES items(id)
  );

  -- 装备表
  CREATE TABLE equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slot TEXT,
    stats_bonus TEXT,
    set_id INTEGER,
    price INTEGER DEFAULT 0,
    description TEXT,
    image_url TEXT,
    rarity TEXT DEFAULT 'common',
    required_level INTEGER DEFAULT 1
  );

  -- 用户装备表
  CREATE TABLE user_equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    equipment_id INTEGER NOT NULL,
    equipped INTEGER DEFAULT 0,
    obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    level INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (equipment_id) REFERENCES equipment(id)
  );

  -- 技能表
  CREATE TABLE skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT,
    power INTEGER DEFAULT 50,
    accuracy REAL DEFAULT 1.0,
    element TEXT,
    description TEXT,
    animation_id INTEGER,
    cooldown INTEGER DEFAULT 0
  );

  -- 宠物技能表
  CREATE TABLE pet_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    skill_level INTEGER DEFAULT 1,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pet_id) REFERENCES pets(id),
    FOREIGN KEY (skill_id) REFERENCES skills(id)
  );

  -- 战斗表
  CREATE TABLE battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet1_id INTEGER NOT NULL,
    pet2_id INTEGER NOT NULL,
    winner_id INTEGER,
    battle_type TEXT DEFAULT 'pvp',
    reward_exp INTEGER DEFAULT 0,
    reward_gold INTEGER DEFAULT 0,
    battle_log TEXT,
    battle_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    season_id INTEGER,
    rank_change INTEGER DEFAULT 0
  );

  -- 作业表
  CREATE TABLE assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    subject TEXT,
    question_type TEXT,
    questions TEXT,
    max_exp INTEGER DEFAULT 100,
    due_date DATETIME,
    status TEXT DEFAULT 'active',
    ai_config TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES users(id)
  );

  -- 提交表
  CREATE TABLE submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    answers TEXT,
    attachments TEXT,
    status TEXT DEFAULT 'submitted',
    ai_score REAL,
    ai_feedback TEXT,
    teacher_score REAL,
    teacher_feedback TEXT,
    exp_reward INTEGER DEFAULT 0,
    gold_reward INTEGER DEFAULT 0,
    dropped_item TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    graded_at DATETIME,
    FOREIGN KEY (assignment_id) REFERENCES assignments(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- 好友表
  CREATE TABLE friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    friendship_level INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_interaction DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id)
  );

  -- 班级表
  CREATE TABLE classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grade TEXT,
    teacher_id INTEGER,
    student_count INTEGER DEFAULT 0,
    total_exp INTEGER DEFAULT 0,
    rank INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 公告表
  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER,
    publisher_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );

  -- 任务表
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT DEFAULT 'daily',
    name TEXT NOT NULL,
    description TEXT,
    condition TEXT,
    reward TEXT,
    reset_type TEXT DEFAULT 'daily',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 用户任务表
  CREATE TABLE user_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    completed_at DATETIME,
    reset_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  -- 成就表
  CREATE TABLE achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    condition TEXT,
    reward_type TEXT,
    reward_value INTEGER
  );

  -- 用户成就表
  CREATE TABLE user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_id INTEGER NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (achievement_id) REFERENCES achievements(id)
  );

  -- 错题表
  CREATE TABLE wrong_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    assignment_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    wrong_answer TEXT,
    correct_answer TEXT,
    analysis TEXT,
    reviewed INTEGER DEFAULT 0,
    reviewed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (assignment_id) REFERENCES assignments(id)
  );

  -- AI配置表
  CREATE TABLE ai_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_name TEXT NOT NULL,
    model_type TEXT,
    api_endpoint TEXT,
    api_key TEXT,
    parameters TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 设置表
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

console.log('   ✓ 表结构创建成功');

// 4. 初始化基础数据
console.log('\n4. 初始化基础数据...');

// 宠物种类
const petSpecies = [
  { name: '火焰狮', element_type: 'fire', base_stats: JSON.stringify({ attack: 15, defense: 8, speed: 12 }), growth_rate: 1.2, description: '热情似火的狮子，拥有强大的攻击力', image_urls: JSON.stringify({ '幼年期': '/images/pets/fire_lion_baby.png', '成长期': '/images/pets/fire_lion_young.png', '成年期': '/images/pets/fire_lion_adult.png' }) },
  { name: '水灵龟', element_type: 'water', base_stats: JSON.stringify({ attack: 8, defense: 15, speed: 7 }), growth_rate: 1.1, description: '温和的水之守护者，拥有极高的防御力', image_urls: JSON.stringify({ '幼年期': '/images/pets/water_turtle_baby.png', '成长期': '/images/pets/water_turtle_young.png', '成年期': '/images/pets/water_turtle_adult.png' }) },
  { name: '森林鹿', element_type: 'grass', base_stats: JSON.stringify({ attack: 10, defense: 10, speed: 15 }), growth_rate: 1.0, description: '优雅的森林精灵，速度敏捷', image_urls: JSON.stringify({ '幼年期': '/images/pets/forest_deer_baby.png', '成长期': '/images/pets/forest_deer_young.png', '成年期': '/images/pets/forest_deer_adult.png' }) },
  { name: '光明鸟', element_type: 'light', base_stats: JSON.stringify({ attack: 12, defense: 9, speed: 14 }), growth_rate: 1.15, description: '神圣的光明使者，平衡而优雅', image_urls: JSON.stringify({ '幼年期': '/images/pets/light_bird_baby.png', '成长期': '/images/pets/light_bird_young.png', '成年期': '/images/pets/light_bird_adult.png' }) },
  { name: '暗影狼', element_type: 'dark', base_stats: JSON.stringify({ attack: 14, defense: 7, speed: 14 }), growth_rate: 1.18, description: '神秘的暗影猎手，高攻高敏', image_urls: JSON.stringify({ '幼年期': '/images/pets/dark_wolf_baby.png', '成长期': '/images/pets/dark_wolf_young.png', '成年期': '/images/pets/dark_wolf_adult.png' }) }
];

const insertSpecies = db.prepare('INSERT INTO pet_species (name, element_type, base_stats, growth_rate, description, image_urls) VALUES (?, ?, ?, ?, ?, ?)');
petSpecies.forEach(s => insertSpecies.run(s.name, s.element_type, s.base_stats, s.growth_rate, s.description, s.image_urls));
console.log('   ✓ 宠物种类初始化完成');

// 物品
const items = [
  { name: '普通粮食', type: 'food', effect_type: 'exp', effect_value: 10, price: 10, description: '普通的宠物粮食', rarity: 'common' },
  { name: '高级零食', type: 'food', effect_type: 'exp', effect_value: 50, price: 50, description: '美味的零食', rarity: 'rare' },
  { name: '特殊料理', type: 'food', effect_type: 'exp', effect_value: 100, price: 100, description: '精心制作的料理', rarity: 'epic' },
  { name: '经验药水', type: 'potion', effect_type: 'exp', effect_value: 200, price: 200, description: '立即获得 200 经验', rarity: 'epic' },
  { name: '心情药水', type: 'potion', effect_type: 'mood', effect_value: 30, price: 30, description: '提升心情值', rarity: 'common' },
  { name: '治疗药剂', type: 'potion', effect_type: 'health', effect_value: 50, price: 50, description: '恢复健康值', rarity: 'common' },
  { name: '体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 50, price: 50, description: '恢复体力值', rarity: 'common' }
];

const insertItem = db.prepare('INSERT INTO items (name, type, effect_type, effect_value, price, description, rarity) VALUES (?, ?, ?, ?, ?, ?, ?)');
items.forEach(i => insertItem.run(i.name, i.type, i.effect_type, i.effect_value, i.price, i.description, i.rarity));
console.log('   ✓ 物品数据初始化完成');

// 装备
const equipment = [
  { name: '铁剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 5 }), price: 100, rarity: 'common', required_level: 1 },
  { name: '钢剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 10 }), price: 200, rarity: 'rare', required_level: 10 },
  { name: '火焰之剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 20 }), price: 500, rarity: 'epic', required_level: 30 },
  { name: '布衣', slot: 'armor', stats_bonus: JSON.stringify({ defense: 5 }), price: 100, rarity: 'common', required_level: 1 },
  { name: '铁甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 10 }), price: 200, rarity: 'rare', required_level: 10 },
  { name: '龙鳞甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 20 }), price: 500, rarity: 'epic', required_level: 30 },
  { name: '皮帽', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 3 }), price: 80, rarity: 'common', required_level: 1 },
  { name: '铁盔', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 8 }), price: 180, rarity: 'rare', required_level: 10 },
  { name: '学士帽', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 5, speed: 5 }), price: 300, rarity: 'epic', required_level: 20 },
  { name: '幸运项链', slot: 'accessory', stats_bonus: JSON.stringify({ crit_rate: 0.05 }), price: 150, rarity: 'rare', required_level: 5 },
  { name: '力量戒指', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 8 }), price: 250, rarity: 'epic', required_level: 15 }
];

const insertEquipment = db.prepare('INSERT INTO equipment (name, slot, stats_bonus, price, rarity, required_level) VALUES (?, ?, ?, ?, ?, ?)');
equipment.forEach(e => insertEquipment.run(e.name, e.slot, e.stats_bonus, e.price, e.rarity, e.required_level));
console.log('   ✓ 装备数据初始化完成');

// 技能
const skills = [
  { name: '普通攻击', type: 'physical', power: 50, accuracy: 1.0, element: 'normal', description: '普通的物理攻击', cooldown: 0 },
  { name: '火焰冲击', type: 'magical', power: 80, accuracy: 0.9, element: 'fire', description: '强力的火焰魔法', cooldown: 2 },
  { name: '水炮', type: 'magical', power: 75, accuracy: 0.95, element: 'water', description: '高压水柱攻击', cooldown: 2 },
  { name: '飞叶快刀', type: 'physical', power: 70, accuracy: 0.95, element: 'grass', description: '快速的叶片攻击', cooldown: 1 },
  { name: '神圣之光', type: 'magical', power: 85, accuracy: 0.9, element: 'light', description: '神圣的光芒攻击', cooldown: 3 },
  { name: '暗影爪', type: 'physical', power: 75, accuracy: 0.95, element: 'dark', description: '黑暗之爪攻击', cooldown: 2 }
];

const insertSkill = db.prepare('INSERT INTO skills (name, type, power, accuracy, element, description, cooldown) VALUES (?, ?, ?, ?, ?, ?, ?)');
skills.forEach(s => insertSkill.run(s.name, s.type, s.power, s.accuracy, s.element, s.description, s.cooldown));
console.log('   ✓ 技能数据初始化完成');

// 成就
const achievements = [
  { name: '初入江湖', description: '创建第一只宠物', condition: JSON.stringify({ type: 'create_pet', count: 1 }), reward_type: 'gold', reward_value: 100 },
  { name: '作业新手', description: '完成第一次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward_type: 'exp', reward_value: 50 },
  { name: '首胜', description: '获得第一场战斗胜利', condition: JSON.stringify({ type: 'win_battle', count: 1 }), reward_type: 'gold', reward_value: 200 },
  { name: '10级突破', description: '宠物达到 10 级', condition: JSON.stringify({ type: 'pet_level', level: 10 }), reward_type: 'item', reward_value: 3 }
];

const insertAchievement = db.prepare('INSERT INTO achievements (name, description, condition, reward_type, reward_value) VALUES (?, ?, ?, ?, ?)');
achievements.forEach(a => insertAchievement.run(a.name, a.description, a.condition, a.reward_type, a.reward_value));
console.log('   ✓ 成就数据初始化完成');

// 任务
const tasks = [
  { type: 'daily', name: '每日签到', description: '每天登录游戏', condition: JSON.stringify({ type: 'login' }), reward: JSON.stringify({ type: 'gold', value: 50 }), reset_type: 'daily' },
  { type: 'daily', name: '完成作业', description: '完成 1 次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward: JSON.stringify({ type: 'exp', value: 100 }), reset_type: 'daily' },
  { type: 'daily', name: '进行战斗', description: '进行 1 次战斗', condition: JSON.stringify({ type: 'battle', count: 1 }), reward: JSON.stringify({ type: 'gold', value: 100 }), reset_type: 'daily' }
];

const insertTask = db.prepare('INSERT INTO tasks (type, name, description, condition, reward, reset_type) VALUES (?, ?, ?, ?, ?, ?)');
tasks.forEach(t => insertTask.run(t.type, t.name, t.description, t.condition, t.reward, t.reset_type));
console.log('   ✓ 任务数据初始化完成');

// 5. 创建测试用户
console.log('\n5. 创建测试用户...');

async function createTestUsers() {
  const saltRounds = 10;
  const password = '111111';
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // 管理员
  db.prepare('INSERT INTO users (username, password_hash, email, role, status) VALUES (?, ?, ?, ?, ?)').run('admin', hashedPassword, 'admin@school.com', 'admin', 'active');
  console.log('   ✓ admin 创建成功');

  // 教师
  const teachers = [
    { username: 'teacher1', email: 'teacher1@school.com' },
    { username: 'teacher2', email: 'teacher2@school.com' }
  ];

  teachers.forEach(t => {
    db.prepare('INSERT INTO users (username, password_hash, email, role, status) VALUES (?, ?, ?, ?, ?)').run(t.username, hashedPassword, t.email, 'teacher', 'active');
    console.log(`   ✓ ${t.username} 创建成功`);
  });

  // 学生
  const students = [
    { username: 'student1', email: 'student1@school.com' },
    { username: 'student2', email: 'student2@school.com' },
    { username: 'student3', email: 'student3@school.com' },
    { username: 'student4', email: 'student4@school.com' },
    { username: 'student5', email: 'student5@school.com' },
    { username: 'student6', email: 'student6@school.com' }
  ];

  const petNames = ['小火', '阿水', '木木', '光明', '暗影', '小狼'];
  const growthStages = ['幼年期', '幼年期', '成长期', '成长期', '成年期', '成年期'];

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const result = db.prepare('INSERT INTO users (username, password_hash, email, role, status) VALUES (?, ?, ?, ?, ?)').run(s.username, hashedPassword, s.email, 'student', 'active');
    const userId = result.lastInsertRowid;
    console.log(`   ✓ ${s.username} 创建成功`);

    // 创建宠物
    const level = 3 + i * 2;
    const exp = Math.floor(50 * level);
    const baseAttack = 10 + i * 3;
    const baseDefense = 8 + i * 2;
    const baseSpeed = 12 + i * 2;

    db.prepare(`
      INSERT INTO pets (user_id, name, species_id, level, exp, attack, defense, speed, health, mood, hunger, growth_stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, petNames[i], (i % 5) + 1, level, exp, baseAttack, baseDefense, baseSpeed, 80 + i * 3, 70 + i * 5, 60 + i * 6, growthStages[i]);
    console.log(`     ✓ 宠物 ${petNames[i]} 创建成功 (Lv.${level})`);

    // 赠送初始装备
    const basicEquipments = db.prepare('SELECT id FROM equipment WHERE rarity = ?').all('common');
    basicEquipments.forEach(eq => {
      db.prepare('INSERT INTO user_equipment (user_id, equipment_id, equipped, level) VALUES (?, ?, 0, 1)').run(userId, eq.id);
    });
  }

  console.log('\n✅ 数据库初始化完成！');
  console.log('\n========================================');
  console.log('测试账号信息：');
  console.log('========================================');
  console.log('管理员: admin (密码: 111111)');
  console.log('教师: teacher1, teacher2 (密码: 111111)');
  console.log('学生: student1 ~ student6 (密码: 111111)');
  console.log('========================================');
}

createTestUsers();
