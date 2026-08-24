const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  loadState, saveState, isVisibleOnSomeDisplay, trackWindow,
} = require('../src/main/window-state');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nd-')), name);
}

test('loadState 文件不存在时返回默认值', () => {
  assert.deepStrictEqual(loadState(tmpFile('missing.json')), {
    width: 1200, height: 800, isMaximized: false,
  });
});

test('loadState JSON 损坏时返回默认值', () => {
  const f = tmpFile('bad.json');
  fs.writeFileSync(f, '{oops');
  assert.deepStrictEqual(loadState(f), { width: 1200, height: 800, isMaximized: false });
});

test('loadState 过滤非法数值', () => {
  const f = tmpFile('s.json');
  fs.writeFileSync(f, JSON.stringify({ width: 100, height: 5000, x: 'bad', y: 20, isMaximized: 1 }));
  const s = loadState(f);
  assert.strictEqual(s.width, 1200);   // 100 < 400 回退默认
  assert.strictEqual(s.height, 5000);  // 合法，保留
  assert.strictEqual(s.x, undefined);
  assert.strictEqual(s.y, 20);
  assert.strictEqual(s.isMaximized, false);
});

test('saveState + loadState 往返一致', () => {
  const f = tmpFile('round.json');
  const s = { width: 1024, height: 768, x: 10, y: 20, isMaximized: true };
  saveState(f, s);
  assert.deepStrictEqual(loadState(f), s);
});

const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];

test('isVisibleOnSomeDisplay: 无坐标视为可见', () => {
  assert.strictEqual(isVisibleOnSomeDisplay({ width: 800, height: 600 }, displays), true);
});
test('isVisibleOnSomeDisplay: 与屏幕有重叠可见', () => {
  assert.strictEqual(isVisibleOnSomeDisplay({ x: 1900, y: 1000, width: 800, height: 600 }, displays), true);
});
test('isVisibleOnSomeDisplay: 完全在屏幕外不可见', () => {
  assert.strictEqual(isVisibleOnSomeDisplay({ x: 5000, y: 5000, width: 800, height: 600 }, displays), false);
});

test('trackWindow 防抖保存窗口状态', async () => {
  const f = tmpFile('state.json');
  const win = new EventEmitter();
  win.isDestroyed = () => false;
  win.isMaximized = () => false;
  win.getNormalBounds = () => ({ x: 1, y: 2, width: 800, height: 600 });
  trackWindow(win, f, 10);
  win.emit('resize');
  win.emit('move');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(loadState(f), { x: 1, y: 2, width: 800, height: 600, isMaximized: false });
});
