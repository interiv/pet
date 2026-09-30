// 课堂做题端到端：教师创建（题库选题）→ 列表出现 → 进入控制台 → 随机点名 → 记录一条学生作答
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
await page.setViewportSize({ width: 1920, height: 1080 });

const shot = (n) => page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/${n}.png`, fullPage: true });

async function loginStudentToken(username, password) {
  const api = await page.request.newContext();
  const res = await api.post(`${BASE.replace('5173', '3000')}/api/auth/login`, {
    data: { username, password },
  });
  const j = await res.json().catch(() => null);
  return j?.token || null;
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'demo_teacher1');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  reset();
  await page.getByRole('menuitem', { name: /课堂做题/ }).first().click();
  await page.waitForTimeout(2500);
  await shot('18a-classroom-list');
  console.log('课堂做题列表 OK, 表格行数 =', await page.locator('.ant-table-row').count());

  // 打开创建弹窗并做表单侦察
  await page.getByRole('button', { name: /创建课堂做题/ }).first().click();
  await page.waitForTimeout(1500);
  const formInfo = await page.evaluate(() => {
    const modal = document.querySelector('.ant-modal-content');
    if (!modal) return null;
    return {
      inputs: [...modal.querySelectorAll('input,textarea')].map((i) => `${i.tagName}#${i.id || '-'}[ph=${i.placeholder || '-'}]`),
      radioLabels: [...modal.querySelectorAll('.ant-radio-button-wrapper')].map((r) => r.innerText.trim()),
      buttons: [...modal.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean),
    };
  });
  console.log('创建弹窗表单:', JSON.stringify(formInfo, null, 1));
  await shot('18b-classroom-create');

  // 标题
  const titleInput = page.locator('.ant-modal-content input#title').first();
  await titleInput.click();
  await titleInput.fill('QA自动化测试-课堂做题');
  await page.waitForTimeout(400);

  // 班级与科目（必填，antd Select）
  for (const id of ['class_id', 'subject']) {
    const sel = page.locator(`.ant-modal-content #${id}`).first();
    await sel.click();
    await page.waitForTimeout(800);
    const opt = page.locator('.ant-select-dropdown:visible .ant-select-item-option').first();
    if (await opt.count()) { await opt.click(); await page.waitForTimeout(500); }
    else console.log(`!! ${id} 无下拉选项`);
  }

  // 题目来源 → 从题库选择
  const bankRadio = page.locator('.ant-modal-content .ant-radio-button-wrapper', { hasText: /从题库选择/ }).first();
  if (await bankRadio.count()) {
    await bankRadio.click();
    await page.waitForTimeout(1800);
  }
  // 勾选前 3 道题
  const boxes = page.locator('.ant-modal-content .ant-table-tbody .ant-checkbox-input');
  const n = Math.min(3, await boxes.count());
  console.log('题库可选行数 =', await boxes.count(), '，准备勾选', n);
  for (let i = 0; i < n; i++) await boxes.nth(i).click({ force: true });
  await page.waitForTimeout(600);
  await shot('18c-classroom-picked');

  // 提交（antd 会在两个中文字之间插空格："确 定"）
  const footerBtns = await page.locator('.ant-modal-footer button').all();
  console.log('弹窗底部按钮:', (await Promise.all(footerBtns.map((b) => b.innerText()))).join(' / '));
  let clicked = false;
  for (const b of footerBtns) {
    const t = (await b.innerText()).replace(/\s/g, '');
    if (t === '确定' || t === '保存' || t === '创建') { await b.click(); clicked = true; break; }
  }
  if (!clicked) console.log('!! 未找到弹窗提交按钮');
  await page.waitForTimeout(3500);
  await shot('18d-classroom-created');
  console.log('创建后列表行数 =', await page.locator('.ant-table-row').count());
  console.log('提示:', await page.locator('.ant-message').first().innerText().catch(() => '(无)'));
  await report('创建课堂做题');

  // 进入控制台
  await page.locator('.ant-table-tbody .ant-table-row', { hasText: /QA自动化测试/ }).first().locator('button', { hasText: /控制台|详情/ }).first().click().catch(async () => {
    await page.locator('tbody tr', { hasText: /QA自动化测试/ }).first().getByRole('button', { name: /控制台/ }).click();
  });
  await page.waitForTimeout(3500);
  await shot('18e-classroom-console');
  const consoleText = await page.locator('.ant-modal-content, body').last().innerText().catch(() => '');
  console.log('控制台文本摘要:', consoleText.slice(0, 300).replace(/\s+/g, ' '));

  // 随机点名
  await reset();
  const pickBtn = page.getByRole('button', { name: /随机点名/ }).first();
  if (await pickBtn.count()) {
    await pickBtn.click();
    await page.waitForTimeout(2500);
    await shot('18f-random-pick');
    console.log('随机点名弹窗:', (await page.locator('.ant-modal-content').last().innerText().catch(() => '(无)')).slice(0, 200).replace(/\s+/g, ' '));
  } else {
    console.log('!! 未找到随机点名按钮');
  }
  await page.keyboard.press('Escape');
  await report('课堂控制台');

  // 用 API 写入一条学生作答，验证答案落库链路
  const token = await loginStudentToken('demo_teacher1', '111111');
  if (token) {
    const api = await page.request.newContext();
    const created = await api.get(`${BASE.replace('5173', '3000')}/api/classroom-quiz?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await created.json().catch(() => ({}));
    const q = (j.quizzes || []).find((x) => String(x.title || '').includes('QA自动化测试'));
    console.log('通过 API 找到测试课堂做题 id =', q?.id, '题目数 =', q?.question_count);
    if (q?.id) {
      const st = await api.get(`${BASE.replace('5173', '3000')}/api/classroom-quiz/students/${q.class_id}`, { headers: { Authorization: `Bearer ${token}` } });
      const sd = await st.json().catch(() => ({}));
      const student = (sd.students || sd || [])[0];
      const det = await api.get(`${BASE.replace('5173', '3000')}/api/classroom-quiz/${q.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const dj = await det.json().catch(() => ({}));
      const firstQ = (dj.questions || [])[0];
      console.log('首个学生 =', student?.username || student?.real_name, '首题 id =', firstQ?.id);
      if (firstQ?.id) {
        const ans = await api.post(`${BASE.replace('5173', '3000')}/api/classroom-quiz/${q.id}/answers`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { question_id: firstQ.id, student_id: student?.id, answer_text: 'x = 2' },
        });
        console.log('写入作答状态 =', ans.status(), JSON.stringify(await ans.json().catch(() => null)).slice(0, 300));
      }
    }
  }
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('s18-异常');
} finally {
  await browser.close();
}
