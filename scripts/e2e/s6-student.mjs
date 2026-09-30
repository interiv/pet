// 阶段六：学生身份 demo_student1 遍历各功能
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const MENUS = ['首页', '学习中心', '我的宠物', '班级', '卡兑换', '通知'];

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_student1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  console.log('登录后 URL:', page.url());

  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log('工作台 URL:', page.url());
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/07-student-home.png', fullPage: true });
  await report('学生-首页');

  for (const m of MENUS) {
    reset();
    const item = page.getByRole('menuitem', { name: new RegExp(m) }).first();
    if (!(await item.count())) { console.log(`!! 未找到菜单: ${m}`); continue; }
    await item.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/student-${m}.png`, fullPage: true });
    const errs = await report(`学生-${m}`);
    if (errs.length) console.log(`   ^^ ${m} 有 ${errs.length} 条问题`);
  }
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段6-异常');
} finally {
  await browser.close();
}
