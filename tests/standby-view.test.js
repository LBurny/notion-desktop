// 预热视图状态机单测：创建/就绪/认领/重建/主题/CSS 同步/销毁。
// 沿用 tabs-view.test.js 的 electron 桩模式（Module.require 拦截 WebContentsView）。
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function setup({ theme = 'dark' } = {}) {
  const created = [];
  class Wc {
    constructor() { this._url = 'https://www.notion.so/'; this._k = 0; this._loads = 0; }
    loadURL(u) { this._url = u; this._loads++; }
    on(ev, fn) { if (ev === 'did-finish-load') this._finish = fn; if (ev === 'dom-ready') this._dom = fn; }
    once() {}
    send() {}
    insertCSS() { return Promise.resolve('k' + ++this._k); }
    removeInsertedCSS() { return Promise.resolve(); }
    setBackgroundColor() {}
    isDestroyed() { return false; }
    getURL() { return this._url; }
    close() {}
  }
  class WebContentsView {
    constructor(opts) { this.opts = opts; created.push(this); this.webContents = new Wc(); this.bg = []; }
    setBackgroundColor(c) { this.bg.push(c); }
  }
  const electronStub = { WebContentsView };
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) { if (id === 'electron') return electronStub; return orig.apply(this, arguments); };
  try {
    delete require.cache[require.resolve('../src/main/standby-view')];
    const { createStandbyView } = orig.call(module, '../src/main/standby-view');
    const sb = createStandbyView({
      partition: 'persist:test', preloadPath: 'p.js',
      homeUrl: 'https://www.notion.so/',
      getCss: () => 'css', getTheme: () => theme,
    });
    return { sb, created };
  } finally { Module.prototype.require = orig; }
}

test('warm：建视图 + 主题底色 + 加载首页 + dom-ready 注入 CSS', async () => {
  const { sb, created } = setup({ theme: 'dark' });
  assert.equal(sb.isWarming(), false);
  sb.warm();
  assert.equal(sb.isWarming(), true);
  assert.equal(created.length, 1);
  assert.equal(created[0].opts.webPreferences.backgroundThrottling, false);
  assert.equal(created[0].opts.webPreferences.partition, 'persist:test');
  assert.equal(created[0].opts.webPreferences.preload, 'p.js');
  assert.deepEqual(created[0].bg, ['#191919']); // dark 底色
  const wc = created[0].webContents;
  assert.equal(wc._url, 'https://www.notion.so/');
  assert.equal(wc._loads, 1);
  wc._dom(); // dom-ready 触发 insertCSS（异步）
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.isReady(), false, 'did-finish-load 未触发前不算就绪');
});

test('did-finish-load 后 ready；claim 返回 view+cssKey 并清空；再次 claim 返回 null', async () => {
  const { sb, created } = setup();
  sb.warm();
  const wc = created[0].webContents;
  wc._dom(); wc._finish();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.isReady(), true);
  const got = sb.claim();
  assert.ok(got && got.view, '应返回认领的视图');
  assert.equal(typeof got.cssKey, 'string');
  assert.equal(sb.isReady(), false);
  assert.equal(sb.claim(), null, '认领后再 claim 应为 null');
});

test('未就绪 claim 返回 null（用户极快）', () => {
  const { sb } = setup();
  sb.warm();
  assert.equal(sb.claim(), null);
});

test('warm 幂等：已加温/已就绪时 no-op', () => {
  const { sb, created } = setup();
  sb.warm(); assert.equal(created.length, 1);
  sb.warm(); assert.equal(created.length, 1, '加温中再 warm 不重建');
});

test('rewarm 幂等：无视图时重建，有视图/加温中 no-op', async () => {
  const { sb, created } = setup();
  sb.rewarm(); assert.equal(created.length, 1);
  sb.rewarm(); assert.equal(created.length, 1, '加温中 rewarm no-op');
  created[0].webContents._dom(); created[0].webContents._finish();
  await new Promise((r) => setTimeout(r, 10));
  sb.claim();
  created.length = 0;
  sb.rewarm(); assert.equal(created.length, 1, '认领后 rewarm 重建');
});

test('setTheme / reinjectCss 同步当前视图', async () => {
  const { sb, created } = setup({ theme: 'dark' });
  sb.warm();
  sb.setTheme('light');
  assert.deepEqual(created[0].bg, ['#191919', '#ffffff']);
  const wc = created[0].webContents;
  wc._dom(); wc._finish();
  await new Promise((r) => setTimeout(r, 10));
  const beforeKey = sb.claim();
  created.length = 0;
  sb.rewarm();
  created[0].webContents._dom();
  created[0].webContents._finish();
  await new Promise((r) => setTimeout(r, 10));
  sb.reinjectCss(() => 'css2');
  await new Promise((r) => setTimeout(r, 10));
  const got = sb.claim();
  assert.ok(got && got.cssKey, 'rewarm 后就绪应能认领');
  assert.ok(got.cssKey !== beforeKey.cssKey, 'remove+insert 更新 cssKey');
});

test('dispose 销毁视图并清状态', () => {
  const { sb, created } = setup();
  sb.warm();
  let closed = false;
  created[0].webContents.close = () => { closed = true; };
  sb.dispose();
  assert.equal(closed, true);
  assert.equal(sb.isWarming(), false);
  assert.equal(sb.isReady(), false);
  assert.equal(sb.claim(), null);
});

test('reinjectCss 无视图时 no-op（不抛）', () => {
  const { sb } = setup();
  assert.doesNotThrow(() => sb.reinjectCss(() => 'css'));
});