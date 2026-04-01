const { db } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

const petsDir = path.join(__dirname, '../../frontend/public/images/pets');

console.log('开始更新宠物图片路径...');

// 获取所有宠物种类
const speciesList = db.prepare('SELECT id, name, image_urls FROM pet_species').all();
let updateCount = 0;

const stages = ['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'];

for (const species of speciesList) {
  let imageUrls;
  try {
    imageUrls = JSON.parse(species.image_urls) || {};
  } catch (e) {
    imageUrls = {};
  }

  let isUpdated = false;
  
  // 检查对应的图片文件夹是否存在
  const speciesDir = path.join(petsDir, species.name);
  if (fs.existsSync(speciesDir)) {
    for (const stage of stages) {
      // 检查具体的形态图片是否存在
      const imgPath = path.join(speciesDir, `${stage}.png`);
      if (fs.existsSync(imgPath)) {
        imageUrls[stage] = `/images/pets/${species.name}/${stage}.png`;
        isUpdated = true;
      }
    }
  }

  if (isUpdated) {
    db.prepare('UPDATE pet_species SET image_urls = ? WHERE id = ?')
      .run(JSON.stringify(imageUrls), species.id);
    updateCount++;
  }
}

console.log(`成功更新了 ${updateCount} 种宠物的图片路径！`);
