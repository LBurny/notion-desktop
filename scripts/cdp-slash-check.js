// 端到端验证斜杠命令快捷键：SendKeys 真实按下 Ctrl+Shift+R → 页面应出现 KaTeX 公式块 → Ctrl+Z 清场
// 前置：应用以 --remote-debugging-port=9222 启动，活动标签是可编辑的 Notion 页面
// 用法：node scripts/cdp-slash-check.js [port] [进程名]
// 注意一：Node 的 fetch/http 长连接会卡死 Electron 的 devtools HTTP 服务，目标列表一律走 curl
// 注意二：CDP Input.dispatchKeyEvent 触发 before-input-event 里的 preventDefault 会卡死主进程，
//         按键必须用真实 SendKeys（与 cdp-tabs-check.js 同一套），CDP 只做只读断言
const { execSync } = require('child_process');
const port = process.argv[2] || '9222';
const procName = process.argv[3] || 'electron';
const triggerSeq = process.argv[4] || '^+r';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// 真实按键：前置窗口后 SendKeys（^=Ctrl +=Shift %=Alt），如 '^+r' '^z'
function sendKeys(seq) {
  const ps = [
    `Add-Type -AssemblyName System.Windows.Forms`,
    `$u = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int p); [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();' -Name U32 -PassThru`,
    `$p = Get-Process '${procName}' -ErrorAction SilentlyContinue | ? { $_.MainWindowHandle -ne 0 } | Select -First 1`,
    `if (-not $p) { exit 3 }`,
    `$u::AllowSetForegroundWindow(-1) | Out-Null`,
    `for ($i = 0; $i -lt 5; $i++) { $u::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 250; if ($u::GetForegroundWindow() -eq $p.MainWindowHandle) { break } }`,
    `[System.Windows.Forms.SendKeys]::SendWait('${seq}')`,
  ].join('; ');
  execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'pipe' });
}

function httpAlive() {
  try {
    execSync(`curl -s -m 5 -o NUL -w "%{http_code}" http://127.0.0.1:${port}/json`, { encoding: 'utf8' });
    return true;
  } catch { return false; }
}

async function targets() {
  const out = execSync(`curl -s -m 8 http://127.0.0.1:${port}/json`, { encoding: 'utf8' });
  return JSON.parse(out);
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

async function evalOn(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result ? r.result.value : undefined;
}

// 滚到底 → 点击正文末尾空区（Notion 会把光标放到末尾文本块）→ 校验编辑器聚焦
async function focusEditorEnd(client) {
  const rect = await evalOn(client, `(() => {
    const scroller = document.querySelector('.notion-frame .notion-scroller') || document.scrollingElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    const root = document.querySelector('.notion-page-content');
    if (!root) return null;
    const r = root.getBoundingClientRect();
    return { x: r.left + Math.min(100, r.width / 2), y: Math.min(r.bottom - 12, window.innerHeight - 30) };
  })()`);
  if (!rect) return false;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await client.send('Input.dispatchMouseEvent', {
      type, x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1,
    });
  }
  await sleep(300);
  const el = await evalOn(client, `(document.activeElement || {}).isContentEditable || false`);
  if (!el) step('警告：activeElement 不是 contenteditable，聚焦可能失败');
  return true;
}

async function main() {
  step('找 notion 页面 target');
  let page = null;
  for (let i = 0; i < 30; i++) {
    const t = (await targets()).find((x) => x.type === 'page' && x.url.startsWith('https://www.notion.so/'));
    if (t) {
      page = await attach(t.webSocketDebuggerUrl);
      const ready = await evalOn(page, `document.readyState === 'complete' && !!document.querySelector('#notion-app')`);
      if (ready) break;
      page.close(); page = null;
    }
    await sleep(1000);
  }
  if (!page) throw new Error('notion page target not found');
  step('target 就绪');

  const katexBefore = await evalOn(page, `document.querySelectorAll('.katex').length`);
  step(`当前 KaTeX 块数: ${katexBefore}`);
  if (!await focusEditorEnd(page)) { console.log('FAIL 编辑器聚焦失败'); process.exit(1); }
  step('编辑器已聚焦（点击正文末尾）');
  await sleep(400);

  step(`SendKeys 按下触发键 (${triggerSeq})`);
  sendKeys(triggerSeq);
  await sleep(300);
  if (!httpAlive()) { console.log('FAIL 按键后主进程卡死（devtools 端点无响应）'); process.exit(1); }
  step('主进程存活，等待 KaTeX 渲染');

  // 等菜单过滤 + Enter + KaTeX 渲染
  let appeared = false;
  for (let i = 0; i < 25; i++) {
    await sleep(300);
    if (await evalOn(page, `document.querySelectorAll('.katex').length`) > katexBefore) { appeared = true; break; }
  }
  console.log(`${appeared ? 'PASS' : 'FAIL'} ${triggerSeq} 插入行间公式（KaTeX 块 ${katexBefore} → ${appeared ? katexBefore + 1 : '未变'}）`);

  // 清场：Esc 关菜单兜底 + 撤销刚才的插入（块插入 + 文本输入各一步，多撤几次兜底）
  step('SendKeys Esc + Ctrl+Z 清场');
  sendKeys('{ESC}');
  await sleep(300);
  for (let i = 0; i < 3; i++) { sendKeys('^z'); await sleep(300); }
  const katexAfter = await evalOn(page, `document.querySelectorAll('.katex').length`);
  const cleaned = katexAfter <= katexBefore;
  console.log(`${cleaned ? 'PASS' : 'FAIL'} Ctrl+Z 清场（KaTeX 块恢复到 ${katexAfter}）`);

  page.close();
  process.exit(appeared && cleaned ? 0 : 1);
}

main().catch((e) => { console.log('FAIL 异常:', e.message); process.exit(1); });
