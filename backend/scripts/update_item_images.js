const { db, initDatabase } = require('./src/config/database');

const updateItemImages = () => {
  try {
    console.log('开始更新道具图片...');

    const itemImageMap = {
      '普通粮食': '/images/items/普通粮食.png',
      '高级零食': '/images/items/高级零食.png',
      '特殊料理': '/images/items/特殊料理.png',
      '蜜汁烤肉': '/images/items/蜜汁烤肉.png',
      '黄金苹果': '/images/items/黄金苹果.png',
      '生命果实': '/images/items/生命果实.png',
      '活力果实': '/images/items/活力果实.png',
      '快乐糖果': '/images/items/快乐糖果.png',
      '彩虹蛋糕': '/images/items/彩虹蛋糕.png',
      '经验药水': '/images/items/经验药水.png',
      '超级经验药水': '/images/items/超级经验药水.png',
      '心情药水': '/images/items/心情药水.png',
      '治疗药剂': '/images/items/治疗药剂.png',
      '大治疗药剂': '/images/items/大治疗药剂.png',
      '体力药剂': '/images/items/体力药剂.png',
      '大体力药剂': '/images/items/大体力药剂.png',
      '保护罩': '/images/items/保护罩.png',
      '力量药水': '/images/items/力量药水.png',
      '铁壁药水': '/images/items/铁壁药水.png',
      '疾风药水': '/images/items/疾风药水.png',
      '狂暴药水': '/images/items/狂暴药水.png',
      '幸运草': '/images/items/幸运草.png',
      '改名卡': '/images/items/改名卡.png',
      '转生丹': '/images/items/转生丹.png',
      '经验加倍卡': '/images/items/经验加倍卡.png',
    };

    const updateStmt = db.prepare('UPDATE items SET image_url = ? WHERE name = ?');

    db.transaction(() => {
      Object.entries(itemImageMap).forEach(([name, imageUrl]) => {
        updateStmt.run(imageUrl, name);
      });
    })();

    console.log('✓ 道具图片更新完成！');

    const updatedItems = db.prepare('SELECT id, name, image_url FROM items ORDER BY id').all();
    console.log('\n当前所有道具及图片:');
    updatedItems.forEach(item => {
      console.log(`- ${item.name}: ${item.image_url || '(无图片)'}`);
    });

  } catch (error) {
    console.error('更新道具图片失败:', error);
    throw error;
  }
};

if (require.main === module) {
  initDatabase();
  updateItemImages();
}

module.exports = { updateItemImages };
