// 用法: npx electron scripts/render-icon.js
// 读取 build/icon.svg，衬白色圆角底（透明背景黑图形在深色任务栏不可见），
// 用 Chromium 离屏渲染导出 PNG + 多尺寸 ICO：
//   assets/tray.png   32x32  托盘图标（高分屏托盘按 200% 取 32px，16px 会被放大发糊）
//   assets/icon.png   256x256 窗口/任务栏图标（非 Windows 兜底）
//   assets/icon.ico   16/24/32/48/64/128/256 多尺寸 窗口/任务栏图标（Windows 按 DPI 自选尺寸）
//   build/icon.png    256x256 electron-builder 兜底
//   build/icon.ico    多尺寸 electron-builder 安装包/exe 图标（约定优于 icon.png）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8')
  .replace(/<\?xml[^?]*\?>/, '')
  .replace(/<!DOCTYPE[^>]*>/i, '');

const SIZES = [
  ['assets/tray.png', 32],
  ['assets/icon.png', 256],
  ['build/icon.png', 256],
];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICO_TARGETS = ['assets/icon.ico', 'build/icon.ico'];

// PNG-in-ICO 打包（Vista+ 标准）：ICONDIR + ICONDIRENTRY*n + PNG 数据块；
// 宽高字段单字节，256 记 0
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); // 调色板（PNG 不用）
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

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
  const icoEntries = ICO_SIZES.map((size) => ({
    size,
    buf: master.resize({ width: size, height: size, quality: 'good' }).toPNG(),
  }));
  const ico = packIco(icoEntries);
  for (const rel of ICO_TARGETS) {
    fs.writeFileSync(path.join(__dirname, '..', rel), ico);
    console.log('written', rel, ICO_SIZES.join('/'));
  }
  app.quit();
});
