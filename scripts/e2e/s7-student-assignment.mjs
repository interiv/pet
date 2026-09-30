// 阶段七：学生进入「学习中心 -> 作业」，点开作业详情并尝试作答提交
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
  await page.waitForTimeout(3500);

  console.log('>> 学习中心');
  await page.getByRole('menuitem', { name: /学习中心/ }).first().click();
  await page.waitForTimeout(2500);

  console.log('>> 点击第一个「去完成」');
  const btn = page.getByRole('button', { name: '去完成' }).first();
  console.log('  去完成按钮数量:', await page.getByRole('button', { name: '去完成' }).count());
  await btn.click();
  await page.waitForTimeout(3000);
  await shot('07a-assignment-detail');
  await report('作业详情');

  // 打印详情页文本
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 2500));
  console.log('---- 详情页文本 ----');
  console.log(txt);
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段7-异常');
} finally {
  await browser.close();
}
