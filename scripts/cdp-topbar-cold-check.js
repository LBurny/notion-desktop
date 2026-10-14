// 端到端验证顶栏按钮懒挂载期不丢点击：应用启动后**立刻**运行本脚本，
// 抢在 Notion 页面挂出 Share/⋯ 按钮之前点标题栏按钮，断言浮层最终仍会弹出。
// （修复前这里静默落空：按钮挂载前 el.click() 被丢弃且不补发，症状=点了 Share/⋯ 什么也不弹）
// 用法：启动应用（带 --remote-debugging-port=9222）后马上运行
//       node scripts/cdp-topbar-cold-check.js [port] [share|more]
// 注：对已就绪的温热实例运行无意义（点击立即生效），必须冷启动抢点。
const port = process.argv[2] || '9222';
const action = process.argv[3] || 'share';
const target = action === 'more' ? 'tb-more' : 'tb-share';
const expectText = action === 'more' ? 'Copy link' : 'Share';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) })).json(); } catch { return []; }
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
const evalOn = async (c, expr) => {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r && r.result ? r.result.value : undefined;
};

// 浮层/按钮状态：只认活动视图（预热视图视口 0x0，恒无浮层）
const Q = `(() => {
  const dlg = document.querySelector('[role="dialog"], [role="menu"]');
  const vp = innerWidth > 0 && document.visibilityState === 'visible';
  return { vp, topbar: !!document.querySelector('.notion-topbar'),
    btn: !!document.querySelector('.notion-topbar-share-menu, .notion-topbar-more-button, [aria-label="Share"], [aria-label="Actions"]'),
    dialog: vp && dlg ? (dlg.innerText || '').slice(0, 40).replace(/\\n/g, ' | ') : null };
})()`;

(async () => {
  const t0 = Date.now();
  let tbT = null, pgT = null;
  for (let i = 0; i < 150 && !(tbT && pgT); i++) {
    const ts = await targets();
    if (!tbT) tbT = ts.find((x) => x.url.includes('titlebar/index.html')) || null;
    if (!pgT) pgT = ts.find((x) => x.type === 'page' && /^https:\/\/www\.notion\.so\//.test(x.url)) || null;
    if (!tbT || !pgT) await sleep(200);
  }
  if (!tbT || !pgT) { console.log('FAIL 未找到标题栏/Notion 页面目标（应用没起来？）'); process.exit(1); }
  const tb = await attach(tbT.webSocketDebuggerUrl);
  const pg = await attach(pgT.webSocketDebuggerUrl);
  const state = async () => evalOn(pg, Q);

  const before = await state();
  console.log(`[+${Date.now() - t0}ms] 抢点前: ${JSON.stringify(before)}`);
  await evalOn(tb, `document.getElementById('${target}').click()`); // 真实路径：标题栏 → 主进程 → preload
  console.log(`[+${Date.now() - t0}ms] 已点 ${target}（页面大概率还没挂出按钮）`);

  let openedAt = null;
  for (let i = 0; i < 50; i++) {
    await sleep(500);
    const s = await state();
    if (s.dialog && !openedAt) openedAt = Date.now() - t0;
    if (i % 6 === 0 || openedAt) console.log(`[+${Date.now() - t0}ms] ${JSON.stringify(s)}`.slice(0, 200));
    if (openedAt) break;
  }
  tb.close(); pg.close();

  const ok = !!openedAt && String(openedAt) !== 'null';
  console.log(ok
    ? `PASS 冷点后 ${openedAt}ms 浮层弹出（按钮懒挂载期点击没丢）`
    : 'FAIL 冷点静默落空：25s 内页面没有任何浮层（点击丢失未补发）');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
