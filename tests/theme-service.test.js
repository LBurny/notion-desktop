const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createThemeService, shouldAcceptReport, isThemeProbeUrl, GRACE_MS } = require('../src/main/theme-service');

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

// fakeSchedule：捕获延迟重报定时器，测试里手动点火（不依赖真实 15s 等待）
function fakeSchedule() {
  const pending = [];
  const schedule = (fn, ms) => { const job = { fn, ms, canceled: false }; pending.push(job); return job; };
  const clear = (job) => { if (job) job.canceled = true; };
  const fire = () => {
    const live = pending.filter((j) => !j.canceled);
    pending.length = 0;
    for (const j of live) j.fn();
  };
  const live = () => pending.filter((j) => !j.canceled);
  return { schedule, clear, pending, live, fire };
}

function setup({ initial = 'dark', elapsed = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-theme-'));
  const themeFile = path.join(dir, 'theme.json');
  const applied = [];
  let t = 100000;
  const timer = fakeSchedule();
  const svc = createThemeService({
    themeFile, initial, onApplied: (theme) => applied.push(theme), now: () => t,
    schedule: timer.schedule, cancel: timer.clear,
  });
  return { svc, themeFile, applied, advance: (ms) => { t += ms; }, elapsed, timer };
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

// preload 只在主题**变化**时上报：宽限期内那次 light 被拒后，页面若一直是 light
// 就再无重报机会（content.js 的 last 已记成 light），外壳会永久停在 dark。
// 服务端必须记住这次被拒的上报，宽限期结束时自己再采一次。
test('宽限期内被拒的 light 在宽限期结束时自动重采（不再依赖页面重报）', () => {
  const { svc, themeFile, applied, advance, timer } = setup({ initial: 'dark' });
  advance(3000); // 启动 3s 后 Notion 报 light（页面实际就是 light）
  assert.equal(svc.report('light'), false, '宽限期内仍按假象拒绝');
  assert.equal(svc.get(), 'dark');
  assert.equal(timer.live().length, 1, '被拒的上报要排一次延迟重采');
  assert.equal(timer.live()[0].ms, GRACE_MS - 3000, '延迟应正好补足剩余宽限期');

  advance(GRACE_MS - 3000);
  timer.fire();
  assert.equal(svc.get(), 'light', '宽限期结束后应接受真实 light');
  assert.deepEqual(applied, ['light']);
  assert.equal(JSON.parse(fs.readFileSync(themeFile, 'utf8')).theme, 'light', 'theme.json 同步更新');
});

test('延迟重采可被紧随其后的 dark 上报取消（页面实际是 dark 时不得回落 light）', () => {
  const { svc, applied, advance, timer } = setup({ initial: 'dark' });
  advance(3000);
  svc.report('light'); // 假象 → 排延迟重采
  advance(200);
  assert.equal(svc.report('dark'), false, '与当前主题相同 → 不落盘');
  assert.deepEqual(applied, ['dark'], '仍触发 onApplied 重设 NC');
  timer.fire();
  assert.equal(svc.get(), 'dark', '已确认 dark 后延迟重采必须被取消，不能回落 light');
  assert.deepEqual(applied, ['dark'], '不得追加 light');
});

test('宽限期内重复的 light 上报只排一次重采（多次上报不堆积定时器）', () => {
  const { svc, advance, timer } = setup({ initial: 'dark' });
  advance(1000);
  svc.report('light');
  svc.report('light');
  svc.report('light');
  assert.equal(timer.live().length, 1, '重复上报不得堆积重采定时器');
  timer.fire();
  assert.equal(svc.get(), 'light');
});

// ── isThemeProbeUrl：主题探针只在 Notion 应用页有效 ──
// calendar.notion.so 等姊妹站没有 dark class，探针会误报 light 污染全局主题（实测坑）

test('isThemeProbeUrl：Notion 应用页放行', () => {
  assert.equal(isThemeProbeUrl('https://www.notion.so/'), true);
  assert.equal(isThemeProbeUrl('https://www.notion.so/3db322f5b25c80a5981ee5a3f89a9459'), true);
  assert.equal(isThemeProbeUrl('https://notion.so/RSS-3c9322f5b25c80acb721cd39951e01b2'), true);
  assert.equal(isThemeProbeUrl('https://app.notion.com/p/3db322f5b25c80a5981ee5a3f89a9459?v=1'), true);
});

test('isThemeProbeUrl：姊妹站/仿冒域名拒绝', () => {
  assert.equal(isThemeProbeUrl('https://calendar.notion.so/'), false);
  assert.equal(isThemeProbeUrl('https://calendar.notion.com/'), false);
  assert.equal(isThemeProbeUrl('https://developers.notion.so/'), false);
  assert.equal(isThemeProbeUrl('https://www.notion.so.evil.com/'), false);
  assert.equal(isThemeProbeUrl('https://evil.com/?q=www.notion.so'), false);
  assert.equal(isThemeProbeUrl('file:///H:/x/index.html'), false);
  assert.equal(isThemeProbeUrl(''), false);
  assert.equal(isThemeProbeUrl(undefined), false);
});
