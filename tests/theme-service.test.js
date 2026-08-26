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

test('与当前主题相同的上报：不落盘，但触发 onApplied 以便重设 NC', () => {
  const { svc, themeFile, applied, advance } = setup({ initial: 'dark' });
  advance(GRACE_MS + 1); // 越过宽限期排除干扰
  assert.equal(svc.report('dark'), false); // 主题未变化 → 返回 false
  assert.deepEqual(applied, ['dark']); // 仍触发回调：窗口就绪后重设 NC（修复持久化 dark 时早期 NC 未生效）
  assert.equal(fs.existsSync(themeFile), false); // 未变化不落盘
});

test('持久化 dark 启动后 Notion 首次 dark 上报触发重设（跨机器白线根因回归）', () => {
  const { svc, applied, advance } = setup({ initial: 'dark' });
  advance(2000); // 模拟 Notion 加载完成后上报（此时窗口已就绪）
  assert.equal(svc.report('dark'), false);
  assert.deepEqual(applied, ['dark']); // 关键：即便主题未变也要重设 NC
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
