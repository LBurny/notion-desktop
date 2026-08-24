// 分段诊断：A) tabsApi.newTab() 直接调用（主进程链路） B) CDP 按键注入（before-input-event 链路）
const port = process.argv[2] || '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function main() {
  const list = await targets();
  console.log('全部目标:');
  for (const t of list) console.log(`  [${t.type}] ${t.url.slice(0, 80)} | ${t.title.slice(0, 30)}`);

  const tbTarget = list.find((x) => x.url.includes('titlebar/index.html'));
  const tb = await attach(tbTarget.webSocketDebuggerUrl);
  const countExpr = `document.querySelectorAll('#tabs .tab').length`;
  console.log('A 前标签数:', await evalOn(tb, countExpr));

  // A：直接调 preload API 走 IPC → 主进程 newTab
  await evalOn(tb, `window.tabsApi.newTab()`);
  await sleep(3000);
  console.log('A 后标签数（IPC 直接调用）:', await evalOn(tb, countExpr));

  // B：CDP 注入 Ctrl+W 到当前活动页面
  const pages = (await targets()).filter((x) => x.url.startsWith('https://www.notion.so'));
  console.log('当前 notion 页面目标数:', pages.length);
  if (pages.length) {
    const pg = await attach(pages[pages.length - 1].webSocketDebuggerUrl);
    await pg.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, modifiers: 2 });
    await pg.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, modifiers: 2 });
    await sleep(2000);
    console.log('B 后标签数（CDP 注入 Ctrl+W）:', await evalOn(tb, countExpr));
    pg.close();
  }
  tb.close();
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
