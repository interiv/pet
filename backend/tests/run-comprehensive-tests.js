const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

// 测试结果存储
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
};

// 测试用户数据
const testUser = {
  username: 'test_user_' + Date.now(),
  password: 'Test123456',
  email: 'test@example.com',
  role: 'student'
};

// 工具函数
function logTest(name, passed, details = '') {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ [PASS] ${name}`);
  } else {
    testResults.failed++;
    console.log(`❌ [FAIL] ${name}`);
    if (details) console.log(`   详情: ${details}`);
    testResults.errors.push({ name, details });
  }
}

// 测试1: 后端服务健康检查
async function testHealthCheck() {
  console.log('\n📋 测试1: 后端服务健康检查');
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    logTest('健康检查接口', response.status === 200);
  } catch (error) {
    logTest('健康检查接口', false, error.message);
  }
}

// 测试2: 用户注册
async function testUserRegistration() {
  console.log('\n📋 测试2: 用户认证系统');
  try {
    const response = await axios.post(`${BASE_URL}/auth/register`, testUser);
    logTest('用户注册', response.status === 201 && response.data.token);
    return response.data.token;
  } catch (error) {
    logTest('用户注册', false, error.response?.data?.error || error.message);
    return null;
  }
}

// 测试3: 用户登录
async function testUserLogin() {
  try {
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      username: testUser.username,
      password: testUser.password
    });
    logTest('用户登录', response.status === 200 && response.data.token);
    return response.data.token;
  } catch (error) {
    logTest('用户登录', false, error.response?.data?.error || error.message);
    return null;
  }
}

// 测试4: 宠物系统
async function testPetSystem(token) {
  console.log('\n📋 测试3: 宠物系统');
  if (!token) {
    logTest('获取宠物列表', false, '缺少认证token');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    // 获取宠物种类
    const speciesResponse = await axios.get(`${BASE_URL}/pets/species`, { headers });
    logTest('获取宠物种类', speciesResponse.status === 200 && speciesResponse.data.species);

    // 创建宠物
    if (speciesResponse.data.species && speciesResponse.data.species.length > 0) {
      const createResponse = await axios.post(`${BASE_URL}/pets/create`, {
        species_id: speciesResponse.data.species[0].id,
        name: '测试宠物'
      }, { headers });
      logTest('创建宠物', createResponse.status === 200 || createResponse.status === 201);
    }

    // 获取我的宠物
    const myPetResponse = await axios.get(`${BASE_URL}/pets/my`, { headers });
    logTest('获取我的宠物', myPetResponse.status === 200);

  } catch (error) {
    logTest('宠物系统', false, error.response?.data?.error || error.message);
  }
}

// 测试5: 知识点统计
async function testKnowledgePoints(token) {
  console.log('\n📋 测试4: 知识点统计系统');
  if (!token) {
    logTest('知识点统计', false, '缺少认证token');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    const response = await axios.get(`${BASE_URL}/knowledge-points?days=7`, { headers });
    logTest('获取知识点统计', response.status === 200);
    
    const weakPoints = await axios.get(`${BASE_URL}/knowledge-points/weak-points`, { headers });
    logTest('获取薄弱知识点', weakPoints.status === 200);
  } catch (error) {
    logTest('知识点统计', false, error.response?.data?.error || error.message);
  }
}

// 测试6: 宠物技能系统
async function testPetSkills(token) {
  console.log('\n📋 测试5: 宠物技能系统');
  if (!token) {
    logTest('宠物技能', false, '缺少认证token');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    const response = await axios.get(`${BASE_URL}/skills/available`, { headers });
    logTest('获取可用技能', response.status === 200 && response.data.skills);
    
    if (response.data.skills && response.data.skills.length > 0) {
      console.log(`   找到 ${response.data.skills.length} 个技能`);
    }
  } catch (error) {
    logTest('宠物技能', false, error.response?.data?.error || error.message);
  }
}

// 测试7: 每日任务系统
async function testDailyTasks(token) {
  console.log('\n📋 测试6: 每日任务系统');
  if (!token) {
    logTest('每日任务', false, '缺少认证token');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    const response = await axios.get(`${BASE_URL}/daily-tasks`, { headers });
    logTest('获取每日任务', response.status === 200 && response.data.tasks);
    
    if (response.data.tasks) {
      console.log(`   今日任务数: ${response.data.tasks.length}`);
    }
  } catch (error) {
    logTest('每日任务', false, error.response?.data?.error || error.message);
  }
}

// 测试8: BOSS战系统
async function testBossBattles(token) {
  console.log('\n📋 测试7: 班级BOSS战系统');
  if (!token) {
    logTest('BOSS战', false, '缺少认证token');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    // 尝试获取当前BOSS (可能没有)
    const response = await axios.get(`${BASE_URL}/boss-battles/current/1`, { headers });
    logTest('获取班级BOSS', response.status === 200);
  } catch (error) {
    // 404表示没有BOSS,也是正常的
    logTest('获取班级BOSS', error.response?.status === 404 || error.response?.status === 200);
  }
}

// 测试9: 成就系统
async function testAchievements(token) {
  console.log('\n📋 测试8: 成就系统');
  if (!token) {
    logTest('成就系统', false, '缺少认证token');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    const response = await axios.get(`${BASE_URL}/achievements`, { headers });
    logTest('获取成就列表', response.status === 200 && response.data.achievements);
    
    if (response.data.achievements) {
      console.log(`   成就总数: ${response.data.achievements.length}`);
    }
  } catch (error) {
    logTest('成就系统', false, error.response?.data?.error || error.message);
  }
}

// 主测试流程
async function runAllTests() {
  console.log('🚀 开始系统测试...\n');
  console.log('=' .repeat(60));

  // 测试1: 健康检查
  await testHealthCheck();

  // 测试2-3: 用户认证
  let token = await testUserRegistration();
  if (!token) {
    token = await testUserLogin();
  }

  // 测试4-8: 核心功能
  await testPetSystem(token);
  await testKnowledgePoints(token);
  await testPetSkills(token);
  await testDailyTasks(token);
  await testBossBattles(token);
  await testAchievements(token);

  // 打印测试报告
  console.log('\n' + '=' .repeat(60));
  console.log('📊 测试报告');
  console.log('=' .repeat(60));
  console.log(`总测试数: ${testResults.total}`);
  console.log(`✅ 通过: ${testResults.passed}`);
  console.log(`❌ 失败: ${testResults.failed}`);
  console.log(`通过率: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);

  if (testResults.errors.length > 0) {
    console.log('\n❌ 失败详情:');
    testResults.errors.forEach((err, index) => {
      console.log(`${index + 1}. ${err.name}: ${err.details}`);
    });
  }

  console.log('\n' + '=' .repeat(60));
  
  // 返回测试结果
  return testResults;
}

// 执行测试
runAllTests().then(results => {
  // 退出码: 0=全部通过, 1=有失败
  process.exit(results.failed > 0 ? 1 : 0);
}).catch(error => {
  console.error('\n💥 测试执行失败:', error);
  process.exit(1);
});
