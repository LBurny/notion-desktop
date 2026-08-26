// 单窗口深色非客户区：消除 Win10 无边框窗口（frame:false）最大化时
// DWM 残留的 1px 白边——系统浅色模式下该 1px 为白色，深色模式下不可见。
// 通过 DWMWA_USE_IMMERSIVE_DARK_MODE 让本窗口非客户区走深色，不动系统主题、
// 不影响其他程序。
//
// 用 koffi 原生 FFI（N-API 预编译，不依赖 .NET 编译器、不受受限语言模式 CLM 限制）
// 直接从主进程调 DwmSetWindowAttribute。曾用 PowerShell Add-Type 内联编译 C#，但部分
// 机器上 Add-Type 编译失败（CLM / 缺 csc.exe / 安全软件拦截），[DwmApi] 类型不存在、
// 调用抛「找不到类型」非终止错误、返回值留空，白边残留——故弃用 PowerShell 链路。
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;        // Win10 2004+（build 19041+）
const DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY = 19; // Win10 1909 及更早

// koffi 加载失败（原生二进制不兼容等）时 setAttr 置 null，本次跳过（白边可能残留，优于闪退）
let dwmSetWindowAttribute = null;
let hwndToPtr = (n) => n;
try {
  const koffi = require('koffi');
  dwmSetWindowAttribute = koffi.load('dwmapi.dll').func('int DwmSetWindowAttribute(void* hwnd, int attr, int* val, int cb)');
  // getNativeWindowHandle() 返回「存有 HWND 值的 Buffer」，koffi 的 void* 参数要的是指针值
  // 本身：读 BigInt 再 koffi.as 转指针，直接传 Buffer 会传成 Buffer 地址（返回 E_HANDLE）
  hwndToPtr = (n) => koffi.as(n, 'void*');
} catch {}

function applyWindowDarkMode(win, theme, { platform = process.platform, log = () => {}, setAttr = dwmSetWindowAttribute, toPtr = hwndToPtr } = {}) {
  if (platform !== 'win32') return false;
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  if (typeof win.getNativeWindowHandle !== 'function') return false;
  if (!setAttr) return false;
  const dark = theme === 'dark' ? 1 : 0;
  try {
    const hwnd = toPtr(win.getNativeWindowHandle().readBigInt64LE(0));
    // 先试 20（Win10 2004+），返回非 0 再退 19（1909 及更早）
    const r20 = setAttr(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, [dark], 4);
    if (r20 === 0) { log('[dwm] ok attr=20 via koffi'); return true; }
    const r19 = setAttr(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY, [dark], 4);
    if (r19 === 0) { log('[dwm] ok attr=19 via koffi'); return true; }
    log(`[dwm] fail r20=${r20} r19=${r19} via koffi`);
    return false;
  } catch (e) {
    log(`[dwm] koffi error=${String(e).slice(0, 120)}`);
    return false;
  }
}

module.exports = {
  applyWindowDarkMode,
  DWMWA_USE_IMMERSIVE_DARK_MODE,
  DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY,
};
