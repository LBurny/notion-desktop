// CDP 侦察：dump Notion 顶栏（.notion-topbar）内全部可点元素，敲定顶栏一体化的选择器常量
// 用法：node scripts/cdp-topbar-scan.js [port]
const fs = require('fs');
const path = require('path');
const port = process.argv[2] || '9222';

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await res.json();
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

  const scan = await evalJs(`JSON.stringify((() => {
    const bar = document.querySelector('.notion-topbar');
    if (!bar) return { found: false };
    const items = [...bar.querySelectorAll('[role="button"], button, a')].map((el) => ({
      cls: el.className && String(el.className).slice(0, 120),
      ariaLabel: el.getAttribute('aria-label'),
      ariaPressed: el.getAttribute('aria-pressed'),
      ariaChecked: el.getAttribute('aria-checked'),
      role: el.getAttribute('role'),
      text: (el.textContent || '').trim().slice(0, 30),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    }));
    return { found: true, barRect: bar.getBoundingClientRect().toJSON(), count: items.length, items };
  })(), null, 1)`);

  console.log(scan);
  const out = path.join(__dirname, '..', '.playwright-mcp', 'topbar-scan.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, scan || '{}');
  console.log('saved to', out);
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
