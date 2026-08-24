// CDP 侦察：dump Notion 顶栏的 DOM 层级与右簇（Share/Favorite/more）的兄弟关系
// 用法：node scripts/cdp-topbar-tree.js [port]
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

  const out = await evalJs(`JSON.stringify((() => {
    const bar = document.querySelector('.notion-topbar');
    if (!bar) return { found: false };
    const brief = (el) => ({
      tag: el.tagName,
      role: el.getAttribute && el.getAttribute('role'),
      aria: el.getAttribute && el.getAttribute('aria-label'),
      stableCls: [...el.classList].filter((c) => c.startsWith('notion-')),
      text: (el.childElementCount === 0 ? (el.textContent || '').trim().slice(0, 20) : ''),
      visible: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
    });
    // 右簇：从 more-button 向上找到包含 Share 的容器，dump 其直接子元素序列
    const more = bar.querySelector('.notion-topbar-more-button');
    let cluster = more;
    while (cluster && cluster.parentElement !== bar) cluster = cluster.parentElement;
    const clusterKids = cluster ? [...cluster.children].map(brief) : null;
    // more 的兄弟链
    const sibs = [];
    let s = more;
    for (let i = 0; i < 5 && s; i++) { sibs.push(brief(s)); s = s.previousElementSibling; }
    // 顶栏顶层结构
    const top = [...bar.children].map((c) => Object.assign(brief(c), { kids: [...c.children].map(brief) }));
    return { found: true, clusterKids, moreSiblings: sibs, top };
  })(), null, 1)`);
  console.log(out);
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
