// 端到端验证标签页：SendKeys 真实按键 + CDP 读标题栏 DOM 断言
// 前置：应用以 --remote-debugging-port=9222 启动（dev=electron 进程，打包版=Notion Desktop 进程）
// 用法：node scripts/cdp-tabs-check.js [port] [进程名]
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const port = process.argv[2] || '9222';
const procName = process.argv[3] || 'electron';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 真实按键：前置窗口后 SendKeys（^=Ctrl + 键），如 '^t' '^{PGDN}' '^w' '^1' '^9'
// AppActivate 会被 Windows 焦点防盗策略间歇拒绝，改用
// AllowSetForegroundWindow(ASFW_ANY) + SetForegroundWindow 并轮询确认前台
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

async function targets() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  return res.json();
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
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r && r.result ? r.result.value : undefined;
}

const tabCountExpr = `document.querySelectorAll('#tabs .tab').length`;
const activeTitleExpr = `(document.querySelector('#tabs .tab.active .tab-title') || {}).textContent || ''`;
const activeIdExpr = `(document.querySelector('#tabs .tab.active') || {}).dataset.id || ''`;
const idAtExpr = (i) => `(document.querySelectorAll('#tabs .tab')[${i}] || { dataset: {} }).dataset.id || ''`;
const allTitlesExpr = `JSON.stringify([...document.querySelectorAll('#tabs .tab .tab-title')].map((t) => t.textContent))`;

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
}

async function main() {
  // 等标题栏渲染出至少 1 个标签
  let tb = null;
  for (let i = 0; i < 30; i++) {
    const t = (await targets()).find((x) => x.url.includes('titlebar/index.html'));
    if (t) {
      tb = await attach(t.webSocketDebuggerUrl);
      if (await evalOn(tb, tabCountExpr) > 0) break;
    }
    await sleep(1000);
  }
  if (!tb) throw new Error('titlebar target not found');
  await sleep(6000); // 等活动标签页面加载完，标题同步

  const initialCount = await evalOn(tb, tabCountExpr);
  console.log(`启动恢复标签数: ${initialCount}, 标题: ${await evalOn(tb, allTitlesExpr)}`);
  const pages1 = (await targets()).filter((x) => x.type === 'page' && x.url.startsWith('https://www.notion.so'));
  check('懒加载（仅活动标签建视图）', pages1.length, 1);
  check('活动标签标题已同步（非占位符）', (await evalOn(tb, activeTitleExpr)) !== '加载中…', true);

  // 1) 新建搜索：官方逻辑——在当前页唤起 Quick Find，此刻不开新标签
  // 优先真实按键 ^t（验 BIE 链路）；Windows 焦点策略吞键时退化为 CDP 点击“+”按钮（同一条 IPC）
  const originPage = pages1[0];
  const op = await attach(originPage.webSocketDebuggerUrl);
  // 冷启动首载很慢：等 Notion 应用就绪再触发，否则注入的 ctrl+k 会被丢弃
  for (let i = 0; i < 40; i++) {
    if (await evalOn(op, `document.readyState === 'complete' && !!document.querySelector('#notion-app')`)) break;
    await sleep(1000);
  }
  const qfExpr = `!!document.querySelector('[role="dialog"] input')`; // 带输入框才算 Quick Find（推广条也是 role=dialog）
  let qfOpen = false, trigger = '无';
  for (let attempt = 0; attempt < 2 && !qfOpen; attempt++) {
    sendKeys('^t');
    for (let i = 0; i < 8 && !qfOpen; i++) {
      await sleep(500);
      qfOpen = await evalOn(op, qfExpr);
    }
  }
  if (qfOpen) trigger = 'Ctrl+T';
  if (!qfOpen) {
    await evalOn(tb, `document.querySelector('#new-tab').click()`);
    for (let i = 0; i < 8 && !qfOpen; i++) {
      await sleep(500);
      qfOpen = await evalOn(op, qfExpr);
    }
    if (qfOpen) trigger = '+按钮兜底';
  }
  console.log(`新建搜索触发方式: ${trigger}`);
  check('Ctrl+T 后不立即新建标签', await evalOn(tb, tabCountExpr), initialCount);
  check('当前页唤起 Quick Find', qfOpen, true);

  // 2) 输入关键词回车选中结果：这一瞬才开新标签（preload 拦截或导航兜底）
  // 用 CDP 注入键入：另起 PowerShell SendKeys 会抢窗口焦点，Quick Find 失焦即关
  for (const ch of 'note') {
    await op.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0), text: ch });
    await op.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
  }
  await sleep(2500); // 等搜索结果返回
  await op.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await op.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(4000); // 等新标签建视图 + 开始加载
  check('选中搜索结果后新建标签', await evalOn(tb, tabCountExpr), initialCount + 1);
  const pickedActive = await evalOn(tb, activeIdExpr);
  check('新标签为活动标签（追加在末尾）', pickedActive, await evalOn(tb, idAtExpr(initialCount)));
  op.close();

  // 3) Ctrl+PageDown 切回上一个（Ctrl+Tab/PageDown 是 Chromium 保留键，走聚焦期全局快捷键）
  // 注意按 data-id 比较：多个标签可能同标题，标题比较会假阴性
  const beforeSwitch = await evalOn(tb, activeIdExpr);
  let afterSwitch = beforeSwitch;
  for (let a = 0; a < 3 && afterSwitch === beforeSwitch; a++) {
    sendKeys('^{PGDN}');
    await sleep(1500);
    afterSwitch = await evalOn(tb, activeIdExpr);
  }
  check('Ctrl+PageDown 切换后活动标签变化', afterSwitch !== beforeSwitch && afterSwitch !== '', true);

  // 3b) Ctrl+2 跳回第 2 个标签（BIE 路径）
  const secondId = await evalOn(tb, idAtExpr(1));
  let posId = '';
  for (let a = 0; a < 3 && posId !== secondId; a++) {
    sendKeys('^2');
    await sleep(1500);
    posId = await evalOn(tb, activeIdExpr);
  }
  check('Ctrl+2 跳转第 2 个标签', posId, secondId);

  // 4) Ctrl+W 关闭当前（只在关少了时重试，防止过度关闭）
  let cnt = await evalOn(tb, tabCountExpr);
  for (let a = 0; a < 3 && cnt > initialCount; a++) {
    sendKeys('^w');
    await sleep(1500);
    cnt = await evalOn(tb, tabCountExpr);
  }
  check('Ctrl+W 关闭标签', cnt, initialCount);

  // 5) 持久化落盘
  await sleep(700);
  const tabsJson = path.join(os.homedir(), 'AppData', 'Roaming', 'notion-desktop', 'tabs.json');
  const saved = JSON.parse(fs.readFileSync(tabsJson, 'utf8'));
  check('tabs.json 标签数', saved.tabs.length, initialCount);
  // 从未激活的懒加载标签没有标题是合法的，只要求至少一个已写回
  check('tabs.json 至少一个标题已写回', saved.tabs.some((t) => t.title && t.title.length > 0), true);

  tb.close();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
