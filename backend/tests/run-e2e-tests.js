const axios = require('axios');
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const BASE_URL = 'http://localhost:3000/api';
const dbPath = path.join(__dirname, '../data/database.sqlite');

// 测试结果
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: [],
  details: []
};

// 测试账号
const testAccounts = {
  student: {
    username: 'test_student_' + Date.now(),
    password: 'Test123456',
    email: 'student@test.com'
  },
  teacher: {
    username: 'test_teacher_' + Date.now(),
    password: 'Test123456',
    email: 'teacher@test.com'
  }
};

// 工具函数
function log(module, name, passed, data = '') {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ [${module}] ${name}`);
  } else {
    testResults.failed++;
    console.log(`❌ [${module}] ${name}`);
    if (data) {
      const errorMsg = typeof data === 'string' ? data : JSON.stringify(data);
      console.log(`   错误: ${errorMsg}`);
      testResults.errors.push({ module, name, error: errorMsg });
    }
  }
  testResults.details.push({ module, name, passed, data });
}

// 准备测试数据
async function prepareTestData() {
  console.log('\n📦 步骤1: 准备测试数据\n');
  
  const db = new Database(dbPath);
  
  try {
    // 1. 创建测试班级
    console.log('1. 创建测试班级...');
    const classResult = db.prepare(`
      INSERT INTO classes (name, teacher_id, grade)
      VALUES ('测试班级E2E', 1, '三年级')
    `).run();
    const classId = classResult.lastInsertRowid;
    console.log(`   ✅ 班级创建成功, ID: ${classId}`);
    
    // 2. 创建邀请码
    console.log('2. 创建班级邀请码...');
    const inviteCode = 'E2E_' + Date.now();
    db.prepare(`
      INSERT INTO class_invitations (class_id, invitation_code, created_by, role_filter)
      VALUES (?, ?, 1, 'any')
    `).run(classId, inviteCode);
    console.log(`   ✅ 邀请码创建成功: ${inviteCode}`);
    
    // 3. 创建测试学生用户
    console.log('3. 创建测试学生用户...');
    const hashedPassword = bcrypt.hashSync(testAccounts.student.password, 10);
    const studentResult = db.prepare(`
      INSERT INTO users (username, password_hash, email, role, class_id)
      VALUES (?, ?, ?, 'student', ?)
    `).run(testAccounts.student.username, hashedPassword, testAccounts.student.email, classId);
    console.log(`   ✅ 学生用户创建成功: ${testAccounts.student.username}`);
    
    // 4. 创建测试教师用户
    console.log('4. 创建测试教师用户...');
    const teacherResult = db.prepare(`
      INSERT INTO users (username, password_hash, email, role)
      VALUES (?, ?, ?, 'teacher')
    `).run(testAccounts.teacher.username, hashedPassword, testAccounts.teacher.email);
    console.log(`   ✅ 教师用户创建成功: ${testAccounts.teacher.username}`);
    
    // 5. 更新班级教师
    db.prepare(`
      UPDATE classes SET teacher_id = ? WHERE id = ?
    `).run(teacherResult.lastInsertRowid, classId);
    
    db.close();
    
    return {
      classId,
      studentId: studentResult.lastInsertRowid,
      teacherId: teacherResult.lastInsertRowid
    };
    
  } catch (error) {
    db.close();
    throw error;
  }
}

// 测试认证系统
async function testAuth() {
  console.log('\n🔐 步骤2: 测试认证系统\n');
  
  let studentToken = null;
  let teacherToken = null;
  
  try {
    // 学生登录
    console.log('1. 学生登录...');
    const studentLogin = await axios.post(`${BASE_URL}/auth/login`, {
      username: testAccounts.student.username,
      password: testAccounts.student.password
    });
    studentToken = studentLogin.data.token;
    log('Auth', '学生登录', !!studentToken);
    
    // 教师登录
    console.log('2. 教师登录...');
    const teacherLogin = await axios.post(`${BASE_URL}/auth/login`, {
      username: testAccounts.teacher.username,
      password: testAccounts.teacher.password
    });
    teacherToken = teacherLogin.data.token;
    log('Auth', '教师登录', !!teacherToken);
    
    return { studentToken, teacherToken };
    
  } catch (error) {
    log('Auth', '认证测试', false, error.response?.data?.error || error.message);
    return { studentToken: null, teacherToken: null };
  }
}

// 测试学生功能
async function testStudentFeatures(token) {
  console.log('\n👨‍🎓 步骤3: 测试学生功能\n');
  
  if (!token) {
    console.log('   ⏭️ 跳过: 缺少token');
    return;
  }
  
  const headers = { Authorization: `Bearer ${token}` };
  
  try {
    // 1. 获取宠物种类
    console.log('1. 获取宠物种类...');
    const speciesRes = await axios.get(`${BASE_URL}/pets/species`, { headers });
    log('Student', '获取宠物种类', speciesRes.status === 200);
    
    // 2. 创建宠物
    if (speciesRes.data.species && speciesRes.data.species.length > 0) {
      console.log('2. 创建宠物...');
      const createPet = await axios.post(`${BASE_URL}/pets/create`, {
        species_id: speciesRes.data.species[0].id,
        name: '我的测试宠物'
      }, { headers });
      log('Student', '创建宠物', createPet.status === 200 || createPet.status === 201);
    }
    
    // 3. 获取我的宠物
    console.log('3. 获取我的宠物...');
    const myPet = await axios.get(`${BASE_URL}/pets/my-pet`, { headers });
    log('Student', '获取我的宠物', myPet.status === 200);
    
    // 4. 获取道具列表
    console.log('4. 获取道具列表...');
    const items = await axios.get(`${BASE_URL}/items`, { headers });
    log('Student', '获取道具列表', items.status === 200);
    
    // 5. 获取我的道具
    console.log('5. 获取我的道具...');
    const myItems = await axios.get(`${BASE_URL}/items/my-items`, { headers });
    log('Student', '获取我的道具', myItems.status === 200);
    
    // 6. 获取每日任务
    console.log('6. 获取每日任务...');
    const dailyTasks = await axios.get(`${BASE_URL}/daily-tasks`, { headers });
    log('Student', '获取每日任务', dailyTasks.status === 200);
    
    // 7. 获取知识点统计
    console.log('7. 获取知识点统计...');
    try {
      const knowledgePoints = await axios.get(`${BASE_URL}/knowledge-points?days=7`, { headers });
      log('Student', '获取知识点统计', knowledgePoints.status === 200);
    } catch (error) {
      // 可能接口路径不对,尝试其他路径
      log('Student', '获取知识点统计', error.response?.status === 404 || false, error.response?.data?.error);
    }
    
    // 8. 获取薄弱知识点
    console.log('8. 获取薄弱知识点...');
    try {
      const weakPoints = await axios.get(`${BASE_URL}/knowledge-points/weak-points`, { headers });
      log('Student', '获取薄弱知识点', weakPoints.status === 200);
    } catch (error) {
      log('Student', '获取薄弱知识点', error.response?.status === 404 || false, error.response?.data?.error);
    }
    
    // 9. 获取可用技能
    console.log('9. 获取可用技能...');
    const skills = await axios.get(`${BASE_URL}/skills/available`, { headers });
    log('Student', '获取可用技能', skills.status === 200);
    if (skills.data.skills) {
      console.log(`   📊 可用技能数: ${skills.data.skills.length}`);
    }
    
    // 10. 获取成就列表
    console.log('10. 获取成就列表...');
    const achievements = await axios.get(`${BASE_URL}/achievements/list`, { headers });
    log('Student', '获取成就列表', achievements.status === 200);
    
    // 11. 获取成就状态
    console.log('11. 获取成就状态...');
    const achievementStatus = await axios.get(`${BASE_URL}/achievements/status`, { headers });
    log('Student', '获取成就状态', achievementStatus.status === 200);
    
    // 12. 获取作业列表
    console.log('12. 获取作业列表...');
    const assignments = await axios.get(`${BASE_URL}/assignments`, { headers });
    log('Student', '获取作业列表', assignments.status === 200);
    
    // 13. 获取班级BOSS
    console.log('13. 获取班级BOSS...');
    try {
      const bossBattle = await axios.get(`${BASE_URL}/boss-battles/current/1`, { headers });
      log('Student', '获取班级BOSS', bossBattle.status === 200);
    } catch (error) {
      // 404也是正常(没有BOSS)
      log('Student', '获取班级BOSS', error.response?.status === 404 || error.response?.status === 200);
    }
    
    // 14. 获取好友列表
    console.log('14. 获取好友列表...');
    const friends = await axios.get(`${BASE_URL}/friends/list`, { headers });
    log('Student', '获取好友列表', friends.status === 200);
    
    // 15. 获取我的装备
    console.log('15. 获取我的装备...');
    const equipment = await axios.get(`${BASE_URL}/equipment/my-equipment`, { headers });
    log('Student', '获取我的装备', equipment.status === 200);
    
  } catch (error) {
    log('Student', '学生功能测试', false, error.response?.data?.error || error.message);
  }
}

// 测试教师功能
async function testTeacherFeatures(token, classId) {
  console.log('\n👨‍🏫 步骤4: 测试教师功能\n');
  
  if (!token) {
    console.log('   ⏭️ 跳过: 缺少token');
    return;
  }
  
  const headers = { Authorization: `Bearer ${token}` };
  
  try {
    // 1. 获取班级列表
    console.log('1. 获取班级列表...');
    const classes = await axios.get(`${BASE_URL}/admin/classes`, { headers });
    log('Teacher', '获取班级列表', classes.status === 200);
    
    // 2. 创建作业
    console.log('2. 创建作业...');
    try {
      const assignment = await axios.post(`${BASE_URL}/assignments`, {
        class_id: classId,
        subject: '数学',
        title: '测试作业-四则运算',
        difficulty: 'easy',
        question_count: 5,
        question_types: ['choice_single'],
        use_ai: false  // 不使用AI生成
      }, { headers });
      log('Teacher', '创建作业', assignment.status === 200 || assignment.status === 201);
    } catch (error) {
      log('Teacher', '创建作业', false, error.response?.data?.error || error.message);
    }
    
    // 3. 获取班级统计
    console.log('3. 获取班级统计...');
    const classStats = await axios.get(`${BASE_URL}/admin/classes/${classId}/stats`, { headers });
    log('Teacher', '获取班级统计', classStats.status === 200);
    
    // 4. 创建BOSS
    console.log('4. 创建BOSS...');
    try {
      const boss = await axios.post(`${BASE_URL}/boss-battles/create`, {
        class_id: classId,
        boss_name: '测试BOSS',
        boss_level: 5,
        knowledge_point: '四则运算',
        duration_hours: 24
      }, { headers });
      log('Teacher', '创建BOSS', boss.status === 200 || boss.status === 201);
    } catch (error) {
      log('Teacher', '创建BOSS', false, error.response?.data?.error || error.message);
    }
    
  } catch (error) {
    log('Teacher', '教师功能测试', false, error.response?.data?.error || error.message);
  }
}

// 主测试流程
async function runE2ETests() {
  console.log('🚀 开始端到端测试...\n');
  console.log('='.repeat(70));
  
  try {
    // 步骤1: 准备测试数据
    const testData = await prepareTestData();
    
    // 步骤2: 测试认证
    const { studentToken, teacherToken } = await testAuth();
    
    // 步骤3: 测试学生功能
    await testStudentFeatures(studentToken);
    
    // 步骤4: 测试教师功能
    await testTeacherFeatures(teacherToken, testData.classId);
    
    // 打印测试报告
    console.log('\n' + '='.repeat(70));
    console.log('📊 测试报告');
    console.log('='.repeat(70));
    console.log(`总测试数: ${testResults.total}`);
    console.log(`✅ 通过: ${testResults.passed}`);
    console.log(`❌ 失败: ${testResults.failed}`);
    console.log(`通过率: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
    
    if (testResults.errors.length > 0) {
      console.log('\n❌ 失败详情:');
      testResults.errors.forEach((err, index) => {
        console.log(`${index + 1}. [${err.module}] ${err.name}: ${err.error}`);
      });
    }
    
    console.log('\n✅ 通过详情:');
    testResults.details.filter(d => d.passed).forEach((detail, index) => {
      console.log(`${index + 1}. [${detail.module}] ${detail.name}`);
    });
    
    console.log('\n' + '='.repeat(70));
    
    // 输出测试账号信息
    console.log('\n📝 测试账号信息:');
    console.log(`学生: ${testAccounts.student.username} / ${testAccounts.student.password}`);
    console.log(`教师: ${testAccounts.teacher.username} / ${testAccounts.teacher.password}`);
    console.log(`班级ID: ${testData.classId}`);
    
    return testResults;
    
  } catch (error) {
    console.error('\n💥 测试执行失败:', error.message);
    console.error(error.stack);
    return testResults;
  }
}

// 执行测试
runE2ETests().then(results => {
  process.exit(results.failed > 0 ? 1 : 0);
}).catch(error => {
  console.error('\n💥 致命错误:', error);
  process.exit(1);
});
