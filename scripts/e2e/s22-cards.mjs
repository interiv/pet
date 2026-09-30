// 阶段22：卡管理「批量生成卡」 → 学生「卡兑换」端到端闭环验证
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();

async function login(username) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', username);
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);
  return page.url().split('?')[0];
}

try {
  // ===== A. 教师：批量生成卡 =====
  const teacherBase = await login('demo_teacher1');
  console.log('教师工作台:', teacherBase);

  reset();
  await page.goto(`${teacherBase}?menu=card-manager`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);

  const createBtn = page.getByRole('button', { name: /批量生成卡/ }).first();
  console.log('找到「批量生成卡」按钮:', (await createBtn.count()) > 0);
  await createBtn.click();
  await page.waitForTimeout(1200);

  await page.fill('#name', 'QA自动化测试-奖励卡');
  await page.click('#type');
  await page.waitForTimeout(600);
  await page.locator('.ant-select-item-option').filter({ hasText: '金币' }).first().click();
  await page.waitForTimeout(400);
  await page.fill('#quantity', '2');
  await page.fill('#reward_value', '50');
  await page.fill('#reward_name', '50金币');
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/22-card-create.png' });

  await page.locator('.ant-modal-footer button.ant-btn-primary').last().click();
  await page.waitForTimeout(3500);

  const codesText = await page.locator('.ant-modal-body').last().innerText().catch(() => '');
  const codes = [...new Set((codesText.match(/\b[A-Z0-9]{8,20}\b/g) || []))];
  console.log('生成卡号:', codes.join(', ') || '(未解析到卡号)');
  console.log('卡号弹窗文本摘要:', codesText.slice(0, 160).replace(/\n/g, ' | '));
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/22-card-codes.png' });
  await report('教师-批量生成卡');

  // ===== B. 学生：兑换其中一张 =====
  const studentBase = await login('demo_student1');
  console.log('学生工作台:', studentBase);

  reset();
  await page.goto(`${studentBase}?menu=card-redeem`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  const code = codes[0];
  if (!code) {
    console.log('!! 无可用卡号，跳过兑换');
  } else {
    await page.fill('input[placeholder="请输入卡号"]', code);
    await page.getByRole('button', { name: '兑换' }).first().click();
    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText();
    const ok = /兑换成功|最近兑换成功/.test(bodyText);
    console.log(`兑换 ${code}:`, ok ? '成功' : '未见到成功提示');
    console.log('  页面提示:', (bodyText.match(/兑换[^\n]{0,60}/g) || []).slice(0, 3).join(' / '));
  }
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/22-card-redeem.png', fullPage: true });
  await report('学生-卡兑换');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段22-异常');
} finally {
  await browser.close();
}
