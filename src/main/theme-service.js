// Notion 主题状态归口：持久化优先于系统主题（混合模式系统下 shouldUseDarkColors
// 拿到的是浅色）；启动宽限期内忽略与持久化 dark 冲突的 light 假象上报——
// Notion 账户主题要等 JS 就绪后才打 dark class，早期探测恒为 light，
// 接受了会白标题栏数秒且 theme.json 被污染
const { saveTheme } = require('./theme-store');

const GRACE_MS = 15000;

// 主题探针只在 Notion 应用页有效：calendar.notion.so 等姊妹站不打 dark class，
// 探针恒报 light——15s 宽限期后被接受会把全局主题与 theme.json 洗成 light（实测坑）。
// 主进程据此丢弃非应用页的主题上报（preload 侧同样按此闸口停发）
const THEME_PROBE_RE = /^https:\/\/((www\.)?notion\.so|app\.notion\.com)\//;
function isThemeProbeUrl(url) {
  return typeof url === 'string' && THEME_PROBE_RE.test(url);
}

function shouldAcceptReport(reported, current, elapsedMs, graceMs = GRACE_MS) {
  if (reported !== 'dark' && reported !== 'light') return false;
  if (reported === 'light' && current === 'dark' && elapsedMs < graceMs) return false;
  return true;
}

function createThemeService({ themeFile, initial, onApplied, now = () => Date.now(), schedule, cancel } = {}) {
  let current = initial === 'dark' ? 'dark' : 'light';
  const bootedAt = now();
  // 默认调度器不 keep-alive 进程：退出时挂着的宽限期重采定时器不应拖延进程结束
  const later = schedule || ((fn, ms) => {
    const timer = setTimeout(fn, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
  });
  const cancelTimer = cancel || ((timer) => clearTimeout(timer));
  let deferred = null; // { theme, timer }：宽限期内被拒、待宽限期结束后再采的上报

  function cancelDeferred() {
    if (!deferred) return;
    cancelTimer(deferred.timer);
    deferred = null;
  }

  function apply(theme, changed) {
    current = theme;
    if (changed && themeFile) saveTheme(themeFile, theme);
    // 即便主题未变也触发 onApplied：持久化 dark 时启动早期那次 NC 设置可能因
    // 窗口尚未就绪而未生效，Notion 上报 dark（此时窗口已就绪）需要这次重设机会，
    // 否则 Win10 无边框窗口的 1px 白边会一直残留（跨机器时序差异根因）
    if (onApplied) onApplied(theme);
  }

  // preload 只在主题**变化**时上报：宽限期内这次 light 被拒后，若页面一直就是
  // light 便再无重报机会（content.js 的 last 已记成 light），外壳会永久停在 dark。
  // 所以被拒的上报要记下来，宽限期结束时自己再采一次。
  function deferRejected(theme, elapsed) {
    cancelDeferred();
    const waitMs = Math.max(0, GRACE_MS - elapsed);
    deferred = {
      theme,
      timer: later(() => {
        const pending = deferred && deferred.theme;
        deferred = null;
        if (pending && pending !== current) apply(pending, true);
      }, waitMs),
    };
  }

  return {
    get: () => current,
    // 返回是否接受了上报（落盘/回调发生）；重复主题与假象上报都算未接受
    report(theme, at = now()) {
      if (theme !== 'dark' && theme !== 'light') return false;
      if (theme === current) {
        // 页面已确认与外壳一致：撤销宽限期内排下的重采，避免之后再被翻回 light
        cancelDeferred();
        apply(theme, false);
        return false;
      }
      const elapsed = at - bootedAt;
      // 宽限期只拦"与持久化 dark 冲突的 light 假象"；dark 上报任何时刻放行
      if (!shouldAcceptReport(theme, current, elapsed)) {
        deferRejected(theme, elapsed);
        return false;
      }
      cancelDeferred();
      apply(theme, true);
      return true;
    },
  };
}

module.exports = { createThemeService, shouldAcceptReport, isThemeProbeUrl, GRACE_MS };
