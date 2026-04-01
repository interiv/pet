const { db } = require('./src/config/database');

const moreEquipment = [
  // 武器 (weapon)
  { name: '精灵之弓', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 15, speed: 10 }), price: 350, rarity: 'rare', required_level: 15, image_url: '🏹' },
  { name: '雷霆法杖', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 25, speed: 5 }), price: 600, rarity: 'epic', required_level: 35, image_url: '⚡' },
  { name: '圣光十字剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 40, defense: 10 }), price: 1200, rarity: 'legendary', required_level: 50, image_url: '⚔️' },
  { name: '暗影匕首', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 18, speed: 20 }), price: 450, rarity: 'epic', required_level: 25, image_url: '🗡️' },
  
  // 躯干 (armor)
  { name: '精灵长袍', slot: 'armor', stats_bonus: JSON.stringify({ defense: 12, speed: 8 }), price: 300, rarity: 'rare', required_level: 15, image_url: '👘' },
  { name: '玄冰重甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 35, speed: -5 }), price: 800, rarity: 'epic', required_level: 40, image_url: '🛡️' },
  { name: '星光守护铠', slot: 'armor', stats_bonus: JSON.stringify({ defense: 50, attack: 5 }), price: 1500, rarity: 'legendary', required_level: 60, image_url: '✨' },
  
  // 头部 (helmet)
  { name: '精灵王冠', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 10, speed: 5, attack: 5 }), price: 500, rarity: 'epic', required_level: 30, image_url: '👑' },
  { name: '魔法头巾', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 8, attack: 10 }), price: 400, rarity: 'rare', required_level: 25, image_url: '🧕' },
  { name: '烈焰角盔', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 15, attack: 15 }), price: 900, rarity: 'legendary', required_level: 45, image_url: '🔥' },
  
  // 饰品 (accessory)
  { name: '精灵护符', slot: 'accessory', stats_bonus: JSON.stringify({ speed: 15 }), price: 400, rarity: 'rare', required_level: 20, image_url: '📿' },
  { name: '风暴之翼', slot: 'accessory', stats_bonus: JSON.stringify({ speed: 30, attack: 10 }), price: 1000, rarity: 'legendary', required_level: 50, image_url: '🪽' },
  { name: '生命宝石', slot: 'accessory', stats_bonus: JSON.stringify({ defense: 15, speed: 5 }), price: 600, rarity: 'epic', required_level: 35, image_url: '💎' },
  { name: '学霸眼镜', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 5, defense: 5, speed: 5 }), price: 300, rarity: 'rare', required_level: 10, image_url: '👓' }
];

console.log('开始添加额外的精灵装备...');

const insertEquipment = db.prepare(`
  INSERT INTO equipment (name, slot, stats_bonus, price, rarity, required_level, image_url)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let count = 0;
for (const eq of moreEquipment) {
  // 检查是否已存在同名装备避免重复
  const exists = db.prepare('SELECT id FROM equipment WHERE name = ?').get(eq.name);
  if (!exists) {
    insertEquipment.run(eq.name, eq.slot, eq.stats_bonus, eq.price, eq.rarity, eq.required_level, eq.image_url);
    count++;
  }
}

console.log(`成功添加 ${count} 件新装备！`);
