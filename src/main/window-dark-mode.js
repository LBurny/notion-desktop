// 单窗口深色非客户区：消除 Win10 无边框窗口（frame:false）最大化时
// DWM 残留的 1px 白边——系统浅色模式下该 1px 为白色，深色模式下不可见。
// 通过 DWMWA_USE_IMMERSIVE_DARK_MODE 让本窗口非客户区走深色，不动系统主题、
// 不影响其他程序。
//
// 跨机器普适性（曾踩坑）：
// - 属性号在 Win10 2004（build 19041+）为 20，更早版本为 19。先试 20，失败退 19。
// - 早期用 PowerShell Add-Type 内联编译 C# 调 DWM，但部分机器上 Add-Type 编译失败
//   （受限语言模式 CLM / 缺 csc.exe / 安全软件拦截），[DwmApi] 类型不存在，
//   DwmSetWindowAttribute 抛「找不到类型」非终止错误，返回值留空 → 白边残留。
//   现改用 koffi 原生 FFI（N-API 预编译，不依赖 .NET 编译器、不受 CLM 限制）
//   直接从主进程调 DwmSetWindowAttribute；koffi 加载失败才回退 PowerShell 链路。
const { execFile } = require('child_process');

const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;        // Win10 2004+（build 19041+）
const DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY = 19; // Win10 1909 及更早

// koffi 原生 FFI：加载失败（原生二进制不兼容等）时置 null，回退 PowerShell
let dwmSetWindowAttribute = null;
let hwndToPtr = (n) => n; // koffi 不可用时恒等（此时 setAttr 也为 null，不会被调用）
try {
  const koffi = require('koffi');
  dwmSetWindowAttribute = koffi.load('dwmapi.dll').func('int DwmSetWindowAttribute(void* hwnd, int attr, int* val, int cb)');
  // getNativeWindowHandle() 返回的是「存有 HWND 值的 Buffer」，koffi 的 void* 参数
  // 需要的是指针值本身——读 BigInt 再 koffi.as 转指针，否则传的是 Buffer 地址（E_HANDLE）
  hwndToPtr = (n) => koffi.as(n, 'void*');
} catch { /* 回退 PowerShell */ }

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
    '$r20 = [DwmApi]::DwmSetWindowAttribute($h, 20, [ref]$v, 4)',
    'if ($r20 -eq 0) {',
    '  "nd-dwm ok attr=20"',
    '} else {',
    '  $r19 = [DwmApi]::DwmSetWindowAttribute($h, 19, [ref]$v, 4)',
    '  if ($r19 -eq 0) {',
    '    "nd-dwm ok attr=19"',
    '  } else {',
    '    $cp = (Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\DWM" -Name ColorPrevalence -ErrorAction SilentlyContinue).ColorPrevalence',
    '    if ($null -ne $cp) { "nd-dwm fail r20=$r20 r19=$r19 cp=$cp" } else { "nd-dwm fail r20=$r20 r19=$r19" }',
    '  }',
    '}',
  ].join('\r\n');
}

// 从 PowerShell stdout 中提取首个 nd-dwm 状态行；无则 null
function parseStatus(stdout) {
  if (!stdout) return null;
  const line = String(stdout).split(/\r?\n/).find((l) => l.startsWith('nd-dwm'));
  return line || null;
}

function tryShells(exec, shells, ps, log) {
  const args = ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps];
  let i = 0;
  const next = () => {
    if (i >= shells.length) { log(`[dwm] all shells failed (${shells.join(', ')})`); return; }
    const shell = shells[i++];
    exec(shell, args, { windowsHide: true }, (err, stdout) => {
      const status = parseStatus(stdout);
      if (status) { log(`[dwm] ${status} via ${shell}`); return; } // 已生效，不再试后续 shell
      // 无状态行：记录该 shell 失败细节后回退下一个
      log(`[dwm] ${shell} no-status${err ? ` err=${String(err).slice(0, 120)}` : ''}${stdout ? ` stdout=${String(stdout).slice(0, 160)}` : ''}`);
      next();
    });
  };
  next();
}

// koffi 直调：先试 20，失败退 19；返回是否成功
function applyViaKoffi(win, dark, log, setAttr, toPtr = (n) => n) {
  const hwnd = win.getNativeWindowHandle();
  const hwndPtr = toPtr(hwnd.readBigInt64LE(0));
  const r20 = setAttr(hwndPtr, DWMWA_USE_IMMERSIVE_DARK_MODE, [dark], 4);
  if (r20 === 0) { log('[dwm] ok attr=20 via koffi'); return true; }
  const r19 = setAttr(hwndPtr, DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY, [dark], 4);
  if (r19 === 0) { log('[dwm] ok attr=19 via koffi'); return true; }
  log(`[dwm] fail r20=${r20} r19=${r19} via koffi`);
  return false;
}

function applyWindowDarkMode(win, theme, { exec = execFile, platform = process.platform, log = () => {}, shells = ['powershell', 'pwsh'], setAttr = dwmSetWindowAttribute, toPtr = hwndToPtr } = {}) {
  if (platform !== 'win32') return false;
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  if (typeof win.getNativeWindowHandle !== 'function') return false;
  const dark = theme === 'dark' ? 1 : 0;
  if (setAttr) {
    try { return applyViaKoffi(win, dark, log, setAttr, toPtr); }
    catch (e) { log(`[dwm] koffi error=${String(e).slice(0, 120)}`); }
  }
  // 回退 PowerShell（koffi 不可用或调用抛异常时）
  let hwndLong;
  try { hwndLong = hwndToLong(win); } catch { return false; }
  const ps = buildScript(hwndLong, dark);
  tryShells(exec, shells, ps, log);
  return true;
}

module.exports = {
  applyWindowDarkMode,
  applyViaKoffi,
  buildScript,
  hwndToLong,
  parseStatus,
  tryShells,
  DWMWA_USE_IMMERSIVE_DARK_MODE,
  DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY,
};
