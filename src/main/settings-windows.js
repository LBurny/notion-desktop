// 「样式」「设置」两个子窗口归口：创建/定位/缩放同步/主题广播。
// 关闭改隐藏缓存（重开免重建，即时显示）；应用退出时（isQuitting）才真正销毁。
// 宽高随页面缩放等比放大（settingsWindowSize），只放高度会横向裁剪。
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { settingsWindowSize } = require('./style-settings');

function createSettingsWindows({
  baseWidth, configs, getZoom, getTheme, getAnchorBounds, isQuitting,
}) {
  const wins = {}; // kind → BrowserWindow | null

  function sizeFor(kind, zoom, area) {
    return settingsWindowSize(baseWidth, configs[kind].height, zoom, area.width - 40, area.height - 40);
  }

  function open(kind) {
    const cfg = configs[kind];
    let w = wins[kind];
    if (w && !w.isDestroyed()) {
      w.show();
      w.focus();
      return w;
    }
    const zoom = getZoom();
    const theme = getTheme(); // 首帧主题广播（页面启动即收，随正文变色）
    // 居中于主窗口所在显示器；宽高随缩放等比放大，且不超出工作区
    const area = screen.getDisplayMatching(getAnchorBounds()).workArea;
    const size = sizeFor(kind, zoom, area);
    w = new BrowserWindow({
      width: size.width,
      height: size.height,
      frame: false,
      transparent: true, // 圆角由页面 body 的 border-radius 绘制（参考托盘菜单），底色不再由窗口承担
      resizable: false,
      skipTaskbar: false,
      show: false,
      icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
      webPreferences: { preload: path.join(__dirname, '..', 'preload', 'settings.js') },
    });
    wins[kind] = w;
    w.setPosition(
      Math.round(area.x + (area.width - size.width) / 2),
      Math.round(area.y + (area.height - size.height) / 2),
    );
    w.webContents.loadFile(path.join(__dirname, '..', 'renderer', cfg.dir, 'index.html'));
    w.once('ready-to-show', () => { if (!w.isDestroyed()) w.show(); });
    w.webContents.on('did-finish-load', () => {
      // 设置窗口也跟随页面缩放（did-finish-load 早于首帧完成，避免闪动）
      if (w.isDestroyed()) return;
      w.webContents.setZoomFactor(zoom);
      w.webContents.send('theme-changed', theme);
    });
    // 关闭即隐藏缓存，重开免重建；退出应用时放行真正销毁
    w.on('close', (e) => {
      if (isQuitting()) return;
      e.preventDefault();
      w.hide();
    });
    w.on('closed', () => { if (wins[kind] === w) wins[kind] = null; });
    return w;
  }

  function forEachWin(fn) {
    for (const kind of Object.keys(wins)) {
      const w = wins[kind];
      if (w && !w.isDestroyed()) fn(w, kind);
    }
  }

  function applyZoom() {
    const zoom = getZoom();
    forEachWin((w, kind) => {
      w.webContents.setZoomFactor(zoom);
      const area = screen.getDisplayMatching(w.getBounds()).workArea;
      const size = sizeFor(kind, zoom, area);
      w.setContentSize(size.width, size.height);
    });
  }

  return {
    open,
    applyZoom,
    broadcastTheme: (theme) => forEachWin((w) => w.webContents.send('theme-changed', theme)),
    forEachWin,
  };
}

module.exports = { createSettingsWindows };
