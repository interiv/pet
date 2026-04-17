const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/database.sqlite');
const db = new Database(dbPath);

console.log('开始宠物技能系统迁移...');

// 创建技能表
db.prepare(`
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    skill_type TEXT NOT NULL,
    subject TEXT,
    base_damage INTEGER DEFAULT 0,
    base_defense INTEGER DEFAULT 0,
    base_speed INTEGER DEFAULT 0,
    cooldown INTEGER DEFAULT 0,
    required_level INTEGER DEFAULT 1,
    required_knowledge_point TEXT,
    required_accuracy REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

console.log('✅ skills 表创建成功');

// 创建宠物技能关联表
db.prepare(`
  CREATE TABLE IF NOT EXISTS pet_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    level INTEGER DEFAULT 1,
    mastery INTEGER DEFAULT 0,
    last_used TEXT,
    use_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pet_id, skill_id)
  )
`).run();

console.log('✅ pet_skills 表创建成功');

// 插入默认技能数据
const defaultSkills = [
  // 数学技能
  {
    name: '计算护盾',
    description: '运用数学计算能力,提升防御力',
    icon: '🛡️',
    skill_type: 'defense',
    subject: '数学',
    base_damage: 0,
    base_defense: 15,
    base_speed: 0,
    cooldown: 3,
    required_level: 5,
    required_knowledge_point: '四则运算',
    required_accuracy: 70
  },
  {
    name: '公式之剑',
    description: '运用公式的力量,造成大量伤害',
    icon: '⚔️',
    skill_type: 'attack',
    subject: '数学',
    base_damage: 20,
    base_defense: 0,
    base_speed: 0,
    cooldown: 2,
    required_level: 8,
    required_knowledge_point: '代数公式',
    required_accuracy: 75
  },
  {
    name: '几何瞬移',
    description: '利用几何知识,提升速度',
    icon: '💨',
    skill_type: 'speed',
    subject: '数学',
    base_damage: 0,
    base_defense: 0,
    base_speed: 20,
    cooldown: 4,
    required_level: 10,
    required_knowledge_point: '几何图形',
    required_accuracy: 80
  },
  
  // 英语技能
  {
    name: '词汇风暴',
    description: '运用丰富的词汇,发动强力攻击',
    icon: '📚',
    skill_type: 'attack',
    subject: '英语',
    base_damage: 18,
    base_defense: 0,
    base_speed: 0,
    cooldown: 2,
    required_level: 5,
    required_knowledge_point: '词汇',
    required_accuracy: 70
  },
  {
    name: '语法护盾',
    description: '精通语法规则,提升防御',
    icon: '📖',
    skill_type: 'defense',
    subject: '英语',
    base_damage: 0,
    base_defense: 12,
    base_speed: 0,
    cooldown: 3,
    required_level: 7,
    required_knowledge_point: '语法',
    required_accuracy: 75
  },
  {
    name: '翻译之光',
    description: '快速翻译,提升全体属性',
    icon: '✨',
    skill_type: 'buff',
    subject: '英语',
    base_damage: 5,
    base_defense: 5,
    base_speed: 5,
    cooldown: 5,
    required_level: 12,
    required_knowledge_point: '翻译',
    required_accuracy: 85
  },
  
  // 物理技能
  {
    name: '力学冲击',
    description: '运用牛顿定律,发动冲击',
    icon: '💥',
    skill_type: 'attack',
    subject: '物理',
    base_damage: 22,
    base_defense: 0,
    base_speed: 0,
    cooldown: 2,
    required_level: 10,
    required_knowledge_point: '力学',
    required_accuracy: 75
  },
  {
    name: '能量护盾',
    description: '能量守恒,转化为防御',
    icon: '🔰',
    skill_type: 'defense',
    subject: '物理',
    base_damage: 0,
    base_defense: 18,
    base_speed: 0,
    cooldown: 3,
    required_level: 12,
    required_knowledge_point: '能量守恒',
    required_accuracy: 80
  },
  
  // 通用技能
  {
    name: '学习之光',
    description: '勤奋学习带来的力量',
    icon: '🌟',
    skill_type: 'buff',
    subject: '通用',
    base_damage: 10,
    base_defense: 10,
    base_speed: 10,
    cooldown: 6,
    required_level: 15,
    required_knowledge_point: null,
    required_accuracy: 90
  }
];

const insertSkill = db.prepare(`
  INSERT OR IGNORE INTO skills (name, description, icon, skill_type, subject, base_damage, base_defense, base_speed, cooldown, required_level, required_knowledge_point, required_accuracy)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const skill of defaultSkills) {
  insertSkill.run(
    skill.name,
    skill.description,
    skill.icon,
    skill.skill_type,
    skill.subject,
    skill.base_damage,
    skill.base_defense,
    skill.base_speed,
    skill.cooldown,
    skill.required_level,
    skill.required_knowledge_point,
    skill.required_accuracy
  );
}

console.log(`✅ 已插入 ${defaultSkills.length} 个默认技能`);

// 关闭数据库
db.close();

console.log('\n🎉 宠物技能系统迁移完成！');
console.log('\n新增功能:');
console.log('  - skills 表：技能定义表');
console.log('  - pet_skills 表：宠物技能关联表');
console.log('  - 10个默认技能（数学/英语/物理/通用）');
console.log('\n技能解锁条件:');
console.log('  - 宠物等级要求');
console.log('  - 知识点掌握度要求');
console.log('  - 正确率要求');
console.log('\n技能类型:');
console.log('  - attack: 攻击型');
console.log('  - defense: 防御型');
console.log('  - speed: 速度型');
console.log('  - buff: 增益型');
