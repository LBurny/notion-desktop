const test = require('node:test');
const assert = require('node:assert');
const { SILENT_ARG, syncLoginItem, shouldStartHidden } = require('../src/main/login-item');

function fakeApp({ wasOpenedAtLogin = false } = {}) {
  const calls = [];
  return {
    calls,
    setLoginItemSettings: (s) => calls.push(s),
    getLoginItemSettings: () => ({ wasOpenedAtLogin }),
  };
}

test('syncLoginItem 开启：openAtLogin + 静默参数（登录项拉起时不弹主窗）', () => {
  const app = fakeApp();
  syncLoginItem(app, true);
  assert.deepStrictEqual(app.calls, [{ openAtLogin: true, args: [SILENT_ARG] }]);
});

test('syncLoginItem 关闭：仅 openAtLogin false（不带启动参数）', () => {
  const app = fakeApp();
  syncLoginItem(app, false);
  assert.deepStrictEqual(app.calls, [{ openAtLogin: false }]);
});

test('shouldStartHidden：wasOpenedAtLogin 为 true 时静默启动', () => {
  const origArgv = process.argv;
  process.argv = origArgv.filter((a) => a !== SILENT_ARG); // 排除标记参数干扰
  try {
    assert.strictEqual(shouldStartHidden(fakeApp({ wasOpenedAtLogin: true })), true);
    assert.strictEqual(shouldStartHidden(fakeApp({ wasOpenedAtLogin: false })), false);
  } finally {
    process.argv = origArgv;
  }
});

test('shouldStartHidden：命令行带静默标记参数也判定静默（双保险）', () => {
  const origArgv = process.argv;
  process.argv = [...origArgv, SILENT_ARG];
  try {
    assert.strictEqual(shouldStartHidden(fakeApp({ wasOpenedAtLogin: false })), true);
  } finally {
    process.argv = origArgv;
  }
});
