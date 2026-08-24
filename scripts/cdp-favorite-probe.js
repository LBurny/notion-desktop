// CDP 侦察：探测收藏按钮的状态标记——点击前读 outerHTML，点击后再读，再点击还原
// 用法：node scripts/cdp-favorite-probe.js [port]
const port = process.argv[2] || '9222';

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('notion.so'));
  if (!page) { console.log('no notion page target found'); process.exit(1); }
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
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result !== undefined ? (r.result.value !== undefined ? r.result.value : r.result) : r;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const readBtn = `(() => {
    const el = document.querySelector('.notion-topbar-favorite-button');
    if (!el) return null;
    return {
      aria: el.getAttribute('aria-label'),
      pressed: el.getAttribute('aria-pressed'),
      html: el.innerHTML.slice(0, 400),
    };
  })()`;

  const before = await evalJs(readBtn);
  console.log('BEFORE:', JSON.stringify(before, null, 1));

  await evalJs(`document.querySelector('.notion-topbar-favorite-button').click(); 'clicked'`);
  await sleep(1200);
  const after = await evalJs(readBtn);
  console.log('AFTER CLICK:', JSON.stringify(after, null, 1));

  // 还原
  await evalJs(`document.querySelector('.notion-topbar-favorite-button').click(); 'clicked'`);
  await sleep(1200);
  const restored = await evalJs(readBtn);
  console.log('RESTORED:', JSON.stringify(restored, null, 1));

  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
