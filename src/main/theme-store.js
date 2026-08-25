// Notion 页面主题持久化：启动时立即拿到上次主题，不必等 Notion 上报（数秒）。
// 解决混合模式系统（深色任务栏+浅色应用）下启动白标题栏/白加载页的问题。
const fs = require('fs');
const path = require('path');

function loadTheme(filePath) {
  try {
    const { theme } = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return theme === 'dark' || theme === 'light' ? theme : null;
  } catch {
    return null;
  }
}

function saveTheme(filePath, theme) {
  if (theme !== 'dark' && theme !== 'light') return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ theme }));
}

module.exports = { loadTheme, saveTheme };
