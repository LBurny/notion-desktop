// topbar-relay 单测：动作转发/收藏回读/页面字体探测。relay 只依赖 ./topbar-actions（纯逻辑），
// wc/queryWc 用假实现，无需 electron 桩。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTopbarRelay } = require('../src/main/topbar-relay');
const { TOPBAR_ACTIONS } = require('../src/main/topbar-actions');

function makeWc({ favorite = true, font = 'Inter, sans-serif', url = 'https://www.notion.so/x' } = {}) {
  const log = [];
  return {
    log,
    favorite,
    font,
    _destroyed: false,
    isDestroyed() { return this._destroyed; },
    getURL() { return url; },
    send(ch, payload) { log.push([ch, payload]); },
  };
}

const FAST = { navDebounceMs: 30, favoriteSettleMs: 20, fontRetryBaseMs: 10 };

function setup(wc, opts = {}) {
  const states = [];
  const fonts = [];
  const relay = createTopbarRelay({
    queryWc: async (w, req) => (req === 'page-font-query' ? w.font : w.favorite),
    getActiveWc: () => wc,
    onTopbarState: (s) => states.push(s),
    onPageFont: (f) => fonts.push(f),
    ...FAST,
    ...opts,
  });
  return { relay, states, fonts };
}

test('topbarAction(favorite)：转发点击并在 Notion 落状态后回读收藏态', async () => {
  const wc = makeWc({ favorite: true });
  const { relay, states } = setup(wc);
  relay.topbarAction('favorite');
  assert.deepEqual(wc.log, [['topbar-click', TOPBAR_ACTIONS.favorite.selectors]]);
  await new Promise((r) => setTimeout(r, 50)); // favoriteSettleMs(20) 后回读
  assert.deepEqual(states, [{ available: true, favorited: true }]);
});

test('topbarAction 非 favorite 动作不回读', async () => {
  const wc = makeWc();
  const { relay, states } = setup(wc);
  relay.topbarAction('sidebar');
  assert.deepEqual(wc.log, [['topbar-click', TOPBAR_ACTIONS.sidebar.selectors]]);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(states, []);
});

test('无活动 wc：状态推送 available:false', async () => {
  const { relay, states } = setup(null);
  relay.schedulePush();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(states, [{ available: false, favorited: null }]);
});

test('schedulePush 防抖合并：连续 3 次只探测一回', async () => {
  const wc = makeWc({ favorite: false });
  const { relay, states } = setup(wc);
  relay.schedulePush();
  relay.schedulePush();
  relay.schedulePush();
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(states.length, 1);
});

test('pushNow 立即探测，不等防抖窗口', async () => {
  const wc = makeWc({ favorite: false });
  const { relay, states } = setup(wc);
  const t0 = Date.now();
  relay.pushNow();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(states.length, 1, `应即时出状态（耗时 ${Date.now() - t0}ms，防抖窗口 30ms）`);
  assert.deepEqual(states[0], { available: true, favorited: false });
});

test('探针非 boolean 时 favorited 归 null', async () => {
  const wc = makeWc({ favorite: null });
  const { relay, states } = setup(wc);
  relay.pushNow();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(states[0], { available: true, favorited: null });
});

test('probePageFont：采到字体即回调；空结果递远重试后放弃', async () => {
  const wc = makeWc({ font: 'LXGW, serif' });
  const { relay, fonts } = setup(wc);
  const rec = { view: { webContents: wc } };
  await relay.probePageFont(rec);
  assert.deepEqual(fonts, ['LXGW, serif']);

  // 空字体 + 未渲染：重试 4 次后放弃（base 10ms → 10+20+30+40）
  const empty = makeWc({ font: null });
  const fonts2 = [];
  const relay2 = createTopbarRelay({
    queryWc: async () => null,
    getActiveWc: () => empty,
    onTopbarState() {},
    onPageFont: (f) => fonts2.push(f),
    ...FAST,
  });
  const t0 = Date.now();
  await relay2.probePageFont({ view: { webContents: empty } });
  assert.deepEqual(fonts2, []);
  assert.ok(Date.now() - t0 >= 95, '应走完 4 次递远重试');
});

test('probePageFont：视图销毁/错误页不探测', async () => {
  const wc = makeWc();
  wc._destroyed = true;
  const { relay, fonts } = setup(wc);
  await relay.probePageFont({ view: { webContents: wc } });
  assert.deepEqual(fonts, []);
  const errWc = makeWc({ url: 'file:///error.html' });
  await relay.probePageFont({ view: { webContents: errWc } });
  assert.deepEqual(fonts, []);
});
