// 阶段八：学生遍历「学习中心」和「我的宠物」内部子页签 + 卡兑换/通知
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const shot = (n) => page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/${n}.png`, fullPage: true });

async function clickTab(name, tag) {
  reset();
  const t = page.locator('.ant-tabs-tab', { hasText: name }).first();
  if (!(await t.count())) { console.log(`  !! 未找到页签: ${name}`); return; }
  await t.click();
  await page.waitForTimeout(2200);
  await shot(`${tag}-${name}`);
  const errs = await report(`${tag}/${name}`);
  if (errs.length) console.log(`   ^^ ${name} 有 ${errs.length} 条问题`);
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_student1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);

  console.log('==== 学习中心子页签 ====');
  await page.getByRole('menuitem', { name: /学习中心/ }).first().click();
  await page.waitForTimeout(2000);
  for (const t of ['错题本', '每日任务', '成就', '学习数据']) await clickTab(t, 'study');

  console.log('==== 我的宠物子页签 ====');
  await page.getByRole('menuitem', { name: /我的宠物/ }).first().click();
  await page.waitForTimeout(2000);
  for (const t of ['我的背包', '宠物技能', '道具商店', '装备商店', 'PVP 对战', 'BOSS 战']) await clickTab(t, 'pet');

  console.log('==== 卡兑换 ====');
  reset();
  await page.getByRole('menuitem', { name: /卡兑换/ }).first().click();
  await page.waitForTimeout(2500);
  await shot('student-tab-卡兑换');
  await report('卡兑换');

  console.log('==== 通知 ====');
  reset();
  await page.getByRole('menuitem', { name: /通知/ }).first().click();
  await page.waitForTimeout(2500);
  await shot('student-tab-通知');
  await report('通知');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段8-异常');
} finally {
  await browser.close();
}
