const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createThemeService, shouldAcceptReport, GRACE_MS } = require('../src/main/theme-service');

// ── shouldAcceptReport 纯函数 ──

test('宽限期内：持久化 dark 时忽略 light 假象上报', () => {
  assert.equal(shouldAcceptReport('light', 'dark', GRACE_MS - 1), false);
});

test('宽限期后：light 上报正常接受', () => {
  assert.equal(shouldAcceptReport('light', 'dark', GRACE_MS), true);
});

test('dark 上报任何时刻都接受；非法值拒绝', () => {
  assert.equal(shouldAcceptReport('dark', 'light', 0), true);
  assert.equal(shouldAcceptReport('dark', 'dark', 0), true);
  assert.equal(shouldAcceptReport('auto', 'light', GRACE_MS + 1), false);
  assert.equal(shouldAcceptReport('', 'light', GRACE_MS + 1), false);
});

// ── createThemeService ──

function setup({ initial = 'dark', elapsed = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-theme-'));
  const themeFile = path.join(dir, 'theme.json');
  const applied = [];
  let t = 100000;
  const svc = createThemeService({
    themeFile, initial, onApplied: (theme) => applied.push(theme), now: () => t,
  });
  return { svc, themeFile, applied, advance: (ms) => { t += ms; }, elapsed };
}

test('接受上报：落盘 + 回调 + get() 更新', () => {
  const { svc, themeFile, applied, advance } = setup({ initial: 'light' });
  advance(100);
  assert.equal(svc.report('dark'), true);
  assert.equal(svc.get(), 'dark');
  assert.deepEqual(applied, ['dark']);
  assert.equal(JSON.parse(fs.readFileSync(themeFile, 'utf8')).theme, 'dark');
});

test('与当前主题相同的上报去重：不落盘不回调', () => {
  const { svc, themeFile, applied, advance } = setup({ initial: 'dark' });
  advance(GRACE_MS + 1); // 越过宽限期排除干扰
  assert.equal(svc.report('dark'), false);
  assert.deepEqual(applied, []);
  assert.equal(fs.existsSync(themeFile), false);
});

test('宽限期内的 light 假象被忽略且不污染 theme.json', () => {
  const { svc, themeFile, applied, advance } = setup({ initial: 'dark' });
  advance(3000);
  assert.equal(svc.report('light'), false);
  assert.equal(svc.get(), 'dark');
  assert.deepEqual(applied, []);
  assert.equal(fs.existsSync(themeFile), false);
});

test('宽限期后 light 正常生效', () => {
  const { svc, applied, advance } = setup({ initial: 'dark' });
  advance(GRACE_MS + 1);
  assert.equal(svc.report('light'), true);
  assert.equal(svc.get(), 'light');
  assert.deepEqual(applied, ['light']);
});
