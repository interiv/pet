// 阶段四：admin 遍历所有管理后台页签，最后导入演示数据
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const TABS = ['总览', '教师管理', '学生管理', '班级管理', '学校管理', '申请审批', '公告管理',
  '数据查看', '网站设置', 'AI设置', 'Token看板', '成就管理', '清理数据', '系统数据'];

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'admin');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByRole('menuitem', { name: /管理后台/ }).first().click();
  await page.waitForTimeout(3000);
  console.log('管理后台 URL:', page.url());
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/04-admin-dashboard.png', fullPage: true });

  for (const tab of TABS) {
    reset();
    const t = page.locator('.ant-tabs-tab', { hasText: tab }).first();
    const cnt = await t.count();
    if (!cnt) { console.log(`!! 未找到页签: ${tab}`); continue; }
    await t.click();
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/tab-${tab}.png`, fullPage: true });
    const errs = await report(`页签-${tab}`);
    if (errs.length) console.log(`   ^^ ${tab} 有 ${errs.length} 条问题`);
  }

  console.log('\n>> 导入演示数据');
  reset();
  await page.getByRole('tab', { name: /系统数据/ }).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '导入演示数据' }).first().click();
  await page.waitForTimeout(20000);
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/05-demo-imported.png', fullPage: true });
  await report('导入演示数据');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段4-异常');
} finally {
  await browser.close();
}
