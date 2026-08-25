const test = require('node:test');
const assert = require('node:assert');
const {
  TOPBAR_ACTIONS, pickTopbarButton, sidebarStateOf, createSidebarToggleRunner,
  favoriteStateOf, quickFindStateOf, uiFontOf, UI_FONT_SELECTORS,
} = require('../src/main/topbar-actions');

// 极简 DOM stub：按选择器表命中预设元素
function stubDoc(map) {
  return { querySelector: (sel) => map[sel] || null };
}

// 模拟 Notion 侧栏：x=-250 收起 / 0 展开；开/收按钮随状态此消彼长，且可懒挂载
function stubSidebarPage({ x = -250, openMounted = true, closeMounted = true } = {}) {
  const page = {
    x, openMounted, closeMounted, openClicks: 0, closeClicks: 0,
    openEl: null, closeEl: null,
  };
  page.openEl = { click() { page.openClicks++; page.x = 0; page.openMounted = false; page.closeMounted = true; } };
  page.closeEl = { click() { page.closeClicks++; page.x = -250; page.closeMounted = false; page.openMounted = true; } };
  const root = {
    querySelector: (sel) => {
      if (sel === '.notion-sidebar') return { getBoundingClientRect: () => ({ x: page.x }) };
      if (sel === '.notion-open-sidebar') return page.openMounted ? page.openEl : null;
      if (sel.includes('Close sidebar')) return page.closeMounted ? page.closeEl : null;
      return null;
    },
  };
  return { page, root };
}

test('四个动作都有非空选择器表', () => {
  for (const k of ['sidebar', 'share', 'favorite', 'more']) {
    assert.ok(Array.isArray(TOPBAR_ACTIONS[k].selectors) && TOPBAR_ACTIONS[k].selectors.length > 0, k);
  }
});

test('pickTopbarButton 按优先级返回第一个命中', () => {
  const a = {}, b = {};
  assert.strictEqual(pickTopbarButton(stubDoc({ '.b': b }), ['.a', '.b']), b);
  assert.strictEqual(pickTopbarButton(stubDoc({ '.a': a, '.b': b }), ['.a', '.b']), a);
  assert.strictEqual(pickTopbarButton(stubDoc({}), ['.a']), null);
});

test('sidebar 动作是开关：开态下有收起按钮可点（选择器表含 Close sidebar）', () => {
  const closeSel = TOPBAR_ACTIONS.sidebar.selectors.find((s) => s.includes('Close sidebar'));
  assert.ok(closeSel, 'sidebar 选择器表缺少收起按钮');
});

test('sidebar 配置拆分 open/close 选择器组，selectors 保持并集兼容', () => {
  const cfg = TOPBAR_ACTIONS.sidebar;
  assert.ok(Array.isArray(cfg.openSelectors) && cfg.openSelectors.length > 0, '缺 openSelectors');
  assert.ok(Array.isArray(cfg.closeSelectors) && cfg.closeSelectors.length > 0, '缺 closeSelectors');
  assert.deepStrictEqual(cfg.selectors, [...cfg.openSelectors, ...cfg.closeSelectors]);
  assert.ok(cfg.toggle, 'sidebar 应标记为状态感知开关');
});

test('sidebarStateOf：x=0 开 / x=-250 收 / 元素缺失 null', () => {
  assert.strictEqual(sidebarStateOf(stubSidebarPage({ x: 0 }).root), 'open');
  assert.strictEqual(sidebarStateOf(stubSidebarPage({ x: -250 }).root), 'closed');
  assert.strictEqual(sidebarStateOf(stubDoc({})), null);
});

test('toggleRunner：收起态点击开钮，翻转即停', async () => {
  const { page, root } = stubSidebarPage({ x: -250 });
  const toggle = createSidebarToggleRunner({
    pickTopbarButton, sidebarStateOf, getRoot: () => root, sleep: () => Promise.resolve(),
  });
  await toggle(TOPBAR_ACTIONS.sidebar);
  assert.equal(page.x, 0);
  assert.equal(page.openClicks, 1);
  assert.equal(page.closeClicks, 0);
});

test('toggleRunner：展开态点击收钮', async () => {
  const { page, root } = stubSidebarPage({ x: 0 });
  const toggle = createSidebarToggleRunner({
    pickTopbarButton, sidebarStateOf, getRoot: () => root, sleep: () => Promise.resolve(),
  });
  await toggle(TOPBAR_ACTIONS.sidebar);
  assert.equal(page.x, -250);
  assert.equal(page.closeClicks, 1);
  assert.equal(page.openClicks, 0);
});

test('toggleRunner：按钮懒挂载时重试直到挂载后生效（☰ 收不回去的根因回归）', async () => {
  const { page, root } = stubSidebarPage({ x: 0, closeMounted: false }); // 开态但收钮未挂载
  let sleeps = 0;
  const sleep = () => {
    sleeps++;
    if (sleeps === 3) page.closeMounted = true; // 第 3 次等待后按钮才挂载
    return Promise.resolve();
  };
  const toggle = createSidebarToggleRunner({
    pickTopbarButton, sidebarStateOf, getRoot: () => root, sleep,
  });
  await toggle(TOPBAR_ACTIONS.sidebar);
  assert.equal(page.x, -250, '按钮挂载后应能收起');
  assert.ok(sleeps >= 3, '应重试过若干次');
  assert.equal(page.closeClicks, 1, '挂载后只点一次');
});

test('toggleRunner：按钮始终不挂载时有限次放弃，不无限重试', async () => {
  const { page, root } = stubSidebarPage({ x: -250, openMounted: false });
  const toggle = createSidebarToggleRunner({
    pickTopbarButton, sidebarStateOf, getRoot: () => root, sleep: () => Promise.resolve(), maxAttempts: 4,
  });
  await toggle(TOPBAR_ACTIONS.sidebar);
  assert.equal(page.x, -250);
  assert.equal(page.openClicks, 0, '按钮不存在，一次也没点成');
});

test('toggleRunner：新一次点击作废旧重试循环（gen 闸口）', async () => {
  const { page, root } = stubSidebarPage({ x: -250 });
  page.openEl.click = () => { page.openClicks++; }; // 点击落空（模拟挂载但无响应窗口期）
  const gates = [];
  const sleep = () => new Promise((r) => gates.push(r));
  const toggle = createSidebarToggleRunner({
    pickTopbarButton, sidebarStateOf, getRoot: () => root, sleep, maxAttempts: 3,
  });
  const t1 = toggle(TOPBAR_ACTIONS.sidebar); // 同步点第 1 次后挂在 sleep
  const t2 = toggle(TOPBAR_ACTIONS.sidebar); // gen 递增，旧循环应作废
  assert.equal(page.openClicks, 2, '两次按下各点一次');
  // 逐轮放行：resolve 的续体在微任务里又推新一轮 gate，直到新循环跑满 maxAttempts
  for (let i = 0; i < 50 && gates.length; i++) {
    while (gates.length) gates.shift()();
    await Promise.resolve();
  }
  await Promise.all([t1, t2]);
  // 旧循环作废不再点；新循环点满 maxAttempts=3 次（首次 + 2 次重试）后放弃
  assert.equal(page.openClicks, 1 + 3);
});

test('favoriteStateOf 按 svg.starFill/star 判态，按钮缺失返回 null', () => {
  const favBtn = (svgCls) => ({
    querySelector: (sel) => (sel === 'svg.starFill' && svgCls === 'starFill') || (sel === 'svg.star' && svgCls === 'star') ? {} : null,
  });
  const key = TOPBAR_ACTIONS.favorite.selectors[0];
  assert.strictEqual(favoriteStateOf(stubDoc({ [key]: favBtn('starFill') }), TOPBAR_ACTIONS.favorite.selectors), true);
  assert.strictEqual(favoriteStateOf(stubDoc({ [key]: favBtn('star') }), TOPBAR_ACTIONS.favorite.selectors), false);
  assert.strictEqual(favoriteStateOf(stubDoc({ [key]: favBtn('other') }), TOPBAR_ACTIONS.favorite.selectors), null);
  assert.strictEqual(favoriteStateOf(stubDoc({}), TOPBAR_ACTIONS.favorite.selectors), null);
});

test('quickFindStateOf：带输入框的浮层才算 Quick Find 打开', () => {
  const both = stubDoc({ '[role="dialog"] input': {}, '[role="dialog"]': {} });
  assert.deepStrictEqual(quickFindStateOf(both), { open: true, anyDialog: true });
  // 推广条也是 role=dialog 但没有 input：算有浮层、不算已开
  const promo = { querySelector: (sel) => (sel === '[role="dialog"]' ? {} : null) };
  assert.deepStrictEqual(quickFindStateOf(promo), { open: false, anyDialog: true });
  assert.deepStrictEqual(quickFindStateOf(stubDoc({})), { open: false, anyDialog: false });
});

test('uiFontOf 返回 .notion-sidebar 的计算字体（标题栏跟随界面字体）', () => {
  const el = {};
  const gcs = (e) => ({ fontFamily: e === el ? '"思源宋体 CN", serif' : 'should-not-use' });
  assert.strictEqual(uiFontOf(stubDoc({ '.notion-sidebar': el }), gcs), '"思源宋体 CN", serif');
});

test('uiFontOf 首选元素缺失时按 UI_FONT_SELECTORS 顺序回退（顶栏/面包屑）', () => {
  const el = {};
  const fallbackSel = UI_FONT_SELECTORS[1];
  const gcs = (e) => ({ fontFamily: e === el ? '"X", serif' : '' });
  assert.strictEqual(uiFontOf(stubDoc({ [fallbackSel]: el }), gcs), '"X", serif');
});

test('uiFontOf 页面未就绪或字体为空时返回 null', () => {
  assert.strictEqual(uiFontOf(stubDoc({}), () => ({ fontFamily: 'x' })), null);
  const el = {};
  assert.strictEqual(uiFontOf(stubDoc({ [UI_FONT_SELECTORS[0]]: el }), () => ({ fontFamily: '' })), null);
  assert.strictEqual(uiFontOf(stubDoc({ [UI_FONT_SELECTORS[0]]: el }), () => ({ fontFamily: '   ' })), null);
});
