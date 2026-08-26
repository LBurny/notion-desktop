const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyWindowDarkMode,
  buildScript,
  hwndToLong,
  DWMWA_USE_IMMERSIVE_DARK_MODE,
} = require('../src/main/window-dark-mode');

function fakeWin(hwndNum = 291) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(hwndNum));
  return { isDestroyed: () => false, getNativeWindowHandle: () => buf };
}

// execFile('powershell', ['-NoProfile','-WindowStyle','Hidden','-Command', ps], ...)
// 脚本位于 -Command 之后的那个参数
function scriptOf(args) {
  const i = args.indexOf('-Command');
  return i >= 0 ? args[i + 1] : '';
}

test('DWMWA_USE_IMMERSIVE_DARK_MODE 为 20（Win10 2004+ 编号）', () => {
  assert.strictEqual(DWMWA_USE_IMMERSIVE_DARK_MODE, 20);
});

test('hwndToLong 把 8 字节小端 Buffer 转为十进制字符串', () => {
  assert.strictEqual(hwndToLong(fakeWin(291)), '291');
  assert.strictEqual(hwndToLong(fakeWin(0)), '0');
});

test('buildScript dark=1 嵌入属性 20 与 $v = 1', () => {
  const ps = buildScript('291', 1);
  assert.ok(ps.includes("$v = 1"), '应包含 $v = 1');
  assert.ok(ps.includes('DwmSetWindowAttribute($h, 20, [ref]$v, 4)'), '应使用属性 20');
  assert.ok(ps.includes("'291'"), '应嵌入 HWND 字面量');
});

test('buildScript light=0 嵌入 $v = 0', () => {
  const ps = buildScript('291', 0);
  assert.ok(ps.includes('$v = 0'));
  assert.ok(!ps.includes('$v = 1'));
});

test('applyWindowDarkMode dark 调用 exec 并传正确脚本', () => {
  let called = null;
  const fakeExec = (cmd, args, opts, cb) => {
    called = { cmd, args, opts };
    cb && cb();
  };
  const ok = applyWindowDarkMode(fakeWin(), 'dark', { exec: fakeExec });
  assert.strictEqual(ok, true);
  assert.strictEqual(called.cmd, 'powershell');
  assert.strictEqual(called.args[0], '-NoProfile');
  const ps = scriptOf(called.args);
  assert.ok(ps.includes('$v = 1'));
  assert.ok(ps.includes('DwmSetWindowAttribute($h, 20, [ref]$v, 4)'));
  assert.strictEqual(called.opts.windowsHide, true);
});

test('applyWindowDarkMode light 设 $v = 0', () => {
  let called = null;
  const fakeExec = (cmd, args, opts, cb) => { called = { args }; cb && cb(); };
  applyWindowDarkMode(fakeWin(), 'light', { exec: fakeExec });
  assert.ok(scriptOf(called.args).includes('$v = 0'));
});

test('applyWindowDarkMode 未知主题按 light 处理（$v = 0）', () => {
  let called = null;
  const fakeExec = (cmd, args, opts, cb) => { called = { args }; cb && cb(); };
  applyWindowDarkMode(fakeWin(), 'auto', { exec: fakeExec });
  assert.ok(scriptOf(called.args).includes('$v = 0'));
});

test('窗口已销毁时不调用 exec 并返回 false', () => {
  let called = false;
  const fakeExec = () => { called = true; };
  const win = { isDestroyed: () => true, getNativeWindowHandle: () => Buffer.alloc(8) };
  assert.strictEqual(applyWindowDarkMode(win, 'dark', { exec: fakeExec }), false);
  assert.strictEqual(called, false);
});

test('win 为 null 时直接返回 false 不抛异常', () => {
  let called = false;
  const fakeExec = () => { called = true; };
  assert.strictEqual(applyWindowDarkMode(null, 'dark', { exec: fakeExec }), false);
  assert.strictEqual(called, false);
});

test('非 win32 平台不调用 exec', () => {
  let called = false;
  const fakeExec = () => { called = true; };
  const ok = applyWindowDarkMode(fakeWin(), 'dark', { exec: fakeExec, platform: 'darwin' });
  assert.strictEqual(ok, false);
  assert.strictEqual(called, false);
});