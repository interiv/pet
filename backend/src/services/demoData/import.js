// 演示数据：导入演示数据（由 services/demoData.js 拆分而来，内容未改动）
const bcrypt = require('bcryptjs');
const {
  DEMO_PREFIX, DEMO_PASSWORD, DEMO_SCHOOL_NAME, DEMO_CLASS_NAMES,
  DEMO_TEACHER_COUNT, DEMO_STUDENT_COUNT, stages,
  seededRandom, slugFor, isDemoUsername, buildDemoNotice,
  applyDemoNotices, restoreDemoNotices, getDemoUsers, getDemoClassIds,
} = require('./_common');

const { db } = require('../../config/database');

async function importDemoData(knex, options = {}) {
  const rng = seededRandom(20240101);
  const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
  const pick = (arr) => arr[randInt(0, arr.length - 1)];

  async function batchInsert(table, records, chunkSize = 50) {
    for (let i = 0; i < records.length; i += chunkSize) {
      await knex(table).insert(records.slice(i, i + chunkSize));
    }
  }

  const summary = { created: [], skipped: [] };

  // ---- 1. 学校 ----
  let school = await knex('schools').where('name', DEMO_SCHOOL_NAME).first();
  if (!school) {
    const [schoolId] = await knex('schools').insert({
      name: DEMO_SCHOOL_NAME,
      city: '演示城市',
      region: '演示区',
      theme_color: '#1677ff',
    });
    school = { id: schoolId };
    summary.created.push('演示学校');
  } else {
    summary.skipped.push('演示学校');
  }

  // ---- 2. 班级 ----
  const classIds = [];
  for (const name of DEMO_CLASS_NAMES) {
    let cls = await knex('classes').where('name', name).first();
    if (!cls) {
      const [classId] = await knex('classes').insert({
        name,
        grade: '演示年级',
        slug: slugFor(name),
        school_id: school.id,
        student_count: 0,
        total_exp: 0,
        is_public: 1,
      });
      classIds.push(classId);
      summary.created.push(name);
    } else {
      classIds.push(cls.id);
      summary.skipped.push(name);
    }
  }

  // ---- 3. 演示教师 ----
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const teacherIds = [];
  for (let i = 1; i <= DEMO_TEACHER_COUNT; i++) {
    const username = `${DEMO_PREFIX}teacher${i}`;
    let user = await knex('users').where('username', username).first();
    if (!user) {
      const [id] = await knex('users').insert({
        username,
        password_hash: passwordHash,
        email: `${username}@demo.local`,
        role: 'teacher',
        status: 'active',
      });
      teacherIds.push(id);
    } else {
      teacherIds.push(user.id);
    }
  }

  // ---- 4. 演示学生（平均分到各演示班级）----
  const studentIds = [];
  for (let i = 1; i <= DEMO_STUDENT_COUNT; i++) {
    const username = `${DEMO_PREFIX}student${i}`;
    const classId = classIds[(i - 1) % classIds.length];
    let user = await knex('users').where('username', username).first();
    if (!user) {
      const [id] = await knex('users').insert({
        username,
        password_hash: passwordHash,
        email: `${username}@demo.local`,
        role: 'student',
        status: 'active',
        class_id: classId,
      });
      studentIds.push(id);
    } else {
      studentIds.push(user.id);
      if (!user.class_id) await knex('users').where('id', user.id).update({ class_id: classId });
    }
  }

  // ---- 5. 班主任与任课教师关系 ----
  for (let idx = 0; idx < classIds.length; idx++) {
    const classId = classIds[idx];
    const headTeacherId = teacherIds[idx % teacherIds.length];
    await knex('classes').where('id', classId).update({ head_teacher_id: headTeacherId });
    const exists = await knex('class_teachers').where({ class_id: classId, teacher_id: headTeacherId }).first();
    if (!exists) {
      await knex('class_teachers').insert({ class_id: classId, teacher_id: headTeacherId, role: 'head_teacher' });
    }
    // 其余演示教师作为任课教师加入
    for (const tId of teacherIds) {
      if (tId === headTeacherId) continue;
      const dup = await knex('class_teachers').where({ class_id: classId, teacher_id: tId }).first();
      if (!dup) await knex('class_teachers').insert({ class_id: classId, teacher_id: tId, role: 'teacher' });
    }
  }

  // 班级人数
  for (const classId of classIds) {
    const cnt = await knex('users').where({ role: 'student', class_id: classId }).count('* as cnt').first();
    await knex('classes').where('id', classId).update({ student_count: cnt.cnt });
  }

  // ---- 6. 宠物 ----
  const existingPets = await knex('pets').whereIn('user_id', studentIds).count('* as cnt').first();
  if (existingPets.cnt === 0) {
    const species = await knex('pet_species').select('id', 'name', 'base_stats');
    const petNames = [
      '火球', '水滴', '叶子', '光芒', '暗影', '烈焰', '冰晶', '藤蔓', '圣光', '幽冥',
      '流星', '狂风', '雷霆', '熔岩', '森林', '深海', '星辰', '月光', '霜雪', '雷鸣',
      '火山', '潮汐', '翠竹', '极光', '影刃', '炎龙', '冰凤', '木灵', '光羽', '暗夜',
    ];
    if (species.length > 0) {
      const petRecords = studentIds.map((userId, i) => {
        const sp = species[i % species.length];
        const baseStats = JSON.parse(sp.base_stats);
        const level = randInt(3, 35);
        const winCount = randInt(0, 60);
        return {
          user_id: userId,
          name: petNames[i % petNames.length],
          species_id: sp.id,
          level,
          exp: randInt(level * 10, level * 150),
          hunger: randInt(30, 100),
          mood: randInt(30, 100),
          health: randInt(50, 100),
          stamina: randInt(50, 100),
          attack: baseStats.attack + randInt(level, level * 2),
          defense: baseStats.defense + randInt(level, Math.floor(level * 1.5)),
          speed: baseStats.speed + randInt(level, Math.floor(level * 1.8)),
          crit_rate: parseFloat((0.03 + rng() * 0.2).toFixed(2)),
          growth_stage: stages[Math.min(Math.floor(level / 5), stages.length - 1)],
          friendship_points: randInt(0, 2000),
          win_count: winCount,
          total_battles: winCount + randInt(0, 40),
          status: 'normal',
          rebirth_count: level >= 30 ? randInt(0, 3) : 0,
        };
      });
      await batchInsert('pets', petRecords);
      summary.created.push(`宠物 ${petRecords.length} 只`);
    }
  } else {
    summary.skipped.push('宠物');
  }

  // ---- 7. 用户物品 ----
  const existingItems = await knex('user_items').whereIn('user_id', studentIds).count('* as cnt').first();
  if (existingItems.cnt === 0) {
    const itemList = await knex('items').select('id');
    const itemRecords = [];
    for (const userId of studentIds) {
      for (const item of itemList) {
        if (rng() > 0.35) itemRecords.push({ user_id: userId, item_id: item.id, quantity: randInt(1, 30) });
      }
    }
    if (itemRecords.length) await batchInsert('user_items', itemRecords);
    summary.created.push(`用户物品 ${itemRecords.length} 条`);
  } else {
    summary.skipped.push('用户物品');
  }

  // ---- 8. 用户装备 ----
  const existingEquip = await knex('user_equipment').whereIn('user_id', studentIds).count('* as cnt').first();
  if (existingEquip.cnt === 0) {
    const equipList = await knex('equipment').select('id', 'name', 'slot', 'rarity');
    const equipRecords = [];
    for (const userId of studentIds) {
      const slotUsed = {};
      for (const eq of equipList) {
        if (rng() > 0.25) {
          const equipped = !slotUsed[eq.slot] && rng() > 0.4 ? 1 : 0;
          if (equipped) slotUsed[eq.slot] = true;
          equipRecords.push({ user_id: userId, equipment_id: eq.id, equipped, level: randInt(1, 6) });
        }
      }
    }
    if (equipRecords.length) await batchInsert('user_equipment', equipRecords);
    summary.created.push(`用户装备 ${equipRecords.length} 条`);
  } else {
    summary.skipped.push('用户装备');
  }

  // ---- 9. 作业（演示班级）----
  const existingAssignments = await knex('assignments').whereIn('class_id', classIds).count('* as cnt').first();
  if (existingAssignments.cnt === 0) {
    const subjects = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '信息'];
    const chapters = ['第一章', '第二章', '第三章'];
    const classAssignments = [];
    for (const classId of classIds) {
      subjects.forEach((subj, si) => {
        const teacher = teacherIds.length ? { id: teacherIds[si % teacherIds.length] } : null;
        if (!teacher) return;
        for (const ch of chapters) {
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
              class_id: classId,
            });
          }
        }
      });
    }
    if (classAssignments.length) await knex('assignments').insert(classAssignments);
    summary.created.push(`作业 ${classAssignments.length} 个`);
  } else {
    summary.skipped.push('作业');
  }

  // ---- 10. 作业提交 ----
  const existingSubs = await knex('submissions').whereIn('user_id', studentIds).count('* as cnt').first();
  if (existingSubs.cnt === 0) {
    const allAssignments = await knex('assignments').whereIn('class_id', classIds).select('id', 'class_id', 'max_exp');
    const students = await knex('users').whereIn('id', studentIds).select('id', 'class_id');
    const subRecords = [];
    for (const student of students) {
      for (const assign of allAssignments.filter((a) => a.class_id === student.class_id)) {
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
            total_max_score: assign.max_exp,
          });
        }
      }
    }
    if (subRecords.length) await batchInsert('submissions', subRecords, 200);
    summary.created.push(`作业提交 ${subRecords.length} 条`);
  } else {
    summary.skipped.push('作业提交');
  }

  // ---- 11. 战斗记录 ----
  const demoPets = await knex('pets').whereIn('user_id', studentIds).select('id');
  const existingBattles = demoPets.length
    ? await knex('battles').whereIn('pet1_id', demoPets.map((p) => p.id)).count('* as cnt').first()
    : { cnt: 0 };
  if (demoPets.length > 1 && existingBattles.cnt === 0) {
    const battleRecords = [];
    const battleCount = Math.min(60, demoPets.length * 2);
    for (let i = 0; i < battleCount; i++) {
      const idx1 = randInt(0, demoPets.length - 1);
      let idx2 = randInt(0, demoPets.length - 1);
      while (idx2 === idx1) idx2 = randInt(0, demoPets.length - 1);
      battleRecords.push({
        pet1_id: demoPets[idx1].id,
        pet2_id: demoPets[idx2].id,
        winner_id: rng() > 0.5 ? demoPets[idx1].id : demoPets[idx2].id,
        battle_type: pick(['pvp', 'pvp', 'pvp', 'class', 'event']),
        reward_exp: randInt(30, 150),
        reward_gold: randInt(50, 300),
        battle_log: JSON.stringify({ rounds: randInt(1, 8), damage_dealt: randInt(100, 2000) }),
      });
    }
    await batchInsert('battles', battleRecords);
    summary.created.push(`战斗记录 ${battleRecords.length} 场`);
  } else {
    summary.skipped.push('战斗记录');
  }

  // ---- 12. 好友关系 ----
  const existingFriends = await knex('friends').whereIn('user_id', studentIds).count('* as cnt').first();
  if (existingFriends.cnt === 0) {
    const friendRecords = [];
    for (let i = 0; i < studentIds.length; i++) {
      for (let j = i + 1; j < studentIds.length; j++) {
        if (rng() > 0.75) {
          const level = randInt(1, 5);
          friendRecords.push({ user_id: studentIds[i], friend_id: studentIds[j], friendship_level: level, status: 'active' });
          friendRecords.push({ user_id: studentIds[j], friend_id: studentIds[i], friendship_level: level, status: 'active' });
        }
      }
    }
    if (friendRecords.length) await batchInsert('friends', friendRecords);
    summary.created.push(`好友关系 ${friendRecords.length} 对`);
  } else {
    summary.skipped.push('好友关系');
  }

  // ---- 13. 班级公告 ----
  const existingAnn = await knex('announcements').whereIn('class_id', classIds).count('* as cnt').first();
  if (existingAnn.cnt === 0 && teacherIds.length) {
    const announcementData = [
      { title: '新学期开始', content: '欢迎同学们回到学校，新的学期让我们一起努力！', priority: 1 },
      { title: '宠物对战大赛通知', content: '第一届班级宠物对战大赛即将开始，获胜者将获得丰厚奖励！', priority: 2 },
      { title: '作业提交提醒', content: '请同学们按时完成作业，不要忘记提交哦~', priority: 0 },
      { title: '班级活动预告', content: '本周五将举办班级宠物展示活动，请带上你们的宠物参加！', priority: 0 },
    ];
    const annRecords = [];
    for (const classId of classIds) {
      announcementData.forEach((ann, i) => {
        if (rng() > 0.3) {
          annRecords.push({
            class_id: classId,
            publisher_id: teacherIds[i % teacherIds.length],
            title: ann.title,
            content: ann.content,
            priority: ann.priority,
          });
        }
      });
    }
    if (annRecords.length) await knex('announcements').insert(annRecords);
    summary.created.push(`班级公告 ${annRecords.length} 条`);
  } else {
    summary.skipped.push('班级公告');
  }

  // ---- 14. 题库（仅在题库为空时补充，避免污染已有题目）----
  const bankCount = await knex('question_bank').count('* as cnt').first();
  if (bankCount.cnt === 0) {
    const bankQuestions = [
      { subject: '数学', content: '1+1=?', options: JSON.stringify(['1', '2', '3', '4']), answer: '2', type: 'choice', difficulty: 'easy', knowledge_point: '加法运算' },
      { subject: '数学', content: '若 a=3, b=4, 则 a²+b²=?', options: JSON.stringify(['12', '16', '25', '49']), answer: '25', type: 'choice', difficulty: 'medium', knowledge_point: '代数运算' },
      { subject: '语文', content: '"但愿人长久"的下一句是？', options: JSON.stringify(['千里共婵娟', '此事古难全', '月有阴晴圆缺', '把酒问青天']), answer: '千里共婵娟', type: 'choice', difficulty: 'easy', knowledge_point: '诗词名句' },
      { subject: '英语', content: 'What does "pet" mean?', options: JSON.stringify(['猫', '狗', '宠物', '动物']), answer: '宠物', type: 'choice', difficulty: 'easy', knowledge_point: '单词翻译' },
      { subject: '物理', content: '牛顿第一定律也称为？', options: JSON.stringify(['万有引力定律', '惯性定律', '能量守恒定律', '热力学定律']), answer: '惯性定律', type: 'choice', difficulty: 'medium', knowledge_point: '牛顿定律' },
      { subject: '化学', content: '水的化学式是？', options: JSON.stringify(['CO2', 'H2O', 'O2', 'NaCl']), answer: 'H2O', type: 'choice', difficulty: 'easy', knowledge_point: '化学式' },
      { subject: '生物', content: '细胞的基本结构包括？', options: JSON.stringify(['细胞膜', '细胞质', '细胞核', '以上都是']), answer: '以上都是', type: 'choice', difficulty: 'easy', knowledge_point: '细胞结构' },
      { subject: '历史', content: '唐朝的开国皇帝是？', options: JSON.stringify(['李世民', '李渊', '武则天', '李治']), answer: '李渊', type: 'choice', difficulty: 'medium', knowledge_point: '唐朝历史' },
      { subject: '地理', content: '中国最大的淡水湖是？', options: JSON.stringify(['洞庭湖', '鄱阳湖', '太湖', '青海湖']), answer: '鄱阳湖', type: 'choice', difficulty: 'medium', knowledge_point: '中国地理' },
    ];
    await knex('question_bank').insert(bankQuestions);
    summary.created.push(`题库示例 ${bankQuestions.length} 题`);
  } else {
    summary.skipped.push('题库示例');
  }

  // ---- 15. 可选：用演示账号信息替换「全局公告」「首页公告」----
  let noticesUpdated = false;
  if (options.updateNotices) {
    await applyDemoNotices(knex);
    noticesUpdated = true;
    summary.created.push('公告内容已更新');
  }

  return {
    ...summary,
    noticesUpdated,
    accounts: {
      teachers: teacherIds.length,
      students: studentIds.length,
      password: DEMO_PASSWORD,
    },
  };
}

// ==================== 清除演示数据 ====================

module.exports = importDemoData;
