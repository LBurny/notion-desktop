// 一次性侦察：侧栏开/关态下四个选择器命中情况 + 全页面 sidebar 相关 aria-label
const { execSync } = require('child_process');
const port = process.argv[2] || '9222';

async function main() {
  const json = execSync(`curl -s -m 8 http://127.0.0.1:${port}/json`).toString();
  const targets = JSON.parse(json);
  const page = targets.find((t) => t.type === 'page' && t.url.includes('notion.so') && !t.url.includes('sw.js'));
  if (!page) { console.log('no notion page'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result !== undefined ? r.result.value : r;
  };

  const out = await evalJs(`JSON.stringify((() => {
    const sels = ['.notion-open-sidebar', '.notion-topbar [aria-label="Lock sidebar open"]', '.notion-topbar [aria-label="Open sidebar"]', '.notion-sidebar [aria-label="Close sidebar"]'];
    const sb = document.querySelector('.notion-sidebar');
    const hits = sels.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { sel: s, found: false };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { sel: s, found: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, display: cs.display, visibility: cs.visibility, pe: cs.pointerEvents, cls: String(el.className).slice(0, 80) };
    });
    // 全页面 aria-label 含 sidebar（任意语言不行，先英文+中文都试）
    const labelled = [...document.querySelectorAll('[aria-label]')]
      .filter((el) => /sidebar|侧边栏|侧栏/i.test(el.getAttribute('aria-label') || ''))
      .map((el) => ({
        tag: el.tagName, ariaLabel: el.getAttribute('aria-label'),
        cls: String(el.className).slice(0, 60),
        parentCls: String(el.parentElement && el.parentElement.className).slice(0, 60),
        inSidebar: !!el.closest('.notion-sidebar'),
        inTopbar: !!el.closest('.notion-topbar'),
        rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      }));
    return {
      sidebarRect: sb ? sb.getBoundingClientRect().toJSON() : null,
      hits, labelled,
      htmlLang: document.documentElement.lang,
    };
  })(), null, 1)`);
  console.log(out);
  ws.close(); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
