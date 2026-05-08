const fs = require('fs');
const path = require('path');

const petsDir = path.join(__dirname, '../../frontend/public/images/pets');
const stages = ['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'];

const petsData = [
  { name: '火焰狮', element_type: 'fire', desc: '热情似火的狮子，拥有强大的攻击力' },
  { name: '水灵龟', element_type: 'water', desc: '温和的水之守护者，拥有极高的防御力' },
  { name: '森林鹿', element_type: 'grass', desc: '优雅的森林精灵，速度敏捷' },
  { name: '光明鸟', element_type: 'light', desc: '神圣的光明使者，平衡而优雅' },
  { name: '暗影狼', element_type: 'dark', desc: '神秘的暗影猎手，高攻高敏' },
  { name: '雷霆狐', element_type: 'light', desc: '掌控雷电的灵狐，速度极快' },
  { name: '冰晶熊', element_type: 'water', desc: '身披冰晶铠甲的巨熊，防御惊人' },
  { name: '疾风鹰', element_type: 'grass', desc: '驾驭狂风的猛禽，灵动迅捷' },
  { name: '大地象', element_type: 'grass', desc: '坚如磐石的巨象，力量无穷' },
  { name: '钢铁犀', element_type: 'dark', desc: '浑身钢铁的犀牛，无坚不摧' },
  { name: '熔岩龙', element_type: 'fire', desc: '诞生于火山的巨龙，毁灭一切' },
  { name: '深海鲸', element_type: 'water', desc: '潜游深海的巨兽，生命力极强' },
  { name: '剧毒蝎', element_type: 'dark', desc: '隐藏在暗处的毒蝎，致命一击' },
  { name: '幻影猫', element_type: 'dark', desc: '能制造幻影的灵猫，神秘莫测' },
  { name: '荆棘蛇', element_type: 'grass', desc: '浑身长满倒刺的毒蛇，令人生畏' },
  { name: '圣光兽', element_type: 'light', desc: '传说中的神圣独角兽，治愈万物' },
  { name: '幽冥蝠', element_type: 'dark', desc: '倒悬于深渊的吸血蝙蝠' },
  { name: '闪电豹', element_type: 'light', desc: '快如闪电的猎豹，瞬间爆发' },
  { name: '极地狐', element_type: 'water', desc: '极寒之地的妖狐，擅长冰冻' },
  { name: '狂风熊', element_type: 'grass', desc: '能呼唤风暴的狂熊' },
  { name: '岩石鳄', element_type: 'grass', desc: '潜伏在沙石中的远古巨鳄' },
  { name: '钛金龙', element_type: 'dark', desc: '金属构造的飞龙，穿梭天际' },
  { name: '赤炎凤', element_type: 'fire', desc: '浴火重生的神鸟凤凰' },
  { name: '潮汐马', element_type: 'water', desc: '掌控海潮的魔法海马' },
  { name: '灵木猿', element_type: 'grass', desc: '穿梭于林间的智慧巨猿' },
  { name: '晨星灵', element_type: 'light', desc: '伴随晨星降临的小精灵' },
  { name: '梦魇犬', element_type: 'dark', desc: '带来无尽噩梦的地狱恶犬' },
  { name: '雷云虎', element_type: 'light', desc: '背负雷云的百兽之王' },
  { name: '霜冻企鹅', element_type: 'water', desc: '操控冰霜的极地企鹅' },
  { name: '飓风螳螂', element_type: 'grass', desc: '挥舞双刀卷起飓风的螳螂' },
  { name: '沙漠鸵', element_type: 'fire', desc: '奔跑在沙漠中的巨型鸵鸟' },
  { name: '秘银龟', element_type: 'light', desc: '背负秘银重壳的长寿灵龟' },
];

exports.seed = async function (knex) {
  await knex('pet_species').del();

  for (const p of petsData) {
    const baseStats = JSON.stringify({
      attack: 10 + Math.floor(Math.random() * 10),
      defense: 10 + Math.floor(Math.random() * 10),
      speed: 10 + Math.floor(Math.random() * 10),
    });
    const growthRate = (1.0 + Math.random() * 0.5).toFixed(2);
    const imageUrls = {};
    const speciesDir = path.join(petsDir, p.name);

    if (fs.existsSync(speciesDir)) {
      for (const stage of stages) {
        const thumbPath = path.join(speciesDir, `${stage}_thumb.png`);
        const imgPath = path.join(speciesDir, `${stage}.png`);
        if (fs.existsSync(thumbPath)) {
          imageUrls[stage] = `/images/pets/${p.name}/${stage}_thumb.png`;
        } else if (fs.existsSync(imgPath)) {
          imageUrls[stage] = `/images/pets/${p.name}/${stage}.png`;
        }
      }
    }

    await knex('pet_species').insert({
      name: p.name,
      element_type: p.element_type,
      base_stats: baseStats,
      growth_rate: growthRate,
      description: p.desc,
      image_urls: JSON.stringify(imageUrls),
    });
  }
};
