// V8 编译缓存：加速冷启动的模块编译（Node 22.1+；旧运行时静默跳过）
try { require('node:module').enableCompileCache(); } catch { /* 无此 API 时忽略 */ }
const path = require('path');
const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, screen, nativeTheme, Tray, Menu, globalShortcut, session } = require('electron');

// 单实例锁：尽早检查（在加载其余模块之前），第二实例立刻 app.exit 退出。
// app.exit(0) 比 app.quit 更快——跳过所有退出事件直接终止进程，
// 避免第二实例短暂存活导致可见闪烁/任务栏闪现
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
}

const { createPerf } = require('./perf');
const { loadState, isVisibleOnSomeDisplay, trackWindow } = require('./window-state');
const { ensureCustomCss, createCssProvider, watchCustomCss } = require('./css-manager');
const { debounce } = require('./debounce');
const { calcMenuPosition } = require('./menu-position');
const { loadSettings, saveSettings, sanitizeSettings, clampZoom, buildSettingsCss, titlebarHeightForZoom } = require('./style-settings');
const { loadTheme } = require('./theme-store');
const { createThemeService } = require('./theme-service');
const { createHotkeys } = require('./hotkey-service');
const { comboToAccelerator } = require('./hotkeys');
const { listSystemFonts } = require('./system-fonts');
const { createTabManager, saveTabsFile } = require('./tab-manager');
const { createTabs } = require('./tabs');
const { createSettingsWindows } = require('./settings-windows');
const { attachRequestFilter } = require('./request-filter');
const { resolveTrayAction } = require('./tray-actions');
const { syncLoginItem, shouldStartHidden } = require('./login-item');
const { resolveLanguage } = require('../renderer/shared/i18n');

const NOTION_URL = 'https://www.notion.so/';
const TITLEBAR_HEIGHT = 36;
const DEFAULT_CSS = path.join(__dirname, '..', '..', 'assets', 'default.css');

let win;
let titlebarView;
let settingsFile = null;
let themeFile = null;
let themeService = null;
let tray = null;
let trayMenu = null;
let isQuitting = false;
let styleSettings = null;
let tabs = null;
let customCssPath = null;
let cssProvider = null;

// 系统字体枚举结果进程级缓存（注册表读一次）；供 system-fonts IPC 与
// buildSettingsCss 的公式 Modern 系默认解析共用
let cachedFonts = null;
function getSystemFontsCached() {
  if (!cachedFonts) cachedFonts = listSystemFonts();
  return cachedFonts;
}

const TRAY_MENU_SIZE = { width: 150, height: 160 };

// ND_PERF=1 时输出启动/加载里程碑耗时
const perf = createPerf({ enabled: !!process.env.ND_PERF });

let settingsWindows = null;

// 主题广播：标题栏、托盘菜单、样式/设置窗哪个开着就发给哪个
function broadcastTheme(theme) {
  for (const v of [titlebarView, trayMenu]) {
    if (v && !v.webContents.isDestroyed()) v.webContents.send('theme-changed', theme);
  }
  if (settingsWindows) settingsWindows.broadcastTheme(theme);
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
  trayMenu.webContents.send('theme-changed', themeService.get());
  // 菜单缓存复用，每次弹出同步当前语言（设置里切过语言后下次弹出即生效）
  trayMenu.webContents.send('language-changed', currentLanguage());
}

function currentLanguage() {
  return resolveLanguage(styleSettings ? styleSettings.language : 'auto', app.getLocale());
}

function openSettingsWindow(kind) {
  settingsWindows.open(kind);
}

function currentCss() {
  return (cssProvider ? cssProvider.combined() : '')
    + '\n' + buildSettingsCss(styleSettings || {}, getSystemFontsCached());
}

// 标题栏随页面缩放等比放大（内容 36px × zoomFactor，bounds 必须同步否则裁剪）
function titlebarHeightNow() {
  return titlebarHeightForZoom(TITLEBAR_HEIGHT, styleSettings ? styleSettings.zoom : 1);
}

// 设置或自定义 CSS 变化后，重刷所有已创建的标签视图（CSS 重注入在 tabs.reinjectCss）
function applyViewSettings() {
  if (!tabs) return;
  tabs.reinjectCss();
  applyZoomEverywhere();
}

// 缩放同时作用于页面视图、标题栏与打开中的设置窗口；
// 标题栏/设置窗尺寸变化后需重新布局或调整窗口大小
function applyZoomEverywhere() {
  if (!styleSettings) return;
  if (tabs) tabs.forEachView((v) => v.webContents.setZoomFactor(styleSettings.zoom));
  if (titlebarView && !titlebarView.webContents.isDestroyed()) {
    titlebarView.webContents.setZoomFactor(styleSettings.zoom);
  }
  if (settingsWindows) settingsWindows.applyZoom();
  layoutViews();
}

// 缩放快捷键每按 1% 都会触发：落盘防抖合并（应用缩放本身即时，不落盘延迟）
const persistSettingsSoon = debounce(() => {
  if (settingsFile && styleSettings) saveSettings(settingsFile, styleSettings);
}, 400);

function adjustZoom(delta) {
  if (!styleSettings) return;
  styleSettings.zoom = clampZoom(Math.round((styleSettings.zoom + delta) * 100) / 100);
  persistSettingsSoon();
  applyZoomEverywhere();
}

// 全局快捷键归 hotkey-service（toggleWindow 须在窗口隐藏时也能唤回，故用 globalShortcut）；
// 标签切换键仅聚焦期注册由服务内部处理
let hotkeys = null;

function layoutViews() {
  const { width, height } = win.getContentBounds();
  titlebarView.setBounds({ x: 0, y: 0, width, height: titlebarHeightNow() });
  if (tabs) tabs.layout();
}

function createWindow({ startHidden = false } = {}) {
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
    show: false, // 显式 show：登录项静默拉起（startHidden）时主窗不弹，留在托盘
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'), // 多尺寸 ico：Windows 按 DPI 自选，高分屏不再发糊
    backgroundColor: themeService.get() === 'dark' ? '#191919' : '#ffffff',
  });
  if (!startHidden) win.show();

  titlebarView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'titlebar.js') },
  });

  win.contentView.addChildView(titlebarView);
  layoutViews();

  titlebarView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'titlebar', 'index.html'));
  // 标题栏加载完成后补发一次当前主题与标签状态，消除「消息先于监听注册」的竞态
  titlebarView.webContents.on('did-finish-load', () => {
    titlebarView.webContents.setZoomFactor(styleSettings ? styleSettings.zoom : 1);
    titlebarView.webContents.send('theme-changed', themeService.get());
    titlebarView.webContents.send('window-maximized', win.isMaximized());
    // 顶栏动作区初始按可用渲染，真实状态随首次导航的 pushTopbarState 到达
    titlebarView.webContents.send('topbar-state', { available: true, favorited: null });
    if (tabs) titlebarView.webContents.send('tabs-changed', tabs.payload());
  });

  if (state.isMaximized) win.maximize();

  win.on('resize', layoutViews);
  trackWindow(win, stateFile);
  perf.mark('window-created');

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

// 单实例锁已在文件顶部尽早获取（gotTheLock）；第二实例已 app.exit(0) 退出。
// 此处仅为第一实例注册 second-instance 处理器：唤起主窗（托盘隐藏则 show，
// 最小化则 restore，已可见则 focus），不重复调 show+focus 避免抖动
if (gotTheLock) {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    else if (!win.isVisible()) win.show();
    else win.focus();
  });
}

app.whenReady().then(() => {
  perf.mark('app-ready');
  Menu.setApplicationMenu(null);
  settingsFile = path.join(app.getPath('userData'), 'style-settings.json');
  styleSettings = loadSettings(settingsFile);
  // 开机自启（静默到托盘）：同步注册表登录项（开发态不写，避免污染）；
  // 本次由登录项拉起则主窗不弹，托盘/全局快捷键照常可用
  if (app.isPackaged) syncLoginItem(app, styleSettings.launchAtLogin);
  const startHidden = styleSettings.launchAtLogin && shouldStartHidden(app);
  // 主题持久化优先于系统主题：混合模式系统（深色任务栏+浅色应用）下
  // shouldUseDarkColors 拿到的是浅色，会白标题栏数秒直到 Notion 上报。
  // 宽限期/落盘/广播全部归 theme-service
  themeFile = path.join(app.getPath('userData'), 'theme.json');
  themeService = createThemeService({
    themeFile,
    initial: loadTheme(themeFile) || (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    onApplied: (theme) => {
      broadcastTheme(theme);
      if (win) win.setBackgroundColor(theme === 'dark' ? '#191919' : '#ffffff');
      if (tabs) tabs.setViewsBackground(theme); // 已建视图加载底色同步，防下次加载闪白
    },
  });
  // 「样式」「设置」子窗口归口（关闭改隐藏缓存，重开即时）。
  // 两页同宽 400（统一回落 baseWidth，设置页不再窄于样式页）；高度按内容贴合：
  // 样式 585（表单 10 行+3 分区头+hint），设置 595（5 分区含启动/语言）；
  // #form 均可滚动兜底（shared/base-win.css），新增表单行不必再调基准高度
  settingsWindows = createSettingsWindows({
    baseWidth: 400,
    configs: {
      style: { height: 585, dir: 'style-settings' },
      app: { height: 595, dir: 'app-settings' },
    },
    getZoom: () => (styleSettings ? styleSettings.zoom : 1),
    getTheme: () => themeService.get(),
    getLanguage: currentLanguage,
    getAnchorBounds: () => win.getBounds(),
    isQuitting: () => isQuitting,
  });
  const tabsFile = path.join(app.getPath('userData'), 'tabs.json');
  createWindow({ startHidden });
  hotkeys = createHotkeys({
    globalShortcut,
    comboToAccelerator,
    isFocused: () => win.isFocused(),
    getCombos: () => (styleSettings ? styleSettings.hotkeys : null),
    actions: {
      zoomIn: () => adjustZoom(0.01),
      zoomOut: () => adjustZoom(-0.01),
      toggleWindow: () => { if (win.isVisible()) { win.hide(); } else { win.show(); } },
      nextTab: () => { if (tabs) tabs.nextTab(); },
      prevTab: () => { if (tabs) tabs.prevTab(); },
    },
  });
  hotkeys.registerAll();

  customCssPath = ensureCustomCss(app.getPath('userData'), DEFAULT_CSS);
  cssProvider = createCssProvider(DEFAULT_CSS, customCssPath);

  // 遥测/广告域名拦截：必须早于任何标签 loadURL（restore/newTab 在 createTabs 之后）
  attachRequestFilter(session.fromPartition('persist:notion'));

  // 标签状态变化 → 推送标题栏渲染 + 防抖持久化
  let saveTimer = null;
  const manager = createTabManager();
  tabs = createTabs({
    win, manager,
    homeUrl: NOTION_URL,
    partition: 'persist:notion',
    preloadPath: path.join(__dirname, '..', 'preload', 'content.js'),
    errorPagePath: path.join(__dirname, '..', 'renderer', 'error.html'),
    getTitlebarHeight: titlebarHeightNow,
    getCss: currentCss,
    getZoom: () => (styleSettings ? styleSettings.zoom : 1),
    getTheme: () => themeService.get(),
    getSlashCommands: () => (styleSettings ? styleSettings.slashCommands : []),
    onUiFont: (font) => {
      if (titlebarView && !titlebarView.webContents.isDestroyed()) {
        titlebarView.webContents.send('ui-font-changed', font);
      }
    },
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
  const firstView = tabs.activeView();
  if (firstView) {
    firstView.webContents.once('dom-ready', () => perf.mark('first-view-dom-ready'));
    firstView.webContents.once('did-finish-load', () => perf.mark('first-view-loaded'));
  }

  win.on('focus', () => hotkeys.registerTabSwitch());
  win.on('blur', () => hotkeys.unregisterTabSwitch());
  hotkeys.registerTabSwitch();

  watchCustomCss(customCssPath, () => { cssProvider.invalidate(); applyViewSettings(); });
  console.log('自定义样式文件:', customCssPath);

  tray = new Tray(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  tray.setToolTip('Notion Desktop');
  tray.on('click', () => { if (win.isVisible()) { win.hide(); } else { win.show(); } });
  tray.on('right-click', (_e, bounds) => showTrayMenu(bounds));

  ipcMain.on('tray-menu-action', (_e, action) => {
    if (trayMenu) trayMenu.hide();
    // 分派表在 tray-actions.js（纯函数）：open 才弹主窗，style/settings 只开子窗口
    const plan = resolveTrayAction(action);
    if (plan.quit) { isQuitting = true; app.quit(); return; }
    if (plan.showMain) win.show();
    if (plan.settingsKind) openSettingsWindow(plan.settingsKind);
  });

  ipcMain.on('get-style-settings', (e) => { e.returnValue = styleSettings; });
  ipcMain.on('system-fonts', (e) => { e.returnValue = getSystemFontsCached(); });
  // 界面语言解析依赖系统语言（渲染页 resolveLanguage(pref, locale) 的 locale 来源）
  ipcMain.on('system-locale', (e) => { e.returnValue = app.getLocale(); });
  ipcMain.handle('style-settings-update', (_e, raw) => {
    styleSettings = sanitizeSettings(raw);
    saveSettings(settingsFile, styleSettings);
    applyViewSettings();
    hotkeys.registerAll();
    if (app.isPackaged) syncLoginItem(app, styleSettings.launchAtLogin);
    if (titlebarView && !titlebarView.webContents.isDestroyed()) {
      titlebarView.webContents.send('style-changed', styleSettings); // 语言随设置到达，标题栏自行解析
    }
    // 子窗口与托盘菜单的语言即时切换（标题栏走上行 style-changed）
    const lang = currentLanguage();
    if (settingsWindows) settingsWindows.broadcastLanguage(lang);
    if (trayMenu && !trayMenu.isDestroyed()) trayMenu.webContents.send('language-changed', lang);
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

  // 白名单校验，防非法 action 触发越权点击
  ipcMain.on('topbar-action', (_e, action) => {
    if (!/^(sidebar|share|favorite|more)$/.test(action)) return;
    tabs.topbarAction(action);
  });

  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-toggle-maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('window-close', () => win.close());
  ipcMain.on('get-theme', (e) => { e.returnValue = themeService.get(); });
  ipcMain.on('notion-theme-changed', (_e, theme) => { themeService.report(theme); });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
