// CDP 探针：连接以 --remote-debugging-port 启动的应用，抓取 Notion 页面诊断信息与视口截图
// 用法：node scripts/cdp-probe.js [port]
const fs = require('fs');
const path = require('path');
const port = process.argv[2] || '9222';

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await res.json();
  console.log('targets:\n  ' + targets.map((t) => `${t.type} ${t.url}`).join('\n  '));
  const page = targets.find((t) => t.type === 'page' && t.url.includes('notion.so'));
  if (!page) {
    console.log('no notion page target found');
    process.exit(1);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result || msg.error);
      pending.delete(msg.id);
    }
  };
  await new Promise((r) => { ws.onopen = r; });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result !== undefined ? (r.result.value !== undefined ? r.result.value : r.result) : r;
  };

  const diag = await evalJs(`JSON.stringify({
    href: location.href,
    ready: document.readyState,
    bodyChildren: document.body ? document.body.childElementCount : -1,
    bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : null,
    bodyDisplay: document.body ? getComputedStyle(document.body).display : null,
    bodyVisibility: document.body ? getComputedStyle(document.body).visibility : null,
    htmlClass: document.documentElement.className,
    notionApp: !!document.querySelector('#notion-app'),
    viewport: innerWidth + 'x' + innerHeight,
  }, null, 1)`);
  console.log('diag:', diag);

  await send('Page.enable');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(__dirname, '..', '.playwright-mcp', 'cdp-content.png');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved to', out);
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
