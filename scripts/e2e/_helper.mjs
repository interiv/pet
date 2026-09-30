// 临时 E2E 脚本：真实浏览器操作 + 控制台/网络错误采集
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\inter\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const BASE = 'http://localhost:5173';

const logs = [];
const errors = [];

export async function launch() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await hook(page);
  return { browser, context, page };
}

// 公告浮层是 position:fixed 的右下角卡片（zIndex 1000），会遮挡群聊输入框/发送按钮、
// 作业提交按钮等位于右下角的控件，导致点击超时。所有脚本统一在页面加载后自动点「×」关闭。
const NOTICE_KILLER = () => {
  const isFixed = (el) => {
    let cur = el;
    while (cur && cur !== document.body) {
      if (window.getComputedStyle(cur).position === 'fixed') return true;
      cur = cur.parentElement;
    }
    return false;
  };
  const closeNotices = () => {
    for (const span of document.querySelectorAll('span')) {
      if (span.textContent.trim() !== '×') continue;
      if (span.dataset.qaNoticeClosed) continue;
      const box = span.closest('div');
      if (!box || !isFixed(box)) continue;
      if (!/公告|📢/.test(box.textContent || '')) continue;
      span.dataset.qaNoticeClosed = '1';
      span.click();
    }
  };
  const start = () => {
    closeNotices();
    try {
      new MutationObserver(closeNotices).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* documentElement 尚未就绪时可忽略，load 事件会再兜一次 */ }
  };
  // addInitScript 可能在 documentElement 存在之前执行，这里两种情况都覆盖
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
};

// 供自行创建 context 的脚本调用
export async function installNoticeKiller(page) {
  await page.addInitScript(NOTICE_KILLER);
  await page.evaluate(NOTICE_KILLER).catch(() => {});
}

// 手动调用：立即关闭当前页面上的公告浮层，返回关闭数量
export async function dismissNotices(page) {
  return await page.evaluate(() => {
    const isFixed = (el) => {
      let cur = el;
      while (cur && cur !== document.body) {
        if (window.getComputedStyle(cur).position === 'fixed') return true;
        cur = cur.parentElement;
      }
      return false;
    };
    let n = 0;
    for (const span of document.querySelectorAll('span')) {
      if (span.textContent.trim() !== '×') continue;
      const box = span.closest('div');
      if (!box || !isFixed(box)) continue;
      if (!/公告|📢/.test(box.textContent || '')) continue;
      span.click();
      n++;
    }
    return n;
  }).catch(() => 0);
}

export async function hook(page) {
  // 每个页面（含后续跳转）都注入公告关闭逻辑
  await page.addInitScript(NOTICE_KILLER).catch(() => {});
  // 公告是接口返回后才渲染的，load/domcontentloaded 后再兜一次
  page.on('domcontentloaded', () => { page.evaluate(NOTICE_KILLER).catch(() => {}); });
  page.on('load', () => { page.evaluate(NOTICE_KILLER).catch(() => {}); });
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    logs.push(`[console.${type}] ${text}`);
    if (type === 'error' || type === 'warning') {
      errors.push(`[console.${type}] ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}\n${(err.stack || '').split('\n').slice(0, 6).join('\n')}`);
  });
  page.on('requestfailed', (req) => {
    const f = req.failure();
    errors.push(`[requestfailed] ${req.method()} ${req.url()} :: ${f ? f.errorText : ''}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      errors.push(`[http ${res.status()}] ${res.request().method()} ${res.url()}`);
    }
  });
}

export async function report(tag) {
  const uniq = [...new Set(errors)];
  console.log(`\n===== 错误汇总 (${tag}) 共 ${uniq.length} 条 =====`);
  uniq.forEach((e) => console.log(e));
  console.log(`===== END (${tag}) =====\n`);
  return uniq;
}

export function reset() {
  errors.length = 0;
  logs.length = 0;
}

export { BASE };
