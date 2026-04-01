const { db, initDatabase } = require('./database');

// 初始化基础数据
const initializeData = () => {
  try {
    console.log('开始初始化基础数据...');

    // 插入宠物种类
    const petSpecies = [
      {
        name: '火焰狮',
        element_type: 'fire',
        base_stats: JSON.stringify({ attack: 15, defense: 8, speed: 12 }),
        growth_rate: 1.2,
        description: '热情似火的狮子，拥有强大的攻击力',
        image_urls: JSON.stringify({
          '幼年期': '🦁',
          '青年期': '🦁🔥',
          '成年期': '🦁🔥🔥',
          '完全体': '🦁🔥🔥🔥',
          '究极体': '🦁✨🔥'
        })
      },
      {
        name: '水灵龟',
        element_type: 'water',
        base_stats: JSON.stringify({ attack: 8, defense: 15, speed: 7 }),
        growth_rate: 1.1,
        description: '温和的水之守护者，拥有极高的防御力',
        image_urls: JSON.stringify({
          '幼年期': '🐢',
          '青年期': '🐢💧',
          '成年期': '🐢💧💧',
          '完全体': '🐢💧💧💧',
          '究极体': '🐢✨💧'
        })
      },
      {
        name: '森林鹿',
        element_type: 'grass',
        base_stats: JSON.stringify({ attack: 10, defense: 10, speed: 15 }),
        growth_rate: 1.0,
        description: '优雅的森林精灵，速度敏捷',
        image_urls: JSON.stringify({
          '幼年期': '🦌',
          '青年期': '🦌🌿',
          '成年期': '🦌🌿🌿',
          '完全体': '🦌🌿🌿🌿',
          '究极体': '🦌✨🌿'
        })
      },
      {
        name: '光明鸟',
        element_type: 'light',
        base_stats: JSON.stringify({ attack: 12, defense: 9, speed: 14 }),
        growth_rate: 1.15,
        description: '神圣的光明使者，平衡而优雅',
        image_urls: JSON.stringify({
          '幼年期': '🐣',
          '青年期': '🦅',
          '成年期': '🦅✨',
          '完全体': '🦅✨✨',
          '究极体': '🦅🌟'
        })
      },
      {
        name: '暗影狼',
        element_type: 'dark',
        base_stats: JSON.stringify({ attack: 14, defense: 7, speed: 14 }),
        growth_rate: 1.18,
        description: '神秘的暗影猎手，高攻高敏',
        image_urls: JSON.stringify({
          '幼年期': '🐺',
          '青年期': '🐺🌑',
          '成年期': '🐺🌑🌑',
          '完全体': '🐺🌑🌑🌑',
          '究极体': '🐺✨🌑'
        })
      }
    ];

    const insertSpecies = db.prepare(`
      INSERT INTO pet_species (name, element_type, base_stats, growth_rate, description, image_urls)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    petSpecies.forEach(species => {
      insertSpecies.run(
        species.name,
        species.element_type,
        species.base_stats,
        species.growth_rate,
        species.description,
        species.image_urls
      );
    });

    console.log('✓ 宠物种类初始化完成');

    // 插入基础物品
    const items = [
      { name: '普通粮食', type: 'food', effect_type: 'exp', effect_value: 10, price: 10, description: '普通的宠物粮食', rarity: 'common' },
      { name: '高级零食', type: 'food', effect_type: 'exp', effect_value: 50, price: 50, description: '美味的零食', rarity: 'rare' },
      { name: '特殊料理', type: 'food', effect_type: 'exp', effect_value: 100, price: 100, description: '精心制作的料理', rarity: 'epic' },
      { name: '经验药水', type: 'potion', effect_type: 'exp', effect_value: 200, price: 200, description: '立即获得 200 经验', rarity: 'epic' },
      { name: '心情药水', type: 'potion', effect_type: 'mood', effect_value: 30, price: 30, description: '提升心情值', rarity: 'common' },
      { name: '治疗药剂', type: 'potion', effect_type: 'health', effect_value: 50, price: 50, description: '恢复健康值', rarity: 'common' },
      { name: '体力药剂', type: 'potion', effect_type: 'stamina', effect_value: 50, price: 50, description: '恢复体力值', rarity: 'common' },
      { name: '保护罩', type: 'potion', effect_type: 'shield', effect_value: 1, price: 100, description: '防止战斗失败掉落经验', rarity: 'rare' },
    ];

    const insertItem = db.prepare(`
      INSERT INTO items (name, type, effect_type, effect_value, price, description, rarity)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

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

    console.log('✓ 物品数据初始化完成');

    // 插入基础装备
    const equipment = [
      { name: '铁剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 5 }), price: 100, rarity: 'common', required_level: 1 },
      { name: '钢剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 10 }), price: 200, rarity: 'rare', required_level: 10 },
      { name: '火焰之剑', slot: 'weapon', stats_bonus: JSON.stringify({ attack: 20 }), price: 500, rarity: 'epic', required_level: 30 },
      { name: '布衣', slot: 'armor', stats_bonus: JSON.stringify({ defense: 5 }), price: 100, rarity: 'common', required_level: 1 },
      { name: '铁甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 10 }), price: 200, rarity: 'rare', required_level: 10 },
      { name: '龙鳞甲', slot: 'armor', stats_bonus: JSON.stringify({ defense: 20 }), price: 500, rarity: 'epic', required_level: 30 },
      { name: '皮帽', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 3 }), price: 80, rarity: 'common', required_level: 1 },
      { name: '铁盔', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 8 }), price: 180, rarity: 'rare', required_level: 10 },
      { name: '学士帽', slot: 'helmet', stats_bonus: JSON.stringify({ defense: 5, speed: 5 }), price: 300, rarity: 'epic', required_level: 20 },
      { name: '幸运项链', slot: 'accessory', stats_bonus: JSON.stringify({ crit_rate: 0.05 }), price: 150, rarity: 'rare', required_level: 5 },
      { name: '力量戒指', slot: 'accessory', stats_bonus: JSON.stringify({ attack: 8 }), price: 250, rarity: 'epic', required_level: 15 },
    ];

    const insertEquipment = db.prepare(`
      INSERT INTO equipment (name, slot, stats_bonus, price, rarity, required_level)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    equipment.forEach(item => {
      insertEquipment.run(
        item.name,
        item.slot,
        item.stats_bonus,
        item.price,
        item.rarity,
        item.required_level
      );
    });

    console.log('✓ 装备数据初始化完成');

    // 插入基础技能
    const skills = [
      { name: '普通攻击', type: 'physical', power: 50, accuracy: 1.0, element: 'normal', description: '普通的物理攻击', cooldown: 0 },
      { name: '火焰冲击', type: 'magical', power: 80, accuracy: 0.9, element: 'fire', description: '强力的火焰魔法', cooldown: 2 },
      { name: '水炮', type: 'magical', power: 75, accuracy: 0.95, element: 'water', description: '高压水柱攻击', cooldown: 2 },
      { name: '飞叶快刀', type: 'physical', power: 70, accuracy: 0.95, element: 'grass', description: '快速的叶片攻击', cooldown: 1 },
      { name: '神圣之光', type: 'magical', power: 85, accuracy: 0.9, element: 'light', description: '神圣的光芒攻击', cooldown: 3 },
      { name: '暗影爪', type: 'physical', power: 75, accuracy: 0.95, element: 'dark', description: '黑暗之爪攻击', cooldown: 2 },
      { name: '防御强化', type: 'buff', power: 0, accuracy: 1.0, element: 'normal', description: '提升自身防御力', cooldown: 3 },
      { name: '速度提升', type: 'buff', power: 0, accuracy: 1.0, element: 'normal', description: '提升自身速度', cooldown: 3 },
      { name: '全力一击', type: 'physical', power: 120, accuracy: 0.7, element: 'normal', description: '高威力但命中率低的攻击', cooldown: 4 },
    ];

    const insertSkill = db.prepare(`
      INSERT INTO skills (name, type, power, accuracy, element, description, cooldown)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    skills.forEach(skill => {
      insertSkill.run(
        skill.name,
        skill.type,
        skill.power,
        skill.accuracy,
        skill.element,
        skill.description,
        skill.cooldown
      );
    });

    console.log('✓ 技能数据初始化完成');

    // 插入基础成就
    const achievements = [
      { name: '初入江湖', description: '创建第一只宠物', condition: JSON.stringify({ type: 'create_pet', count: 1 }), reward_type: 'gold', reward_value: 100 },
      { name: '作业新手', description: '完成第一次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward_type: 'exp', reward_value: 50 },
      { name: '作业达人', description: '连续 7 天完成作业', condition: JSON.stringify({ type: 'continuous_assignment', days: 7 }), reward_type: 'item', reward_value: 1 },
      { name: '首胜', description: '获得第一场战斗胜利', condition: JSON.stringify({ type: 'win_battle', count: 1 }), reward_type: 'gold', reward_value: 200 },
      { name: '战斗王者', description: '获得 10 连胜', condition: JSON.stringify({ type: 'win_streak', count: 10 }), reward_type: 'item', reward_value: 2 },
      { name: '社交达人', description: '添加 5 个好友', condition: JSON.stringify({ type: 'add_friends', count: 5 }), reward_type: 'gold', reward_value: 300 },
      { name: '10 级突破', description: '宠物达到 10 级', condition: JSON.stringify({ type: 'pet_level', level: 10 }), reward_type: 'item', reward_value: 3 },
      { name: '50 级大师', description: '宠物达到 50 级', condition: JSON.stringify({ type: 'pet_level', level: 50 }), reward_type: 'item', reward_value: 5 },
      { name: '收藏家', description: '收集 10 件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 10 }), reward_type: 'gold', reward_value: 500 },
    ];

    const insertAchievement = db.prepare(`
      INSERT INTO achievements (name, description, condition, reward_type, reward_value)
      VALUES (?, ?, ?, ?, ?)
    `);

    achievements.forEach(achievement => {
      insertAchievement.run(
        achievement.name,
        achievement.description,
        achievement.condition,
        achievement.reward_type,
        achievement.reward_value
      );
    });

    console.log('✓ 成就数据初始化完成');

    // 插入每日任务
    const tasks = [
      { type: 'daily', name: '每日签到', description: '每天登录游戏', condition: JSON.stringify({ type: 'login' }), reward: JSON.stringify({ type: 'gold', value: 50 }), reset_type: 'daily' },
      { type: 'daily', name: '完成作业', description: '完成 1 次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward: JSON.stringify({ type: 'exp', value: 100 }), reset_type: 'daily' },
      { type: 'daily', name: '进行战斗', description: '进行 1 次战斗', condition: JSON.stringify({ type: 'battle', count: 1 }), reward: JSON.stringify({ type: 'gold', value: 100 }), reset_type: 'daily' },
      { type: 'daily', name: '拜访好友', description: '拜访 3 位好友', condition: JSON.stringify({ type: 'visit_friends', count: 3 }), reward: JSON.stringify({ type: 'gold', value: 80 }), reset_type: 'daily' },
      { type: 'weekly', name: '周任务 - 作业', description: '完成 5 次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 5 }), reward: JSON.stringify({ type: 'item', value: 2 }), reset_type: 'weekly' },
      { type: 'weekly', name: '周任务 - 战斗', description: '战斗胜利 10 场', condition: JSON.stringify({ type: 'win_battle', count: 10 }), reward: JSON.stringify({ type: 'item', value: 3 }), reset_type: 'weekly' },
    ];

    const insertTask = db.prepare(`
      INSERT INTO tasks (type, name, description, condition, reward, reset_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    tasks.forEach(task => {
      insertTask.run(
        task.type,
        task.name,
        task.description,
        task.condition,
        task.reward,
        task.reset_type
      );
    });

    console.log('✓ 任务数据初始化完成');

    console.log('\n✅ 基础数据初始化完成！');
  } catch (error) {
    console.error('初始化数据失败:', error);
    throw error;
  }
};

// 执行初始化
if (require.main === module) {
  initDatabase();
  initializeData();
}

module.exports = { initializeData };
