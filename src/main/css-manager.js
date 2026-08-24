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

module.exports = { ensureCustomCss, readCombinedCss, watchCustomCss };
