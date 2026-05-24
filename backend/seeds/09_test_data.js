/**
 * 测试数据种子
 * 为已有的测试账号（admin, teacher1~10, student1~50）创建：
 * - 学校
 * - 宠物（每学生1只）
 * - 物品 & 装备
 * - 作业 & 提交
 * - 战斗
 * - 好友
 * - 公告
 * - 题库 & 错题
 * - AI 设置
 */

const crypto = require('crypto');

// 宠物成长阶段
const stages = ['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'];

// 随机种子，让每次生成的数据一致（可复现）
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}
const rng = seededRandom(20240101);

function randInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

exports.seed = async function (knex) {
  console.log('\n=== 创建测试数据 ===\n');

  // ---- 1. 学校 ----
  let schoolId;
  const existingSchool = await knex('schools').first();
  if (existingSchool) {
    schoolId = existingSchool.id;
    console.log('  学校已存在，跳过');
  } else {
    [schoolId] = await knex('schools').insert({ name: '示范学校', city: '北京', region: '海淀区' });
    console.log('  ✓ 学校创建完成');
  }

  // ---- 2. 查找已有数据 ----
  const teachers = await knex('users').where('role', 'teacher').select('id', 'username');
  const students = await knex('users').where('role', 'student').select('id', 'username', 'class_id');
  const classes = await knex('classes').select('id', 'name');
  const species = await knex('pet_species').select('id', 'name', 'base_stats');
  const itemList = await knex('items').select('id', 'name');
  const equipList = await knex('equipment').select('id', 'name', 'slot', 'rarity');

  console.log(`  教师: ${teachers.length}人  学生: ${students.length}人  班级: ${classes.length}个`);
  console.log(`  物种: ${species.length}种  物品: ${itemList.length}种  装备: ${equipList.length}件`);

  // 辅助：分批插入
  async function batchInsert(table, records, chunkSize = 50) {
    for (let i = 0; i < records.length; i += chunkSize) {
      await knex(table).insert(records.slice(i, i + chunkSize));
    }
  }

  // ---- 3. 宠物 ----
  if ((await knex('pets').count('* as cnt').first()).cnt > 0) {
    console.log('  宠物已存在，跳过 (已有 ' + (await knex('pets').count('* as cnt').first()).cnt + ' 只)');
  } else {
    const petNames = [
      '火球', '水滴', '叶子', '光芒', '暗影', '烈焰', '冰晶', '藤蔓', '圣光', '幽冥',
      '流星', '狂风', '雷霆', '熔岩', '森林', '深海', '星辰', '月光', '霜雪', '雷鸣',
      '火山', '潮汐', '翠竹', '极光', '影刃', '炎龙', '冰凤', '木灵', '光羽', '暗夜',
      '风行', '雷灵', '地裂', '水镜', '火羽', '花仙', '云兽', '雪狼', '石像', '灵猫',
      '飞鹰', '巨鲸', '蝶舞', '萤火', '迷雾', '彩虹', '碧波', '紫电', '金狮', '银狐'
    ];

    const petRecords = [];
    students.forEach((student, i) => {
      const sp = species[i % species.length];
      const baseStats = JSON.parse(sp.base_stats);
      const level = randInt(3, 35);
      const exp = randInt(level * 10, level * 150);
      const attack = baseStats.attack + randInt(level, level * 2);
      const defense = baseStats.defense + randInt(level, Math.floor(level * 1.5));
      const speed = baseStats.speed + randInt(level, Math.floor(level * 1.8));
      const critRate = (0.03 + rng() * 0.2).toFixed(2);
      const growthStage = stages[Math.min(Math.floor(level / 5), stages.length - 1)];
      const winCount = randInt(0, 60);
      const totalBattles = winCount + randInt(0, 40);

      petRecords.push({
        user_id: student.id,
        name: petNames[i % petNames.length],
        species_id: sp.id,
        level,
        exp,
        hunger: randInt(30, 100),
        mood: randInt(30, 100),
        health: randInt(50, 100),
        stamina: randInt(50, 100),
        attack,
        defense,
        speed,
        crit_rate: parseFloat(critRate),
        growth_stage: growthStage,
        friendship_points: randInt(0, 2000),
        win_count: winCount,
        total_battles: totalBattles,
        status: 'normal',
        rebirth_count: level >= 30 ? randInt(0, 3) : 0
      });
    });
    await batchInsert('pets', petRecords);
    console.log(`  ✓ 宠物创建完成 (${petRecords.length}只)`);
  }

  // ---- 4. 用户物品 ----
  if ((await knex('user_items').count('* as cnt').first()).cnt > 0) {
    console.log('  物品已存在，跳过 (已有 ' + (await knex('user_items').count('* as cnt').first()).cnt + ' 条)');
  } else {
    const itemRecords = [];
    students.forEach(student => {
      itemList.forEach(item => {
        if (rng() > 0.35) {
          itemRecords.push({
            user_id: student.id,
            item_id: item.id,
            quantity: randInt(1, 30)
          });
        }
      });
    });
    await batchInsert('user_items', itemRecords);
    console.log(`  ✓ 用户物品创建完成 (${itemRecords.length}条)`);
  }

  // ---- 5. 用户装备 ----
  if ((await knex('user_equipment').count('* as cnt').first()).cnt > 0) {
    console.log('  装备已存在，跳过 (已有 ' + (await knex('user_equipment').count('* as cnt').first()).cnt + ' 条)');
  } else {
    const equipRecords = [];
    students.forEach(student => {
      const slotUsed = {};
      equipList.forEach(eq => {
        if (rng() > 0.25) {
          const equipped = !slotUsed[eq.slot] && rng() > 0.4 ? 1 : 0;
          if (equipped) slotUsed[eq.slot] = true;
          equipRecords.push({
            user_id: student.id,
            equipment_id: eq.id,
            equipped,
            level: randInt(1, 6)
          });
        }
      });
    });
    await batchInsert('user_equipment', equipRecords);
    console.log(`  ✓ 用户装备创建完成 (${equipRecords.length}条)`);
  }

  // ---- 6. 作业 ----
  if ((await knex('assignments').count('* as cnt').first()).cnt > 0) {
    console.log('  作业已存在，跳过 (已有 ' + (await knex('assignments').count('* as cnt').first()).cnt + ' 个)');
  } else {
    const subjects = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '信息'];
    const classAssignments = [];
    classes.forEach(cls => {
      const clsTeachers = teachers.filter(t => {
        // 检查 class_teachers 表
        return true; // 简化：所有教师都可能出题
      });
      subjects.forEach((subj, si) => {
        const teacher = teachers[si % teachers.length];
        const chapters = ['第一章', '第二章', '第三章'];
        chapters.forEach(ch => {
          if (rng() > 0.35) {
            classAssignments.push({
              teacher_id: teacher.id,
              title: `${subj}练习-${ch}`,
              description: `完成${subj}课本章节练习`,
              subject: subj,
              question_type: pick(['选择题', '填空题', '简答题', '计算题']),
              questions: null,
              max_exp: randInt(50, 200),
              status: 'active',
              class_id: cls.id
            });
          }
        });
      });
    });
    await knex('assignments').insert(classAssignments);
    console.log(`  ✓ 作业创建完成 (${classAssignments.length}个)`);
  }

  // ---- 7. 提交 ----
  if ((await knex('submissions').count('* as cnt').first()).cnt > 0) {
    console.log('  提交已存在，跳过 (已有 ' + (await knex('submissions').count('* as cnt').first()).cnt + ' 条)');
  } else {
    const allAssignments = await knex('assignments').select('id', 'class_id', 'max_exp');
    const subRecords = [];
    students.forEach(student => {
      const classAssigns = allAssignments.filter(a => a.class_id === student.class_id);
      classAssigns.forEach(assign => {
        if (rng() > 0.25) {
          const aiScore = 50 + rng() * 50;
          const teacherScore = 45 + rng() * 55;
          const status = rng() > 0.15 ? 'graded' : 'submitted';
          subRecords.push({
            assignment_id: assign.id,
            user_id: student.id,
            answers: JSON.stringify({ answer: '学生答题内容' }),
            status,
            ai_score: status === 'graded' ? aiScore : null,
            teacher_score: status === 'graded' ? teacherScore : null,
            exp_reward: status === 'graded' ? Math.floor(aiScore) : 0,
            gold_reward: status === 'graded' ? Math.floor(aiScore / 2) : 0,
            total_score: status === 'graded' ? aiScore * (assign.max_exp / 100) : null,
            total_max_score: assign.max_exp
          });
        }
      });
    });
    await batchInsert('submissions', subRecords, 200);
    console.log(`  ✓ 提交创建完成 (${subRecords.length}条)`);
  }

  // ---- 8. 战斗 ----
  if ((await knex('battles').count('* as cnt').first()).cnt > 0) {
    console.log('  战斗已存在，跳过 (已有 ' + (await knex('battles').count('* as cnt').first()).cnt + ' 场)');
  } else {
    const allPets = await knex('pets').select('id');
    const battleRecords = [];
    const battleCount = Math.min(50, allPets.length * 2);
    for (let i = 0; i < battleCount; i++) {
      const idx1 = randInt(0, allPets.length - 1);
      let idx2 = randInt(0, allPets.length - 1);
      while (idx2 === idx1) idx2 = randInt(0, allPets.length - 1);
      const winnerId = rng() > 0.5 ? allPets[idx1].id : allPets[idx2].id;
      battleRecords.push({
        pet1_id: allPets[idx1].id,
        pet2_id: allPets[idx2].id,
        winner_id: winnerId,
        battle_type: pick(['pvp', 'pvp', 'pvp', 'class', 'event']),
        reward_exp: randInt(30, 150),
        reward_gold: randInt(50, 300),
        battle_log: JSON.stringify({ rounds: randInt(1, 8), damage_dealt: randInt(100, 2000) })
      });
    }
    await batchInsert('battles', battleRecords);
    console.log(`  ✓ 战斗创建完成 (${battleRecords.length}场)`);
  }

  // ---- 9. 好友 ----
  if ((await knex('friends').count('* as cnt').first()).cnt > 0) {
    console.log('  好友已存在，跳过 (已有 ' + (await knex('friends').count('* as cnt').first()).cnt + ' 对)');
  } else {
    const friendRecords = [];
    for (let i = 0; i < students.length; i++) {
      for (let j = i + 1; j < students.length; j++) {
        if (rng() > 0.5) {
          const level = randInt(1, 5);
          friendRecords.push({ user_id: students[i].id, friend_id: students[j].id, friendship_level: level, status: 'active' });
          friendRecords.push({ user_id: students[j].id, friend_id: students[i].id, friendship_level: level, status: 'active' });
        }
      }
    }
    await batchInsert('friends', friendRecords);
    console.log(`  ✓ 好友创建完成 (${friendRecords.length}对)`);
  }

  // ---- 10. 公告 ----
  if ((await knex('announcements').count('* as cnt').first()).cnt > 0) {
    console.log('  公告已存在，跳过');
  } else {
    const announcementData = [
      { title: '新学期开始', content: '欢迎同学们回到学校，新的学期让我们一起努力！', priority: 1 },
      { title: '宠物对战大赛通知', content: '第一届班级宠物对战大赛即将开始，请大家积极参与！获胜者将获得丰厚奖励！', priority: 2 },
      { title: '作业提交提醒', content: '请同学们按时完成作业，不要忘记提交哦~每周日晚12点截止', priority: 0 },
      { title: '班级活动预告', content: '本周五将举办班级宠物展示活动，请带上你们的宠物参加！', priority: 0 },
      { title: '安全提醒', content: '请注意账号安全，不要将密码告诉他人。如有异常登录请及时报告。', priority: 1 }
    ];
    const annRecords = [];
    classes.forEach(cls => {
      announcementData.forEach((ann, i) => {
        if (rng() > 0.3) {
          const teacher = teachers[i % teachers.length];
          annRecords.push({
            class_id: cls.id,
            publisher_id: teacher.id,
            title: ann.title,
            content: ann.content,
            priority: ann.priority
          });
        }
      });
    });
    if (annRecords.length > 0) {
      await knex('announcements').insert(annRecords);
      console.log(`  ✓ 公告创建完成 (${annRecords.length}条)`);
    }
  }

  // ---- 11. 题库（部分题目） ----
  if ((await knex('question_bank').count('* as cnt').first()).cnt > 0) {
    console.log('  题库已存在，跳过');
  } else {
    const bankQuestions = [
      { subject: '数学', content: '1+1=?', options: JSON.stringify(['1','2','3','4']), answer: '2', type: 'choice', difficulty: 'easy', knowledge_point: '加法运算' },
      { subject: '数学', content: '若 a=3, b=4, 则 a²+b²=?', options: JSON.stringify(['12','16','25','49']), answer: '25', type: 'choice', difficulty: 'medium', knowledge_point: '代数运算' },
      { subject: '语文', content: '"但愿人长久"的下一句是？', options: JSON.stringify(['千里共婵娟','此事古难全','月有阴晴圆缺','把酒问青天']), answer: '千里共婵娟', type: 'choice', difficulty: 'easy', knowledge_point: '诗词名句' },
      { subject: '英语', content: 'What does "pet" mean?', options: JSON.stringify(['猫','狗','宠物','动物']), answer: '宠物', type: 'choice', difficulty: 'easy', knowledge_point: '单词翻译' },
      { subject: '英语', content: 'I ___ a student.', options: JSON.stringify(['is','am','are','be']), answer: 'am', type: 'choice', difficulty: 'easy', knowledge_point: 'be动词' },
      { subject: '物理', content: '牛顿第一定律也称为？', options: JSON.stringify(['万有引力定律','惯性定律','能量守恒定律','热力学定律']), answer: '惯性定律', type: 'choice', difficulty: 'medium', knowledge_point: '牛顿定律' },
      { subject: '化学', content: '水的化学式是？', options: JSON.stringify(['CO2','H2O','O2','NaCl']), answer: 'H2O', type: 'choice', difficulty: 'easy', knowledge_point: '化学式' },
      { subject: '生物', content: '细胞的基本结构包括？', options: JSON.stringify(['细胞膜','细胞质','细胞核','以上都是']), answer: '以上都是', type: 'choice', difficulty: 'easy', knowledge_point: '细胞结构' },
      { subject: '历史', content: '唐朝的开国皇帝是？', options: JSON.stringify(['李世民','李渊','武则天','李治']), answer: '李渊', type: 'choice', difficulty: 'medium', knowledge_point: '唐朝历史' },
      { subject: '地理', content: '中国最大的淡水湖是？', options: JSON.stringify(['洞庭湖','鄱阳湖','太湖','青海湖']), answer: '鄱阳湖', type: 'choice', difficulty: 'medium', knowledge_point: '中国地理' },
    ];
    await knex('question_bank').insert(bankQuestions);
    console.log(`  ✓ 题库创建完成 (${bankQuestions.length}题)`);
  }

  // ---- 12. AI 设置（默认值） ----
  const existingAISettings = await knex('settings').where('key', 'like', 'ai_%').orWhere('key', 'like', 'daily_%').orWhere('key', 'like', 'max_%').first();
  if (existingAISettings) {
    console.log('  AI设置已存在，跳过');
  } else {
    const defaultSettings = [
      { key: 'ai_model', value: 'gpt-3.5-turbo' },
      { key: 'ai_base_url', value: 'https://api.openai.com/v1' },
      { key: 'ai_report_interval_days', value: '3' },
      { key: 'max_tokens_per_generation', value: '18000' },
      { key: 'daily_teacher_gen_limit', value: '5' },
      { key: 'daily_global_token_limit', value: '2000000' },
      { key: 'max_questions_per_generation', value: '20' },
    ];
    await knex('settings').insert(defaultSettings);
    console.log(`  ✓ AI默认设置创建完成 (${defaultSettings.length}项)`);
  }

  console.log('\n=== 测试数据创建完成 ===\n');
};