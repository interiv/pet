// 阶段25：移动端（390x844）窄屏回归：菜单遍历 + 横向溢出 + 控制台错误采集
import { chromium } from 'playwright-core';
import { report, reset, installNoticeKiller } from './_helper.mjs';

const CHROME = 'C:\\Users\\inter\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const BASE = 'http://localhost:5173';

const browser = await chromium.launch({ executablePath: CHROME, headless: false });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();
await installNoticeKiller(page);

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`); });

async function overflow() {
  return await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_student1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);
  const base = page.url().split('?')[0];
  console.log('移动端工作台:', base);

  const MENUS = ['首页', '学习中心', '我的宠物', '班级', '卡兑换'];
  for (const m of MENUS) {
    errors.length = 0;
    await page.goto(`${base}?menu=${encodeURIComponent(m)}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    // 菜单是按可见文本渲染的，若直接带参无效则点击菜单项
    const item = page.getByRole('menuitem', { name: new RegExp(m) }).first();
    if (await item.count()) { await item.click(); await page.waitForTimeout(2500); }
    const o = await overflow();
    const over = o.scrollW - o.innerW;
    await page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/25-mobile-${m}.png`, fullPage: true });
    console.log(`>> ${m}: 横向溢出=${over > 2 ? `⚠ ${over}px` : '无'}，控制台问题=${[...new Set(errors)].length} 条`);
    [...new Set(errors)].slice(0, 4).forEach(e => console.log('   ', e.slice(0, 160)));
  }

  // 学习中心各子页签
  const TABS = ['wrong', 'daily', 'achievements', 'learning'];
  for (const t of TABS) {
    errors.length = 0;
    await page.goto(`${base}?menu=study&tab=${t}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const o = await overflow();
    console.log(`>> 学习中心/${t}: 横向溢出=${o.scrollW - o.innerW > 2 ? `⚠ ${o.scrollW - o.innerW}px` : '无'}，控制台问题=${[...new Set(errors)].length} 条`);
    [...new Set(errors)].slice(0, 3).forEach(e => console.log('   ', e.slice(0, 160)));
  }
} catch (e) {
  console.error('脚本异常:', e.message);
} finally {
  await browser.close();
}
