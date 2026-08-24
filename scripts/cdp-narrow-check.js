// 窄窗走查：把窗口压到最小宽 640，截图标题栏确认不溢出，然后还原
// 用法：node scripts/cdp-narrow-check.js [port]
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const port = process.argv[2] || '9222';

// CDP 的 Browser.setWindowBounds 对 frameless BaseWindow 不生效，改用 user32 MoveWindow
// 写成临时 .ps1 执行：内联 -Command 会被 shell 吃掉 C# 里的引号
function moveWindow(x, y, w, h) {
  const ps1 = path.join(__dirname, '..', '.playwright-mcp', 'move-window.ps1');
  fs.writeFileSync(ps1, `
$u = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool MoveWindow(System.IntPtr h, int x, int y, int w, int ht, bool r); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int s);' -Name U32 -PassThru
$p = Get-Process 'Notion Desktop' -ErrorAction SilentlyContinue | ? { $_.MainWindowHandle -ne 0 } | Select -First 1
if (-not $p) { exit 3 }
$u::ShowWindow($p.MainWindowHandle, 9) | Out-Null
$u::MoveWindow($p.MainWindowHandle, ${x}, ${y}, ${w}, ${h}, $true) | Out-Null
`);
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, { stdio: 'pipe' });
}

function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); }
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send: (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      close: () => ws.close(),
    });
    ws.onerror = reject;
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const tb = list.find((x) => x.url.includes('titlebar/index.html'));
  moveWindow(100, 100, 640, 480);
  await sleep(1500);

  const c = await attach(tb.webSocketDebuggerUrl);
  const evalJs = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  };
  const m = await evalJs(`(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const close = r('close'), more = r('tb-more'), sidebar = r('sidebar-toggle');
    return {
      vw: innerWidth,
      closeRight: Math.round(close.right),
      moreRight: Math.round(more.right),
      sidebarLeft: Math.round(sidebar.left),
      overlap: more.right > close.left,
    };
  })()`);
  console.log('窄窗测量:', JSON.stringify(m));
  await c.send('Page.enable');
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '..', '.playwright-mcp', 'narrow-titlebar.png'), Buffer.from(shot.data, 'base64'));
  console.log('written narrow-titlebar.png');
  c.close();

  moveWindow(100, 100, 1252, 1400); // 还原到走查前大致尺寸
  const ok = m.vw <= 640 && m.closeRight <= m.vw && !m.overlap && m.sidebarLeft === 0;
  console.log(ok ? 'NARROW PASS' : 'NARROW FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
