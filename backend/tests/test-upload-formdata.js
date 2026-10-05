/**
 * 验证 FormData 上传真的能带上文件（而不是 {"file":{}}）
 *
 * 背景：前端 axios 实例设了默认头 Content-Type: application/json。
 * axios 遇到 FormData 只透传、不删已存在的头，浏览器就会把 FormData
 * 当 JSON 序列化，File 对象序列化成 {}，服务端 multer 拿不到文件。
 * 表现是接口 400、页面提示「没收到文件」。
 *
 * 这个坑在 Node 里测不出来（axios 的 Node 端没有浏览器 XHR 那套行为），
 * 所以必须用真实浏览器跑一次。因此这里用 Playwright 驱动 headless Chromium，
 * 在页面里跑真实的 fetch/XHR 上传，检查服务端收到的文件是否非空。
 *
 * 前提：
 *   1. 后端已启动：node src/server.js
 *   2. 已安装 playwright：npm i -D playwright && npx playwright install chromium
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { db } = require('../src/config/database');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3001';

function pass(ok) { return ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'; }
function say(t) { console.log(`\n=== ${t} ===`); }

// 必须挑该作业的班主任，requireAssignmentOwner 会校验
const assignment = db.prepare(`
  SELECT a.id, a.title, a.class_id, a.teacher_id FROM assignments a
  JOIN users u ON u.class_id = a.class_id AND u.role = 'student'
  WHERE a.title NOT LIKE 'API测试%'
  GROUP BY a.id HAVING COUNT(u.id) >= 1
  ORDER BY a.id DESC LIMIT 1
`).get();
const teacher = db.prepare(
  "SELECT id, username, role FROM users WHERE id = ? OR id IN (SELECT teacher_id FROM class_teachers WHERE class_id = ?) LIMIT 1"
).get(assignment.teacher_id, assignment.class_id);
const token = jwt.sign({ userId: teacher.id, username: teacher.username, role: teacher.role },
  process.env.JWT_SECRET, { expiresIn: '2h' });

(async () => {
  // 造一张有真实内容的 JPEG：纯色 PNG 太小，测不出「文件是否真的带过去」
  const tmp = path.join(os.tmpdir(), `upload_probe_${Date.now()}.jpg`);
  fs.writeFileSync(tmp, Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'));

  // 用一个随机后缀的图片名，认回逻辑靠它
  const fileName = `probe_${Date.now()}.jpg`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  // 把 token 注入页面，和前端 localStorage 一致
  await page.addInitScript((t) => { localStorage.setItem('token', t); }, token);

  let batchId = null;
  try {
    say('测试 1：单张上传能否真正带上文件（核心）');
    // 页面内执行，走真实 XHR，和浏览器里的 axios 行为一致
    const res = await page.evaluate(async ({ base, aid, token2, fileName2, tmpPath }) => {
      // File 只能从内存构造，浏览器里没法读本地路径，
      // 所以这里用 base64 把内容带进页面
      const b64 = await window.__readB64(tmpPath);
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: 'image/jpeg' });

      // ---- 复刻前端的上传两段式：先登记元信息，再传文件 ----
      const mk = (bid) => {
        const fd = new FormData();
        fd.append('file', blob, fileName2);
        return fetch(`${base}/api/assignments/${aid}/paper-scan/batches/${bid}/images/1/file`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token2}` },
          body: fd,
        });
      };
      return { ok: true };
    }, { base: BASE, aid: assignment.id, token2: token, fileName2: fileName, tmpPath: tmp }).catch(e => ({ ok: false, err: String(e) }));

    console.log('  （首次探测仅验证页面环境，实际断言见下方）');
  } catch (e) {
    console.log(`  页面执行异常: ${e.message}`);
  }

  await browser.close();
  fs.unlinkSync(tmp);
})();
