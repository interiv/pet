// 探针：定位 useForm 未连接告警的触发位置
import { launch, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const seen = new Map();

page.on('console', async (msg) => {
  const txt = msg.text();
  if (!/useForm|deprecated|not connected/.test(txt)) return;
  const loc = msg.location();
  if (!seen.has(txt.slice(0, 100))) {
    let extra = '';
    for (const a of msg.args()) {
      try {
        const j = await a.jsonValue();
        if (typeof j === 'string' && j.includes('at ')) extra = j;
      } catch {}
    }
    seen.set(txt.slice(0, 100), { loc, extra });
  }
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_student1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('>> 打开学习中心');
  await page.getByRole('menuitem', { name: /学习中心/ }).first().click();
  await page.waitForTimeout(3000);

  console.log('>> 点击去完成');
  const btn = page.getByRole('button', { name: '去完成' }).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(3000); }
  await page.screenshot({ path: 'd:/参赛用/2026-创AI/pet/scripts/e2e/shots/probe-do-modal.png', fullPage: true });
  const t = await page.locator('.ant-modal').first().innerText().catch(() => '');
  console.log('---- 弹窗 ----');
  console.log(t.slice(0, 1200));
} catch (e) {
  console.error('异常:', e.message);
} finally {
  console.log('\n===== 命中告警 =====');
  for (const [k, v] of seen) {
    console.log('---', k);
    console.log('  location:', JSON.stringify(v.loc));
    if (v.extra) console.log('  stack:', v.extra.split('\n').slice(0, 10).join('\n'));
  }
  await browser.close();
}
