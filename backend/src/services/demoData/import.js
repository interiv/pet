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
  // 每题满分统一 100/N，保证「题目数 × 单题满分 = 100」
  const QUESTION_MAX_SCORE = 100;
  // 演示题库以外的备选题干（保证答案唯一且与选项一一对应）
  const DEMO_QUESTION_BANK = {
    数学: [
      { content: '1+1=?', options: ['1', '2', '3', '4'], answer: 'B', knowledge_point: '加法运算' },
      { content: '若 a=3, b=4, 则 a²+b²=?', options: ['12', '16', '25', '49'], answer: 'C', knowledge_point: '代数运算' },
      { content: '12 ÷ 4 = ?', options: ['2', '3', '4', '6'], answer: 'B', knowledge_point: '除法运算' },
    ],
    语文: [
      { content: '"但愿人长久"的下一句是？', options: ['千里共婵娟', '此事古难全', '月有阴晴圆缺', '把酒问青天'], answer: 'A', knowledge_point: '诗词名句' },
      { content: '"春眠不觉晓"的作者是？', options: ['李白', '杜甫', '孟浩然', '王维'], answer: 'C', knowledge_point: '唐诗作者' },
      { content: '下列词语中没有错别字的是？', options: ['按步就班', '按部就班', '安部就班', '按部就搬'], answer: 'B', knowledge_point: '字形辨析' },
    ],
    英语: [
      { content: 'What does "pet" mean?', options: ['猫', '狗', '宠物', '动物'], answer: 'C', knowledge_point: '单词翻译' },
      { content: 'I ___ a student.', options: ['is', 'am', 'are', 'be'], answer: 'B', knowledge_point: 'be动词' },
      { content: 'Choose the correct plural of "box".', options: ['boxs', 'boxes', 'boxies', 'box'], answer: 'B', knowledge_point: '名词复数' },
    ],
    物理: [
      { content: '牛顿第一定律也称为？', options: ['万有引力定律', '惯性定律', '能量守恒定律', '热力学定律'], answer: 'B', knowledge_point: '牛顿定律' },
      { content: '标准大气压下水的沸点是？', options: ['90℃', '100℃', '110℃', '120℃'], answer: 'B', knowledge_point: '物态变化' },
      { content: '速度的国际单位是？', options: ['m/s', 'km/h', 'm/s²', 'N'], answer: 'A', knowledge_point: '速度单位' },
    ],
    化学: [
      { content: '水的化学式是？', options: ['CO2', 'H2O', 'O2', 'NaCl'], answer: 'B', knowledge_point: '化学式' },
      { content: '空气中体积分数最大的气体是？', options: ['氧气', '氮气', '二氧化碳', '稀有气体'], answer: 'B', knowledge_point: '空气组成' },
      { content: '下列属于混合物的是？', options: ['蒸馏水', '氧气', '空气', '二氧化碳'], answer: 'C', knowledge_point: '物质分类' },
    ],
    生物: [
      { content: '细胞的基本结构包括？', options: ['细胞膜', '细胞质', '细胞核', '以上都是'], answer: 'D', knowledge_point: '细胞结构' },
      { content: '绿色植物进行光合作用的场所是？', options: ['线粒体', '叶绿体', '细胞核', '液泡'], answer: 'B', knowledge_point: '光合作用' },
      { content: '人体最大的消化腺是？', options: ['胃', '肝脏', '胰腺', '小肠'], answer: 'B', knowledge_point: '消化系统' },
    ],
    历史: [
      { content: '唐朝的开国皇帝是？', options: ['李世民', '李渊', '武则天', '李治'], answer: 'B', knowledge_point: '唐朝历史' },
      { content: '中国历史上第一个统一的封建王朝是？', options: ['夏朝', '商朝', '秦朝', '汉朝'], answer: 'C', knowledge_point: '秦朝统一' },
      { content: '丝绸之路开通于哪个朝代？', options: ['秦朝', '西汉', '唐朝', '明朝'], answer: 'B', knowledge_point: '丝绸之路' },
    ],
    地理: [
      { content: '中国最大的淡水湖是？', options: ['洞庭湖', '鄱阳湖', '太湖', '青海湖'], answer: 'B', knowledge_point: '中国地理' },
      { content: '地球上最大的洋是？', options: ['大西洋', '印度洋', '太平洋', '北冰洋'], answer: 'C', knowledge_point: '海洋分布' },
      { content: '我国领土最南端位于？', options: ['海南岛', '南沙群岛', '台湾岛', '西沙群岛'], answer: 'B', knowledge_point: '中国疆域' },
    ],
    政治: [
      { content: '我国的根本政治制度是？', options: ['人民代表大会制度', '民族区域自治制度', '基层群众自治制度', '多党合作制度'], answer: 'A', knowledge_point: '政治制度' },
      { content: '公民最基本、最重要的权利是？', options: ['选举权', '人身自由权', '受教育权', '财产权'], answer: 'B', knowledge_point: '公民权利' },
      { content: '法律最主要的特征是？', options: ['由国家制定或认可', '靠国家强制力保证实施', '对全体社会成员具有普遍约束力', '规定权利和义务'], answer: 'B', knowledge_point: '法律特征' },
    ],
    信息: [
      { content: '计算机中存储容量的基本单位是？', options: ['位(bit)', '字节(Byte)', '千字节(KB)', '兆字节(MB)'], answer: 'B', knowledge_point: '存储单位' },
      { content: '二进制数 101 对应的十进制数是？', options: ['3', '4', '5', '6'], answer: 'C', knowledge_point: '进制转换' },
      { content: '下列属于输出设备的是？', options: ['键盘', '鼠标', '显示器', '扫描仪'], answer: 'C', knowledge_point: '计算机硬件' },
    ],
  };

  const existingAssignments = await knex('assignments').whereIn('class_id', classIds).count('* as cnt').first();
  const subjects = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '信息'];
  const chapters = ['第一章', '第二章', '第三章'];

  if (existingAssignments.cnt === 0) {
    const classAssignments = [];
    for (const classId of classIds) {
      subjects.forEach((subj, si) => {
        const teacher = teacherIds.length ? { id: teacherIds[si % teacherIds.length] } : null;
        if (!teacher) return;
        for (const ch of chapters) {
          if (rng() > 0.35) {
            // 截止时间：距今 3~17 天，避免历史作业全部过期而不显示「去完成」
            // 使用 toISOString()，与教师发布作业时的写入格式保持一致
            const dueDate = new Date(Date.now() + randInt(3, 17) * 24 * 3600 * 1000);
            classAssignments.push({
              teacher_id: teacher.id,
              title: `${subj}练习-${ch}`,
              description: `完成${subj}课本章节练习`,
              subject: subj,
              question_type: 'choice_single',
              questions: null,
              max_exp: randInt(50, 200),
              due_date: dueDate.toISOString(),
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

  // ---- 9b. 补齐历史演示作业的截止时间（幂等）----
  // 早期版本没有写 due_date，前端会显示 Invalid Date
  const noDueCount = await knex('assignments')
    .whereIn('class_id', classIds)
    .whereNull('due_date')
    .update({ due_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() });
  if (noDueCount) summary.created.push(`补齐作业截止时间 ${noDueCount} 个`);

  // ---- 9c. 修正历史题库中的非法题型（幂等）----
  // 旧版演示题库写的是 type='choice' + 答案为选项文本，
  // 但前端答题界面与后端判分只认 choice_single/choice_multi/judgment/fill_blank/essay，
  // 导致这些题既不显示选项、也不参与判分（BOSS战/课堂做题的取题语句同样会过滤掉）。
  const legacyQuestions = await knex('question_bank').where('type', 'choice').select('id', 'options', 'answer');
  let repairedQuestions = 0;
  for (const q of legacyQuestions) {
    let options = [];
    try { options = JSON.parse(q.options || '[]'); } catch (e) { options = []; }
    let answer = String(q.answer || '').trim();
    if (!/^[A-H]$/i.test(answer)) {
      const idx = options.findIndex((o) => String(o).trim() === answer);
      if (idx < 0) continue; // 无法定位答案则跳过，避免改错
      answer = String.fromCharCode(65 + idx);
    }
    await knex('question_bank').where('id', q.id).update({ type: 'choice_single', answer: answer.toUpperCase() });
    repairedQuestions += 1;
  }
  if (repairedQuestions) summary.created.push(`修正非法题型 ${repairedQuestions} 题`);

  // 清掉指向「仍然不受支持题型」的作业-题目关联，随后由 9d 用正确题目重新补上
  const SUPPORTED_TYPES = ['choice_single', 'choice_multi', 'judgment', 'fill_blank', 'essay'];
  const orphanLinks = await knex('assignment_questions as aq')
    .join('question_bank as qb', 'qb.id', 'aq.question_bank_id')
    .whereIn('aq.assignment_id', knex('assignments').whereIn('class_id', classIds).select('id'))
    .whereNotIn('qb.type', SUPPORTED_TYPES)
    .select('aq.id');
  if (orphanLinks.length) {
    await knex('assignment_questions').whereIn('id', orphanLinks.map((r) => r.id)).del();
    summary.created.push(`清理无效作业题目关联 ${orphanLinks.length} 条`);
  }

  // ---- 9d. 给演示作业挂题目（幂等：只补没有题目的作业）----
  // 原实现只建空作业，学生点「去完成」会看到 0 道题的空白弹窗，无法体验答题流程。
  const demoAssignments = await knex('assignments').whereIn('class_id', classIds).select('id', 'subject');
  if (demoAssignments.length) {
    const linkedRows = await knex('assignment_questions')
      .whereIn('assignment_id', demoAssignments.map((a) => a.id))
      .select('assignment_id');
    const linkedSet = new Set(linkedRows.map((r) => r.assignment_id));
    const emptyAssignments = demoAssignments.filter((a) => !linkedSet.has(a.id));

    if (emptyAssignments.length) {
      // 先按「科目 + 题干」去重，避免同一道题被 44 个作业反复插入
      const uniqueQuestions = new Map();
      for (const assign of emptyAssignments) {
        const pool = DEMO_QUESTION_BANK[assign.subject] || DEMO_QUESTION_BANK['数学'];
        for (const q of pool.slice(0, 3)) {
          const key = `${assign.subject}|||${q.content}`;
          if (!uniqueQuestions.has(key)) {
            uniqueQuestions.set(key, {
              subject: assign.subject,
              topic: assign.subject,
              difficulty: pick(['easy', 'medium', 'hard']),
              type: 'choice_single',
              content: q.content,
              options: JSON.stringify(q.options),
              answer: q.answer,
              explanation: '',
              analysis: '',
              knowledge_point: q.knowledge_point,
              source: 'demo',
              default_score: QUESTION_MAX_SCORE / 3,
              is_public: 1,
            });
          }
        }
      }

      // 只复用「题型与答案格式都对得上」的题，避免挂上选项都渲染不出来的历史脏数据
      const existingQ = await knex('question_bank')
        .whereIn('content', [...uniqueQuestions.values()].map((q) => q.content))
        .where('type', 'choice_single')
        .whereRaw("answer GLOB '[A-H]'")
        .select('id', 'subject', 'content');
      const idOf = new Map(existingQ.map((r) => [`${r.subject}|||${r.content}`, r.id]));

      const toInsert = [...uniqueQuestions.entries()]
        .filter(([key]) => !idOf.has(key))
        .map(([, row]) => row);
      if (toInsert.length) {
        await batchInsert('question_bank', toInsert, 100);
        const afterInsert = await knex('question_bank')
          .whereIn('content', toInsert.map((q) => q.content))
          .select('id', 'subject', 'content');
        for (const r of afterInsert) idOf.set(`${r.subject}|||${r.content}`, r.id);
      }

      const linkRows = [];
      const sortOfAssign = {};
      for (const assign of emptyAssignments) {
        const pool = DEMO_QUESTION_BANK[assign.subject] || DEMO_QUESTION_BANK['数学'];
        for (const q of pool.slice(0, 3)) {
          const qid = idOf.get(`${assign.subject}|||${q.content}`);
          if (!qid) continue;
          sortOfAssign[assign.id] = (sortOfAssign[assign.id] || 0) + 1;
          linkRows.push({ assignment_id: assign.id, question_bank_id: qid, sort_order: sortOfAssign[assign.id] });
        }
      }

      if (linkRows.length) await batchInsert('assignment_questions', linkRows, 200);
      summary.created.push(`作业题目 ${linkRows.length} 条（覆盖 ${emptyAssignments.length} 个作业）`);
    } else {
      summary.skipped.push('作业题目');
    }
  }

  // ---- 10. 作业提交（幂等：只补缺失的「学生 × 作业」组合）----
  // 答题明细 / 知识点统计 / 错题本由 10c 统一按提交结果重建，这里只负责造提交记录。
  const LETTERS = ['A', 'B', 'C', 'D'];
  const allAssignments = await knex('assignments').whereIn('class_id', classIds).select('id', 'class_id', 'subject', 'max_exp');
  if (allAssignments.length) {
    const assignQuestions = await knex('assignment_questions')
      .whereIn('assignment_id', allAssignments.map((a) => a.id))
      .select('assignment_id', 'question_bank_id', 'sort_order');
    const qBank = await knex('question_bank')
      .whereIn('id', [...new Set(assignQuestions.map((r) => r.question_bank_id))])
      .select('id', 'answer');
    const answerOf = new Map(qBank.map((q) => [q.id, q.answer]));
    const questionsOf = {};
    for (const r of assignQuestions) {
      (questionsOf[r.assignment_id] = questionsOf[r.assignment_id] || []).push(r);
    }

    const students = await knex('users').whereIn('id', studentIds).select('id', 'class_id');
    const existingPairs = new Set(
      (await knex('submissions').whereIn('user_id', studentIds).select('user_id', 'assignment_id'))
        .map((r) => `${r.user_id}|||${r.assignment_id}`)
    );

    const subRecords = [];
    for (const student of students) {
      const myAssignments = allAssignments.filter((a) => a.class_id === student.class_id);
      // 固定挑 3 个科目「整章做完」，保证同一知识点至少有 3 次作答样本
      // （学生端「学习数据」与教师端「学情概览」都按 >=3 次过滤，样本不足会显示为暂无数据）
      const subjects = [...new Set(myAssignments.map((a) => a.subject).filter(Boolean))];
      const fullSubjects = new Set(
        [0, 1, 2].map(() => (subjects.length ? subjects[randInt(0, subjects.length - 1)] : null)).filter(Boolean)
      );

      for (const assign of myAssignments) {
        if (existingPairs.has(`${student.id}|||${assign.id}`)) continue;
        const qs = questionsOf[assign.id] || [];
        if (qs.length === 0) continue;
        if (!fullSubjects.has(assign.subject) && rng() <= 0.25) continue;

        // 逐题造答案：约 70% 答对，其余随机错选，方便体验错题本/学情统计
        const answers = [];
        let correctCount = 0;
        for (const q of qs) {
          const correct = answerOf.get(q.question_bank_id) || 'A';
          const isRight = rng() < 0.7;
          let letter = correct;
          if (!isRight) {
            const others = LETTERS.filter((l) => l !== correct);
            letter = others[randInt(0, others.length - 1)];
          } else {
            correctCount += 1;
          }
          answers.push({ question_id: q.question_bank_id, answer: letter, image_url: '' });
        }

        // 百分制整数分，避免出现 175.27 这种越界小数（历史上用 max_exp/100 缩放导致）
        const totalScore = Math.round((correctCount / qs.length) * 100);
        const status = rng() > 0.15 ? 'graded' : 'submitted';
        subRecords.push({
          assignment_id: assign.id,
          user_id: student.id,
          answers: JSON.stringify(answers),
          status,
          ai_score: status === 'graded' ? totalScore : null,
          teacher_score: status === 'graded' ? totalScore : null,
          exp_reward: status === 'graded' ? totalScore : 0,
          gold_reward: status === 'graded' ? Math.floor((totalScore / 100) * (assign.max_exp || 30)) : 0,
          total_score: status === 'graded' ? totalScore : null,
          total_max_score: 100,
        });
      }
    }
    if (subRecords.length) {
      await batchInsert('submissions', subRecords, 200);
      summary.created.push(`作业提交 ${subRecords.length} 条`);
    } else {
      summary.skipped.push('作业提交');
    }
  }

  // ---- 10b. 修正历史演示数据中的异常分数（幂等，「重新导入演示数据」即可修复）----
  // 旧版本用 aiScore * (max_exp/100) 当总分，会出现 175.27 这类 >100 的小数
  const fixedScores = await knex('submissions')
    .whereIn('user_id', studentIds)
    .andWhere((b) => b.where('total_score', '>', 100).orWhereNot('total_max_score', 100))
    .update({
      total_score: knex.raw('MIN(100, ROUND(COALESCE(total_score, 0)))'),
      total_max_score: 100,
    });
  if (fixedScores) summary.created.push(`修正异常分数 ${fixedScores} 条`);

  // ---- 10c. 补齐/校正答题明细、知识点统计、错题本（幂等）----
  // 没有 question_answers / knowledge_point_stats，教师的「学情概览」、学生的「学习数据」
  // 与「错题本」都会是空的，演示数据看起来像功能坏掉了。
  // 答对/答错的分布按提交记录的 total_score 反推，保证统计与分数自洽。
  const demoSubs = await knex('submissions')
    .whereIn('user_id', studentIds)
    .select('id', 'assignment_id', 'user_id', 'total_score', 'submitted_at');
  if (demoSubs.length) {
    const subIds = demoSubs.map((s) => s.id);
    const linked = await knex('assignment_questions as aq')
      .join('question_bank as qb', 'qb.id', 'aq.question_bank_id')
      .whereIn('aq.assignment_id', [...new Set(demoSubs.map((s) => s.assignment_id))])
      .select('aq.assignment_id', 'aq.question_bank_id', 'aq.sort_order', 'qb.answer', 'qb.knowledge_point');
    const questionsOf = {};
    for (const r of linked) {
      (questionsOf[r.assignment_id] = questionsOf[r.assignment_id] || []).push(r);
    }

    const existingQa = await knex('question_answers')
      .whereIn('submission_id', subIds)
      .select('submission_id', 'question_bank_id', 'is_correct');
    const qaOf = {};
    for (const r of existingQa) {
      (qaOf[r.submission_id] = qaOf[r.submission_id] || []).push(r);
    }

    // 用提交 id 作为随机种子，保证每次重跑得到同样的「对错分布」
    const seededOrder = (n, seed) => {
      const idx = Array.from({ length: n }, (_, i) => i);
      let x = seed * 1103515245 + 12345;
      for (let i = n - 1; i > 0; i--) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        const j = x % (i + 1);
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      return idx;
    };

    const staleSubIds = [];
    for (const sub of demoSubs) {
      const qs = questionsOf[sub.assignment_id] || [];
      if (qs.length === 0) continue;
      const desiredCorrect = Math.max(0, Math.min(qs.length, Math.round(((sub.total_score ?? 0) / 100) * qs.length)));
      const existing = qaOf[sub.id] || [];
      const existingCorrect = existing.filter((r) => r.is_correct === 1).length;
      if (existing.length === qs.length && existingCorrect === desiredCorrect) continue;
      staleSubIds.push(sub);
    }

    if (staleSubIds.length) {
      const qaRows = [];
      for (const sub of staleSubIds) {
        const qs = (questionsOf[sub.assignment_id] || []).slice().sort((a, b) => a.sort_order - b.sort_order);
        const maxScore = 100 / qs.length;
        const desiredCorrect = Math.max(0, Math.min(qs.length, Math.round(((sub.total_score ?? 0) / 100) * qs.length)));
        const correctPositions = new Set(seededOrder(qs.length, sub.id).slice(0, desiredCorrect));
        await knex('question_answers').where('submission_id', sub.id).del();
        qs.forEach((q, i) => {
          const correct = String(q.answer || '').trim().toUpperCase();
          const isCorrect = correctPositions.has(i);
          let letter = correct;
          if (!isCorrect) {
            const others = ['A', 'B', 'C', 'D'].filter((l) => l !== correct);
            letter = others[(sub.id + i) % others.length];
          }
          qaRows.push({
            submission_id: sub.id,
            question_bank_id: q.question_bank_id,
            attempt_number: 1,
            student_answer: letter,
            is_correct: isCorrect ? 1 : 0,
            score: isCorrect ? maxScore : 0,
            max_score: maxScore,
            answered_at: sub.submitted_at || new Date().toISOString(),
          });
        });
      }
      if (qaRows.length) await batchInsert('question_answers', qaRows, 200);

      // 知识点统计与错题本都是答题明细的派生数据，明细变了就整体重建（只限演示账号）
      const allDetails = await knex('question_answers as qa')
        .join('submissions as s', 's.id', 'qa.submission_id')
        .join('question_bank as qb', 'qb.id', 'qa.question_bank_id')
        .whereIn('s.user_id', studentIds)
        .select('s.user_id', 's.assignment_id', 's.submitted_at', 'qa.question_bank_id', 'qa.is_correct', 'qa.student_answer', 'qb.knowledge_point', 'qb.answer', 'qb.answer as correct_answer');

      const kpAgg = {};
      for (const d of allDetails) {
        if (!d.knowledge_point) continue;
        const date = String(d.submitted_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
        const key = `${d.user_id}|||${d.knowledge_point}|||${date}`;
        const agg = (kpAgg[key] = kpAgg[key] || { user_id: d.user_id, knowledge_point: d.knowledge_point, date, total: 0, correct: 0 });
        agg.total += 1;
        if (d.is_correct === 1) agg.correct += 1;
      }
      await knex('knowledge_point_stats').whereIn('user_id', studentIds).del();
      const kpRows = Object.values(kpAgg).map((a) => ({
        user_id: a.user_id,
        knowledge_point: a.knowledge_point,
        date: a.date,
        total_attempts: a.total,
        correct_attempts: a.correct,
        accuracy: a.total > 0 ? Math.round((a.correct / a.total) * 10000) / 100 : 0,
      }));
      if (kpRows.length) await batchInsert('knowledge_point_stats', kpRows, 200);

      const seenWrong = new Set();
      const wrongRows = [];
      for (const d of allDetails) {
        if (d.is_correct === 1) continue;
        const key = `${d.user_id}|||${d.question_bank_id}`;
        if (seenWrong.has(key)) continue;
        seenWrong.add(key);
        wrongRows.push({
          user_id: d.user_id,
          assignment_id: d.assignment_id,
          question_id: d.question_bank_id,
          wrong_answer: d.student_answer || '',
          correct_answer: d.correct_answer || '',
          analysis: '',
          reviewed: 0,
          wrong_count: 1,
        });
      }
      await knex('wrong_questions').whereIn('user_id', studentIds).del();
      if (wrongRows.length) await batchInsert('wrong_questions', wrongRows, 200);

      // AI 助教报告（学习规划 / 学情诊断）只按「距上次生成天数」缓存，不感知新增答题数据。
      // 明细重建后旧报告口径已失真（会出现正确率与实际不符），这里一并清掉，让下次请求重新生成。
      const affectedUsers = [...new Set(staleSubIds.map((s) => s.user_id))];
      const clearedReports = await knex('ai_reports').whereIn('user_id', affectedUsers).del();
      if (clearedReports) summary.created.push(`清除过期AI报告 ${clearedReports} 份`);

      summary.created.push(`校正答题明细 ${qaRows.length} 条、知识点统计 ${kpRows.length} 条、错题本 ${wrongRows.length} 条`);
    } else {
      summary.skipped.push('答题明细');
    }
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

  // ---- 15. 题库（仅在题库为空时补充，避免污染已有题目）----
  // 题型必须是前端/后端都支持的 choice_single，且答案为选项字母
  const bankCount = await knex('question_bank').count('* as cnt').first();
  if (bankCount.cnt === 0) {
    const bankQuestions = [
      { subject: '数学', content: '1+1=?', options: JSON.stringify(['1', '2', '3', '4']), answer: 'B', type: 'choice_single', difficulty: 'easy', knowledge_point: '加法运算' },
      { subject: '数学', content: '若 a=3, b=4, 则 a²+b²=?', options: JSON.stringify(['12', '16', '25', '49']), answer: 'C', type: 'choice_single', difficulty: 'medium', knowledge_point: '代数运算' },
      { subject: '语文', content: '"但愿人长久"的下一句是？', options: JSON.stringify(['千里共婵娟', '此事古难全', '月有阴晴圆缺', '把酒问青天']), answer: 'A', type: 'choice_single', difficulty: 'easy', knowledge_point: '诗词名句' },
      { subject: '英语', content: 'What does "pet" mean?', options: JSON.stringify(['猫', '狗', '宠物', '动物']), answer: 'C', type: 'choice_single', difficulty: 'easy', knowledge_point: '单词翻译' },
      { subject: '物理', content: '牛顿第一定律也称为？', options: JSON.stringify(['万有引力定律', '惯性定律', '能量守恒定律', '热力学定律']), answer: 'B', type: 'choice_single', difficulty: 'medium', knowledge_point: '牛顿定律' },
      { subject: '化学', content: '水的化学式是？', options: JSON.stringify(['CO2', 'H2O', 'O2', 'NaCl']), answer: 'B', type: 'choice_single', difficulty: 'easy', knowledge_point: '化学式' },
      { subject: '生物', content: '细胞的基本结构包括？', options: JSON.stringify(['细胞膜', '细胞质', '细胞核', '以上都是']), answer: 'D', type: 'choice_single', difficulty: 'easy', knowledge_point: '细胞结构' },
      { subject: '历史', content: '唐朝的开国皇帝是？', options: JSON.stringify(['李世民', '李渊', '武则天', '李治']), answer: 'B', type: 'choice_single', difficulty: 'medium', knowledge_point: '唐朝历史' },
      { subject: '地理', content: '中国最大的淡水湖是？', options: JSON.stringify(['洞庭湖', '鄱阳湖', '太湖', '青海湖']), answer: 'B', type: 'choice_single', difficulty: 'medium', knowledge_point: '中国地理' },
    ];
    await knex('question_bank').insert(bankQuestions);
    summary.created.push(`题库示例 ${bankQuestions.length} 题`);
  } else {
    summary.skipped.push('题库示例');
  }

  // ---- 16. 可选：用演示账号信息替换「全局公告」「首页公告」----
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
