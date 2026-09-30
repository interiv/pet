// 阶段九：学生实际交互 —— 每日任务领奖 / 投喂 / 发起战斗
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

  // ---- 每日任务领奖 ----
  console.log('==== 每日任务：领取奖励 ====');
  reset();
  await page.getByRole('menuitem', { name: /学习中心/ }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('.ant-tabs-tab', { hasText: '每日任务' }).first().click();
  await page.waitForTimeout(2000);
  const claim = page.getByRole('button', { name: '领取奖励' }).first();
  console.log('  领取奖励按钮数:', await page.getByRole('button', { name: '领取奖励' }).count());
  if (await claim.count()) {
    await claim.click();
    await page.waitForTimeout(2500);
    await shot('09a-daily-claimed');
    const msg = await page.locator('.ant-message').innerText().catch(() => '(无消息)');
    console.log('  提示:', msg.replace(/\n/g, ' | '));
  }
  await report('每日任务领奖');

  // ---- 投喂 ----
  console.log('==== 我的宠物：投喂 ====');
  reset();
  await page.getByRole('menuitem', { name: /我的宠物/ }).first().click();
  await page.waitForTimeout(2500);
  const feed = page.getByRole('button', { name: /投喂/ }).first();
  console.log('  投喂按钮数:', await page.getByRole('button', { name: /投喂/ }).count());
  if (await feed.count()) {
    await feed.click();
    await page.waitForTimeout(2500);
    await shot('09b-feed');
    const msg = await page.locator('.ant-message').innerText().catch(() => '(无消息)');
    console.log('  提示:', msg.replace(/\n/g, ' | '));
  }
  await report('投喂');

  // ---- 发起战斗 ----
  console.log('==== PVP：发起挑战 ====');
  reset();
  await page.locator('.ant-tabs-tab', { hasText: 'PVP 对战' }).first().click();
  await page.waitForTimeout(2500);
  const fight = page.getByRole('button', { name: /发起挑战/ }).first();
  if (await fight.count()) {
    await fight.click();
    await page.waitForTimeout(4000);
    await shot('09c-battle');
    const body = await page.evaluate(() => document.body.innerText.slice(0, 1800));
    console.log('---- 战斗页文本 ----');
    console.log(body);
  }
  await report('发起战斗');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段9-异常');
} finally {
  await browser.close();
}
