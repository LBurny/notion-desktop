// quickFindPicked 动作顺序回归测试：
// 选中结果后要先用 Escape 关来源页上的 Quick Find 浮层，再开新标签。
// 两处时序坑（实测）：摘除视图后注入按键会被丢弃；同 tick 内先注入再摘除，
// 尚在队列里的按键也会被丢弃——所以开新标签必须延迟到 Escape 处理完之后。
//
// tabs.js 顶层 require('electron')，用 require 钩子换成最小桩。
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function makeWc(log, ipcMainStub, qfState) {
  const wc = {
    _url: 'https://www.notion.so/Page1',
    loadURL(u) { this._url = u; },
    loadFile() {},
    on() {},
    once() {},
    // 状态查询按测试场景应答：open:true 让重试轮次自停止（顺序测试），
    // open:false 让重试每轮都尝试注入（重开回归测试）
    send(channel) {
      if (channel === 'quick-find-state-query') {
        setTimeout(() => {
          const fn = ipcMainStub._listeners['quick-find-state'];
          if (fn) fn({ sender: wc }, qfState);
        }, 0);
      }
    },
    sendInputEvent(ev) { if (ev.type === 'keyDown') log.push(`input:${ev.keyCode}`); },
    insertCSS() { return Promise.resolve('k'); },
    removeInsertedCSS() { return Promise.resolve(); },
    setZoomFactor() {},
    setWindowOpenHandler() {},
    isDestroyed() { return false; },
    getURL() { return this._url; },
    getTitle() { return ''; },
    focus() {},
    reload() {},
    close() {},
  };
  return wc;
}

function loadTabs(log, { qfState = { open: true, anyDialog: true }, retryDelays = null } = {}) {
  const ipcMainStub = {
    _listeners: {},
    on(ch, fn) { this._listeners[ch] = fn; },
    removeListener(ch) { delete this._listeners[ch]; },
  };
  const electronStub = {
    WebContentsView: class {
      constructor() { this.webContents = makeWc(log, ipcMainStub, qfState); }
      setBackgroundColor() {}
      setBounds() {}
    },
    shell: { openExternal() {} },
    ipcMain: ipcMainStub,
  };
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'electron') return electronStub;
    if (id.endsWith('quick-find') && retryDelays) {
      const real = orig.call(this, id);
      return { ...real, QUICK_FIND_RETRY_DELAYS: retryDelays };
    }
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/main/tabs')];
    return orig.call(module, '../src/main/tabs');
  } finally {
    Module.prototype.require = orig;
  }
}

function setup(log, opts) {
  const { createTabs } = loadTabs(log, opts);
  const { createTabManager } = require('../src/main/tab-manager');
  const win = {
    getContentBounds: () => ({ width: 1200, height: 800 }),
    contentView: {
      addChildView() { log.push('add'); },
      removeChildView() { log.push('remove'); },
    },
  };
  return createTabs({
    win,
    manager: createTabManager(),
    homeUrl: 'https://www.notion.so',
    partition: 'persist:test',
    preloadPath: 'preload.js',
    errorPagePath: 'error.html',
    getTitlebarHeight: () => 36,
    getCss: () => '',
    getZoom: () => 1,
    getTheme: () => 'dark',
    getSlashCommands: () => [],
    onChanged() {},
    onEmpty() {},
    onTopbarState() {},
    onPageFont() {},
    saveFile() {},
  });
}

test('选中 Quick Find 结果：Escape 关浮层必须先于来源视图摘除', async () => {
  const log = [];
  const tabs = setup(log);

  tabs.newTab('https://www.notion.so/Page1');
  const sourceWc = tabs.activeView().webContents;
  log.length = 0;

  tabs.newTabInteractive(); // 在当前页唤起 Quick Find 并进入待命态
  tabs.quickFindPicked(sourceWc, '/Page-x'); // 用户选中结果

  // 选中同 tick 只允许注入 Escape；立即摘除视图会丢掉还在队列里的按键
  assert.deepEqual(log, ['input:Escape'], `选中同 tick 只允许注入 Escape，实际: ${log.join(',')}`);

  await new Promise((r) => setTimeout(r, 500)); // 等延迟的开标签动作完成
  const escAt = log.indexOf('input:Escape');
  const removeAt = log.indexOf('remove');
  const addAt = log.lastIndexOf('add');
  assert.notEqual(removeAt, -1, '延迟后应摘除来源视图并挂新视图');
  assert.notEqual(addAt, -1);
  assert.ok(
    escAt < removeAt && escAt < addAt,
    `Escape 必须先于视图摘除/新视图挂载，实际顺序: ${log.join(',')}`,
  );
});

test('选中后待命解除：重试阶梯不再重开浮层', async () => {
  const log = [];
  // open:false 让每轮重试都尝试注入；缩短阶梯让测试毫秒级跑完
  const tabs = setup(log, { qfState: { open: false, anyDialog: false }, retryDelays: [0, 60, 120, 180] });

  tabs.newTab('https://www.notion.so/Page1');
  const sourceWc = tabs.activeView().webContents;
  log.length = 0;

  tabs.newTabInteractive();
  await new Promise((r) => setTimeout(r, 30)); // 第 0 轮已注入一次 Ctrl+K
  tabs.quickFindPicked(sourceWc, '/Page-x'); // 选中 → 待命解除
  await new Promise((r) => setTimeout(r, 400)); // 越过整个缩短的重试阶梯

  const kCount = log.filter((x) => x === 'input:k').length;
  assert.equal(kCount, 1, `待命解除后重试轮次不应再注入 Ctrl+K，实际: ${log.join(',')}`);
});

