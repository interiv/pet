// 探针：登录后打印页面上所有按钮/链接文本
import { launch, BASE } from './_helper.mjs';

const { browser, page } = await launch();
const user = process.argv[2] || 'admin';
const pwd = process.argv[3] || '111111';
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', user);
  await page.fill('input#login_password', pwd);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  console.log('URL:', page.url());
  const info = await page.evaluate(() => {
    const out = { buttons: [], links: [], text: document.body.innerText.slice(0, 3000) };
    document.querySelectorAll('button, a').forEach((el) => {
      const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (t) out.buttons.push(el.tagName + ':' + t);
    });
    out.buttons = [...new Set(out.buttons)];
    return out;
  });
  console.log(JSON.stringify(info.buttons, null, 1));
  console.log('---- BODY TEXT ----');
  console.log(info.text);
} catch (e) {
  console.error('异常:', e.message);
} finally {
  await browser.close();
}
