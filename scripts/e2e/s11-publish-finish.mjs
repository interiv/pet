// 阶段十一：教师完成一次作业发布（AI生成 -> 预览 -> 发布设置 -> 确认发布）
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const shot = (n) => page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/${n}.png`, fullPage: true });
const NUM = Date.now().toString().slice(-4);

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_teacher1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  reset();
  await page.getByRole('menuitem', { name: /教学管理/ }).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '发布新作业' }).first().click();
  await page.waitForTimeout(1500);

  await page.locator('#subject').click(); await page.waitForTimeout(500);
  await page.locator('.ant-select-item-option', { hasText: '数学' }).first().click(); await page.waitForTimeout(400);
  await page.locator('#question_type').click(); await page.waitForTimeout(500);
  await page.locator('.ant-select-item-option', { hasText: '单选题' }).first().click(); await page.waitForTimeout(400);
  await page.locator('#topic').fill('一元二次方程求根');
  await page.locator('#count').fill('3');
  await page.getByRole('button', { name: /AI生成题目/ }).first().click();

  let generated = false;
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(3000);
    const t = await page.locator('.ant-modal').first().innerText().catch(() => '');
    if (/确认题目，下一步/.test(t)) { generated = true; break; }
    if (/失败|次数已用完/.test(t)) break;
  }
  console.log('生成完成:', generated);
  if (!generated) { await report('生成失败'); throw new Error('AI 生成未完成'); }

  console.log('>> 确认题目，下一步');
  await page.getByRole('button', { name: /确认题目，下一步/ }).first().click();
  await page.waitForTimeout(2000);
  await shot('11a-publish-settings');
  const settingsTxt = await page.locator('.ant-modal').first().innerText().catch(() => '');
  console.log('---- 发布设置 ----');
  console.log(settingsTxt.slice(0, 1500));

  // 确认发布
  const confirm = page.getByRole('button', { name: /确认发布作业|确认发布/ }).first();
  console.log('确认发布按钮:', await confirm.count());
  if (await confirm.count()) {
    await confirm.click();
    await page.waitForTimeout(6000);
    await shot('11b-published');
    const msg = await page.locator('.ant-message').innerText().catch(() => '(无)');
    console.log('提示:', msg.replace(/\n/g, ' | '));
  }
  await report('发布作业收尾');
  console.log('作业编号标记:', NUM);
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段11-异常');
} finally {
  await browser.close();
}
