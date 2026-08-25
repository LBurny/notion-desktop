// CDP 性能探针（只读诊断，结束时自动恢复，不改用户内容）：
//   1) 列出所有目标，定位 notion.so 页面（排除 sw.js）
//   2) Performance 域累积计数器：空闲 6s 的后台消耗（Script/Task/Layout/RecalcStyle）
//   3) 滚动工作负载（setTimeout 驱动 scrollTop；非活动标签无 rAF）下的计数增量
//   4) 强制 style recalc+layout 微基准：body 级（全树）与块级（模拟打字）两档
//   5) 注入 CSS 的 A/B 隔离：CSS 域临时清空注入样式表 → 重测 → 恢复原文
// 用法：node scripts/cdp-perf-probe.js [port]
// 前置：应用以 --remote-debugging-port=9222 启动且页面就绪
const { execFileSync } = require('child_process');
const port = process.argv[2] || '9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// AGENTS.md：Node fetch/http 会卡死 Electron devtools HTTP 服务，/json 一律 curl
function listTargets() {
  const out = execFileSync('curl', ['-s', '-m', '8', `http://127.0.0.1:${port}/json`]);
  return JSON.parse(out.toString('utf8'));
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
      ws,
      send: (m, p = {}) => Promise.race([
        new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
        sleep(15000).then(() => ({ __timeout: true })),
      ]),
      close: () => ws.close(),
    });
    ws.onerror = reject;
  });
}

async function evalOn(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return { __error: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') };
  return r && r.result ? r.result.value : undefined;
}

async function metricsOf(client) {
  await client.send('Performance.enable');
  const r = await client.send('Performance.getMetrics');
  const out = {};
  for (const m of (r && r.metrics) || []) out[m.name] = m.value;
  return out;
}

const METRIC_KEYS = ['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'JSHeapUsedSize', 'Nodes', 'JSEventListeners', 'Documents'];
function pick(m) {
  const o = {};
  for (const k of METRIC_KEYS) o[k] = Math.round((m[k] || 0) * 1000) / 1000;
  return o;
}
function delta(a, b) {
  const o = {};
  for (const k of METRIC_KEYS) o[k] = Math.round(((b[k] || 0) - (a[k] || 0)) * 1000) / 1000;
  return o;
}

// body 级全树 recalc+layout（最坏情况）
const BENCH_RECALC_BODY = `(async () => {
  const body = document.body;
  if (!body) return 'no body';
  body.classList.toggle('nd-bench'); void body.offsetHeight; body.classList.toggle('nd-bench'); void body.offsetHeight;
  const ts = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    body.classList.toggle('nd-bench');
    void body.offsetHeight;
    ts.push(performance.now() - t0);
  }
  body.classList.remove('nd-bench');
  ts.sort((a, b) => a - b);
  return JSON.stringify({ medianMs: Math.round(ts[Math.floor(ts.length / 2)] * 100) / 100, maxMs: Math.round(ts[ts.length - 1] * 100) / 100 });
})()`;

// 块级 recalc（模拟打字引起的局部重算）：轮流隐藏/显示一个内容块
const BENCH_RECALC_BLOCK = `(async () => {
  const el = document.querySelector('.notion-page-content [data-block-id]')
    || document.querySelector('[contenteditable="true"]');
  if (!el) return 'no block';
  const ts = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    el.classList.toggle('nd-bench');
    void el.offsetHeight;
    ts.push(performance.now() - t0);
  }
  el.classList.remove('nd-bench');
  ts.sort((a, b) => a - b);
  return JSON.stringify({ medianMs: Math.round(ts[Math.floor(ts.length / 2)] * 100) / 100, maxMs: Math.round(ts[ts.length - 1] * 100) / 100 });
})()`;

// 注意用 setTimeout 而非 rAF：非活动标签视图被摘除、永不产帧，rAF 会挂死
const BENCH_SCROLL = `(async () => {
  const sc = document.querySelector('.notion-scroller') || document.scrollingElement;
  if (!sc) return 'no scroller';
  const step = Math.max(200, Math.floor(sc.clientHeight * 0.7));
  await new Promise((res) => {
    let n = 0;
    const tick = () => {
      sc.scrollTop += (n % 12 < 6 ? step : -step); // 下滚 6 屏再回滚，触发懒渲染
      n++;
      if (n >= 12) { sc.scrollTop = 0; res(); return; }
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });
  return 'ok';
})()`;

// 经 CSS 域找到注入样式表（insertCSS 产生的 origin=injected / 文本含本项目特征选择器），
// 清空后跑 fn，最后恢复原文
async function withInjectedCssDisabled(client, fn) {
  const sheets = [];
  client.ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'CSS.styleSheetAdded') sheets.push(msg.params.header);
  });
  await client.send('CSS.enable');
  await sleep(300); // 等 styleSheetAdded 事件到齐
  const targets = [];
  for (const h of sheets) {
    if (h.origin !== 'injected' && h.origin !== 'inspector') continue;
    const t = await client.send('CSS.getStyleSheetText', { styleSheetId: h.styleSheetId });
    const text = t && t.text;
    if (typeof text === 'string' && /notion-text-block|notion-topbar/.test(text)) {
      targets.push({ id: h.styleSheetId, text });
    }
  }
  if (!targets.length) { await client.send('CSS.disable'); return { skipped: 'no injected sheet found' }; }
  for (const t of targets) await client.send('CSS.setStyleSheetText', { styleSheetId: t.id, text: '' });
  await sleep(150);
  const out = await fn();
  for (const t of targets) await client.send('CSS.setStyleSheetText', { styleSheetId: t.id, text: t.text });
  await client.send('CSS.disable');
  return { sheetsEmptied: targets.length, totalCssBytes: targets.reduce((s, t) => s + t.text.length, 0), result: out };
}

async function probePage(label, client) {
  console.log(`\n== ${label} ==`);
  const dom = await evalOn(client, `JSON.stringify({
    url: location.href.slice(0, 80), ready: document.readyState,
    nodes: document.getElementsByTagName('*').length,
    iframes: document.querySelectorAll('iframe').length,
    editables: document.querySelectorAll('[contenteditable]').length,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
  })`);
  console.log('dom:', dom);
  console.log('recalc[body]  with-css:', await evalOn(client, BENCH_RECALC_BODY));
  console.log('recalc[block] with-css:', await evalOn(client, BENCH_RECALC_BLOCK));
  const ab = await withInjectedCssDisabled(client, async () => ({
    body: await evalOn(client, BENCH_RECALC_BODY),
    block: await evalOn(client, BENCH_RECALC_BLOCK),
  }));
  console.log('recalc       without-css:', JSON.stringify(ab));

  const m0 = await metricsOf(client);
  await sleep(6000); // 空闲窗口：后台定时器/同步任务的自然消耗
  const m1 = await metricsOf(client);
  console.log('idle 6s delta:', JSON.stringify(delta(m0, m1)));

  await evalOn(client, BENCH_SCROLL);
  const m2 = await metricsOf(client);
  console.log('scroll workload delta:', JSON.stringify(delta(m1, m2)));
  console.log('snapshot:', JSON.stringify(pick(m2)));
}

async function main() {
  const targets = listTargets();
  console.log('targets:');
  for (const t of targets) console.log(`  ${t.type} ${t.url.slice(0, 90)}`);
  const pages = targets.filter((t) => t.type === 'page' && t.url.includes('notion.so') && !t.url.includes('sw.js'));
  if (!pages.length) { console.log('no notion page target'); process.exit(1); }
  // 全量页面各测一轮：多标签后台消耗对比（backgroundThrottling:false 的代价量化）
  for (let i = 0; i < pages.length; i++) {
    const client = await attach(pages[i].webSocketDebuggerUrl);
    // attach 返回对象补出 ws 引用，供 CSS 事件旁路监听
    try { await probePage(`page#${i}`, client); } finally { client.close(); }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
