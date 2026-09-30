// 阶段二：进入管理后台，遍历各页签，并导入演示数据
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'admin');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);

  console.log('>> 点击「管理后台」');
  await page.getByText('管理后台', { exact: false }).first().click();
  await page.waitForTimeout(3000);
  console.log('   URL:', page.url());
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/02-admin-home.png', fullPage: true });

  await report('阶段2-管理后台首页');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段2-异常');
} finally {
  await browser.close();
}
