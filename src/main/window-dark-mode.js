// 单窗口深色非客户区：消除 Win10 无边框窗口（frame:false）最大化时
// DWM 残留的 1px 白边——系统浅色模式下该 1px 为白色，深色模式下不可见。
// 通过 DWMWA_USE_IMMERSIVE_DARK_MODE 让本窗口非客户区走深色，不动系统主题、
// 不影响其他程序。属性值 20 适用于 Win10 2004+（build 19041+，22H2=19045）。
// 沿用项目既有 PowerShell 调用链路（slash-commands.js），不引入 ffi 原生依赖；
// 仅在启动/主题切换时调用，频率低，进程开销可忽略。
const { execFile } = require('child_process');

const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

function hwndToLong(win) {
  const buf = win.getNativeWindowHandle();
  // 64 位进程里 HWND 是 64 位指针；读为 BigInt 转十进制字符串，避免 JS Number 精度丢失
  return buf.readBigInt64LE(0).toString();
}

function buildScript(hwndLong, dark) {
  return [
    '$code = @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class DwmApi {',
    '  [DllImport("dwmapi.dll")]',
    '  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int cb);',
    '}',
    '\'@',
    'Add-Type -TypeDefinition $code -Language CSharp',
    `$h = [IntPtr]::new([long]'${hwndLong}')`,
    `$v = ${dark}`,
    `[DwmApi]::DwmSetWindowAttribute($h, ${DWMWA_USE_IMMERSIVE_DARK_MODE}, [ref]$v, 4) | Out-Null`,
  ].join('\r\n');
}

function applyWindowDarkMode(win, theme, { exec = execFile, platform = process.platform } = {}) {
  if (platform !== 'win32') return false;
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  if (typeof win.getNativeWindowHandle !== 'function') return false;
  const dark = theme === 'dark' ? 1 : 0;
  let hwndLong;
  try { hwndLong = hwndToLong(win); } catch { return false; }
  const ps = buildScript(hwndLong, dark);
  exec('powershell',
    ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
    { windowsHide: true },
    () => {}
  );
  return true;
}

module.exports = { applyWindowDarkMode, buildScript, hwndToLong, DWMWA_USE_IMMERSIVE_DARK_MODE };