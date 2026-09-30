// 阶段三：admin 进入 /workspace -> 管理后台，遍历页签并导入演示数据
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'admin');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  console.log('>> 进入 /workspace');
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/03-workspace.png', fullPage: true });

  const menu = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('li, button').forEach((el) => {
      const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 20) out.push(t);
    });
    return [...new Set(out)];
  });
  console.log('侧边/可点击项:', JSON.stringify(menu, null, 1));

  await report('阶段3-workspace');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段3-异常');
} finally {
  await browser.close();
}
