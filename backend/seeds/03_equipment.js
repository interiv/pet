const equipment = [
  { name: '铁剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 5, defense: 2, speed: 1 }), price: 100, rarity: 'common', required_level: 1, image_url: '/images/equipment/铁剑_ai.png' },
  { name: '钢剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 10, defense: 3, speed: 2 }), price: 200, rarity: 'rare', required_level: 10, image_url: '/images/equipment/钢剑_ai.png' },
  { name: '火焰之剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 20, defense: 5, speed: 3 }), price: 500, rarity: 'epic', required_level: 30, image_url: '/images/equipment/火焰之剑_ai.png' },
  { name: '精灵之弓', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 15, defense: 3, speed: 10 }), price: 350, rarity: 'rare', required_level: 15, image_url: '/images/equipment/精灵之弓_ai.png' },
  { name: '雷霆法杖', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 25, defense: 4, speed: 5 }), price: 600, rarity: 'epic', required_level: 35, image_url: '/images/equipment/雷霆法杖_ai.png' },
  { name: '圣光十字剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 40, defense: 10, speed: 5 }), price: 1200, rarity: 'legendary', required_level: 50, image_url: '/images/equipment/圣光十字剑_ai.png' },
  { name: '暗影匕首', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 18, defense: 2, speed: 20 }), price: 450, rarity: 'epic', required_level: 25, image_url: '/images/equipment/暗影匕首_ai.png' },
  { name: '布衣', slot: 'armor', stats_bonus: JSON.stringify({ defense: 5, attack: 2, speed: 1 }), price: 100, rarity: 'common', required_level: 1, image_url: '/images/equipment/布衣_ai.png' },
  { name: '铁甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 10, attack: 3, speed: 1 }), price: 200, rarity: 'rare', required_level: 10, image_url: '/images/equipment/铁甲_ai.png' },
  { name: '龙鳞甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 20, attack: 5, speed: 3 }), price: 500, rarity: 'epic', required_level: 30, image_url: '/images/equipment/龙鳞甲_ai.png' },
  { name: '精灵长袍', slot: 'armor', stats_bonus: JSON.stringify({ defense: 12, attack: 3, speed: 8 }), price: 300, rarity: 'rare', required_level: 15, image_url: '/images/equipment/精灵长袍_ai.png' },
  { name: '玄冰重甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 35, attack: 5, speed: -5 }), price: 800, rarity: 'epic', required_level: 40, image_url: '/images/equipment/玄冰重甲_ai.png' },
  { name: '星光守护铠', slot: 'armor', stats_bonus: JSON.stringify({ defense: 50, attack: 5, speed: 3 }), price: 1500, rarity: 'legendary', required_level: 60, image_url: '/images/equipment/星光守护铠_ai.png' },
  { name: '皮帽', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 3, attack: 1, speed: 1 }), price: 80, rarity: 'common', required_level: 1, image_url: '/images/equipment/皮帽_ai.png' },
  { name: '铁盔', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 8, attack: 2, speed: 1 }), price: 180, rarity: 'rare', required_level: 10, image_url: '/images/equipment/铁盔_ai.png' },
  { name: '学士帽', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 5, attack: 3, speed: 5 }), price: 300, rarity: 'epic', required_level: 20, image_url: '/images/equipment/学士帽_ai.png' },
  { name: '精灵王冠', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 10, attack: 5, speed: 5 }), price: 500, rarity: 'epic', required_level: 30, image_url: '/images/equipment/精灵王冠_ai.png' },
  { name: '魔法头巾', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 8, attack: 10, speed: 3 }), price: 400, rarity: 'rare', required_level: 25, image_url: '/images/equipment/魔法头巾_ai.png' },
  { name: '烈焰角盔', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 15, attack: 15, speed: 5 }), price: 900, rarity: 'legendary', required_level: 45, image_url: '/images/equipment/烈焰角盔_ai.png' },
  { name: '幸运项链', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 3, defense: 3, speed: 3, crit_rate: 0.05 }), price: 150, rarity: 'rare', required_level: 5, image_url: '/images/equipment/幸运项链_ai.png' },
  { name: '精灵护符', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 5, defense: 5, speed: 10 }), price: 300, rarity: 'rare', required_level: 15, image_url: '/images/equipment/精灵护符_ai.png' },
  { name: '力量戒指', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 15, defense: 5, speed: 3 }), price: 500, rarity: 'epic', required_level: 30, image_url: '/images/equipment/力量戒指_ai.png' },
  { name: '风暴之翼', slot: 'accessory', stats_bonus: JSON.stringify({ speed: 30, attack: 10, defense: 5 }), price: 1000, rarity: 'legendary', required_level: 50, image_url: '/images/equipment/风暴之翼_ai.png' },
  { name: '生命宝石', slot: 'accessory', stats_bonus: JSON.stringify({ defense: 15, attack: 3, speed: 5 }), price: 600, rarity: 'epic', required_level: 35, image_url: '/images/equipment/生命宝石_ai.png' },
  { name: '学霸眼镜', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 5, defense: 5, speed: 5 }), price: 300, rarity: 'rare', required_level: 10, image_url: '/images/equipment/学霸眼镜_ai.png' },
];

exports.seed = async function (knex) {
  await knex('equipment').del();
  await knex('equipment').insert(equipment);
};
