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
      if (theme === current) return false;
      if (!shouldAcceptReport(theme, current, at - bootedAt)) return false;
      current = theme;
      if (themeFile) saveTheme(themeFile, theme);
      if (onApplied) onApplied(theme);
      return true;
    },
  };
}

module.exports = { createThemeService, shouldAcceptReport, GRACE_MS };
