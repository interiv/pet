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
      // === 新手入门 ===
      { name: '初入江湖', description: '创建第一只宠物', condition: JSON.stringify({ type: 'create_pet', count: 1 }), reward_type: 'gold', reward_value: 100 },
      { name: '初露锋芒', description: '宠物达到 5 级', condition: JSON.stringify({ type: 'pet_level', level: 5 }), reward_type: 'gold', reward_value: 150 },
      { name: '小有所成', description: '宠物达到 10 级', condition: JSON.stringify({ type: 'pet_level', level: 10 }), reward_type: 'item', reward_value: 3 },
      { name: '渐入佳境', description: '宠物达到 15 级', condition: JSON.stringify({ type: 'pet_level', level: 15 }), reward_type: 'gold', reward_value: 300 },
      { name: '崭露头角', description: '宠物达到 20 级', condition: JSON.stringify({ type: 'pet_level', level: 20 }), reward_type: 'item', reward_value: 5 },
      { name: '声名鹊起', description: '宠物达到 25 级', condition: JSON.stringify({ type: 'pet_level', level: 25 }), reward_type: 'gold', reward_value: 500 },
      { name: '一方霸主', description: '宠物达到 30 级', condition: JSON.stringify({ type: 'pet_level', level: 30 }), reward_type: 'item', reward_value: 8 },
      { name: '威震八方', description: '宠物达到 40 级', condition: JSON.stringify({ type: 'pet_level', level: 40 }), reward_type: 'gold', reward_value: 800 },
      { name: '登峰造极', description: '宠物达到 50 级', condition: JSON.stringify({ type: 'pet_level', level: 50 }), reward_type: 'item', reward_value: 10 },
      { name: '超凡入圣', description: '宠物达到 60 级', condition: JSON.stringify({ type: 'pet_level', level: 60 }), reward_type: 'gold', reward_value: 1000 },
      { name: '天下无敌', description: '宠物达到 70 级', condition: JSON.stringify({ type: 'pet_level', level: 70 }), reward_type: 'item', reward_value: 15 },
      { name: '传奇诞生', description: '宠物达到 80 级', condition: JSON.stringify({ type: 'pet_level', level: 80 }), reward_type: 'gold', reward_value: 2000 },
      { name: '神话降临', description: '宠物达到 90 级', condition: JSON.stringify({ type: 'pet_level', level: 90 }), reward_type: 'item', reward_value: 20 },
      { name: '满级成就', description: '宠物达到 100 级', condition: JSON.stringify({ type: 'pet_level', level: 100 }), reward_type: 'gold', reward_value: 5000 },

      // === 经验积累 ===
      { name: '初学乍练', description: '累计获得 1000 经验', condition: JSON.stringify({ type: 'total_exp', exp: 1000 }), reward_type: 'gold', reward_value: 100 },
      { name: '学有小成', description: '累计获得 5000 经验', condition: JSON.stringify({ type: 'total_exp', exp: 5000 }), reward_type: 'gold', reward_value: 200 },
      { name: '学有所成', description: '累计获得 10000 经验', condition: JSON.stringify({ type: 'total_exp', exp: 10000 }), reward_type: 'item', reward_value: 2 },
      { name: '学富五车', description: '累计获得 50000 经验', condition: JSON.stringify({ type: 'total_exp', exp: 50000 }), reward_type: 'gold', reward_value: 500 },
      { name: '博学多才', description: '累计获得 100000 经验', condition: JSON.stringify({ type: 'total_exp', exp: 100000 }), reward_type: 'item', reward_value: 5 },
      { name: '学贯古今', description: '累计获得 500000 经验', condition: JSON.stringify({ type: 'total_exp', exp: 500000 }), reward_type: 'gold', reward_value: 1000 },
      { name: '无所不知', description: '累计获得 1000000 经验', condition: JSON.stringify({ type: 'total_exp', exp: 1000000 }), reward_type: 'item', reward_value: 10 },

      // === 战斗相关 ===
      { name: '首战告捷', description: '获得第一场战斗胜利', condition: JSON.stringify({ type: 'win_battle', count: 1 }), reward_type: 'gold', reward_value: 200 },
      { name: '战斗新手', description: '累计胜利 10 场', condition: JSON.stringify({ type: 'win_battle', count: 10 }), reward_type: 'gold', reward_value: 300 },
      { name: '身经百战', description: '累计胜利 50 场', condition: JSON.stringify({ type: 'win_battle', count: 50 }), reward_type: 'item', reward_value: 3 },
      { name: '百战不殆', description: '累计胜利 100 场', condition: JSON.stringify({ type: 'win_battle', count: 100 }), reward_type: 'gold', reward_value: 800 },
      { name: '百战百胜', description: '累计胜利 200 场', condition: JSON.stringify({ type: 'win_battle', count: 200 }), reward_type: 'item', reward_value: 5 },
      { name: '战无不胜', description: '累计胜利 500 场', condition: JSON.stringify({ type: 'win_battle', count: 500 }), reward_type: 'gold', reward_value: 1500 },
      { name: '战神降临', description: '累计胜利 1000 场', condition: JSON.stringify({ type: 'win_battle', count: 1000 }), reward_type: 'item', reward_value: 10 },
      { name: '不败传说', description: '累计胜利 2000 场', condition: JSON.stringify({ type: 'win_battle', count: 2000 }), reward_type: 'gold', reward_value: 3000 },
      { name: '连胜新星', description: '获得 3 连胜', condition: JSON.stringify({ type: 'win_streak', count: 3 }), reward_type: 'gold', reward_value: 150 },
      { name: '连胜新秀', description: '获得 5 连胜', condition: JSON.stringify({ type: 'win_streak', count: 5 }), reward_type: 'gold', reward_value: 300 },
      { name: '连胜达人', description: '获得 10 连胜', condition: JSON.stringify({ type: 'win_streak', count: 10 }), reward_type: 'item', reward_value: 5 },
      { name: '连胜精英', description: '获得 20 连胜', condition: JSON.stringify({ type: 'win_streak', count: 20 }), reward_type: 'gold', reward_value: 800 },
      { name: '连胜大师', description: '获得 30 连胜', condition: JSON.stringify({ type: 'win_streak', count: 30 }), reward_type: 'item', reward_value: 8 },
      { name: '连胜传说', description: '获得 50 连胜', condition: JSON.stringify({ type: 'win_streak', count: 50 }), reward_type: 'gold', reward_value: 2000 },
      { name: '常胜将军', description: '获得 100 连胜', condition: JSON.stringify({ type: 'win_streak', count: 100 }), reward_type: 'item', reward_value: 15 },
      { name: '首战失利', description: '经历第一次战败', condition: JSON.stringify({ type: 'lose_battle', count: 1 }), reward_type: 'gold', reward_value: 50 },
      { name: '败而不馁', description: '累计战败 50 次', condition: JSON.stringify({ type: 'lose_battle', count: 50 }), reward_type: 'gold', reward_value: 200 },
      { name: '越战越勇', description: '累计战斗 100 场', condition: JSON.stringify({ type: 'total_battles', count: 100 }), reward_type: 'item', reward_value: 3 },
      { name: '身经百战', description: '累计战斗 500 场', condition: JSON.stringify({ type: 'total_battles', count: 500 }), reward_type: 'gold', reward_value: 500 },
      { name: '战斗狂人', description: '累计战斗 1000 场', condition: JSON.stringify({ type: 'total_battles', count: 1000 }), reward_type: 'item', reward_value: 8 },

      // === 作业相关 ===
      { name: '作业新手', description: '完成第一次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward_type: 'gold', reward_value: 100 },
      { name: '作业小兵', description: '完成 10 次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 10 }), reward_type: 'gold', reward_value: 200 },
      { name: '作业达人', description: '完成 50 次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 50 }), reward_type: 'item', reward_value: 3 },
      { name: '作业高手', description: '完成 100 次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 100 }), reward_type: 'gold', reward_value: 800 },
      { name: '作业大师', description: '完成 200 次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 200 }), reward_type: 'item', reward_value: 8 },
      { name: '作业狂人', description: '完成 500 次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 500 }), reward_type: 'gold', reward_value: 1500 },
      { name: '连续两天', description: '连续 2 天完成作业', condition: JSON.stringify({ type: 'continuous_assignment', days: 2 }), reward_type: 'gold', reward_value: 100 },
      { name: '连续一周', description: '连续 7 天完成作业', condition: JSON.stringify({ type: 'continuous_assignment', days: 7 }), reward_type: 'item', reward_value: 3 },
      { name: '连续两周', description: '连续 14 天完成作业', condition: JSON.stringify({ type: 'continuous_assignment', days: 14 }), reward_type: 'gold', reward_value: 400 },
      { name: '连续一月', description: '连续 30 天完成作业', condition: JSON.stringify({ type: 'continuous_assignment', days: 30 }), reward_type: 'item', reward_value: 8 },
      { name: '坚持不懈', description: '连续 60 天完成作业', condition: JSON.stringify({ type: 'continuous_assignment', days: 60 }), reward_type: 'gold', reward_value: 1000 },
      { name: '持之以恒', description: '连续 90 天完成作业', condition: JSON.stringify({ type: 'continuous_assignment', days: 90 }), reward_type: 'item', reward_value: 10 },
      { name: '作业王者', description: '连续 180 天完成作业', condition: JSON.stringify({ type: 'continuous_assignment', days: 180 }), reward_type: 'gold', reward_value: 3000 },
      { name: '优秀学生', description: '作业获得 90 分以上 10 次', condition: JSON.stringify({ type: 'high_score', count: 10, score: 90 }), reward_type: 'gold', reward_value: 500 },
      { name: '全优学生', description: '作业获得 90 分以上 50 次', condition: JSON.stringify({ type: 'high_score', count: 50, score: 90 }), reward_type: 'item', reward_value: 5 },
      { name: '满分达人', description: '作业获得 100 分 5 次', condition: JSON.stringify({ type: 'perfect_score', count: 5 }), reward_type: 'gold', reward_value: 800 },
      { name: '满分收割机', description: '作业获得 100 分 20 次', condition: JSON.stringify({ type: 'perfect_score', count: 20 }), reward_type: 'item', reward_value: 10 },

      // === 社交相关 ===
      { name: '认识新朋友', description: '添加 1 个好友', condition: JSON.stringify({ type: 'add_friends', count: 1 }), reward_type: 'gold', reward_value: 50 },
      { name: '广交朋友', description: '添加 5 个好友', condition: JSON.stringify({ type: 'add_friends', count: 5 }), reward_type: 'gold', reward_value: 200 },
      { name: '社交达人', description: '添加 10 个好友', condition: JSON.stringify({ type: 'add_friends', count: 10 }), reward_type: 'item', reward_value: 3 },
      { name: '朋友满天下', description: '添加 20 个好友', condition: JSON.stringify({ type: 'add_friends', count: 20 }), reward_type: 'gold', reward_value: 500 },
      { name: '好友成群', description: '添加 50 个好友', condition: JSON.stringify({ type: 'add_friends', count: 50 }), reward_type: 'item', reward_value: 5 },
      { name: '一呼百应', description: '添加 100 个好友', condition: JSON.stringify({ type: 'add_friends', count: 100 }), reward_type: 'gold', reward_value: 1000 },
      { name: '初次聊天', description: '发送第一条消息', condition: JSON.stringify({ type: 'send_message', count: 1 }), reward_type: 'gold', reward_value: 30 },
      { name: '聊天达人', description: '累计发送 100 条消息', condition: JSON.stringify({ type: 'send_message', count: 100 }), reward_type: 'gold', reward_value: 200 },
      { name: '社交女王', description: '累计发送 500 条消息', condition: JSON.stringify({ type: 'send_message', count: 500 }), reward_type: 'item', reward_value: 3 },
      { name: '话痨之王', description: '累计发送 1000 条消息', condition: JSON.stringify({ type: 'send_message', count: 1000 }), reward_type: 'gold', reward_value: 500 },
      { name: '拜访新人', description: '拜访好友 1 次', condition: JSON.stringify({ type: 'visit_friends', count: 1 }), reward_type: 'gold', reward_value: 50 },
      { name: '热情好客', description: '拜访好友 10 次', condition: JSON.stringify({ type: 'visit_friends', count: 10 }), reward_type: 'gold', reward_value: 150 },
      { name: '串门达人', description: '拜访好友 50 次', condition: JSON.stringify({ type: 'visit_friends', count: 50 }), reward_type: 'item', reward_value: 3 },
      { name: '社交蝴蝶', description: '被好友拜访 20 次', condition: JSON.stringify({ type: 'be_visited', count: 20 }), reward_type: 'gold', reward_value: 300 },
      { name: '万人迷', description: '被好友拜访 100 次', condition: JSON.stringify({ type: 'be_visited', count: 100 }), reward_type: 'item', reward_value: 5 },

      // === 收集相关 ===
      { name: '初获装备', description: '获得第一件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 1 }), reward_type: 'gold', reward_value: 100 },
      { name: '装备收集者', description: '收集 5 件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 5 }), reward_type: 'gold', reward_value: 200 },
      { name: '装备收藏家', description: '收集 10 件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 10 }), reward_type: 'item', reward_value: 3 },
      { name: '装备大师', description: '收集 20 件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 20 }), reward_type: 'gold', reward_value: 500 },
      { name: '收藏大家', description: '收集 50 件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 50 }), reward_type: 'item', reward_value: 8 },
      { name: '初得物品', description: '获得第一件物品', condition: JSON.stringify({ type: 'collect_items', count: 1 }), reward_type: 'gold', reward_value: 50 },
      { name: '物品收集者', description: '收集 20 件物品', condition: JSON.stringify({ type: 'collect_items', count: 20 }), reward_type: 'gold', reward_value: 200 },
      { name: '物品收藏家', description: '收集 50 件物品', condition: JSON.stringify({ type: 'collect_items', count: 50 }), reward_type: 'item', reward_value: 3 },
      { name: '囤积狂人', description: '收集 100 件物品', condition: JSON.stringify({ type: 'collect_items', count: 100 }), reward_type: 'gold', reward_value: 800 },
      { name: '仓库满了', description: '收集 200 件物品', condition: JSON.stringify({ type: 'collect_items', count: 200 }), reward_type: 'item', reward_value: 5 },
      { name: '稀有初现', description: '获得第一件稀有物品', condition: JSON.stringify({ type: 'rare_item', count: 1 }), reward_type: 'gold', reward_value: 300 },
      { name: '稀有收藏家', description: '获得 5 件稀有物品', condition: JSON.stringify({ type: 'rare_item', count: 5 }), reward_type: 'item', reward_value: 5 },
      { name: '史诗降临', description: '获得第一件史诗物品', condition: JSON.stringify({ type: 'epic_item', count: 1 }), reward_type: 'gold', reward_value: 800 },
      { name: '史诗收藏家', description: '获得 3 件史诗物品', condition: JSON.stringify({ type: 'epic_item', count: 3 }), reward_type: 'item', reward_value: 10 },
      { name: '传说拥有者', description: '获得第一件传说物品', condition: JSON.stringify({ type: 'legendary_item', count: 1 }), reward_type: 'gold', reward_value: 2000 },
      { name: '全种类收集', description: '拥有所有类型的装备各一件', condition: JSON.stringify({ type: 'all_equipment_types', count: 1 }), reward_type: 'item', reward_value: 15 },

      // === 宠物属性相关 ===
      { name: '力量初现', description: '宠物攻击力达到 30', condition: JSON.stringify({ type: 'pet_attack', value: 30 }), reward_type: 'gold', reward_value: 200 },
      { name: '攻击力惊人', description: '宠物攻击力达到 50', condition: JSON.stringify({ type: 'pet_attack', value: 50 }), reward_type: 'gold', reward_value: 500 },
      { name: '攻击力爆表', description: '宠物攻击力达到 80', condition: JSON.stringify({ type: 'pet_attack', value: 80 }), reward_type: 'item', reward_value: 5 },
      { name: '防御初成', description: '宠物防御力达到 30', condition: JSON.stringify({ type: 'pet_defense', value: 30 }), reward_type: 'gold', reward_value: 200 },
      { name: '铜墙铁壁', description: '宠物防御力达到 50', condition: JSON.stringify({ type: 'pet_defense', value: 50 }), reward_type: 'gold', reward_value: 500 },
      { name: '固若金汤', description: '宠物防御力达到 80', condition: JSON.stringify({ type: 'pet_defense', value: 80 }), reward_type: 'item', reward_value: 5 },
      { name: '疾如风', description: '宠物速度达到 30', condition: JSON.stringify({ type: 'pet_speed', value: 30 }), reward_type: 'gold', reward_value: 200 },
      { name: '快如闪电', description: '宠物速度达到 50', condition: JSON.stringify({ type: 'pet_speed', value: 50 }), reward_type: 'gold', reward_value: 500 },
      { name: '风驰电掣', description: '宠物速度达到 80', condition: JSON.stringify({ type: 'pet_speed', value: 80 }), reward_type: 'item', reward_value: 5 },
      { name: '全能宠物', description: '宠物三项属性均达到 40', condition: JSON.stringify({ type: 'pet_all_stats', value: 40 }), reward_type: 'gold', reward_value: 1000 },
      { name: '完美属性', description: '宠物三项属性均达到 60', condition: JSON.stringify({ type: 'pet_all_stats', value: 60 }), reward_type: 'item', reward_value: 10 },

      // === 登录相关 ===
      { name: '首次登录', description: '第一天登录游戏', condition: JSON.stringify({ type: 'login', count: 1 }), reward_type: 'gold', reward_value: 50 },
      { name: '连续登录', description: '连续登录 3 天', condition: JSON.stringify({ type: 'continuous_login', days: 3 }), reward_type: 'gold', reward_value: 100 },
      { name: '登录达人', description: '连续登录 7 天', condition: JSON.stringify({ type: 'continuous_login', days: 7 }), reward_type: 'item', reward_value: 2 },
      { name: '登录狂热', description: '连续登录 15 天', condition: JSON.stringify({ type: 'continuous_login', days: 15 }), reward_type: 'gold', reward_value: 400 },
      { name: '登录常客', description: '连续登录 30 天', condition: JSON.stringify({ type: 'continuous_login', days: 30 }), reward_type: 'item', reward_value: 5 },
      { name: '登录坚持', description: '连续登录 60 天', condition: JSON.stringify({ type: 'continuous_login', days: 60 }), reward_type: 'gold', reward_value: 1000 },
      { name: '登录王者', description: '连续登录 100 天', condition: JSON.stringify({ type: 'continuous_login', days: 100 }), reward_type: 'item', reward_value: 10 },
      { name: '登录传说', description: '连续登录 180 天', condition: JSON.stringify({ type: 'continuous_login', days: 180 }), reward_type: 'gold', reward_value: 3000 },
      { name: '登录神话', description: '连续登录 365 天', condition: JSON.stringify({ type: 'continuous_login', days: 365 }), reward_type: 'item', reward_value: 20 },
      { name: '总登录数', description: '累计登录 100 天', condition: JSON.stringify({ type: 'total_login_days', days: 100 }), reward_type: 'gold', reward_value: 500 },
      { name: '骨灰级玩家', description: '累计登录 500 天', condition: JSON.stringify({ type: 'total_login_days', days: 500 }), reward_type: 'item', reward_value: 10 },

      // === 金币相关 ===
      { name: '小有积蓄', description: '累计获得 1000 金币', condition: JSON.stringify({ type: 'total_gold', gold: 1000 }), reward_type: 'item', reward_value: 2 },
      { name: '金银满屋', description: '累计获得 10000 金币', condition: JSON.stringify({ type: 'total_gold', gold: 10000 }), reward_type: 'item', reward_value: 5 },
      { name: '财源滚滚', description: '累计获得 50000 金币', condition: JSON.stringify({ type: 'total_gold', gold: 50000 }), reward_type: 'item', reward_value: 8 },
      { name: '富甲一方', description: '累计获得 100000 金币', condition: JSON.stringify({ type: 'total_gold', gold: 100000 }), reward_type: 'item', reward_value: 10 },
      { name: '世界首富', description: '累计获得 500000 金币', condition: JSON.stringify({ type: 'total_gold', gold: 500000 }), reward_type: 'item', reward_value: 20 },

      // === 其他成就 ===
      { name: '每日任务初体验', description: '完成第一个每日任务', condition: JSON.stringify({ type: 'complete_daily_task', count: 1 }), reward_type: 'gold', reward_value: 50 },
      { name: '任务达人', description: '累计完成 50 个每日任务', condition: JSON.stringify({ type: 'complete_daily_task', count: 50 }), reward_type: 'gold', reward_value: 300 },
      { name: '任务狂人', description: '累计完成 200 个每日任务', condition: JSON.stringify({ type: 'complete_daily_task', count: 200 }), reward_type: 'item', reward_value: 5 },
      { name: '活跃玩家', description: '单日完成 5 个任务', condition: JSON.stringify({ type: 'daily_tasks_complete', count: 5 }), reward_type: 'gold', reward_value: 200 },
      { name: '超级活跃', description: '单日完成 10 个任务', condition: JSON.stringify({ type: 'daily_tasks_complete', count: 10 }), reward_type: 'item', reward_value: 3 },
      { name: '第一次强化', description: '强化装备 1 次', condition: JSON.stringify({ type: 'enhance_equipment', count: 1 }), reward_type: 'gold', reward_value: 100 },
      { name: '强化达人', description: '强化装备 20 次', condition: JSON.stringify({ type: 'enhance_equipment', count: 20 }), reward_type: 'gold', reward_value: 400 },
      { name: '强化大师', description: '强化装备 50 次', condition: JSON.stringify({ type: 'enhance_equipment', count: 50 }), reward_type: 'item', reward_value: 5 },
      { name: '强化狂人', description: '强化装备 100 次', condition: JSON.stringify({ type: 'enhance_equipment', count: 100 }), reward_type: 'gold', reward_value: 1000 },
      { name: '合成成功', description: '合成物品 1 次', condition: JSON.stringify({ type: 'synthesize_item', count: 1 }), reward_type: 'gold', reward_value: 100 },
      { name: '合成专家', description: '合成物品 10 次', condition: JSON.stringify({ type: 'synthesize_item', count: 10 }), reward_type: 'gold', reward_value: 300 },
      { name: '合成大师', description: '合成物品 30 次', condition: JSON.stringify({ type: 'synthesize_item', count: 30 }), reward_type: 'item', reward_value: 5 },
      { name: '商店顾客', description: '在商店购买 1 次', condition: JSON.stringify({ type: 'store_purchase', count: 1 }), reward_type: 'gold', reward_value: 50 },
      { name: '购物达人', description: '在商店购买 10 次', condition: JSON.stringify({ type: 'store_purchase', count: 10 }), reward_type: 'gold', reward_value: 300 },
      { name: '疯狂采购', description: '在商店购买 50 次', condition: JSON.stringify({ type: 'store_purchase', count: 50 }), reward_type: 'item', reward_value: 5 },
      { name: '首次出售', description: '在商店出售物品 1 次', condition: JSON.stringify({ type: 'store_sell', count: 1 }), reward_type: 'gold', reward_value: 30 },
      { name: '商人头脑', description: '累计出售物品 30 次', condition: JSON.stringify({ type: 'store_sell', count: 30 }), reward_type: 'gold', reward_value: 200 },
      { name: '商店会员', description: '累计消费 10000 金币', condition: JSON.stringify({ type: 'total_spend', gold: 10000 }), reward_type: 'item', reward_value: 5 },
      { name: 'VIP会员', description: '累计消费 50000 金币', condition: JSON.stringify({ type: 'total_spend', gold: 50000 }), reward_type: 'item', reward_value: 10 },
      { name: '超级富豪', description: '累计消费 100000 金币', condition: JSON.stringify({ type: 'total_spend', gold: 100000 }), reward_type: 'item', reward_value: 15 },
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
