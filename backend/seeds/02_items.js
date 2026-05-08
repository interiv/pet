const items = [
  { name: '普通粮食', type: 'food', effect_type: 'hunger', effect_value: 20, price: 10, description: '普通的宠物粮食，恢复20饱腹度', rarity: 'common', image_url: '/images/items/普通粮食.png' },
  { name: '高级零食', type: 'food', effect_type: 'hunger', effect_value: 50, price: 50, description: '美味的零食，恢复50饱腹度', rarity: 'rare', image_url: '/images/items/高级零食.png' },
  { name: '特殊料理', type: 'food', effect_type: 'hunger', effect_value: 80, price: 100, description: '精心制作的料理，恢复80饱腹度', rarity: 'epic', image_url: '/images/items/特殊料理.png' },
  { name: '蜜汁烤肉', type: 'food', effect_type: 'hunger', effect_value: 100, price: 150, description: '香气四溢的烤肉，恢复满饱腹度', rarity: 'epic', image_url: '/images/items/蜜汁烤肉.png' },
  { name: '黄金苹果', type: 'food', effect_type: 'hunger', effect_value: 100, price: 200, description: '传说中的黄金苹果，恢复满饱腹度并附带经验', rarity: 'legendary', image_url: '/images/items/黄金苹果.png' },
  { name: '经验药水', type: 'potion', effect_type: 'exp', effect_value: 200, price: 200, description: '立即获得200经验', rarity: 'epic', image_url: '/images/items/经验药水.png' },
  { name: '超级经验药水', type: 'potion', effect_type: 'exp', effect_value: 500, price: 500, description: '立即获得500经验', rarity: 'legendary', image_url: '/images/items/超级经验药水.png' },
  { name: '治疗药剂', type: 'potion', effect_type: 'health', effect_value: 50, price: 50, description: '恢复50健康值', rarity: 'common', image_url: '/images/items/治疗药剂.png' },
  { name: '大治疗药剂', type: 'potion', effect_type: 'health', effect_value: 100, price: 100, description: '恢复满健康值', rarity: 'rare', image_url: '/images/items/大治疗药剂.png' },
  { name: '生命果实', type: 'food', effect_type: 'health', effect_value: 100, price: 80, description: '恢复宠物全部健康值', rarity: 'rare', image_url: '/images/items/生命果实.png' },
  { name: '体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 50, price: 50, description: '恢复50体力值', rarity: 'common', image_url: '/images/items/体力药剂.png' },
  { name: '大体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 100, price: 100, description: '恢复满体力值', rarity: 'rare', image_url: '/images/items/大体力药剂.png' },
  { name: '活力果实', type: 'food', effect_type: 'stamina', effect_value: 100, price: 80, description: '恢复宠物全部体力值', rarity: 'rare', image_url: '/images/items/活力果实.png' },
  { name: '心情药水', type: 'potion', effect_type: 'mood', effect_value: 30, price: 30, description: '提升30心情值', rarity: 'common', image_url: '/images/items/心情药水.png' },
  { name: '快乐糖果', type: 'food', effect_type: 'mood', effect_value: 50, price: 50, description: '提升50心情值', rarity: 'common', image_url: '/images/items/快乐糖果.png' },
  { name: '彩虹蛋糕', type: 'food', effect_type: 'mood', effect_value: 100, price: 120, description: '提升满心情值', rarity: 'epic', image_url: '/images/items/彩虹蛋糕.png' },
  { name: '力量果实', type: 'food', effect_type: 'attack', effect_value: 1, price: 500, description: '永久提升1点攻击力', rarity: 'legendary', image_url: '/images/items/力量药水.png' },
  { name: '铁骨果实', type: 'food', effect_type: 'defense', effect_value: 1, price: 500, description: '永久提升1点防御力', rarity: 'legendary', image_url: '/images/items/铁壁药水.png' },
  { name: '疾风果实', type: 'food', effect_type: 'speed', effect_value: 1, price: 500, description: '永久提升1点速度', rarity: 'legendary', image_url: '/images/items/疾风药水.png' },
  { name: '保护罩', type: 'potion', effect_type: 'shield', effect_value: 1, price: 100, description: '防止战斗失败掉落经验', rarity: 'rare', image_url: '/images/items/保护罩.png' },
  { name: '力量药水', type: 'potion', effect_type: 'buff_attack', effect_value: 10, price: 150, description: '临时提升攻击力10点', rarity: 'rare', image_url: '/images/items/力量药水.png' },
  { name: '铁壁药水', type: 'potion', effect_type: 'buff_defense', effect_value: 10, price: 150, description: '临时提升防御力10点', rarity: 'rare', image_url: '/images/items/铁壁药水.png' },
  { name: '疾风药水', type: 'potion', effect_type: 'buff_speed', effect_value: 10, price: 150, description: '临时提升速度10点', rarity: 'rare', image_url: '/images/items/疾风药水.png' },
  { name: '狂暴药水', type: 'potion', effect_type: 'buff_crit', effect_value: 0.2, price: 200, description: '临时提升暴击率20%', rarity: 'epic', image_url: '/images/items/狂暴药水.png' },
  { name: '幸运草', type: 'potion', effect_type: 'luck', effect_value: 1, price: 300, description: '下一次战斗获得双倍金币', rarity: 'epic', image_url: '/images/items/幸运草.png' },
  { name: '改名卡', type: 'potion', effect_type: 'rename', effect_value: 1, price: 500, description: '修改宠物的名字', rarity: 'rare', image_url: '/images/items/改名卡.png' },
  { name: '转生丹', type: 'potion', effect_type: 'reincarnate', effect_value: 1, price: 1000, description: '宠物重置为1级，保留属性加成', rarity: 'legendary', image_url: '/images/items/转生丹.png' },
  { name: '经验加倍卡', type: 'potion', effect_type: 'double_exp', effect_value: 10, price: 300, description: '接下来10次获得经验时双倍', rarity: 'epic', image_url: '/images/items/经验加倍卡.png' },
  { name: '万灵药', type: 'potion', effect_type: 'health', effect_value: 100, price: 300, description: '恢复满健康值、满饱腹度、满心情', rarity: 'epic', image_url: '/images/items/大治疗药剂.png' },
  { name: '营养套餐', type: 'food', effect_type: 'hunger', effect_value: 60, price: 80, description: '营养均衡的套餐，恢复60饱腹度和30心情', rarity: 'rare', image_url: '/images/items/特殊料理.png' },
  { name: '满汉全席', type: 'food', effect_type: 'hunger', effect_value: 100, price: 500, description: '顶级盛宴，恢复满饱腹度、满心情、满体力', rarity: 'legendary', image_url: '/images/items/蜜汁烤肉.png' },
  { name: '灵丹妙药', type: 'potion', effect_type: 'stamina', effect_value: 100, price: 400, description: '恢复满体力、满健康、满心情', rarity: 'legendary', image_url: '/images/items/超级经验药水.png' },
];

exports.seed = async function (knex) {
  await knex('items').del();
  await knex('items').insert(items);
};
