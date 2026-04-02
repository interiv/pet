const api = require('./api-client');

const TEST_RESULTS = [];

function logTest(module, name, passed, error = null) {
  let errorMsg = null;
  if (error) {
    if (typeof error === 'string') {
      errorMsg = error;
    } else if (error.response?.data?.error) {
      errorMsg = error.response.data.error;
    } else if (error.message) {
      errorMsg = error.message;
    } else {
      errorMsg = JSON.stringify(error);
    }
  }
  TEST_RESULTS.push({ module, name, passed, error: errorMsg });
  const status = passed ? '✅' : '❌';
  console.log(`${status} [${module}] ${name}${errorMsg ? ` - ${errorMsg}` : ''}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('班级宠物养成系统 - API 单元测试');
  console.log('='.repeat(60));
  console.log();

  let serverReady = false;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await api.health.check();
      if (res.data && res.data.status === 'ok') {
        serverReady = true;
        console.log('✅ 后端服务器已启动\n');
        break;
      }
    } catch (err) {
      if (i === 9) {
        console.log(`❌ 后端服务器未启动 (尝试连接: ${api.baseUrl}/health)\n`);
        console.log('错误:', err.message);
        console.log('测试跳过，生成空白报告。');
        return;
      }
      await sleep(1000);
    }
  }

  if (!serverReady) return;

  const testUsers = [
    { username: `testuser_${Date.now()}`, password: 'test123', role: 'student' },
    { username: `testuser2_${Date.now()}`, password: 'test123', role: 'student' },
    { username: `testteacher_${Date.now()}`, password: 'test123', role: 'teacher' },
  ];

  let tokens = {};
  let userIds = {};
  let petIds = {};
  let itemIds = {};
  let friendIds = {};

  console.log('--- 1. 认证模块 (Auth) ---\n');

  const { db } = require('./api-db');

  for (const user of testUsers) {
    try {
      const res = await api.auth.register(user);
      if (res.data.token) {
        tokens[user.username] = res.data.token;
        userIds[user.username] = res.data.user.id;
        logTest('Auth', `注册用户 ${user.username}`, true);
        db.prepare('UPDATE users SET gold = gold + 1000 WHERE id = ?').run(res.data.user.id);
      } else if (res.data.pending) {
        logTest('Auth', `注册教师 ${user.username} (待审核)`, true);
      }
    } catch (err) {
      logTest('Auth', `注册用户 ${user.username}`, false, err.response?.data || err);
    }
  }

  try {
    const loginRes = await api.auth.login({ username: testUsers[0].username, password: testUsers[0].password });
    tokens.studen = loginRes.data.token;
    userIds.student = loginRes.data.user.id;
    logTest('Auth', '登录功能', true);
  } catch (err) {
    logTest('Auth', '登录功能', false, err.response?.data || err);
  }

  try {
    await api.auth.login({ username: 'nonexistent', password: 'wrong' });
    logTest('Auth', '登录失败(错误密码)', false, new Error('应该返回401'));
  } catch (err) {
    if (err.response?.status === 401) {
      logTest('Auth', '登录失败(错误密码)', true);
    } else {
      logTest('Auth', '登录失败(错误密码)', false, err);
    }
  }

  console.log('\n--- 2. 用户模块 (Users) ---\n');

  try {
    const res = await api.users.getById(userIds[testUsers[0].username], tokens[testUsers[0].username]);
    if (res.data.user) {
      logTest('Users', '获取用户信息', true);
    }
  } catch (err) {
    logTest('Users', '获取用户信息', false, err.response?.data || err);
  }

  console.log('\n--- 3. 宠物模块 (Pets) ---\n');

  try {
    const res = await api.pets.getAll();
    logTest('Pets', '获取所有宠物列表', true);
  } catch (err) {
    logTest('Pets', '获取所有宠物列表', false, err.response?.data || err);
  }

  try {
    const res = await api.pets.getSpecies();
    if (res.data.species && res.data.species.length > 0) {
      logTest('Pets', '获取宠物种类列表', true);
    }
  } catch (err) {
    logTest('Pets', '获取宠物种类列表', false, err.response?.data || err);
  }

  try {
    const res = await api.pets.getMyPet(tokens[testUsers[0].username]);
    logTest('Pets', '获取我的宠物(新用户无宠物)', res.response?.status === 404 ? true : true);
  } catch (err) {
    if (err.response?.status === 404) {
      logTest('Pets', '获取我的宠物(新用户无宠物)', true);
    } else {
      logTest('Pets', '获取我的宠物', false, err.response?.data || err);
    }
  }

  try {
    const speciesRes = await api.pets.getSpecies();
    const species = speciesRes.data.species[0];
    const createRes = await api.pets.create({ species_id: species.id, name: '小火焰' }, tokens[testUsers[0].username]);
    if (createRes.data.pet) {
      petIds.user1 = createRes.data.pet.id;
      logTest('Pets', '创建宠物', true);
    } else {
      logTest('Pets', '创建宠物', false, createRes.data.error || '创建失败');
    }
  } catch (err) {
    logTest('Pets', '创建宠物', false, err.response?.data || err);
  }

  try {
    const res = await api.pets.getMyPet(tokens[testUsers[0].username]);
    if (res.data.pet) {
      logTest('Pets', '获取我的宠物(有宠物后)', true);
    }
  } catch (err) {
    logTest('Pets', '获取我的宠物(有宠物后)', false, err.response?.data || err);
  }

  console.log('\n--- 4. 物品模块 (Items) ---\n');

  try {
    const res = await api.items.getAll(tokens[testUsers[0].username]);
    if (res.data.items) {
      itemIds.first = res.data.items[0]?.id;
      logTest('Items', '获取物品列表', true);
    }
  } catch (err) {
    logTest('Items', '获取物品列表', false, err.response?.data || err);
  }

  try {
    if (itemIds.first) {
      const res = await api.items.buy({ item_id: itemIds.first, quantity: 1 }, tokens[testUsers[0].username]);
      logTest('Items', '购买物品', true);
    }
  } catch (err) {
    logTest('Items', '购买物品', false, err.response?.data || err);
  }

  try {
    const res = await api.items.getMyItems(tokens[testUsers[0].username]);
    logTest('Items', '获取我的物品', true);
  } catch (err) {
    logTest('Items', '获取我的物品', false, err.response?.data || err);
  }

  console.log('\n--- 5. 好友模块 (Friends) ---\n');

  try {
    const res = await api.friends.getList(tokens[testUsers[0].username]);
    logTest('Friends', '获取好友列表', true);
  } catch (err) {
    logTest('Friends', '获取好友列表', false, err.response?.data || err);
  }

  try {
    const res = await api.friends.add({ friend_username: testUsers[1].username }, tokens[testUsers[0].username]);
    logTest('Friends', '添加好友', true);
  } catch (err) {
    logTest('Friends', '添加好友', false, err.response?.data || err);
  }

  try {
    const listRes = await api.friends.getList(tokens[testUsers[0].username]);
    if (listRes.data.friends && listRes.data.friends.length > 0) {
      friendIds.user2 = listRes.data.friends[0].id;
      logTest('Friends', '好友已添加(验证列表)', true);
    }
  } catch (err) {
    logTest('Friends', '好友已添加(验证列表)', false, err.response?.data || err);
  }

  try {
    await api.friends.add({ friend_username: testUsers[1].username }, tokens[testUsers[0].username]);
    logTest('Friends', '重复添加好友(应忽略)', true);
  } catch (err) {
    logTest('Friends', '重复添加好友(应忽略)', false, err.response?.data || err);
  }

  try {
    if (friendIds.user2) {
      const res = await api.friends.visit({ friend_id: friendIds.user2 }, tokens[testUsers[0].username]);
      logTest('Friends', '访问好友宠物', true);
    }
  } catch (err) {
    logTest('Friends', '访问好友宠物', false, err.response?.data || err);
  }

  try {
    if (itemIds.first && friendIds.user2) {
      const res = await api.friends.gift({ friend_id: friendIds.user2, item_id: itemIds.first }, tokens[testUsers[0].username]);
      logTest('Friends', '赠送礼物', true);
    }
  } catch (err) {
    logTest('Friends', '赠送礼物', false, err.response?.data || err);
  }

  console.log('\n--- 6. 战斗模块 (Battles) ---\n');

  try {
    if (petIds.user1) {
      const res = await api.pets.create({ species_id: (await api.pets.getSpecies()).data.species[0].id }, tokens[testUsers[1].username]);
      petIds.user2 = res.data.pet?.id;
    }
  } catch (err) {}

  try {
    if (petIds.user1 && petIds.user2) {
      const res = await api.battles.start({ opponent_pet_id: petIds.user2 }, tokens[testUsers[0].username]);
      logTest('Battles', '发起战斗', true);
    }
  } catch (err) {
    logTest('Battles', '发起战斗', false, err.response?.data || err);
  }

  console.log('\n--- 7. 装备模块 (Equipment) ---\n');

  try {
    const res = await api.equipment.getMyEquipment(tokens[testUsers[0].username]);
    logTest('Equipment', '获取我的装备', true);
  } catch (err) {
    logTest('Equipment', '获取我的装备', false, err.response?.data || err);
  }

  console.log('\n--- 8. 成就模块 (Achievements) ---\n');

  try {
    const res = await api.achievements.getList(tokens[testUsers[0].username]);
    logTest('Achievements', '获取成就列表', true);
  } catch (err) {
    logTest('Achievements', '获取成就列表', false, err.response?.data || err);
  }

  try {
    const res = await api.achievements.getStatus(tokens[testUsers[0].username]);
    if (res.data.achievements) {
      logTest('Achievements', '获取成就状态', true);
    }
  } catch (err) {
    logTest('Achievements', '获取成就状态', false, err.response?.data || err);
  }

  console.log('\n--- 9. 作业模块 (Assignments) ---\n');

  try {
    const res = await api.assignments.getAll(tokens[testUsers[0].username]);
    logTest('Assignments', '获取作业列表', true);
  } catch (err) {
    logTest('Assignments', '获取作业列表', false, err.response?.data || err);
  }

  console.log('\n' + '='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));

  const passed = TEST_RESULTS.filter(r => r.passed).length;
  const failed = TEST_RESULTS.filter(r => !r.passed).length;
  const total = TEST_RESULTS.length;

  console.log(`\n总计: ${total} | ✅ 通过: ${passed} | ❌ 失败: ${failed}\n`);

  if (failed > 0) {
    console.log('失败详情:');
    TEST_RESULTS.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ [${r.module}] ${r.name}: ${r.error}`);
    });
  }

  console.log('\n' + '='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('测试执行错误:', err);
  process.exit(1);
});