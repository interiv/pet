// 阶段十：教师实际发布一次 AI 作业（题目数 3，限制 token 消耗）
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const shot = (n) => page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/${n}.png`, fullPage: true });

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_teacher1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);

  reset();
  await page.getByRole('menuitem', { name: /教学管理/ }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: '发布新作业' }).first().click();
  await page.waitForTimeout(2000);
  await shot('10a-publish-modal');

  // 科目
  await page.locator('#subject').click();
  await page.waitForTimeout(600);
  await page.locator('.ant-select-item-option', { hasText: '数学' }).first().click();
  await page.waitForTimeout(500);
  // 题型
  await page.locator('#question_type').click();
  await page.waitForTimeout(600);
  await page.locator('.ant-select-item-option', { hasText: '单选题' }).first().click();
  await page.waitForTimeout(500);
  // 知识点
  await page.locator('#topic').fill('一元二次方程求根');
  // 数量
  await page.locator('#count').fill('3');
  await page.waitForTimeout(300);
  await shot('10b-publish-filled');

  console.log('>> 点击 AI 生成（预计 1-3 分钟）');
  await page.getByRole('button', { name: /AI生成题目|AI正在处理中/ }).first().click();

  // 等待生成完成（最多 4 分钟）
  let done = false;
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(3000);
    const txt = await page.locator('.ant-modal').first().innerText().catch(() => '');
    if (/题目预览|预览|共\d+道主题/.test(txt) && !/AI正在处理中/.test(txt)) { done = true; break; }
    if (/失败|错误|次数已用完|生成失败/.test(txt)) { done = true; break; }
    if (i % 5 === 0) console.log(`  等待中... ${(i + 1) * 3}s`);
  }
  console.log('生成结束, done =', done);
  await shot('10c-publish-generated');
  const modalTxt = await page.locator('.ant-modal').first().innerText().catch(() => '(无弹窗)');
  console.log('---- 弹窗文本 ----');
  console.log(modalTxt.slice(0, 2500));
  await report('教师发布作业');
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('阶段10-异常');
} finally {
  await browser.close();
}
