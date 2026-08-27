// 标签视图创建参数回归 + 预热视图认领路径 + SPA 兜底看门狗（修 v0.2.0 双加载）。
// 后台标签不被 Chromium 节流；加载期底色跟随主题；认领预热视图后经 SPA 内导航瞬时跳转，
// 看门狗用 location.href 探针判定是否生效，未生效才整页加载兜底。
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function setup({ theme = 'dark' } = {}) {
  const created = [];
  const opened = []; // shell.openExternal 录制
  // ipcMain 桩：支持 queryWc 的 send→reply 往返（location-href-query → location-href）
  const ipcListeners = {};
  const emitReply = (channel, sender, data) => {
    [...(ipcListeners[channel] || [])].forEach((fn) => fn({ sender }, data));
  };
  const ipcMainStub = {
    on(ch, fn) { (ipcListeners[ch] ||= []).push(fn); },
    removeListener(ch, fn) { ipcListeners[ch] = (ipcListeners[ch] || []).filter((f) => f !== fn); },
  };
  class Wc {
    constructor() {
      this._url = 'https://www.notion.so/';
      this._href = 'https://www.notion.so/'; // location.href（SPA 跳转改这里，不改 getURL）
      this.cssKeys = 0;
      this._loads = 0;
      this._spaNavUrl = null;
      this.session = { _downloads: [], downloadURL(u) { this._downloads.push(u); } };
    }
    loadURL(u) { this._url = u; this._loads++; }
    loadFile() {}
    on(ev, fn) { if (ev === 'dom-ready') this._dom = fn; if (ev === 'did-finish-load') this._finish = fn; if (ev === 'before-input-event') this._bie = fn; }
    once() {}
    send(ch, payload) {
      if (ch === 'spa-navigate') this._spaNavUrl = payload;
      else if (ch === 'location-href-query') emitReply('location-href', this, this._href);
    }
    sendInputEvent() {}
    insertCSS() { return Promise.resolve('k' + ++this.cssKeys); }
    removeInsertedCSS() { return Promise.resolve(); }
    setZoomFactor() {}
    setWindowOpenHandler(fn) { this._openHandler = fn; }
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
  const electronStub = {
    WebContentsView,
    shell: { openExternal(u) { opened.push(u); } },
    ipcMain: ipcMainStub,
  };
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
      homeUrl: 'https://www.notion.so/',
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
    return { tabs, created, opened };
  } finally {
    Module.prototype.require = orig;
  }
}

test('newTab 建视图：backgroundThrottling=false，partition/preload 透传', () => {
  const { tabs, created } = setup();
  tabs.newTab('https://www.notion.so/Page1');
  assert.equal(created.length, 1, '无预热则建新视图冷加载');
  assert.equal(created[0].webPreferences.backgroundThrottling, false, '后台标签必须禁节流');
  assert.equal(created[0].webPreferences.partition, 'persist:test');
  assert.equal(created[0].webPreferences.preload, 'preload.js');
});

test('视图加载底色跟随主题：dark → #191919，light → #ffffff', () => {
  const dark = setup({ theme: 'dark' });
  dark.tabs.newTab('https://www.notion.so/Page1');
  assert.equal(dark.created[0].webPreferences.backgroundColor, undefined);
  assert.deepEqual(dark.tabs.activeView().bgColors, ['#191919']);

  const light = setup({ theme: 'light' });
  light.tabs.newTab('https://www.notion.so/Page2');
  assert.deepEqual(light.tabs.activeView().bgColors, ['#ffffff']);
});

// ── 预热视图认领路径 ──

test('newTab：standby 未就绪时回退冷加载（原路径不回归）', () => {
  const { tabs, created } = setup();
  tabs.newTab('https://www.notion.so/Page1');
  assert.equal(created.length, 1);
  assert.equal(created[0].webContents._url, 'https://www.notion.so/Page1');
  assert.equal(created[0].webContents._loads, 1, '冷加载走 loadURL 一次');
});

test('ensureView：standby 就绪时认领并经 spa-navigate 跳转，不再 loadURL', () => {
  const { tabs, created } = setup();
  tabs.warmStandby();
  const sbWc = created[0].webContents;
  sbWc._dom(); sbWc._finish(); // 推进预热到就绪
  const sbView = created[0];
  created.length = 0;
  tabs.newTab('https://www.notion.so/Page1');
  assert.equal(created.length, 1, '仅 rewarm 建一个后台预热，不为新标签建冷加载视图');
  const active = tabs.activeView();
  assert.strictEqual(active, sbView, '活动视图即被认领的预热视图');
  assert.equal(active.webContents._spaNavUrl, 'https://www.notion.so/Page1', '经 SPA 内导航跳转');
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

// ── 看门狗（修 v0.2.0 用 getURL 误判的双加载 bug）──

test('watchdog：SPA 跳转生效（location.href 已变目标）则不再整页加载', async () => {
  const { tabs, created } = setup();
  tabs.warmStandby();
  const sbWc = created[0].webContents;
  sbWc._dom(); sbWc._finish();
  created.length = 0;
  tabs.newTab('https://www.notion.so/Page1');
  const wc = tabs.activeView().webContents;
  // 模拟 Notion 客户端路由已把 location.href 改到目标（getURL 仍为首页）
  wc._href = 'https://www.notion.so/Page1';
  await new Promise((r) => setTimeout(r, 500)); // 越过看门狗首次轮询（200ms）
  assert.equal(wc._loads, 1, 'SPA 生效不应再 loadURL（仅预热时 1 次首页加载）');
  assert.equal(wc._url, 'https://www.notion.so/', 'getURL 仍是首页（SPA 不改 getURL），但页面已在目标');
});

test('watchdog：SPA 未生效（location.href 仍首页）则 1.5s 后整页加载兜底', async () => {
  const { tabs, created } = setup();
  tabs.warmStandby();
  const sbWc = created[0].webContents;
  sbWc._dom(); sbWc._finish();
  created.length = 0;
  tabs.newTab('https://www.notion.so/Page1');
  const wc = tabs.activeView().webContents;
  // location.href 保持首页：模拟 Notion 未拦截程序化点击（SPA 未生效）
  wc._href = 'https://www.notion.so/';
  await new Promise((r) => setTimeout(r, 1900)); // 越过 1.5s 兜底
  assert.equal(wc._loads, 2, 'SPA 未生效应整页加载兜底（首页 1 + 目标 1）');
  assert.equal(wc._url, 'https://www.notion.so/Page1', '兜底后到达目标页');
});

test('setViewsBackground 同步预热视图底色', () => {
  const { tabs, created } = setup({ theme: 'dark' });
  tabs.warmStandby();
  tabs.setViewsBackground('light');
  assert.deepEqual(created[0].bgColors, ['#191919', '#ffffff']);
});

// ── Ctrl+T 回归：before-input-event 的 new-tab 动作必须可调用 ──
// v0.2.2 及更早 before-input-event 里裸调 newTabInteractive()（未定义）→ Ctrl+T 崩溃。
test('Ctrl+T 触发 new-tab 动作不抛 ReferenceError', () => {
  const { tabs, created } = setup();
  tabs.newTab('https://www.notion.so/Page1'); // 建视图并 wire before-input-event
  const wc = created[0].webContents;
  // 活动页设成 file:// 使 newTabInteractive 走 newTab(homeUrl,{search}) 无定时器分支，避免测试挂起
  wc._url = 'file:///error.html';
  assert.doesNotThrow(() => {
    wc._bie({ preventDefault() {} }, { type: 'keyDown', control: true, key: 't' });
  }, 'Ctrl+T 不应抛 ReferenceError');
});

// ── 视图销毁防御：ensureView 重建已销毁视图，避免 addChildView 抛 "destroyed child view" ──
test('ensureView：活动视图已销毁则重建（不抛 destroyed child view）', () => {
  const { tabs, created } = setup();
  tabs.newTab('https://www.notion.so/Page1'); // tab1
  const id1 = tabs.payload().tabs[0].id;
  tabs.newTab('https://www.notion.so/Page2'); // tab2 变活动，tab1 留有视图
  // 模拟 tab1 视图被异常销毁
  created[0].webContents.isDestroyed = () => true;
  created.length = 0;
  assert.doesNotThrow(() => tabs.activateTab(id1), '激活已销毁视图的标签不应抛');
  assert.equal(created.length, 1, '已销毁视图应重建（认领预热或冷加载）');
  assert.equal(tabs.activeView().webContents.isDestroyed(), false, '新视图未销毁');
});

// ── window-open 分流（修 v0.2.10 附件点击误开新标签）──
// 实测：附件点击 window.open('https://www.notion.so/signed/attachment:…')，原逻辑误开新标签
test('window-open：附件签名地址走 session.downloadURL 原地下载，不开标签不外开', () => {
  const { tabs, created, opened } = setup();
  tabs.newTab('https://www.notion.so/Page1');
  const wc = created[0].webContents;
  const url = 'https://www.notion.so/signed/attachment%3Auuid%3A%E8%AE%BA%E6%96%87.doc?table=block&id=x';
  assert.deepEqual(wc._openHandler({ url }), { action: 'deny' });
  assert.deepEqual(wc.session._downloads, [url], '必须原地触发下载');
  assert.equal(created.length, 1, '不得新开标签');
  assert.equal(opened.length, 0, '不得交给外部浏览器');
});

test('window-open：file.notion.so / S3 直链同样分流下载', () => {
  const { tabs, created } = setup();
  tabs.newTab('https://www.notion.so/Page1');
  const wc = created[0].webContents;
  wc._openHandler({ url: 'https://file.notion.so/f/f/uuid/file.doc' });
  wc._openHandler({ url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/uuid/f.pdf?X-Amz-Signature=x' });
  assert.equal(wc.session._downloads.length, 2, '两条文件直链都应触发下载');
  assert.equal(created.length, 1, '不开新标签');
});

test('window-open：Notion 页面仍开新标签，外链仍 shell.openExternal', () => {
  const { tabs, created, opened } = setup();
  tabs.newTab('https://www.notion.so/Page1');
  const wc = created[0].webContents;
  assert.deepEqual(wc._openHandler({ url: 'https://www.notion.so/Page2' }), { action: 'deny' });
  assert.equal(tabs.payload().tabs.length, 2, 'Notion 页面照常开标签');
  wc._openHandler({ url: 'https://github.com/readdig/readdig' });
  assert.deepEqual(opened, ['https://github.com/readdig/readdig'], '外链交系统浏览器');
  assert.equal(wc.session._downloads.length, 0, '外链不得误触发下载');
});

test('window-open：登录弹窗仍放行 allow', () => {
  const { tabs, created } = setup();
  tabs.newTab('https://www.notion.so/Page1');
  const wc = created[0].webContents;
  const url = 'https://accounts.google.com/o/oauth2/auth?client_id=1';
  assert.deepEqual(wc._openHandler({ url }), { action: 'allow' });
});