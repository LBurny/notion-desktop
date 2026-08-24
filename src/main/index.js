const path = require('path');
const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, screen, nativeTheme, Tray, Menu, globalShortcut } = require('electron');
const { loadState, isVisibleOnSomeDisplay, trackWindow } = require('./window-state');
const { ensureCustomCss, readCombinedCss, watchCustomCss } = require('./css-manager');
const { calcMenuPosition } = require('./menu-position');
const { loadSettings, saveSettings, sanitizeSettings, clampZoom, buildSettingsCss } = require('./style-settings');
const { comboToAccelerator } = require('./hotkeys');
const { listSystemFonts } = require('./system-fonts');
const { createTabManager, saveTabsFile } = require('./tab-manager');
const { createTabs } = require('./tabs');

const NOTION_URL = 'https://www.notion.so/';
const TITLEBAR_HEIGHT = 36;
const DEFAULT_CSS = path.join(__dirname, '..', '..', 'assets', 'default.css');

let win;
let titlebarView;
let currentTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
let tray = null;
let trayMenu = null;
let isQuitting = false;
let styleSettings = null;
let settingsFile = null;
let tabs = null;
let customCssPath = null;

const TRAY_MENU_SIZE = { width: 150, height: 160 };

// 「样式」与「设置」两个子窗口的配置；内容后续会持续扩充
const SETTINGS_WINDOWS = {
  style: { height: 300, dir: 'style-settings' },
  app: { height: 480, dir: 'app-settings' },
};
const settingsWins = { style: null, app: null };

// 主题广播：标题栏、托盘菜单、样式/设置窗哪个开着就发给哪个
function broadcastTheme(theme) {
  for (const v of [titlebarView, trayMenu, settingsWins.style, settingsWins.app]) {
    if (v && !v.webContents.isDestroyed()) v.webContents.send('theme-changed', theme);
  }
}

function showTrayMenu(trayBounds) {
  if (!trayMenu) {
    trayMenu = new BrowserWindow({
      width: TRAY_MENU_SIZE.width,
      height: TRAY_MENU_SIZE.height,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, '..', 'preload', 'tray-menu.js') },
    });
    trayMenu.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'tray-menu', 'index.html'));
    trayMenu.on('blur', () => trayMenu.hide());
    trayMenu.on('closed', () => { trayMenu = null; });
  }
  const display = screen.getDisplayMatching(trayBounds);
  const pos = calcMenuPosition(trayBounds, TRAY_MENU_SIZE, display.workArea);
  trayMenu.setPosition(pos.x, pos.y);
  trayMenu.show();
  trayMenu.focus();
  trayMenu.webContents.send('theme-changed', currentTheme);
}

function openSettingsWindow(kind) {
  const cfg = SETTINGS_WINDOWS[kind];
  let w = settingsWins[kind];
  if (w) {
    w.show();
    w.focus();
    return;
  }
  w = new BrowserWindow({
    width: 340,
    height: cfg.height,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: currentTheme === 'dark' ? '#252525' : '#ffffff',
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'settings.js') },
  });
  settingsWins[kind] = w;
  // 居中于主窗口所在显示器
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  w.setPosition(
    Math.round(area.x + (area.width - 340) / 2),
    Math.round(area.y + (area.height - cfg.height) / 2)
  );
  w.webContents.loadFile(path.join(__dirname, '..', 'renderer', cfg.dir, 'index.html'));
  w.once('ready-to-show', () => w.show());
  w.webContents.on('did-finish-load', () => {
    w.webContents.send('theme-changed', currentTheme);
  });
  w.on('closed', () => { settingsWins[kind] = null; });
}

function currentCss() {
  return readCombinedCss(DEFAULT_CSS, customCssPath)
    + '\n' + buildSettingsCss(styleSettings || {});
}

// 设置或自定义 CSS 变化后，重刷所有已创建的标签视图
function applyViewSettings() {
  if (!tabs) return;
  tabs.forEachView((v, rec) => {
    const wc = v.webContents;
    const pre = rec.cssKey ? wc.removeInsertedCSS(rec.cssKey).catch(() => {}) : Promise.resolve();
    pre.then(() => wc.insertCSS(currentCss(), { cssOrigin: 'author' }))
      .then((k) => { rec.cssKey = k; })
      .catch(() => {});
    if (styleSettings) wc.setZoomFactor(styleSettings.zoom);
  });
}

function adjustZoom(delta) {
  if (!styleSettings) return;
  styleSettings.zoom = clampZoom(Math.round((styleSettings.zoom + delta) * 100) / 100);
  if (settingsFile) saveSettings(settingsFile, styleSettings);
  if (tabs) tabs.forEachView((v) => v.webContents.setZoomFactor(styleSettings.zoom));
}

// 全局快捷键：toggleWindow 必须在窗口隐藏时也能唤回，故用 globalShortcut
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const h = styleSettings ? styleSettings.hotkeys : null;
  if (h) {
    const bind = (combo, fn) => {
      try { globalShortcut.register(comboToAccelerator(combo), fn); } catch { /* 非法组合直接忽略 */ }
    };
    bind(h.zoomIn, () => adjustZoom(0.01));
    bind(h.zoomOut, () => adjustZoom(-0.01));
    bind(h.toggleWindow, () => { if (win.isVisible()) { win.hide(); } else { win.show(); } });
  }
  registerTabSwitchKeys();
}

// Ctrl+Tab 和 Ctrl+PageDown/PageUp 都是 Chromium 保留键，到不了 before-input-event（菜单加速器同理）；
// 只能在主窗口聚焦期间注册为全局快捷键，失焦即注销，不影响其他应用
function registerTabSwitchKeys() {
  if (!win || !win.isFocused() || !tabs) return;
  try { globalShortcut.register('CommandOrControl+PageDown', () => tabs.nextTab()); } catch { /* 已注册则忽略 */ }
  try { globalShortcut.register('CommandOrControl+Shift+PageUp', () => tabs.prevTab()); } catch { /* 已注册则忽略 */ }
}

function unregisterTabSwitchKeys() {
  try { globalShortcut.unregister('CommandOrControl+PageDown'); } catch { /* 未注册则忽略 */ }
  try { globalShortcut.unregister('CommandOrControl+Shift+PageUp'); } catch { /* 未注册则忽略 */ }
}

function layoutViews() {
  const { width, height } = win.getContentBounds();
  titlebarView.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
  if (tabs) tabs.layout();
}

function createWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const state = loadState(stateFile);
  if (!isVisibleOnSomeDisplay(state, screen.getAllDisplays())) {
    delete state.x;
    delete state.y;
  }

  win = new BaseWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff',
  });

  titlebarView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'titlebar.js') },
  });

  win.contentView.addChildView(titlebarView);
  layoutViews();

  titlebarView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'titlebar', 'index.html'));
  // 标题栏加载完成后补发一次当前主题与标签状态，消除「消息先于监听注册」的竞态
  titlebarView.webContents.on('did-finish-load', () => {
    titlebarView.webContents.send('theme-changed', currentTheme);
    titlebarView.webContents.send('window-maximized', win.isMaximized());
    // 顶栏动作区初始按可用渲染，真实状态随首次导航的 pushTopbarState 到达
    titlebarView.webContents.send('topbar-state', { available: true, favorited: null });
    if (tabs) titlebarView.webContents.send('tabs-changed', tabs.payload());
  });

  if (state.isMaximized) win.maximize();

  win.on('resize', layoutViews);
  trackWindow(win, stateFile);

  win.on('maximize', () => titlebarView.webContents.send('window-maximized', true));
  win.on('unmaximize', () => titlebarView.webContents.send('window-maximized', false));

  win.on('close', (e) => {
    if (isQuitting) return;
    if (styleSettings && styleSettings.closeAction === 'quit') {
      isQuitting = true;
      return; // 不拦截，窗口关闭后 window-all-closed 退出程序
    }
    e.preventDefault();
    win.hide();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  settingsFile = path.join(app.getPath('userData'), 'style-settings.json');
  styleSettings = loadSettings(settingsFile);
  const tabsFile = path.join(app.getPath('userData'), 'tabs.json');
  createWindow();
  registerHotkeys();

  customCssPath = ensureCustomCss(app.getPath('userData'), DEFAULT_CSS);

  // 标签状态变化 → 推送标题栏渲染 + 防抖持久化
  let saveTimer = null;
  const manager = createTabManager();
  tabs = createTabs({
    win, manager,
    homeUrl: NOTION_URL,
    partition: 'persist:notion',
    preloadPath: path.join(__dirname, '..', 'preload', 'content.js'),
    errorPagePath: path.join(__dirname, '..', 'renderer', 'error.html'),
    titlebarHeight: TITLEBAR_HEIGHT,
    getCss: currentCss,
    getZoom: () => (styleSettings ? styleSettings.zoom : 1),
    getSlashCommands: () => (styleSettings ? styleSettings.slashCommands : []),
    onChanged: () => {
      if (titlebarView && !titlebarView.webContents.isDestroyed()) {
        titlebarView.webContents.send('tabs-changed', tabs.payload());
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveTabsFile(tabsFile, manager.serialize()), 400);
    },
    onTopbarState: (s) => {
      if (titlebarView && !titlebarView.webContents.isDestroyed()) {
        titlebarView.webContents.send('topbar-state', s);
      }
    },
    onEmpty: () => win.close(),
    saveFile: tabsFile,
  });
  if (!tabs.restore()) tabs.newTab(NOTION_URL);

  win.on('focus', registerTabSwitchKeys);
  win.on('blur', unregisterTabSwitchKeys);
  registerTabSwitchKeys();

  watchCustomCss(customCssPath, () => { applyViewSettings(); });
  console.log('自定义样式文件:', customCssPath);

  tray = new Tray(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  tray.setToolTip('Notion Desktop');
  tray.on('click', () => { if (win.isVisible()) { win.hide(); } else { win.show(); } });
  tray.on('right-click', (_e, bounds) => showTrayMenu(bounds));

  ipcMain.on('tray-menu-action', (_e, action) => {
    if (trayMenu) trayMenu.hide();
    if (action === 'open') {
      win.show();
    } else if (action === 'style' || action === 'settings') {
      win.show();
      openSettingsWindow(action === 'style' ? 'style' : 'app');
    } else if (action === 'quit') {
      isQuitting = true;
      app.quit();
    }
  });

  ipcMain.on('get-style-settings', (e) => { e.returnValue = styleSettings; });
  // 系统字体枚举走注册表（与 Word 同源），结果进程级缓存
  let cachedFonts = null;
  ipcMain.on('system-fonts', (e) => {
    if (!cachedFonts) cachedFonts = listSystemFonts();
    e.returnValue = cachedFonts;
  });
  ipcMain.handle('style-settings-update', (_e, raw) => {
    styleSettings = sanitizeSettings(raw);
    saveSettings(settingsFile, styleSettings);
    applyViewSettings();
    registerHotkeys();
    if (titlebarView && !titlebarView.webContents.isDestroyed()) {
      titlebarView.webContents.send('style-changed', styleSettings);
    }
    return true;
  });
  ipcMain.on('settings-close', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.close();
  });

  ipcMain.on('retry-load', (e) => {
    const rec = tabs && tabs.findByWebContents(e.sender);
    if (rec) rec.view.webContents.loadURL(rec.url);
  });

  ipcMain.on('tabs-activate', (_e, id) => tabs.activateTab(id));
  ipcMain.on('tabs-close', (_e, id) => tabs.closeTab(id));
  ipcMain.on('tabs-new', () => tabs.newTabInteractive());
  ipcMain.on('tabs-reorder', (_e, ids) => tabs.reorder(ids));
  ipcMain.on('quick-find-picked', (e, href) => tabs.quickFindPicked(e.sender, href));
  ipcMain.on('quick-find-dismissed', (e) => tabs.quickFindDismissed(e.sender));

  // 白名单校验，防非法 action 触发 buildClickScript 抛错
  ipcMain.on('topbar-action', (_e, action) => {
    if (!/^(sidebar|share|favorite|more)$/.test(action)) return;
    tabs.topbarAction(action);
  });

  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-toggle-maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('window-close', () => win.close());
  ipcMain.on('get-theme', (e) => { e.returnValue = currentTheme; });
  ipcMain.on('notion-theme-changed', (_e, theme) => {
    if (theme !== 'dark' && theme !== 'light') return;
    currentTheme = theme;
    broadcastTheme(theme);
    win.setBackgroundColor(theme === 'dark' ? '#191919' : '#ffffff');
  });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
