// 用法: npx electron scripts/render-icon.js
// 读取 build/icon.svg，衬白色圆角底（透明背景黑图形在深色任务栏不可见），
// 用 Chromium 离屏渲染导出三尺寸 PNG：
//   assets/tray.png   16x16  托盘图标
//   assets/icon.png   64x64  窗口/任务栏图标
//   build/icon.png    256x256 electron-builder 安装包图标
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8')
  .replace(/<\?xml[^?]*\?>/, '')
  .replace(/<!DOCTYPE[^>]*>/i, '');

const SIZES = [
  ['assets/tray.png', 16],
  ['assets/icon.png', 64],
  ['build/icon.png', 256],
];

function pageHtml(size) {
  const pad = Math.round(size * 0.08);
  const radius = Math.round(size * 0.2);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
    #bg{width:${size}px;height:${size}px;background:#fff;border-radius:${radius}px;display:flex;align-items:center;justify-content:center}
    #icon{width:${size - pad * 2}px;height:${size - pad * 2}px}
    #icon svg{width:100%!important;height:100%!important;display:block}
  </style></head><body><div id="bg"><div id="icon">${svg}</div></div></body></html>`;
}

app.whenReady().then(async () => {
  const os = require('os');
  // 离屏窗口在高分屏下小尺寸会被系统最小高度限制（16px 变成 32x39），
  // 所以统一渲染 512px 母图，再降采样到目标尺寸
  const MASTER = 512;
  const win = new BrowserWindow({
    width: MASTER, height: MASTER, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true },
  });
  const htmlFile = path.join(os.tmpdir(), 'nd-icon-master.html');
  fs.writeFileSync(htmlFile, pageHtml(MASTER));
  await win.loadFile(htmlFile);
  await new Promise((r) => setTimeout(r, 400));
  const master = await win.webContents.capturePage();
  win.destroy();
  fs.unlinkSync(htmlFile);

  for (const [rel, size] of SIZES) {
    const img = master.resize({ width: size, height: size, quality: 'good' });
    fs.writeFileSync(path.join(__dirname, '..', rel), img.toPNG());
    console.log('written', rel, `${size}x${size}`);
  }
  app.quit();
});
