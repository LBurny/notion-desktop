// CDP 侦察：递归 dump Notion 顶栏 DOM 树（路径 + role/aria/稳定 class），定位四个按钮的稳定选择器
// 用法：node scripts/cdp-topbar-tree2.js [port]
const fs = require('fs');
const path = require('path');
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

  const out = await evalJs(`(() => {
    const bar = document.querySelector('.notion-topbar');
    if (!bar) return 'not found';
    const lines = [];
    const walk = (el, depth, idxPath) => {
      const role = el.getAttribute && el.getAttribute('role');
      const aria = el.getAttribute && el.getAttribute('aria-label');
      const stable = [...el.classList].filter((c) => c.startsWith('notion-')).join('.');
      const txt = el.childElementCount === 0 ? (el.textContent || '').trim().slice(0, 20) : '';
      const r = el.getBoundingClientRect();
      const mark = (role === 'button' || role === 'link') ? ' <<<' : '';
      lines.push('  '.repeat(depth) + idxPath + ' ' + el.tagName
        + (stable ? ' .' + stable : '')
        + (role ? ' role=' + role : '')
        + (aria ? ' aria="' + aria + '"' : '')
        + (txt ? ' "' + txt + '"' : '')
        + ' [' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']'
        + mark);
      [...el.children].forEach((c, i) => walk(c, depth + 1, idxPath + '.' + i));
    };
    walk(bar, 0, '0');
    return lines.join('\\n');
  })()`);
  console.log(out);
  const f = path.join(__dirname, '..', '.playwright-mcp', 'topbar-tree.txt');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, out || '');
  console.log('saved to', f);
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
