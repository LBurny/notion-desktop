// 单窗口深色非客户区：消除 Win10 无边框窗口（frame:false）最大化时
// DWM 残留的 1px 白边——系统浅色模式下该 1px 为白色，深色模式下不可见。
// 通过 DWMWA_USE_IMMERSIVE_DARK_MODE 让本窗口非客户区走深色，不动系统主题、
// 不影响其他程序。
//
// 跨机器普适性（曾踩坑：只发属性 20 在 build<19041 的机器上静默失效）：
// - 属性号在 Win10 2004（build 19041+）为 20，更早版本为 19。脚本先试 20，
//   返回非 0 再退 19，两种版本都覆盖。
// - 不再用 | Out-Null 吞返回值：脚本回写一行 nd-dwm 状态（含 HRESULT），
//   主进程按 log 回调输出，失败不再静默。
// - 顺带回读 ColorPrevalence：用户开了"在窗口边框显示强调色"时边框会走系统
//   强调色而盖过本属性，失败行带 cp=<val> 提示，便于现场定位"为何没生效"。
// 沿用项目既有 PowerShell 调用链路（slash-commands.js），不引入 ffi 原生依赖；
// 仅在启动/主题切换时调用，频率低，进程开销可忽略。
const { execFile } = require('child_process');

const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;        // Win10 2004+（build 19041+）
const DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY = 19; // Win10 1909 及更早

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

function applyWindowDarkMode(win, theme, { exec = execFile, platform = process.platform, log = () => {}, shells = ['powershell', 'pwsh'] } = {}) {
  if (platform !== 'win32') return false;
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  if (typeof win.getNativeWindowHandle !== 'function') return false;
  const dark = theme === 'dark' ? 1 : 0;
  let hwndLong;
  try { hwndLong = hwndToLong(win); } catch { return false; }
  const ps = buildScript(hwndLong, dark);
  tryShells(exec, shells, ps, log);
  return true;
}

module.exports = {
  applyWindowDarkMode,
  buildScript,
  hwndToLong,
  parseStatus,
  tryShells,
  DWMWA_USE_IMMERSIVE_DARK_MODE,
  DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY,
};