// 实窗截图：抓取标题栏（标签条）和活动 Notion 页面
// 用法：node scripts/cdp-shot.js [port]
const fs = require('fs');
const path = require('path');
const port = process.argv[2] || '9222';

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

async function shot(client, file) {
  await client.send('Page.enable');
  const r = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '..', '.playwright-mcp', file), Buffer.from(r.data, 'base64'));
  console.log('written', file);
}

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  const list = await res.json();
  const tb = list.find((x) => x.url.includes('titlebar/index.html'));
  const page = list.find((x) => x.type === 'page' && x.url.startsWith('https://www.notion.so'));
  if (tb) { const c = await attach(tb.webSocketDebuggerUrl); await shot(c, 'live-titlebar.png'); c.close(); }
  if (page) { const c = await attach(page.webSocketDebuggerUrl); await shot(c, 'live-content.png'); c.close(); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
