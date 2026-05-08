const skills = [
  { name: '普通攻击', description: '普通的物理攻击', icon: '⚔️', skill_type: 'physical', subject: null, base_damage: 50, base_defense: 0, base_speed: 0, cooldown: 0, required_level: 1, required_knowledge_point: null, required_accuracy: 0 },
  { name: '火焰冲击', description: '强力的火焰魔法', icon: '🔥', skill_type: 'magical', subject: '数学', base_damage: 80, base_defense: 0, base_speed: 0, cooldown: 2, required_level: 5, required_knowledge_point: '分数运算', required_accuracy: 0.6 },
  { name: '水炮', description: '高压水柱攻击', icon: '💧', skill_type: 'magical', subject: '语文', base_damage: 75, base_defense: 0, base_speed: 0, cooldown: 2, required_level: 5, required_knowledge_point: '阅读理解', required_accuracy: 0.6 },
  { name: '飞叶快刀', description: '快速的叶片攻击', icon: '🍃', skill_type: 'physical', subject: '英语', base_damage: 70, base_defense: 0, base_speed: 10, cooldown: 1, required_level: 3, required_knowledge_point: '单词拼写', required_accuracy: 0.5 },
  { name: '神圣之光', description: '神圣的光芒攻击', icon: '✨', skill_type: 'magical', subject: '科学', base_damage: 85, base_defense: 0, base_speed: 0, cooldown: 3, required_level: 8, required_knowledge_point: '光的折射', required_accuracy: 0.7 },
  { name: '暗影爪', description: '黑暗之爪攻击', icon: '🌑', skill_type: 'physical', subject: null, base_damage: 75, base_defense: 0, base_speed: 5, cooldown: 2, required_level: 5, required_knowledge_point: null, required_accuracy: 0 },
  { name: '铁壁防御', description: '大幅提升防御力', icon: '🛡️', skill_type: 'buff', subject: null, base_damage: 0, base_defense: 30, base_speed: 0, cooldown: 3, required_level: 3, required_knowledge_point: null, required_accuracy: 0 },
  { name: '疾风步', description: '大幅提升速度', icon: '💨', skill_type: 'buff', subject: null, base_damage: 0, base_defense: 0, base_speed: 30, cooldown: 3, required_level: 3, required_knowledge_point: null, required_accuracy: 0 },
  { name: '全力一击', description: '高威力但命中率低的攻击', icon: '💥', skill_type: 'physical', subject: null, base_damage: 120, base_defense: 0, base_speed: 0, cooldown: 4, required_level: 10, required_knowledge_point: null, required_accuracy: 0 },
];

exports.seed = async function (knex) {
  await knex('skills').del();
  await knex('skills').insert(skills);
};
