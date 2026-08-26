// 标签视图创建参数回归：后台标签不被 Chromium 节流（切回无重绘顿挫）、
// 加载期底色跟随主题（Electron 43 构造选项无 backgroundColor，必须建后 setBackgroundColor）
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function setup({ theme = 'dark' } = {}) {
  const log = [];
  const created = [];
  const ipcMainStub = { _l: {}, on() {}, removeListener() {} };
  class Wc {
    constructor() {
      this._url = 'https://www.notion.so/';
      this.cssKeys = 0;
      this._loads = 0;
      this._spaNavUrl = null;
    }
    loadURL(u) { this._url = u; this._loads++; }
    loadFile() {}
    on(ev, fn) {
      // 仅存预热视图需要的两个里程碑；其它事件丢弃（现有测试不依赖）
      if (ev === 'dom-ready') this._dom = fn;
      if (ev === 'did-finish-load') this._finish = fn;
    }
    once() {}
    send(ch, payload) { if (ch === 'spa-navigate') this._spaNavUrl = payload; }
    sendInputEvent() {}
    insertCSS() { return Promise.resolve('k' + ++this.cssKeys); }
    removeInsertedCSS() { return Promise.resolve(); }
    setZoomFactor() {}
    setWindowOpenHandler() {}
    setBackgroundColor() {}
    isDestroyed() { return false; }
    getURL() { return this._url; }
    getTitle() { return ''; }
    focus() {}
    reload() {}
    close() {}
  }
  class WebContentsView {
    constructor(opts) {
      this.webPreferences = opts.webPreferences;
      created.push(this);
      this.webContents = new Wc();
      this.bgColors = [];
    }
    setBackgroundColor(c) { this.bgColors.push(c); }
    setBounds() {}
  }
  const electronStub = { WebContentsView, shell: { openExternal() {} }, ipcMain: ipcMainStub };
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'electron') return electronStub;
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/main/tabs')];
    delete require.cache[require.resolve('../src/main/standby-view')];
    const { createTabs } = orig.call(module, '../src/main/tabs');
    const { createTabManager } = require('../src/main/tab-manager');
    const tabs = createTabs({
      win: { getContentBounds: () => ({ width: 1200, height: 800 }), contentView: { addChildView() {}, removeChildView() {} } },
      manager: createTabManager(),
      homeUrl: 'https://www.notion.so',
      partition: 'persist:test',
      preloadPath: 'preload.js',
      errorPagePath: 'error.html',
      getTitlebarHeight: () => 36,
      getCss: () => '',
      getZoom: () => 1,
      getTheme: () => theme,
      getSlashCommands: () => [],
      onChanged() {}, onEmpty() {}, onTopbarState() {}, onUiFont() {},
      saveFile() {},
    });
    return { tabs, created, log };
  } finally {
    Module.prototype.require = orig;
  }
}

test('newTab 建视图：backgroundThrottling=false，partition/preload 透传', () => {
  const { tabs, created } = setup();
  tabs.newTab('https://www.notion.so/Page1');
  assert.equal(created.length, 1);
  assert.equal(created[0].webPreferences.backgroundThrottling, false, '后台标签必须禁节流');
  assert.equal(created[0].webPreferences.partition, 'persist:test');
  assert.equal(created[0].webPreferences.preload, 'preload.js');
});

test('视图加载底色跟随主题：dark → #191919，light → #ffffff', () => {
  const dark = setup({ theme: 'dark' });
  dark.tabs.newTab('https://www.notion.so/Page1');
  // Electron 43 的 WebContentsView 构造选项没有 backgroundColor（传了会被静默忽略）
  assert.equal(dark.created[0].webPreferences.backgroundColor, undefined);
  const darkView = dark.tabs.activeView();
  assert.deepEqual(darkView.bgColors, ['#191919']); // 建实例后 setBackgroundColor

  const light = setup({ theme: 'light' });
  light.tabs.newTab('https://www.notion.so/Page2');
  assert.deepEqual(light.tabs.activeView().bgColors, ['#ffffff']);
});

// ── 预热视图集成：newTab 优先认领预热视图并经 SPA 内导航，避免冷加载 ──

test('newTab：standby 未就绪时回退冷加载（原路径不回归）', () => {
  const { tabs, created } = setup();
  tabs.newTab('https://www.notion.so/Page1');
  assert.equal(created.length, 1, '无预热则建新视图冷加载');
  assert.equal(created[0].webContents._url, 'https://www.notion.so/Page1');
  assert.equal(created[0].webContents._loads, 1, '冷加载走 loadURL 一次');
});

test('ensureView：standby 就绪时认领并经 spa-navigate 跳转，不再 loadURL', () => {
  const { tabs, created } = setup();
  tabs.warmStandby();                 // 建预热视图（created[0]）
  const sbWc = created[0].webContents;
  sbWc._dom(); sbWc._finish();        // 推进到就绪
  const sbView = created[0];
  created.length = 0;
  tabs.newTab('https://www.notion.so/Page1');
  assert.equal(created.length, 1, '仅 rewarm 建一个后台预热，不为新标签建冷加载视图');
  const active = tabs.activeView();
  assert.strictEqual(active, sbView, '活动视图即被认领的预热视图');
  assert.equal(active.webContents._spaNavUrl, 'https://www.notion.so/Page1', '经 SPA 内导航跳转');
  assert.equal(active.webContents._loads, 1, '认领后不再 loadURL（仅预热时 1 次）');
});

test('ensureView：目标已是首页 URL 时不发 spa-navigate', () => {
  const { tabs, created } = setup();
  tabs.warmStandby();
  created[0].webContents._dom();
  created[0].webContents._finish();
  created.length = 0;
  tabs.newTab('https://www.notion.so/');
  assert.equal(tabs.activeView().webContents._spaNavUrl, null, '首页无需 SPA 导航');
});

test('setViewsBackground 同步预热视图底色', () => {
  const { tabs, created } = setup({ theme: 'dark' });
  tabs.warmStandby();
  tabs.setViewsBackground('light');
  assert.deepEqual(created[0].bgColors, ['#191919', '#ffffff']);
});
