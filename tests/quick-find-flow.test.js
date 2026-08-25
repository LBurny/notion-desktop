// quick-find-flow 单测：待命状态机 + Escape 后探针轮询提速。
// flow 只依赖 ./quick-find（纯逻辑），无需 electron 桩；wc/queryWc 用假实现。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuickFindFlow } = require('../src/main/quick-find-flow');

// states：数组按序应答（用尽后重复最后一项）；probeNull:true 时探针恒 null（页面未就绪）
function makeWc({ states = [{ open: true, anyDialog: true }], probeNull = false, url = 'https://www.notion.so/Page1' } = {}) {
  const log = [];
  let i = 0;
  return {
    log,
    navigationHistory: {
      canGoBack: () => true,
      goBack() { log.push('goBack'); },
    },
    _destroyed: false,
    isDestroyed() { return this._destroyed; },
    getURL() { return url; },
    focus() {},
    send(ch, payload) { if (ch === 'quick-find-arm') log.push(`arm:${payload}`); },
    sendInputEvent(ev) { if (ev.type === 'keyDown') log.push(`input:${ev.keyCode}`); },
    nextState() {
      if (probeNull) return null;
      const st = states[Math.min(i, states.length - 1)];
      i++;
      return st;
    },
  };
}

const FAST = { pollMs: 5, escapeMaxWaitMs: 120, fallbackWaitMs: 40, armTimeoutMs: 10000, dismissGraceMs: 50 };

function setup(wc, { newTabImpl, ...opts } = {}) {
  const rec = { id: 't1', view: { webContents: wc } };
  const tabs = [];
  const flow = createQuickFindFlow({
    queryWc: async (wcArg) => wcArg.nextState(),
    newTab: (url, o) => { tabs.push({ url, o }); return 'new-id'; },
    homeUrl: 'https://www.notion.so/',
    getActiveRec: () => rec,
    findByWebContents: (w) => (w === wc ? rec : null),
    retryDelays: [],
    ...FAST,
    ...opts,
  });
  return { flow, rec, tabs };
}

test('picked：同 tick 只注入 Escape；探针报已关闭即开新标签（快于旧 150ms 固定等待）', async () => {
  const wc = makeWc({ states: [{ open: false, anyDialog: false }] });
  const { flow, tabs } = setup(wc);
  flow.newTabInteractive(); // 进入待命
  wc.log.length = 0;

  const t0 = Date.now();
  const p = flow.picked(wc, '/Page-x');
  // 同 tick 只允许注入 Escape 这一个按键（arm:false 是 IPC 消息，不在此不变量内）
  assert.deepEqual(
    wc.log.filter((x) => x.startsWith('input:')),
    ['input:Escape'],
    '同 tick 只允许注入 Escape',
  );
  await p;
  const elapsed = Date.now() - t0;
  assert.deepEqual(tabs.map((t) => t.url), ['https://www.notion.so/Page-x']);
  assert.ok(elapsed < 120, `探针命中应立即开标签，实际 ${elapsed}ms`);
});

test('picked：探针不通（页面未就绪）退回固定节奏兜底', async () => {
  const wc = makeWc({ probeNull: true });
  const { flow, tabs } = setup(wc);
  flow.newTabInteractive();
  const t0 = Date.now();
  await flow.picked(wc, '/Page-x');
  const elapsed = Date.now() - t0;
  assert.equal(tabs.length, 1);
  assert.ok(elapsed >= 35, `探针不通至少等原节奏（40ms 兜底），实际 ${elapsed}ms`);
  assert.ok(elapsed < 300, `兜底不应拖长，实际 ${elapsed}ms`);
});

test('picked：探针一直报 open 也不死等，超时仍开新标签', async () => {
  const wc = makeWc({ states: [{ open: true, anyDialog: true }] });
  const { flow, tabs } = setup(wc);
  flow.newTabInteractive();
  const t0 = Date.now();
  await flow.picked(wc, '/Page-x');
  const elapsed = Date.now() - t0;
  assert.equal(tabs.length, 1);
  assert.ok(elapsed >= 110, `超时应到 escapeMaxWaitMs(120)，实际 ${elapsed}ms`);
});

test('非待命/非法 href 的 picked 直接忽略', async () => {
  const wc = makeWc();
  const { flow, tabs } = setup(wc);
  await flow.picked(wc, '/Page-x'); // 未待命
  flow.newTabInteractive();
  await flow.picked(wc, 'https://evil.com/x'); // 非法
  assert.equal(tabs.length, 0);
});

test('trigger：dismissFirst 且有阻挡浮层 → Escape 后等浮层消失再注入 Ctrl+K', async () => {
  const wc = makeWc({
    states: [
      { open: false, anyDialog: true },  // trigger 首轮查询：推广条挡着
      { open: false, anyDialog: false }, // waitOverlay 首轮：已消失
    ],
  });
  const { flow, rec } = setup(wc, { retryDelays: [0] });
  flow.trigger(rec.view, { dismissFirst: true });
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(wc.log, ['input:Escape', 'input:k']);
});

test('trigger：无浮层时跳过 Escape 直接注入 Ctrl+K', async () => {
  const wc = makeWc({ states: [{ open: false, anyDialog: false }] });
  const { flow, rec } = setup(wc, { retryDelays: [0] });
  flow.trigger(rec.view, { dismissFirst: true });
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(wc.log, ['input:k']);
});

test('待命闸口：picked 解除待命后，等待中的重试轮次不再注入 Ctrl+K', async () => {
  const wc = makeWc({ states: [{ open: false, anyDialog: true }] }); // anyDialog 恒真：waitOverlay 等待中
  const { flow, rec } = setup(wc, { retryDelays: [0, 40, 80] });
  flow.newTabInteractive();
  await new Promise((r) => setTimeout(r, 20)); // 第 0 轮已进入 Escape→waitOverlay
  await flow.picked(wc, '/Page-x'); // 解除待命（waitOverlay 仍在轮询 anyDialog）
  await new Promise((r) => setTimeout(r, 300)); // 越过全部轮次与 waitOverlay 超时
  const kCount = wc.log.filter((x) => x === 'input:k').length;
  assert.equal(kCount, 0, `待命解除后不应注入 Ctrl+K，实际: ${wc.log.join(',')}`);
});

test('handleNav：待命页自跳转 → 回退 + 新标签；非待命不消费', () => {
  const wc = makeWc();
  const { flow, rec, tabs } = setup(wc);
  assert.equal(flow.handleNav(rec, 'https://www.notion.so/X', wc), false);
  flow.newTabInteractive();
  assert.equal(flow.handleNav(rec, 'https://www.notion.so/Y', wc), true);
  assert.deepEqual(wc.log.filter((x) => x === 'goBack'), ['goBack']);
  assert.deepEqual(tabs.map((t) => t.url), ['https://www.notion.so/Y']);
  assert.equal(flow.isArmedFor(rec), false, '跳转消费后待命解除');
});

test('dismissed：宽限期内忽略，宽限期后解除待命', async () => {
  const wc = makeWc();
  const { flow, rec } = setup(wc);
  flow.newTabInteractive();
  flow.dismissed(wc); // armedAt 宽限（50ms）内
  assert.equal(flow.isArmedFor(rec), true);
  await new Promise((r) => setTimeout(r, 70));
  flow.dismissed(wc);
  assert.equal(flow.isArmedFor(rec), false);
});

test('onActiveChanged：待命标签被切走解除待命；切回自己不动', () => {
  const wc = makeWc();
  const { flow, rec } = setup(wc);
  flow.newTabInteractive();
  flow.onActiveChanged(rec);
  assert.equal(flow.isArmedFor(rec), true);
  flow.onActiveChanged({ id: 't2' });
  assert.equal(flow.isArmedFor(rec), false);
});

test('newTabInteractive：当前页不可搜索（file://）退回先开首页标签', () => {
  const wc = makeWc({ url: 'file:///error.html' });
  const { flow, tabs } = setup(wc);
  const r = flow.newTabInteractive();
  assert.equal(r, 'new-id');
  assert.deepEqual(tabs, [{ url: 'https://www.notion.so/', o: { search: true } }]);
  assert.deepEqual(wc.log, [], '不可搜索页面不应收到 arm');
});

test('newTabInteractive：正常页面进入待命并触发唤起', () => {
  const wc = makeWc();
  const { flow, rec } = setup(wc);
  const r = flow.newTabInteractive();
  assert.equal(r, null);
  assert.equal(flow.isArmedFor(rec), true);
  assert.deepEqual(wc.log, ['arm:true']);
});
