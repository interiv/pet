const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

// 使用之前测试创建的token
const TEST_TOKEN = process.argv[2];

if (!TEST_TOKEN) {
  console.log('使用方法: node test-new-routes.js <token>');
  console.log('\n请先登录获取token:');
  console.log('curl -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d \'{"username":"your_user","password":"your_password"}\'');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TEST_TOKEN}`
};

async function testRoute(name, method, url, data = null) {
  try {
    console.log(`\n测试: ${name}`);
    console.log(`  ${method} ${url}`);
    
    let response;
    if (method === 'GET') {
      response = await axios.get(`${BASE_URL}${url}`, { headers });
    } else if (method === 'POST') {
      response = await axios.post(`${BASE_URL}${url}`, data, { headers });
    }
    
    console.log(`  ✅ 状态: ${response.status}`);
    console.log(`  📦 响应: ${JSON.stringify(response.data).substring(0, 150)}...`);
    return true;
  } catch (error) {
    const status = error.response?.status || '无响应';
    const message = error.response?.data?.error || error.message;
    console.log(`  ❌ 状态: ${status}`);
    console.log(`  ❌ 错误: ${message}`);
    return false;
  }
}

async function runTests() {
  console.log('🧪 测试新增路由...\n');
  console.log('='.repeat(60));
  
  const results = {
    total: 0,
    passed: 0,
    failed: 0
  };
  
  // 测试1: 知识点统计
  const kp1 = await testRoute('知识点统计', 'GET', '/knowledge-points?days=7');
  results.total++;
  if (kp1) results.passed++; else results.failed++;
  
  // 测试2: 薄弱知识点
  const kp2 = await testRoute('薄弱知识点', 'GET', '/knowledge-points/weak-points');
  results.total++;
  if (kp2) results.passed++; else results.failed++;
  
  // 测试3: 可用技能
  const sk1 = await testRoute('可用技能列表', 'GET', '/skills/available');
  results.total++;
  if (sk1) results.passed++; else results.failed++;
  
  // 测试4: 班级BOSS
  const boss1 = await testRoute('班级BOSS(班级ID=1)', 'GET', '/boss-battles/current/1');
  results.total++;
  if (boss1) results.passed++; else results.failed++;
  
  // 测试5: 班级BOSS(班级ID=7,使用测试班级)
  const boss2 = await testRoute('班级BOSS(班级ID=7)', 'GET', '/boss-battles/current/7');
  results.total++;
  if (boss2) results.passed++; else results.failed++;
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果');
  console.log('='.repeat(60));
  console.log(`总测试: ${results.total}`);
  console.log(`✅ 通过: ${results.passed}`);
  console.log(`❌ 失败: ${results.failed}`);
  console.log(`通过率: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  
  if (results.passed === results.total) {
    console.log('\n🎉 所有路由都正常工作!');
  } else {
    console.log('\n⚠️ 部分路由存在问题,需要检查');
  }
}

runTests().catch(error => {
  console.error('\n💥 测试失败:', error.message);
  process.exit(1);
});
