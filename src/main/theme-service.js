// Notion 主题状态归口：持久化优先于系统主题（混合模式系统下 shouldUseDarkColors
// 拿到的是浅色）；启动宽限期内忽略与持久化 dark 冲突的 light 假象上报——
// Notion 账户主题要等 JS 就绪后才打 dark class，早期探测恒为 light，
// 接受了会白标题栏数秒且 theme.json 被污染
const { saveTheme } = require('./theme-store');

const GRACE_MS = 15000;

function shouldAcceptReport(reported, current, elapsedMs, graceMs = GRACE_MS) {
  if (reported !== 'dark' && reported !== 'light') return false;
  if (reported === 'light' && current === 'dark' && elapsedMs < graceMs) return false;
  return true;
}

function createThemeService({ themeFile, initial, onApplied, now = () => Date.now() }) {
  let current = initial === 'dark' ? 'dark' : 'light';
  const bootedAt = now();
  return {
    get: () => current,
    // 返回是否接受了上报（落盘/回调发生）；重复主题与假象上报都算未接受
    report(theme, at = now()) {
      if (theme !== 'dark' && theme !== 'light') return false;
      const changed = theme !== current;
      // 宽限期只拦"与持久化 dark 冲突的 light 假象"；dark 上报任何时刻放行
      if (changed && !shouldAcceptReport(theme, current, at - bootedAt)) return false;
      current = theme;
      if (changed && themeFile) saveTheme(themeFile, theme);
      // 即便主题未变也触发 onApplied：持久化 dark 时启动早期那次 NC 设置可能因
      // 窗口尚未就绪而未生效，Notion 上报 dark（此时窗口已就绪）需要这次重设机会，
      // 否则 Win10 无边框窗口的 1px 白边会一直残留（跨机器时序差异根因）
      if (onApplied) onApplied(theme);
      return changed;
    },
  };
}

module.exports = { createThemeService, shouldAcceptReport, GRACE_MS };
