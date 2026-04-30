/**
 * 成就条件类型注册表
 * 管理员创建成就时，从此列表中选择条件类型，填入阈值即可。
 */
module.exports = [
  // --- 宠物 ---
  { type: 'create_pet', label: '创建宠物', category: 'pet', thresholdKey: 'count', thresholdLabel: '次数', description: '创建宠物的次数' },
  { type: 'pet_level', label: '宠物等级', category: 'pet', thresholdKey: 'level', thresholdLabel: '等级', description: '宠物达到指定等级' },
  { type: 'total_exp', label: '累计经验', category: 'pet', thresholdKey: 'exp', thresholdLabel: '经验值', description: '累计获得经验值' },
  { type: 'feed_pet', label: '投喂次数', category: 'pet', thresholdKey: 'count', thresholdLabel: '次数', description: '投喂宠物的次数' },

  // --- 战斗 ---
  { type: 'win_battle', label: '胜利次数', category: 'battle', thresholdKey: 'count', thresholdLabel: '次数', description: 'PVP战斗胜利次数' },
  { type: 'win_streak', label: '连胜次数', category: 'battle', thresholdKey: 'count', thresholdLabel: '次数', description: '连续胜利次数' },
  { type: 'lose_battle', label: '失败次数', category: 'battle', thresholdKey: 'count', thresholdLabel: '次数', description: 'PVP战斗失败次数' },
  { type: 'boss_damage', label: 'BOSS伤害', category: 'battle', thresholdKey: 'damage', thresholdLabel: '伤害值', description: '对BOSS累计造成伤害' },
  { type: 'boss_kill', label: '击杀BOSS', category: 'battle', thresholdKey: 'count', thresholdLabel: '次数', description: '参与击杀BOSS次数' },

  // --- 学习 ---
  { type: 'submit_assignment', label: '提交作业', category: 'learning', thresholdKey: 'count', thresholdLabel: '次数', description: '提交作业次数' },
  { type: 'high_score', label: '高分次数', category: 'learning', thresholdKey: 'count', thresholdLabel: '次数', extraField: 'score', extraLabel: '最低分数', extraDefault: 90, description: '得分≥指定分数的次数' },
  { type: 'perfect_score', label: '满分次数', category: 'learning', thresholdKey: 'count', thresholdLabel: '次数', description: '获得满分的次数' },
  { type: 'review_wrong', label: '复习错题', category: 'learning', thresholdKey: 'count', thresholdLabel: '次数', description: '复习错题次数' },

  // --- 社交 ---
  { type: 'add_friends', label: '添加好友', category: 'social', thresholdKey: 'count', thresholdLabel: '人数', description: '添加好友数量' },
  { type: 'send_message', label: '发送消息', category: 'social', thresholdKey: 'count', thresholdLabel: '条数', description: '发送聊天消息数' },
  { type: 'post_count', label: '发动态', category: 'social', thresholdKey: 'count', thresholdLabel: '次数', description: '发布班级动态次数' },
  { type: 'forum_post', label: '论坛发帖', category: 'social', thresholdKey: 'count', thresholdLabel: '次数', description: '论坛发帖/回帖次数' },

  // --- 收集 ---
  { type: 'collect_equipment', label: '收集装备', category: 'collection', thresholdKey: 'count', thresholdLabel: '件数', description: '获得装备件数' },
  { type: 'total_gold', label: '累计金币', category: 'collection', thresholdKey: 'gold', thresholdLabel: '金币数', description: '累计获得金币总数' },

  // --- 签到/综合 ---
  { type: 'login', label: '登录', category: 'special', thresholdKey: 'count', thresholdLabel: '次数', description: '登录次数' },
  { type: 'continuous_login', label: '连续登录', category: 'special', thresholdKey: 'days', thresholdLabel: '天数', description: '连续登录天数' },
  { type: 'complete_daily_task', label: '完成每日任务', category: 'special', thresholdKey: 'count', thresholdLabel: '次数', description: '完成每日任务次数' },
];
