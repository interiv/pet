// 阶段五：教师身份 demo_teacher1 遍历各功能
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const MENUS = ['首页', '教学管理', '沟通', '卡管理', '课堂做题', '通知', '工作台'];

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_teacher1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  console.log('登录后 URL:', page.url());

  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/06-teacher-home.png', fullPage: true });

  for (const m of MENUS) {
    reset();
    const item = page.getByRole('menuitem', { name: new RegExp(m) }).first();
    if (!(await item.count())) { console.log(`!! 未找到菜单: ${m}`); continue; }
    await item.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/teacher-${m}.png`, fullPage: true });
    const errs = await report(`教师-${m}`);
    if (errs.length) console.log(`   ^^ ${m} 有 ${errs.length} 条问题`);
  }
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段5-异常');
} finally {
  await browser.close();
}
