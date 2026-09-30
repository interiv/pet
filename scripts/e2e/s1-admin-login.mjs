// 阶段一：登录 admin，打开管理后台 -> 系统数据 -> 导入演示数据
import { launch, report, BASE } from './_helper.mjs';

const { browser, page } = await launch();

try {
  console.log('>> 打开登录页');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.fill('input#login_username', 'admin');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  console.log('>> 当前 URL:', page.url());
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/01-after-login.png' });

  await report('阶段1-登录');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段1-异常');
} finally {
  await browser.close();
}
