const { db } = require('./src/config/database');

const items = [
  { name: '普通粮食', type: 'food', effect_type: 'exp', effect_value: 10, price: 10, description: '普通的宠物粮食', rarity: 'common', image_url: '🍞' },
  { name: '高级零食', type: 'food', effect_type: 'exp', effect_value: 50, price: 50, description: '美味的零食', rarity: 'rare', image_url: '🍖' },
  { name: '特殊料理', type: 'food', effect_type: 'exp', effect_value: 100, price: 100, description: '精心制作的料理', rarity: 'epic', image_url: '🍱' },
  { name: '经验药水', type: 'potion', effect_type: 'exp', effect_value: 200, price: 200, description: '立即获得 200 经验', rarity: 'epic', image_url: '🧪' },
  { name: '心情药水', type: 'potion', effect_type: 'mood', effect_value: 30, price: 30, description: '提升心情值', rarity: 'common', image_url: '💖' },
  { name: '治疗药剂', type: 'potion', effect_type: 'health', effect_value: 50, price: 50, description: '恢复健康值', rarity: 'common', image_url: '💊' },
  { name: '体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 50, price: 50, description: '恢复体力值', rarity: 'common', image_url: '⚡' },
  { name: '保护罩', type: 'potion', effect_type: 'shield', effect_value: 1, price: 100, description: '防止战斗失败掉落经验', rarity: 'rare', image_url: '🛡️' },
  // 新增永久属性道具
  { name: '力量果实', type: 'food', effect_type: 'attack', effect_value: 1, price: 500, description: '永久提升 1 点攻击力', rarity: 'legendary', image_url: '🍎' },
  { name: '铁骨果实', type: 'food', effect_type: 'defense', effect_value: 1, price: 500, description: '永久提升 1 点防御力', rarity: 'legendary', image_url: '🥥' },
  { name: '疾风果实', type: 'food', effect_type: 'speed', effect_value: 1, price: 500, description: '永久提升 1 点速度', rarity: 'legendary', image_url: '🍇' }
];

console.log('开始更新道具商店数据...');

const updateStmt = db.prepare(`
  UPDATE items SET type = ?, effect_type = ?, effect_value = ?, price = ?, description = ?, rarity = ?, image_url = ?
  WHERE name = ?
`);

const insertStmt = db.prepare(`
  INSERT INTO items (name, type, effect_type, effect_value, price, description, rarity, image_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let updateCount = 0;
let insertCount = 0;

for (const item of items) {
  const existing = db.prepare('SELECT id FROM items WHERE name = ?').get(item.name);
  if (existing) {
    updateStmt.run(item.type, item.effect_type, item.effect_value, item.price, item.description, item.rarity, item.image_url, item.name);
    updateCount++;
  } else {
    insertStmt.run(item.name, item.type, item.effect_type, item.effect_value, item.price, item.description, item.rarity, item.image_url);
    insertCount++;
  }
}

console.log(`成功更新了 ${updateCount} 个道具，新增了 ${insertCount} 个道具！`);