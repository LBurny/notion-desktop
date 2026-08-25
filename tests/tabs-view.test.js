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
    }
    loadURL(u) { this._url = u; }
    loadFile() {}
    on() {}
    once() {}
    send() {}
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
      created.push(opts);
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
      onChanged() {}, onEmpty() {}, onTopbarState() {}, onPageFont() {},
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
