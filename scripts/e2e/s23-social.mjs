// 阶段23：学生端「错题本相似题 / 论坛发帖 / 好友 / 群聊」端到端验证
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_student1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);
  return page.url().split('?')[0];
}

const step = async (tag, fn) => {
  reset();
  try {
    await fn();
  } catch (e) {
    console.log(`!! ${tag} 异常: ${e.message.split('\n')[0]}`);
  }
  const errs = await report(tag);
  console.log(`>> ${tag}: ${errs.length === 0 ? '控制台 0 错误' : errs.length + ' 条问题'}`);
};

try {
  const base = await login();
  console.log('学生工作台:', base);

  // ===== 1. 错题本 → 练习相似题 =====
  await step('错题本-相似题', async () => {
    await page.goto(`${base}?menu=study&tab=wrong`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const rows = await page.locator('tbody tr').count();
    console.log('  错题行数:', rows);
    const detailBtn = page.getByRole('button', { name: /详情/ }).first();
    if (await detailBtn.count()) {
      await detailBtn.click();
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: /练习相似题/ }).first().click();
      await page.waitForTimeout(3000);
      const modalText = await page.locator('.ant-modal-content').last().innerText();
      console.log('  相似题弹窗:', modalText.slice(0, 120).replace(/\n/g, ' | '));
    } else {
      console.log('  !! 未找到「详情」按钮（错题本可能为空）');
    }
    await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/23-similar.png' });
  });

  // ===== 2. 论坛 → 发帖 =====
  await step('论坛-发帖', async () => {
    await page.goto(`${base}?menu=social&tab=forum`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const threadCount = await page.locator('.ant-list-item, .ant-card').count();
    console.log('  论坛条目数:', threadCount);
    await page.getByRole('button', { name: /发帖/ }).first().click();
    await page.waitForTimeout(1200);
    await page.fill('input[placeholder="帖子标题"]', 'QA自动化测试-论坛发帖');
    await page.fill('textarea[placeholder="详细描述你的问题或想法..."]', '这是一条由自动化测试创建的帖子，用于验证论坛发帖功能是否正常。');
    await page.locator('.ant-modal-footer button.ant-btn-primary').last().click();
    await page.waitForTimeout(3000);
    const body = await page.locator('body').innerText();
    console.log('  发帖结果:', /发布成功|QA自动化测试-论坛发帖/.test(body) ? 'OK' : '未见到成功反馈');
    await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/23-forum.png', fullPage: true });
  });

  // ===== 3. 好友列表 =====
  await step('好友列表', async () => {
    await page.goto(`${base}?menu=social&tab=friends`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const text = await page.locator('body').innerText();
    console.log('  好友页摘要:', text.slice(0, 160).replace(/\n/g, ' | '));
    await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/23-friends.png', fullPage: true });
  });

  // ===== 4. 群聊 → 发消息 =====
  await step('群聊-发消息', async () => {
    await page.goto(`${base}?menu=social&tab=chat`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3500);
    const convItems = page.locator('.ant-list-items > div');
    console.log('  会话条目数:', await convItems.count());
    let ta = page.locator('textarea[placeholder^="发送到"]').first();
    if (!(await ta.count())) {
      // 会话项是自定义 div（非标准 .ant-list-item），按可见文本点击
      const target = page.locator('div', { hasText: '演示1班 班级群' }).last();
      if (await target.count()) {
        await target.click();
        await page.waitForTimeout(2500);
      }
      ta = page.locator('textarea[placeholder^="发送到"]').first();
    }
    if (await ta.count()) {
      const msg = `QA自动化测试消息-${Date.now()}`;
      await ta.fill(msg);
      await page.locator('button.ant-btn-primary.ant-btn-circle').first().click();
      await page.waitForTimeout(3000);
      const body = await page.locator('body').innerText();
      console.log('  消息是否出现:', body.includes(msg) ? '是' : '否');
    } else {
      console.log('  !! 未找到聊天输入框');
    }
    await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/23-chat.png', fullPage: true });
  });
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段23-异常');
} finally {
  await browser.close();
}
