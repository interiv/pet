/**
 * 默认成就种子数据
 * init_db.js 和 seed_achievements.js 共用此文件，避免重复维护。
 *
 * 道具奖励说明：reward_type='item' 时 reward_value 为 items 表的 id
 *   1=普通粮食(10金) 2=高级零食(50金) 3=特殊料理(100金) 8=快乐糖果(50金)
 *   10=经验药水(200金) 14=大治疗药剂(100金) 16=大体力药剂(100金)
 *   24=转生丹(1000金) 28=经验加倍卡(300金)
 */
module.exports = [
  // ===== 宠物 (19个) =====
  { name: '初入江湖', description: '创建第一只宠物', condition: JSON.stringify({ type: 'create_pet', count: 1 }), reward_type: 'gold', reward_value: 100, category: 'pet', icon: '🐾', sort_order: 1 },
  { name: '初露锋芒', description: '宠物达到5级', condition: JSON.stringify({ type: 'pet_level', level: 5 }), reward_type: 'gold', reward_value: 150, category: 'pet', icon: '⭐', sort_order: 2 },
  { name: '小有所成', description: '宠物达到10级', condition: JSON.stringify({ type: 'pet_level', level: 10 }), reward_type: 'item', reward_value: 2, category: 'pet', icon: '🌟', sort_order: 3 },
  { name: '渐入佳境', description: '宠物达到15级', condition: JSON.stringify({ type: 'pet_level', level: 15 }), reward_type: 'gold', reward_value: 300, category: 'pet', icon: '💫', sort_order: 4 },
  { name: '崭露头角', description: '宠物达到20级', condition: JSON.stringify({ type: 'pet_level', level: 20 }), reward_type: 'item', reward_value: 3, category: 'pet', icon: '✨', sort_order: 5 },
  { name: '声名鹊起', description: '宠物达到25级', condition: JSON.stringify({ type: 'pet_level', level: 25 }), reward_type: 'gold', reward_value: 500, category: 'pet', icon: '🔥', sort_order: 6 },
  { name: '一方霸主', description: '宠物达到30级', condition: JSON.stringify({ type: 'pet_level', level: 30 }), reward_type: 'item', reward_value: 10, category: 'pet', icon: '👑', sort_order: 7 },
  { name: '威震八方', description: '宠物达到40级', condition: JSON.stringify({ type: 'pet_level', level: 40 }), reward_type: 'gold', reward_value: 800, category: 'pet', icon: '💎', sort_order: 8 },
  { name: '登峰造极', description: '宠物达到50级', condition: JSON.stringify({ type: 'pet_level', level: 50 }), reward_type: 'item', reward_value: 28, category: 'pet', icon: '🏰', sort_order: 9 },
  { name: '超凡入圣', description: '宠物达到60级', condition: JSON.stringify({ type: 'pet_level', level: 60 }), reward_type: 'gold', reward_value: 1000, category: 'pet', icon: '🌈', sort_order: 10 },
  { name: '天下无敌', description: '宠物达到70级', condition: JSON.stringify({ type: 'pet_level', level: 70 }), reward_type: 'item', reward_value: 24, category: 'pet', icon: '⚡', sort_order: 11 },
  { name: '传奇诞生', description: '宠物达到80级', condition: JSON.stringify({ type: 'pet_level', level: 80 }), reward_type: 'gold', reward_value: 2000, category: 'pet', icon: '🏆', sort_order: 12 },
  { name: '神话降临', description: '宠物达到90级', condition: JSON.stringify({ type: 'pet_level', level: 90 }), reward_type: 'item', reward_value: 24, category: 'pet', icon: '🌠', sort_order: 13 },
  { name: '满级成就', description: '宠物达到100级', condition: JSON.stringify({ type: 'pet_level', level: 100 }), reward_type: 'gold', reward_value: 5000, category: 'pet', icon: '🎯', sort_order: 14 },
  { name: '初学乍练', description: '累计获得1000经验', condition: JSON.stringify({ type: 'total_exp', exp: 1000 }), reward_type: 'gold', reward_value: 100, category: 'pet', icon: '📖', sort_order: 15 },
  { name: '学有小成', description: '累计获得5000经验', condition: JSON.stringify({ type: 'total_exp', exp: 5000 }), reward_type: 'item', reward_value: 1, category: 'pet', icon: '📚', sort_order: 16 },
  { name: '学有所成', description: '累计获得10000经验', condition: JSON.stringify({ type: 'total_exp', exp: 10000 }), reward_type: 'item', reward_value: 2, category: 'pet', icon: '🎓', sort_order: 17 },
  { name: '学富五车', description: '累计获得50000经验', condition: JSON.stringify({ type: 'total_exp', exp: 50000 }), reward_type: 'gold', reward_value: 500, category: 'pet', icon: '🏫', sort_order: 18 },
  { name: '博学多才', description: '累计获得100000经验', condition: JSON.stringify({ type: 'total_exp', exp: 100000 }), reward_type: 'item', reward_value: 28, category: 'pet', icon: '👨‍🎓', sort_order: 19 },

  // ===== 战斗 (12个) =====
  { name: '首战告捷', description: '获得第一场战斗胜利', condition: JSON.stringify({ type: 'win_battle', count: 1 }), reward_type: 'gold', reward_value: 200, category: 'battle', icon: '⚔️', sort_order: 20 },
  { name: '战斗新手', description: '累计胜利10场', condition: JSON.stringify({ type: 'win_battle', count: 10 }), reward_type: 'item', reward_value: 8, category: 'battle', icon: '🗡️', sort_order: 21 },
  { name: '身经百战', description: '累计胜利50场', condition: JSON.stringify({ type: 'win_battle', count: 50 }), reward_type: 'item', reward_value: 10, category: 'battle', icon: '🛡️', sort_order: 22 },
  { name: '百战不殆', description: '累计胜利100场', condition: JSON.stringify({ type: 'win_battle', count: 100 }), reward_type: 'gold', reward_value: 800, category: 'battle', icon: '🏅', sort_order: 23 },
  { name: '连胜新星', description: '获得3连胜', condition: JSON.stringify({ type: 'win_streak', count: 3 }), reward_type: 'gold', reward_value: 150, category: 'battle', icon: '🔥', sort_order: 24 },
  { name: '连胜达人', description: '获得10连胜', condition: JSON.stringify({ type: 'win_streak', count: 10 }), reward_type: 'item', reward_value: 16, category: 'battle', icon: '💥', sort_order: 25 },
  { name: '连胜王者', description: '获得25连胜', condition: JSON.stringify({ type: 'win_streak', count: 25 }), reward_type: 'gold', reward_value: 1000, category: 'battle', icon: '👹', sort_order: 26 },
  { name: '首战失利', description: '经历第一次战败', condition: JSON.stringify({ type: 'lose_battle', count: 1 }), reward_type: 'gold', reward_value: 50, category: 'battle', icon: '💪', sort_order: 27 },
  { name: '越挫越勇', description: '累计失败10场', condition: JSON.stringify({ type: 'lose_battle', count: 10 }), reward_type: 'item', reward_value: 14, category: 'battle', icon: '🩹', sort_order: 28 },
  { name: 'BOSS猎手', description: '对BOSS累计造成500伤害', condition: JSON.stringify({ type: 'boss_damage', damage: 500 }), reward_type: 'gold', reward_value: 300, category: 'battle', icon: '🐉', sort_order: 29 },
  { name: 'BOSS终结者', description: '参与击杀3只BOSS', condition: JSON.stringify({ type: 'boss_kill', count: 3 }), reward_type: 'item', reward_value: 10, category: 'battle', icon: '☠️', sort_order: 30 },
  { name: '屠龙勇士', description: '参与击杀10只BOSS', condition: JSON.stringify({ type: 'boss_kill', count: 10 }), reward_type: 'gold', reward_value: 1000, category: 'battle', icon: '🐲', sort_order: 31 },

  // ===== 学习 (8个) =====
  { name: '作业新手', description: '完成第一次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 1 }), reward_type: 'gold', reward_value: 100, category: 'learning', icon: '📝', sort_order: 40 },
  { name: '勤学好问', description: '完成10次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 10 }), reward_type: 'item', reward_value: 1, category: 'learning', icon: '✏️', sort_order: 41 },
  { name: '作业达人', description: '完成50次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 50 }), reward_type: 'item', reward_value: 10, category: 'learning', icon: '📚', sort_order: 42 },
  { name: '作业大师', description: '完成200次作业', condition: JSON.stringify({ type: 'submit_assignment', count: 200 }), reward_type: 'gold', reward_value: 1000, category: 'learning', icon: '🏅', sort_order: 43 },
  { name: '优秀学生', description: '作业获得90分以上10次', condition: JSON.stringify({ type: 'high_score', count: 10, score: 90 }), reward_type: 'gold', reward_value: 500, category: 'learning', icon: '💯', sort_order: 44 },
  { name: '满分达人', description: '作业获得100分5次', condition: JSON.stringify({ type: 'perfect_score', count: 5 }), reward_type: 'item', reward_value: 28, category: 'learning', icon: '🥇', sort_order: 45 },
  { name: '错题克星', description: '复习10道错题', condition: JSON.stringify({ type: 'review_wrong', count: 10 }), reward_type: 'gold', reward_value: 200, category: 'learning', icon: '🔍', sort_order: 46 },
  { name: '温故知新', description: '复习50道错题', condition: JSON.stringify({ type: 'review_wrong', count: 50 }), reward_type: 'item', reward_value: 3, category: 'learning', icon: '📖', sort_order: 47 },

  // ===== 社交 (8个) =====
  { name: '认识新朋友', description: '添加1个好友', condition: JSON.stringify({ type: 'add_friends', count: 1 }), reward_type: 'gold', reward_value: 50, category: 'social', icon: '👋', sort_order: 50 },
  { name: '广交好友', description: '添加5个好友', condition: JSON.stringify({ type: 'add_friends', count: 5 }), reward_type: 'item', reward_value: 8, category: 'social', icon: '🤝', sort_order: 51 },
  { name: '社交达人', description: '添加15个好友', condition: JSON.stringify({ type: 'add_friends', count: 15 }), reward_type: 'item', reward_value: 10, category: 'social', icon: '🎉', sort_order: 52 },
  { name: '初次聊天', description: '发送第一条消息', condition: JSON.stringify({ type: 'send_message', count: 1 }), reward_type: 'gold', reward_value: 30, category: 'social', icon: '💬', sort_order: 53 },
  { name: '话唠', description: '发送100条消息', condition: JSON.stringify({ type: 'send_message', count: 100 }), reward_type: 'gold', reward_value: 200, category: 'social', icon: '🗣️', sort_order: 54 },
  { name: '初次发帖', description: '发布第一条动态', condition: JSON.stringify({ type: 'post_count', count: 1 }), reward_type: 'gold', reward_value: 50, category: 'social', icon: '📢', sort_order: 55 },
  { name: '论坛新手', description: '在论坛发帖或回帖3次', condition: JSON.stringify({ type: 'forum_post', count: 3 }), reward_type: 'gold', reward_value: 100, category: 'social', icon: '📋', sort_order: 56 },
  { name: '论坛达人', description: '在论坛发帖或回帖20次', condition: JSON.stringify({ type: 'forum_post', count: 20 }), reward_type: 'item', reward_value: 3, category: 'social', icon: '🏆', sort_order: 57 },

  // ===== 收集 (4个) =====
  { name: '初获装备', description: '获得第一件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 1 }), reward_type: 'gold', reward_value: 100, category: 'collection', icon: '🎁', sort_order: 60 },
  { name: '装备收藏家', description: '收集10件装备', condition: JSON.stringify({ type: 'collect_equipment', count: 10 }), reward_type: 'item', reward_value: 3, category: 'collection', icon: '🎒', sort_order: 61 },
  { name: '小有积蓄', description: '累计获得1000金币', condition: JSON.stringify({ type: 'total_gold', gold: 1000 }), reward_type: 'item', reward_value: 1, category: 'collection', icon: '💰', sort_order: 62 },
  { name: '富甲一方', description: '累计获得10000金币', condition: JSON.stringify({ type: 'total_gold', gold: 10000 }), reward_type: 'item', reward_value: 28, category: 'collection', icon: '🤑', sort_order: 63 },

  // ===== 综合 (6个) =====
  { name: '首次登录', description: '第一天登录游戏', condition: JSON.stringify({ type: 'login', count: 1 }), reward_type: 'gold', reward_value: 50, category: 'special', icon: '📅', sort_order: 70 },
  { name: '常来常往', description: '累计登录7次', condition: JSON.stringify({ type: 'login', count: 7 }), reward_type: 'item', reward_value: 1, category: 'special', icon: '📆', sort_order: 71 },
  { name: '连续登录', description: '连续登录7天', condition: JSON.stringify({ type: 'continuous_login', days: 7 }), reward_type: 'item', reward_value: 2, category: 'special', icon: '🔥', sort_order: 72 },
  { name: '登录常客', description: '连续登录30天', condition: JSON.stringify({ type: 'continuous_login', days: 30 }), reward_type: 'gold', reward_value: 1000, category: 'special', icon: '👑', sort_order: 73 },
  { name: '每日任务初体验', description: '完成第一个每日任务', condition: JSON.stringify({ type: 'complete_daily_task', count: 1 }), reward_type: 'gold', reward_value: 50, category: 'special', icon: '✅', sort_order: 74 },
  { name: '任务达人', description: '累计完成50个每日任务', condition: JSON.stringify({ type: 'complete_daily_task', count: 50 }), reward_type: 'gold', reward_value: 300, category: 'special', icon: '🎯', sort_order: 75 }
];
