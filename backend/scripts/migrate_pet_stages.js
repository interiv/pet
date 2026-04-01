const { db } = require('./src/config/database');
const fs = require('fs');
const path = require('path');

// 1. 迁移 pets 表，去除旧的 check 约束并更新默认值
try {
  console.log('开始迁移 pets 表结构以支持 7 种新形态...');
  
  db.prepare('BEGIN TRANSACTION').run();
  
  // 创建新表
  db.prepare(`
    CREATE TABLE pets_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
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
      growth_stage TEXT DEFAULT '宠物蛋' CHECK(growth_stage IN ('宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体')),
      friendship_points INTEGER DEFAULT 0,
      win_count INTEGER DEFAULT 0,
      total_battles INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (species_id) REFERENCES pet_species(id)
    )
  `).run();

  // 复制数据，并把旧的 stage 映射到新的
  const pets = db.prepare('SELECT * FROM pets').all();
  const insertPet = db.prepare(`
    INSERT INTO pets_new (id, user_id, name, species_id, level, exp, hunger, mood, health, stamina, attack, defense, speed, crit_rate, image_id, current_equipment, growth_stage, friendship_points, win_count, total_battles, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const pet of pets) {
    let newStage = '宠物蛋';
    // 映射旧形态或根据等级重新计算
    if (pet.level >= 80) newStage = '究极体';
    else if (pet.level >= 55) newStage = '完全体';
    else if (pet.level >= 35) newStage = '成年期';
    else if (pet.level >= 20) newStage = '成长期';
    else if (pet.level >= 10) newStage = '幼年期';
    else if (pet.level >= 5) newStage = '初生期';
    
    insertPet.run(
      pet.id, pet.user_id, pet.name, pet.species_id, pet.level, pet.exp, pet.hunger, pet.mood, pet.health, pet.stamina,
      pet.attack, pet.defense, pet.speed, pet.crit_rate, pet.image_id, pet.current_equipment, newStage, pet.friendship_points,
      pet.win_count, pet.total_battles, pet.created_at, pet.updated_at
    );
  }

  db.prepare('DROP TABLE pets').run();
  db.prepare('ALTER TABLE pets_new RENAME TO pets').run();
  
  db.prepare('CREATE INDEX idx_pets_user ON pets(user_id)').run();
  db.prepare('CREATE INDEX idx_pets_species ON pets(species_id)').run();

  db.prepare('COMMIT').run();
  console.log('pets 表结构迁移成功！');
} catch (e) {
  if (db.inTransaction) db.prepare('ROLLBACK').run();
  console.error('迁移 pets 表失败 (如果已存在 pets_new 表请忽略或者手动清理):', e.message);
}

// 2. 插入 32 种宠物和提示词生成
const stages = ['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'];
const stagePrompts = {
  '宠物蛋': 'a magical egg of a {en_name}, {element} element theme, glowing patterns, cute',
  '初生期': 'tiny newborn baby {en_name}, big cute eyes, very small, {element} aura',
  '幼年期': 'small cute {en_name}, playful, developing {element} features',
  '成长期': 'growing young {en_name}, energetic, clear {element} traits',
  '成年期': 'majestic adult {en_name}, strong {element} aura',
  '完全体': 'heavily armored perfect {en_name}, glowing {element} power, large and intimidating',
  '究极体': 'god-like mythic {en_name}, legendary, immense {element} energy radiating, divine pose'
};

const petsData = [
  { name: '火焰狮', en_name: 'fire lion', element: 'fire', desc: '热情似火的狮子，拥有强大的攻击力' },
  { name: '水灵龟', en_name: 'water turtle', element: 'water', desc: '温和的水之守护者，拥有极高的防御力' },
  { name: '森林鹿', en_name: 'forest deer', element: 'grass', desc: '优雅的森林精灵，速度敏捷' },
  { name: '光明鸟', en_name: 'light bird', element: 'light', desc: '神圣的光明使者，平衡而优雅' },
  { name: '暗影狼', en_name: 'shadow wolf', element: 'dark', desc: '神秘的暗影猎手，高攻高敏' },
  { name: '雷霆狐', en_name: 'thunder fox', element: 'light', desc: '掌控雷电的灵狐，速度极快' },
  { name: '冰晶熊', en_name: 'ice bear', element: 'water', desc: '身披冰晶铠甲的巨熊，防御惊人' },
  { name: '疾风鹰', en_name: 'wind eagle', element: 'grass', desc: '驾驭狂风的猛禽，灵动迅捷' },
  { name: '大地象', en_name: 'earth elephant', element: 'grass', desc: '坚如磐石的巨象，力量无穷' },
  { name: '钢铁犀', en_name: 'metal rhino', element: 'dark', desc: '浑身钢铁的犀牛，无坚不摧' },
  { name: '熔岩龙', en_name: 'lava dragon', element: 'fire', desc: '诞生于火山的巨龙，毁灭一切' },
  { name: '深海鲸', en_name: 'deep sea whale', element: 'water', desc: '潜游深海的巨兽，生命力极强' },
  { name: '剧毒蝎', en_name: 'poison scorpion', element: 'dark', desc: '隐藏在暗处的毒蝎，致命一击' },
  { name: '幻影猫', en_name: 'illusion cat', element: 'dark', desc: '能制造幻影的灵猫，神秘莫测' },
  { name: '荆棘蛇', en_name: 'thorn snake', element: 'grass', desc: '浑身长满倒刺的毒蛇，令人生畏' },
  { name: '圣光兽', en_name: 'holy unicorn', element: 'light', desc: '传说中的神圣独角兽，治愈万物' },
  { name: '幽冥蝠', en_name: 'nether bat', element: 'dark', desc: '倒悬于深渊的吸血蝙蝠' },
  { name: '闪电豹', en_name: 'lightning leopard', element: 'light', desc: '快如闪电的猎豹，瞬间爆发' },
  { name: '极地狐', en_name: 'polar snow fox', element: 'water', desc: '极寒之地的妖狐，擅长冰冻' },
  { name: '狂风熊', en_name: 'storm bear', element: 'grass', desc: '能呼唤风暴的狂熊' },
  { name: '岩石鳄', en_name: 'rock crocodile', element: 'grass', desc: '潜伏在沙石中的远古巨鳄' },
  { name: '钛金龙', en_name: 'titanium wyvern', element: 'dark', desc: '金属构造的飞龙，穿梭天际' },
  { name: '赤炎凤', en_name: 'crimson phoenix', element: 'fire', desc: '浴火重生的神鸟凤凰' },
  { name: '潮汐马', en_name: 'tidal seahorse', element: 'water', desc: '掌控海潮的魔法海马' },
  { name: '灵木猿', en_name: 'spirit wood ape', element: 'grass', desc: '穿梭于林间的智慧巨猿' },
  { name: '晨星灵', en_name: 'morning star sprite', element: 'light', desc: '伴随晨星降临的小精灵' },
  { name: '梦魇犬', en_name: 'nightmare hound', element: 'dark', desc: '带来无尽噩梦的地狱恶犬' },
  { name: '雷云虎', en_name: 'thundercloud tiger', element: 'light', desc: '背负雷云的百兽之王' },
  { name: '霜冻企鹅', en_name: 'frost penguin', element: 'water', desc: '操控冰霜的极地企鹅' },
  { name: '飓风螳螂', en_name: 'hurricane mantis', element: 'grass', desc: '挥舞双刀卷起飓风的螳螂' },
  { name: '沙漠鸵', en_name: 'desert ostrich', element: 'fire', desc: '奔跑在沙漠中的巨型鸵鸟' },
  { name: '秘银龟', en_name: 'mithril turtle', element: 'light', desc: '背负秘银重壳的长寿灵龟' }
];

let mdContent = `# 宠物生成提示词列表\n\n一共设计了 **32** 种宠物，每种宠物有 **7** 个形态（宠物蛋、初生期、幼年期、成长期、成年期、完全体、究极体）。\n\n**通用要求**：生成图片时，请务必在提示词中加上背景和风格的描述，建议直接复制每条后面的英文。\n\n---\n\n`;

const commonSuffix = ", anime style, high quality, white background, isolated";

let updateCount = 0;
let insertCount = 0;

for (let i = 0; i < petsData.length; i++) {
  const p = petsData[i];
  mdContent += `## ${i + 1}. ${p.name} (${p.en_name})\n`;
  
  const imageUrls = {};
  
  for (const stage of stages) {
    let promptTpl = stagePrompts[stage];
    let prompt = promptTpl.replace('{en_name}', p.en_name).replace('{element}', p.element);
    let fullPrompt = `Game asset, ${prompt}${commonSuffix}`;
    
    mdContent += `- **${stage}**: \`${fullPrompt}\`\n`;
    imageUrls[stage] = `/images/pets/${p.name}_${stage}_ai.png`;
  }
  mdContent += `\n`;

  const baseStats = JSON.stringify({ attack: 10 + Math.floor(Math.random() * 10), defense: 10 + Math.floor(Math.random() * 10), speed: 10 + Math.floor(Math.random() * 10) });
  const growthRate = (1.0 + Math.random() * 0.5).toFixed(2);
  const imgJson = JSON.stringify(imageUrls);

  const existing = db.prepare('SELECT id FROM pet_species WHERE name = ?').get(p.name);
  if (existing) {
    db.prepare('UPDATE pet_species SET element_type = ?, base_stats = ?, growth_rate = ?, description = ?, image_urls = ? WHERE name = ?')
      .run(p.element, baseStats, growthRate, p.desc, imgJson, p.name);
    updateCount++;
  } else {
    db.prepare('INSERT INTO pet_species (name, element_type, base_stats, growth_rate, description, image_urls) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.name, p.element, baseStats, growthRate, p.desc, imgJson);
    insertCount++;
  }
}

const mdPath = path.join(__dirname, '../pet_prompts.md');
fs.writeFileSync(mdPath, mdContent, 'utf8');

console.log(`成功更新了 ${updateCount} 个已有宠物，新增了 ${insertCount} 个宠物！`);
console.log(`提示词已保存至: ${mdPath}`);
