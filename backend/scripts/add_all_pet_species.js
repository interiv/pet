const { db } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

const petsDir = path.join(__dirname, '../../frontend/public/images/pets');
const stages = ['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'];

console.log('开始添加所有宠物种类到数据库...');

const elementTypes = ['fire', 'water', 'grass', 'light', 'dark', 'earth', 'ice', 'electric', 'wind', 'poison'];

const petDescriptions = {
  '火焰狮': '热情似火的狮子，拥有强大的攻击力',
  '水灵龟': '温和的水之守护者，拥有极高的防御力',
  '森林鹿': '优雅的森林精灵，速度敏捷',
  '光明鸟': '神圣的光明使者，平衡而优雅',
  '暗影狼': '神秘的暗影猎手，高攻高敏',
  '冰晶熊': '来自极地的冰雪守护者',
  '剧毒蝎': '致命的沙漠毒蝎',
  '圣光兽': '圣洁的神圣守护者',
  '大地象': '坚如磐石的大地之力',
  '岩石鳄': '远古时期的岩石巨兽',
  '幻影猫': '神秘莫测的幻影精灵',
  '幽冥蝠': '来自幽冥的暗夜蝙蝠',
  '晨星灵': '璀璨的星辰化身',
  '极地狐': '灵动的极地雪狐',
  '梦魇犬': '来自梦境的恐怖守卫',
  '沙漠鸵': '沙漠中极速奔跑的鸵鸟',
  '深海鲸': '来自深海的巨大守护者',
  '潮汐马': '驾驭潮汐的神秘骏马',
  '灵木猿': '森林中的智慧猿猴',
  '熔岩龙': '来自地心的火焰巨龙',
  '狂风熊': '驾驭狂风的威猛熊王',
  '疾风鹰': '天空中的极速猎手',
  '秘银龟': '身披秘银铠甲的神龟',
  '荆棘蛇': '身披荆棘的剧毒蛇王',
  '赤炎凤': '浴火重生的不死凤凰',
  '钛金龙': '坚不可摧的钢铁巨龙',
  '钢铁犀': '身披铁甲的犀牛战士',
  '闪电豹': '如闪电般的极速猎手',
  '雷云虎': '驾驭雷电的猛虎之王',
  '雷霆狐': '携带雷霆之力的狐狸',
  '霜冻企鹅': '来自极地的可爱企鹅',
  '飓风螳螂': '锋利如刀的飓风螳螂'
};

const petElementType = {
  '火焰狮': 'fire',
  '水灵龟': 'water',
  '森林鹿': 'grass',
  '光明鸟': 'light',
  '暗影狼': 'dark',
  '冰晶熊': 'ice',
  '剧毒蝎': 'poison',
  '圣光兽': 'light',
  '大地象': 'earth',
  '岩石鳄': 'earth',
  '幻影猫': 'dark',
  '幽冥蝠': 'dark',
  '晨星灵': 'light',
  '极地狐': 'ice',
  '梦魇犬': 'dark',
  '沙漠鸵': 'earth',
  '深海鲸': 'water',
  '潮汐马': 'water',
  '灵木猿': 'grass',
  '熔岩龙': 'fire',
  '狂风熊': 'wind',
  '疾风鹰': 'wind',
  '秘银龟': 'earth',
  '荆棘蛇': 'poison',
  '赤炎凤': 'fire',
  '钛金龙': 'earth',
  '钢铁犀': 'earth',
  '闪电豹': 'electric',
  '雷云虎': 'electric',
  '雷霆狐': 'electric',
  '霜冻企鹅': 'ice',
  '飓风螳螂': 'wind'
};

const insertSpecies = db.prepare(`
  INSERT OR IGNORE INTO pet_species (name, element_type, base_stats, growth_rate, description, image_urls)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const speciesDirs = fs.readdirSync(petsDir).filter(dir => 
  fs.statSync(path.join(petsDir, dir)).isDirectory() && dir !== 'progress.json'
);

let addedCount = 0;
let skippedCount = 0;

speciesDirs.forEach((name, index) => {
  const existing = db.prepare('SELECT id FROM pet_species WHERE name = ?').get(name);
  if (existing) {
    skippedCount++;
    console.log(`跳过已存在的: ${name}`);
    return;
  }

  const element = petElementType[name] || elementTypes[index % elementTypes.length];
  const description = petDescriptions[name] || `神秘的${name}`;
  
  const baseAttack = 8 + Math.floor(Math.random() * 10);
  const baseDefense = 7 + Math.floor(Math.random() * 10);
  const baseSpeed = 7 + Math.floor(Math.random() * 10);
  
  const base_stats = JSON.stringify({
    attack: baseAttack,
    defense: baseDefense,
    speed: baseSpeed
  });
  
  const growth_rate = 1.0 + Math.random() * 0.3;
  
  const imageUrls = {};
  const speciesDir = path.join(petsDir, name);
  for (const stage of stages) {
    const imgPath = path.join(speciesDir, `${stage}.png`);
    if (fs.existsSync(imgPath)) {
      imageUrls[stage] = `/images/pets/${name}/${stage}.png`;
    }
  }

  insertSpecies.run(
    name,
    element,
    base_stats,
    growth_rate,
    description,
    JSON.stringify(imageUrls)
  );
  
  addedCount++;
  console.log(`添加成功: ${name} (${element})`);
});

console.log(`\n完成！新增 ${addedCount} 种宠物，跳过 ${skippedCount} 种已存在的宠物。`);

const total = db.prepare('SELECT COUNT(*) as count FROM pet_species').get();
console.log(`当前数据库中共有 ${total.count} 种宠物。`);
