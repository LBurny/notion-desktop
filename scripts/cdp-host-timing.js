// 一次性诊断：按 host 聚合资源计时，找出拖慢加载的域名
const { execFileSync } = require('child_process');
const port = process.argv[2] || '9222';

function listTargets() {
  const out = execFileSync('curl', ['-s', '-m', '8', `http://127.0.0.1:${port}/json`]);
  return JSON.parse(out.toString('utf8'));
}

async function main() {
  const targets = listTargets();
  const pages = targets.filter((t) => t.type === 'page' && t.url.includes('notion.so/') && !t.url.includes('sw.js'));
  if (!pages.length) { console.log('no notion page'); process.exit(1); }
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); }
  };
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : (r && r.exceptionDetails ? r.exceptionDetails.text : undefined);
  };
  await new Promise((r) => { ws.onopen = r; });

  const out = await evalJs(`(() => {
    const rs = performance.getEntriesByType('resource');
    const byHost = {};
    for (const r of rs) {
      let h;
      try { h = new URL(r.name).host; } catch { continue; }
      const o = byHost[h] || (byHost[h] = { n: 0, totalMs: 0, maxMs: 0, cached: 0, xferKB: 0 });
      o.n++;
      o.totalMs += r.duration;
      if (r.duration > o.maxMs) o.maxMs = r.duration;
      if (r.transferSize === 0) o.cached++;
      o.xferKB += (r.transferSize || 0) / 1024;
    }
    const rows = Object.entries(byHost).map(([h, o]) => ({
      host: h, n: o.n, cached: o.cached,
      avgMs: Math.round(o.totalMs / o.n), maxMs: Math.round(o.maxMs), xferKB: Math.round(o.xferKB),
    }));
    rows.sort((a, b) => b.maxMs - a.maxMs);
    return JSON.stringify(rows, null, 1);
  })()`);
  console.log(out);
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
