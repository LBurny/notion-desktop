const fs = require('fs');
const path = require('path');

function ensureCustomCss(userDataDir, defaultCssPath) {
  const customPath = path.join(userDataDir, 'custom.css');
  if (!fs.existsSync(customPath)) {
    fs.copyFileSync(defaultCssPath, customPath);
  }
  return customPath;
}

function readCombinedCss(defaultCssPath, customCssPath) {
  let out = '';
  try { out += fs.readFileSync(defaultCssPath, 'utf8'); } catch { /* 容错 */ }
  out += '\n';
  try { out += fs.readFileSync(customCssPath, 'utf8'); } catch { /* 容错 */ }
  return out;
}

function watchCustomCss(customCssPath, onChange, delay = 300) {
  let timer = null;
  const watcher = fs.watch(customCssPath, () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(customCssPath), delay);
  });
  return {
    close: () => { clearTimeout(timer); watcher.close(); },
  };
}

// 合并结果进程内缓存：custom.css 由 watcher 失效；设置变化只影响 buildSettingsCss
// 输出（不触碰文件），缓存无需因此失效
function createCssProvider(defaultCssPath, customCssPath) {
  let cached = null;
  return {
    combined() {
      if (cached === null) cached = readCombinedCss(defaultCssPath, customCssPath);
      return cached;
    },
    invalidate() { cached = null; },
  };
}

module.exports = { ensureCustomCss, readCombinedCss, watchCustomCss, createCssProvider };
