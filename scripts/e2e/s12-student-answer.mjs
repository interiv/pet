// 阶段十二：学生完成刚发布的作业（作答 -> 提交 -> 查看结果）
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const shot = (n) => page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/${n}.png`, fullPage: true });

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_student1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  reset();
  await page.getByRole('menuitem', { name: /学习中心/ }).first().click();
  await page.waitForTimeout(2500);
  await shot('12a-assignment-list');

  console.log('>> 打开第一份「一元二次方程求根 - 单选题练习」');
  const card = page.locator('tr', { hasText: '一元二次方程求根' }).first();
  await card.getByRole('button', { name: '去完成' }).first().click();
  await page.waitForTimeout(3000);
  await shot('12b-answer-modal');
  const t = await page.locator('.ant-modal').first().innerText().catch(() => '');
  console.log('---- 答题弹窗 ----');
  console.log(t.slice(0, 1500));

  // 选择每道题的 A 选项
  const radios = page.locator('.ant-modal .ant-radio-wrapper');
  const n = await radios.count();
  console.log('  选项数量:', n);
  for (let i = 0; i < n; i += 4) { // 每题4个选项，选第一个
    await radios.nth(i).click();
    await page.waitForTimeout(200);
  }
  await shot('12c-answered');

  console.log('>> 提交答案');
  await page.getByRole('button', { name: /提交答案/ }).first().click();
  await page.waitForTimeout(8000);
  await shot('12d-submitted');
  const msg = await page.locator('.ant-message').innerText().catch(() => '(无)');
  console.log('提示:', msg.replace(/\n/g, ' | '));
  const body = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  console.log('---- 提交后文本 ----');
  console.log(body);
  await report('学生作答');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段12-异常');
} finally {
  await browser.close();
}
