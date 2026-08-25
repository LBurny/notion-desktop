// settings-windows 单测：electron 用 Module require 钩子换成最小桩
// （沿用 quick-find-picked.test.js 的 harness 模式）
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts;
    this.handlers = {};
    this.wcHandlers = {};
    this.sent = [];
    this.shown = 0;
    this.focused = 0;
    this.hidden = 0;
    this.destroyed = false;
    this.pos = null;
    this.zoom = null;
    this.contentSize = null;
    const self = this;
    this.webContents = {
      loadFile(f) { self.htmlFile = f; },
      on(ch, fn) { self.wcHandlers[ch] = fn; },
      setZoomFactor(z) { self.zoom = z; },
      send(ch, ...a) { self.sent.push([ch, ...a]); },
      isDestroyed() { return self.destroyed; },
    };
    FakeBrowserWindow.all.push(this);
  }
  on(ch, fn) { this.handlers[ch] = fn; }
  once(ch, fn) { this.handlers[`once:${ch}`] = fn; }
  emit(ch, ...a) {
    const fn = this.handlers[ch] || this.handlers[`once:${ch}`];
    if (!fn) return;
    delete this.handlers[`once:${ch}`];
    return fn(...a);
  }
  emitWc(ch, ...a) { const fn = this.wcHandlers[ch]; if (fn) fn(...a); }
  // 模拟用户点关闭：未被 preventDefault 则销毁并触发 closed（Electron 语义）
  simulateClose() {
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.emit('close', e);
    if (!e.defaultPrevented) { this.destroyed = true; this.emit('closed'); }
  }
  show() { this.shown++; }
  focus() { this.focused++; }
  hide() { this.hidden++; }
  isDestroyed() { return this.destroyed; }
  getBounds() { return { x: 0, y: 0, width: this.opts.width, height: this.opts.height }; }
  setPosition(x, y) { this.pos = { x, y }; }
  setContentSize(w, h) { this.contentSize = { w, h }; }
}
FakeBrowserWindow.all = [];

const fakeScreen = {
  getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
};

function loadModule() {
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'electron') return { BrowserWindow: FakeBrowserWindow, screen: fakeScreen };
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/main/settings-windows')];
    return orig.call(module, '../src/main/settings-windows');
  } finally {
    Module.prototype.require = orig;
  }
}

function setup({ zoom = 1, theme = 'dark', quitting = false } = {}) {
  FakeBrowserWindow.all = [];
  const { createSettingsWindows } = loadModule();
  const state = { zoom, theme, quitting };
  const svc = createSettingsWindows({
    baseWidth: 340,
    configs: { style: { width: 400, height: 475, dir: 'style-settings' }, app: { height: 440, dir: 'app-settings' } },
    getZoom: () => state.zoom,
    getTheme: () => state.theme,
    getAnchorBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    isQuitting: () => state.quitting,
  });
  return { svc, state };
}

test('open 创建窗口：尺寸随缩放、居中、就绪后 zoom+theme', () => {
  const { svc } = setup({ zoom: 1, theme: 'dark' });
  const w = svc.open('style');
  assert.equal(FakeBrowserWindow.all.length, 1);
  assert.equal(w.opts.width, 400); // 样式页比设置页宽（字体下拉输入行长）
  assert.equal(w.opts.height, 475); // 贴合内容（表单+hint ≈470px），底部无大段留白
  // 透明窗口（body 圆角由页面 CSS 绘制），不再设置不透明底色
  assert.equal(w.opts.transparent, true);
  assert.equal(w.opts.backgroundColor, undefined);
  assert.match(w.htmlFile, /style-settings/);
  // 居中于 1920x1040 工作区
  assert.deepEqual(w.pos, { x: Math.round((1920 - 400) / 2), y: Math.round((1040 - 475) / 2) });
  w.emit('ready-to-show');
  assert.equal(w.shown, 1);
  w.emitWc('did-finish-load');
  assert.equal(w.zoom, 1);
  assert.deepEqual(w.sent, [['theme-changed', 'dark']]);
});

test('open 未单独定宽的窗口回落 baseWidth（设置页 340）', () => {
  const { svc } = setup();
  const w = svc.open('app');
  assert.equal(w.opts.width, 340);
  assert.equal(w.opts.height, 440);
});

test('同 kind 重复 open：不新建，show+focus 复用', () => {
  const { svc } = setup();
  svc.open('style');
  const again = svc.open('style');
  assert.equal(FakeBrowserWindow.all.length, 1);
  assert.equal(again.shown, 1);
  assert.equal(again.focused, 1);
});

test('关闭改隐藏缓存：非退出时 preventDefault + hide，窗口保留复用', () => {
  const { svc } = setup();
  const w = svc.open('app');
  w.simulateClose();
  assert.equal(w.hidden, 1);
  assert.equal(w.destroyed, false);
  svc.open('app'); // 重开 = 直接复用，不再构造
  assert.equal(FakeBrowserWindow.all.length, 1);
  assert.equal(w.shown, 1);
});

test('退出应用时关闭放行，真正销毁', () => {
  const { svc, state } = setup();
  const w = svc.open('style');
  state.quitting = true;
  w.simulateClose();
  assert.equal(w.hidden, 0);
  assert.equal(w.destroyed, true);
  svc.open('style'); // 已销毁 → 重新构造
  assert.equal(FakeBrowserWindow.all.length, 2);
});

test('applyZoom：存活窗口 setZoomFactor + setContentSize 随缩放等比放大', () => {
  const { svc, state } = setup({ zoom: 1 });
  const w = svc.open('style');
  state.zoom = 1.5;
  svc.applyZoom();
  assert.equal(w.zoom, 1.5);
  assert.deepEqual(w.contentSize, { w: 600, h: 713 }); // 400/475 × 1.5（475×1.5=712.5 取整）
});

test('broadcastTheme：给所有存活窗口发 theme-changed；已销毁跳过', () => {
  const { svc, state } = setup();
  const style = svc.open('style');
  const app = svc.open('app');
  state.quitting = true;
  app.simulateClose();
  style.sent.length = 0;
  svc.broadcastTheme('light');
  assert.deepEqual(style.sent, [['theme-changed', 'light']]);
  assert.deepEqual(app.sent, []);
});
