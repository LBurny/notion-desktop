const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyWindowDarkMode,
  DWMWA_USE_IMMERSIVE_DARK_MODE,
  DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY,
} = require('../src/main/window-dark-mode');

function fakeWin(hwndNum = 291) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(hwndNum));
  return { isDestroyed: () => false, getNativeWindowHandle: () => buf };
}

test('DWMWA_USE_IMMERSIVE_DARK_MODE 为 20（Win10 2004+ 编号）', () => {
  assert.strictEqual(DWMWA_USE_IMMERSIVE_DARK_MODE, 20);
});

test('DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY 为 19（Win10 1909 及更早编号）', () => {
  assert.strictEqual(DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY, 19);
});

test('属性 20 成功时返回 true 并 log ok attr=20，值/属性号/长度正确', () => {
  const calls = [];
  const setAttr = (hwnd, attr, val, cb) => { calls.push({ hwnd, attr, val, cb }); return 0; };
  let logged = null;
  const ok = applyWindowDarkMode(fakeWin(), 'dark', { setAttr, toPtr: (n) => n, log: (m) => { logged = m; } });
  assert.strictEqual(ok, true);
  assert.strictEqual(logged, '[dwm] ok attr=20 via koffi');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].hwnd, 291n); // Buffer 里的 HWND 值被读出（BigInt），不是 Buffer 地址
  assert.strictEqual(calls[0].attr, 20);
  assert.deepEqual(calls[0].val, [1]);
  assert.strictEqual(calls[0].cb, 4);
});

test('用 toPtr 把 HWND 值转成指针再传', () => {
  let received = null;
  const setAttr = (hwnd, attr, val, cb) => { received = hwnd; return 0; };
  const toPtr = (n) => `ptr:${n}`;
  applyWindowDarkMode(fakeWin(291), 'dark', { setAttr, toPtr });
  assert.strictEqual(received, 'ptr:291');
});

test('属性 20 失败退 19', () => {
  const calls = [];
  const setAttr = (hwnd, attr, val, cb) => { calls.push(attr); return attr === 20 ? -1 : 0; };
  let logged = null;
  const ok = applyWindowDarkMode(fakeWin(), 'dark', { setAttr, log: (m) => { logged = m; } });
  assert.strictEqual(ok, true);
  assert.strictEqual(logged, '[dwm] ok attr=19 via koffi');
  assert.deepEqual(calls, [20, 19]);
});

test('两属性都失败返回 false 并 log fail', () => {
  const setAttr = () => -1;
  let logged = null;
  const ok = applyWindowDarkMode(fakeWin(), 'dark', { setAttr, log: (m) => { logged = m; } });
  assert.strictEqual(ok, false);
  assert.ok(logged.includes('r20=-1') && logged.includes('r19=-1'), logged);
});

test('light 设 val=0', () => {
  let val = null;
  const setAttr = (hwnd, attr, v, cb) => { val = v; return 0; };
  applyWindowDarkMode(fakeWin(), 'light', { setAttr });
  assert.deepEqual(val, [0]);
});

test('未知主题按 light 处理（val=0）', () => {
  let val = null;
  const setAttr = (hwnd, attr, v, cb) => { val = v; return 0; };
  applyWindowDarkMode(fakeWin(), 'auto', { setAttr });
  assert.deepEqual(val, [0]);
});

test('窗口已销毁时返回 false 不调 setAttr', () => {
  let called = false;
  const setAttr = () => { called = true; return 0; };
  const win = { isDestroyed: () => true, getNativeWindowHandle: () => Buffer.alloc(8) };
  assert.strictEqual(applyWindowDarkMode(win, 'dark', { setAttr }), false);
  assert.strictEqual(called, false);
});

test('win 为 null 时返回 false 不抛异常', () => {
  let called = false;
  const setAttr = () => { called = true; return 0; };
  assert.strictEqual(applyWindowDarkMode(null, 'dark', { setAttr }), false);
  assert.strictEqual(called, false);
});

test('非 win32 平台返回 false 不调 setAttr', () => {
  let called = false;
  const setAttr = () => { called = true; return 0; };
  assert.strictEqual(applyWindowDarkMode(fakeWin(), 'dark', { setAttr, platform: 'darwin' }), false);
  assert.strictEqual(called, false);
});

test('setAttr 为 null（koffi 未加载）时返回 false 不抛', () => {
  assert.strictEqual(applyWindowDarkMode(fakeWin(), 'dark', { setAttr: null }), false);
});

test('setAttr 抛异常时返回 false 并 log koffi error', () => {
  const setAttr = () => { throw new Error('boom'); };
  let logged = null;
  const ok = applyWindowDarkMode(fakeWin(), 'dark', { setAttr, log: (m) => { logged = m; } });
  assert.strictEqual(ok, false);
  assert.ok(logged.includes('koffi error'), logged);
});
