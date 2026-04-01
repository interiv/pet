const { db } = require('./src/config/database');
const fs = require('fs');
const path = require('path');

// 装备名称列表，来源于数据库
const equipments = [
  '铁剑', '钢剑', '火焰之剑', '精灵之弓', '雷霆法杖', '圣光十字剑', '暗影匕首',
  '布衣', '铁甲', '龙鳞甲', '精灵长袍', '玄冰重甲', '星光守护铠',
  '皮帽', '铁盔', '学士帽', '精灵王冠', '魔法头巾', '烈焰角盔',
  '幸运项链', '力量戒指', '精灵护符', '风暴之翼', '生命宝石', '学霸眼镜'
];

console.log('开始更新装备图片为本地路径...');

const updateStmt = db.prepare(`
  UPDATE equipment SET image_url = ? WHERE name = ?
`);

let count = 0;
for (const name of equipments) {
  // 假设所有装备都在 frontend/public/images/equipment 下，并且后缀为 _ai.png
  const url = `/images/equipment/${name}_ai.png`;
  const result = updateStmt.run(url, name);
  if (result.changes > 0) count++;
}

console.log(`成功更新了 ${count} 件装备的本地图片链接！`);
