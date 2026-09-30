// 管理后台全量回归：逐页签采集控制台错误 + 内容健康检查（空表格 / Invalid Date / NaN / undefined）
import { launch, report, reset, BASE } from './_helper.mjs';

const { browser, page } = await launch();
// 加宽视口，尽量减少 antd Tabs 溢出折叠
await page.setViewportSize({ width: 1920, height: 1080 });

const TABS = ['总览', '教师管理', '学生管理', '班级管理', '学校管理', '申请审批', '公告管理',
  '数据查看', '网站设置', 'AI设置', 'Token看板', '成就管理', '清理数据', '系统数据'];

// 脏渲染关键字：之前踩过的坑（Invalid Date / 越界分数 / classId undefined）
const DIRTY = ['Invalid Date', 'NaN', 'undefined', '[object Object]'];

// 点击页签：可见的直接点；被折叠到「更多」下拉里的，先展开下拉再点
async function clickTab(label) {
  const re = new RegExp(`^\\s*${label}\\s*$`);
  const direct = page.locator('.ant-tabs-nav-list .ant-tabs-tab', { hasText: re }).first();
  if (await direct.count()) {
    if (await direct.isVisible().catch(() => false)) {
      await direct.click();
      return 'direct';
    }
  }
  const more = page.locator('.ant-tabs-nav-more').first();
  if (await more.count() && await more.isVisible().catch(() => false)) {
    await more.click();
    await page.waitForTimeout(500);
    const item = page.locator('.ant-tabs-dropdown-menu-item', { hasText: re }).first();
    if (await item.count()) {
      await item.click();
      await page.waitForTimeout(300);
      return 'dropdown';
    }
    await page.keyboard.press('Escape');
  }
  return 'notfound';
}

async function panelStats() {
  return await page.evaluate(() => {
    const panes = [...document.querySelectorAll('.ant-tabs-tabpane-active')];
    const p = panes[panes.length - 1] || document.body;
    const text = (p.innerText || '').trim();
    return {
      chars: text.length,
      rows: p.querySelectorAll('.ant-table-row').length,
      cards: p.querySelectorAll('.ant-statistic').length,
      hasEmpty: !!p.querySelector('.ant-empty'),
      head: text.slice(0, 160).replace(/\s+/g, ' '),
    };
  });
}

function dirtyHits(text) {
  return DIRTY.filter((d) => text.includes(d));
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input#login_username', 'admin');
  await page.fill('input#login_password', '111111');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);

  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByRole('menuitem', { name: /管理后台/ }).first().click();
  await page.waitForTimeout(3000);
  console.log('管理后台 URL:', page.url());

  const summary = [];

  for (const tab of TABS) {
    reset();
    const how = await clickTab(tab);
    if (how === 'notfound') {
      console.log(`\n>> ${tab}: !! 未找到页签`);
      continue;
    }
    await page.waitForTimeout(2600);

    // 确认页签真的切换过去了（防止点了个寂寞却把上一页内容当成本页结果）
    const activeTab = await page.evaluate(() => {
      const el = document.querySelector('.ant-tabs-nav-list .ant-tabs-tab-active');
      return el ? el.innerText.trim() : null;
    });
    const switched = !!activeTab && activeTab.replace(/\s/g, '').includes(tab.replace(/\s/g, ''));

    const st = await panelStats();
    const dirty = dirtyHits(st.head);
    const errs = await report(`页签-${tab}`);

    const flags = [];
    if (!switched) flags.push(`未切换(当前=${activeTab})`);
    if (errs.length) flags.push(`控制台${errs.length}条`);
    if (st.hasEmpty) flags.push('空状态');
    if (st.rows === 0) flags.push('表格0行');
    if (dirty.length) flags.push(`脏渲染:${dirty.join(',')}`);

    summary.push({ tab, ...st, errs: errs.length, flags });
    console.log(`>> ${tab} [${how}] 选中=${activeTab} 字符${st.chars} 表格${st.rows}行 卡片${st.cards}个 ${flags.length ? '⚠ ' + flags.join(' | ') : 'OK'}`);
    await page.screenshot({ path: `d:/参赛用/2026-创AI/pet/scripts/e2e/shots/adm-${tab}.png`, fullPage: true });

    // 展开二级页签（如存在）
    await reset();
    const nested = await page.evaluate(() => {
      const panes = [...document.querySelectorAll('.ant-tabs-tabpane-active')];
      const p = panes[panes.length - 1];
      if (!p) return [];
      return [...p.querySelectorAll('.ant-tabs-tab')].map((e) => e.innerText.trim()).filter(Boolean);
    });
    for (const n of nested) {
      const loc = page.locator('.ant-tabs-tabpane-active .ant-tabs-tab', { hasText: n }).first();
      if (!(await loc.count())) continue;
      await loc.click();
      await page.waitForTimeout(1800);
      const nst = await panelStats();
      const ndirty = dirtyHits(nst.head);
      const nerrs = await report(`二级-${tab}/${n}`);
      const nf = [];
      if (nerrs.length) nf.push(`控制台${nerrs.length}条`);
      if (nst.hasEmpty) nf.push('空状态');
      if (ndirty.length) nf.push(`脏渲染:${ndirty.join(',')}`);
      summary.push({ tab: `${tab} > ${n}`, ...nst, errs: nerrs.length, flags: nf });
      console.log(`   - ${tab} > ${n}: 字符${nst.chars} 表格${nst.rows}行 ${nf.length ? '⚠ ' + nf.join(' | ') : 'OK'}`);
      await reset();
    }
  }

  console.log('\n================ 管理后台页签健康汇总 ================');
  const bad = summary.filter((s) => s.flags.length);
  console.log(`共检查 ${summary.length} 个页面，其中 ${bad.length} 个存在问题：`);
  for (const s of bad) {
    console.log(`  ✗ ${s.tab}  → ${s.flags.join(' | ')}`);
    if (s.head) console.log(`      面板摘要: ${s.head.slice(0, 120)}`);
  }
  const ok = summary.filter((s) => !s.flags.length);
  console.log(`\n正常页面 ${ok.length} 个: ${ok.map((s) => s.tab).join('、')}`);
} catch (e) {
  console.error('脚本异常:', e.message);
  await report('admin-full-异常');
} finally {
  await browser.close();
}
