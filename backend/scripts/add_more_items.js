const { db, initDatabase } = require('./src/config/database');

const addMoreItems = () => {
  try {
    console.log('开始添加更多道具...');

    const items = [
      { name: '普通粮食', type: 'food', effect_type: 'exp', effect_value: 10, price: 10, description: '普通的宠物粮食，提供少量经验', rarity: 'common' },
      { name: '高级零食', type: 'food', effect_type: 'exp', effect_value: 50, price: 50, description: '美味的零食，提供中等经验', rarity: 'rare' },
      { name: '特殊料理', type: 'food', effect_type: 'exp', effect_value: 100, price: 100, description: '精心制作的料理，提供大量经验', rarity: 'epic' },
      { name: '蜜汁烤肉', type: 'food', effect_type: 'exp', effect_value: 150, price: 150, description: '香气四溢的烤肉，宠物超喜欢', rarity: 'epic' },
      { name: '黄金苹果', type: 'food', effect_type: 'exp', effect_value: 200, price: 200, description: '传说中的黄金苹果，提供巨额经验', rarity: 'legendary' },
      { name: '生命果实', type: 'food', effect_type: 'health', effect_value: 100, price: 80, description: '恢复宠物全部生命值', rarity: 'rare' },
      { name: '活力果实', type: 'food', effect_type: 'stamina', effect_value: 100, price: 80, description: '恢复宠物全部体力值', rarity: 'rare' },
      { name: '快乐糖果', type: 'food', effect_type: 'mood', effect_value: 50, price: 50, description: '让宠物心情大好', rarity: 'common' },
      { name: '彩虹蛋糕', type: 'food', effect_type: 'mood', effect_value: 100, price: 120, description: '美味的彩虹蛋糕，宠物心情爆表', rarity: 'epic' },
      
      { name: '经验药水', type: 'potion', effect_type: 'exp', effect_value: 200, price: 200, description: '立即获得 200 经验', rarity: 'epic' },
      { name: '超级经验药水', type: 'potion', effect_type: 'exp', effect_value: 500, price: 500, description: '立即获得 500 经验', rarity: 'legendary' },
      { name: '心情药水', type: 'potion', effect_type: 'mood', effect_value: 30, price: 30, description: '提升心情值 30 点', rarity: 'common' },
      { name: '治疗药剂', type: 'potion', effect_type: 'health', effect_value: 50, price: 50, description: '恢复 50 点生命值', rarity: 'common' },
      { name: '大治疗药剂', type: 'potion', effect_type: 'health', effect_value: 100, price: 100, description: '恢复 100 点生命值', rarity: 'rare' },
      { name: '体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 50, price: 50, description: '恢复 50 点体力值', rarity: 'common' },
      { name: '大体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 100, price: 100, description: '恢复 100 点体力值', rarity: 'rare' },
      { name: '保护罩', type: 'potion', effect_type: 'shield', effect_value: 1, price: 100, description: '防止战斗失败掉落经验', rarity: 'rare' },
      { name: '力量药水', type: 'potion', effect_type: 'buff_attack', effect_value: 10, price: 150, description: '临时提升攻击力 10 点（1场战斗）', rarity: 'rare' },
      { name: '铁壁药水', type: 'potion', effect_type: 'buff_defense', effect_value: 10, price: 150, description: '临时提升防御力 10 点（1场战斗）', rarity: 'rare' },
      { name: '疾风药水', type: 'potion', effect_type: 'buff_speed', effect_value: 10, price: 150, description: '临时提升速度 10 点（1场战斗）', rarity: 'rare' },
      { name: '狂暴药水', type: 'potion', effect_type: 'buff_crit', effect_value: 0.2, price: 200, description: '临时提升暴击率 20%（1场战斗）', rarity: 'epic' },
      
      { name: '幸运草', type: 'potion', effect_type: 'luck', effect_value: 1, price: 300, description: '使用后下一次战斗必定获得双倍金币奖励', rarity: 'epic' },
      { name: '改名卡', type: 'potion', effect_type: 'rename', effect_value: 1, price: 500, description: '可以修改宠物的名字', rarity: 'rare' },
      { name: '转生丹', type: 'potion', effect_type: 'reincarnate', effect_value: 1, price: 1000, description: '宠物重置为1级，但保留所有属性加成', rarity: 'legendary' },
      { name: '经验加倍卡', type: 'potion', effect_type: 'double_exp', effect_value: 10, price: 300, description: '接下来10次获得经验时双倍', rarity: 'epic' },
    ];

    const insertItem = db.prepare(`
      INSERT OR REPLACE INTO items (name, type, effect_type, effect_value, price, description, rarity)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      items.forEach(item => {
        insertItem.run(
          item.name,
          item.type,
          item.effect_type,
          item.effect_value,
          item.price,
          item.description,
          item.rarity
        );
      });
    })();

    console.log('✓ 道具数据添加完成！共添加', items.length, '个道具');

    const addedItems = db.prepare('SELECT * FROM items ORDER BY price').all();
    console.log('\n当前所有道具:');
    addedItems.forEach(item => {
      console.log(`- ${item.name} (${item.type}) - ${item.price}金币 - ${item.rarity}`);
    });

  } catch (error) {
    console.error('添加道具失败:', error);
    throw error;
  }
};

if (require.main === module) {
  initDatabase();
  addMoreItems();
}

module.exports = { addMoreItems };
