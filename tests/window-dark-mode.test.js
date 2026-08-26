const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyWindowDarkMode,
  buildScript,
  hwndToLong,
  parseStatus,
  DWMWA_USE_IMMERSIVE_DARK_MODE,
  DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY,
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

// ---- 跨机器普适性：属性 20 → 19 兜底 + 返回值不再吞 ----

test('DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY 为 19（Win10 1909 及更早编号）', () => {
  assert.strictEqual(DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY, 19);
});

test('buildScript 先试属性 20，返回非 0 才退属性 19', () => {
  const ps = buildScript('291', 1);
  assert.ok(ps.includes('$r20 = [DwmApi]::DwmSetWindowAttribute($h, 20, [ref]$v, 4)'), '应先试属性 20');
  assert.ok(ps.includes('$r19 = [DwmApi]::DwmSetWindowAttribute($h, 19, [ref]$v, 4)'), '应退属性 19');
  // 20 成功即收手，不再碰 19
  assert.ok(ps.includes('if ($r20 -eq 0)'), '应以 $r20 == 0 为收手判据');
});

test('buildScript 不再用 Out-Null 吞掉 DwmSetWindowAttribute 返回值', () => {
  const ps = buildScript('291', 1);
  assert.ok(!/DwmSetWindowAttribute[^]*\|\s*Out-Null/.test(ps), '不应再对 DwmSetWindowAttribute 用 Out-Null');
});

test('buildScript 成功路径回写 nd-dwm ok 状态行', () => {
  const ps = buildScript('291', 1);
  assert.ok(ps.includes('nd-dwm ok attr=20'), '20 成功应回写 attr=20');
  assert.ok(ps.includes('nd-dwm ok attr=19'), '19 兜底成功应回写 attr=19');
});

test('buildScript 两属性都失败时回写 nd-dwm fail 带 HRESULT', () => {
  const ps = buildScript('291', 1);
  assert.ok(ps.includes('nd-dwm fail r20=$r20 r19=$r19'), '失败行应带两个返回码');
});

// ---- parseStatus ----

test('parseStatus 解析 nd-dwm 行，忽略其余输出', () => {
  assert.strictEqual(parseStatus('foo\r\nnd-dwm ok attr=20\r\nbar'), 'nd-dwm ok attr=20');
  assert.strictEqual(parseStatus('nd-dwm fail r20=1 r19=1 cp=1'), 'nd-dwm fail r20=1 r19=1 cp=1');
  assert.strictEqual(parseStatus(''), null);
  assert.strictEqual(parseStatus(undefined), null);
  assert.strictEqual(parseStatus('no marker here'), null);
});

// ---- exec 回调回报 ----

test('applyWindowDarkMode 成功时通过 log 回报状态', () => {
  let logged = null;
  const fakeExec = (cmd, args, opts, cb) => { cb && cb(null, 'nd-dwm ok attr=20\r\n', ''); };
  applyWindowDarkMode(fakeWin(), 'dark', { exec: fakeExec, log: (m) => { logged = m; } });
  assert.strictEqual(logged, '[dwm] nd-dwm ok attr=20');
});

test('applyWindowDarkMode 两属性失败时 log 带 r20/r19（及可能的 cp）', () => {
  let logged = null;
  const fakeExec = (cmd, args, opts, cb) => { cb && cb(null, 'nd-dwm fail r20=1 r19=1 cp=1\r\n', ''); };
  applyWindowDarkMode(fakeWin(), 'dark', { exec: fakeExec, log: (m) => { logged = m; } });
  assert.ok(logged.includes('r20=1') && logged.includes('r19=1') && logged.includes('cp=1'), logged);
});

test('applyWindowDarkMode 无状态行且无 err 时不调 log', () => {
  let logged = null;
  const fakeExec = (cmd, args, opts, cb) => { cb && cb(null, '', ''); };
  applyWindowDarkMode(fakeWin(), 'dark', { exec: fakeExec, log: (m) => { logged = m; } });
  assert.strictEqual(logged, null);
});

test('applyWindowDarkMode 默认 log 为空函数也不抛', () => {
  const fakeExec = (cmd, args, opts, cb) => { cb && cb(null, 'nd-dwm ok attr=19\r\n', ''); };
  assert.strictEqual(applyWindowDarkMode(fakeWin(), 'dark', { exec: fakeExec }), true);
});