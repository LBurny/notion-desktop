// 弹窗双主题预览：npx electron scripts/preview-menu.js [menu|style|settings|tabs]
// 产物写到 .playwright-mcp/<name>-<light|dark>.png
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { listSystemFonts } = require('../src/main/system-fonts');

const TARGETS = {
  menu: { width: 150, height: 160, dir: 'tray-menu', preload: 'tray-menu.js' },
  style: { width: 340, height: 380, dir: 'style-settings', preload: 'settings.js' },
  settings: { width: 340, height: 440, dir: 'app-settings', preload: 'settings.js' },
  tabs: { width: 900, height: 36, dir: 'titlebar', preload: 'titlebar.js' },
};

const DEMO_SETTINGS = {
  font: '思源宋体 CN', lineHeight: 1.73, paragraphSpacing: 4, zoom: 1.05, hideHelp: true, dividerWidth: 1.5, align: 'justify',
  hotkeys: { zoomIn: 'Ctrl+Shift+=', zoomOut: 'Ctrl+Shift+-', toggleWindow: 'Ctrl+`' },
  slashCommands: [{ combo: 'Ctrl+Shift+M', command: 'math' }, { combo: 'Ctrl+Shift+D', command: 'divider' }],
  closeAction: 'tray',
};

const DEMO_TABS = [
  { id: 't1', url: '', title: 'Paper', active: false },
  { id: 't2', url: '', title: 'Agent驱动的涡轮设计审稿意见', active: true },
  { id: 't3', url: '', title: '基于主动学习的物理信息神经网络高效采样方法', active: false },
];

const name = process.argv[2] || 'menu';
const target = TARGETS[name] || TARGETS.menu;

app.whenReady().then(async () => {
  let theme = 'light';
  ipcMain.on('get-theme', (e) => { e.returnValue = theme; });
  ipcMain.on('tray-menu-action', () => {});
  ipcMain.on('get-style-settings', (e) => { e.returnValue = DEMO_SETTINGS; });
  ipcMain.on('system-fonts', (e) => { e.returnValue = listSystemFonts(); });
  ipcMain.handle('style-settings-update', () => true);
  ipcMain.on('settings-close', () => {});
  // 标题栏（标签条）场景的通道桩
  ipcMain.on('window-minimize', () => {});
  ipcMain.on('window-toggle-maximize', () => {});
  ipcMain.on('window-close', () => {});
  ipcMain.on('tabs-activate', () => {});
  ipcMain.on('tabs-close', () => {});
  ipcMain.on('tabs-new', () => {});
  ipcMain.on('tabs-reorder', () => {});

  const win = new BrowserWindow({
    width: target.width, height: target.height,
    show: false, frame: false, transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload', target.preload),
      offscreen: true,
    },
  });
  for (const t of ['light', 'dark']) {
    theme = t;
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', target.dir, 'index.html'));
    await new Promise((r) => setTimeout(r, 400));
    if (name === 'tabs') {
      win.webContents.send('tabs-changed', { tabs: DEMO_TABS, canAdd: true });
      await new Promise((r) => setTimeout(r, 200));
    }
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', '.playwright-mcp', `${name}-${t}.png`), img.toPNG());
    console.log('written', t);
  }
  // 标签条追加溢出场景：10 个长标题标签 + 禁用加号
  if (name === 'tabs') {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: 'm' + i, url: '', title: '基于主动学习的物理信息神经网络高效采样方法 ' + (i + 1), active: i === 3,
    }));
    win.webContents.send('tabs-changed', { tabs: many, canAdd: false });
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', '.playwright-mcp', 'tabs-overflow.png'), img.toPNG());
    console.log('written tabs-overflow');
  }
  // 样式页追加验证：字体下拉展开态（自绘列表，跟随主题，可滚动）
  if (name === 'style') {
    const n = await win.webContents.executeJavaScript(
      "document.getElementById('font-toggle').click(); document.querySelectorAll('#font-options li').length"
    );
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', '.playwright-mcp', 'style-font-open.png'), img.toPNG());
    console.log('written style-font-open, options:', n);
  }
  win.destroy();
  app.quit();
});
