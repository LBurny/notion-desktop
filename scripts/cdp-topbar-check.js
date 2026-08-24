// 端到端验证顶栏一体化：Notion 顶栏已隐藏、标题栏新按钮存在且顺序正确、
// 点击 ⋯/Share 在页面弹出真实菜单、☆ 状态双向一致（点后还原不留痕）
// 前置：应用以 --remote-debugging-port=9222 启动
// 用法：node scripts/cdp-topbar-check.js [port]
const port = process.argv[2] || '9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  return res.json();
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

async function evalOn(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r && r.result ? r.result.value : undefined;
}

async function escapeOn(client) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
}

const overlayExpr = `!!document.querySelector('.notion-overlay-container [role="menu"], .notion-overlay-container [role="dialog"], [role="menu"]')`;
const favStateExpr = `(() => {
  const el = document.querySelector('.notion-topbar-favorite-button');
  if (!el) return null;
  if (el.querySelector('svg.starFill')) return true;
  if (el.querySelector('svg.star')) return false;
  return null;
})()`;

async function main() {
  // 等标题栏与 Notion 页面就绪
  let tb = null, op = null;
  for (let i = 0; i < 40 && (!tb || !op); i++) {
    const ts = await targets();
    if (!tb) {
      const t = ts.find((x) => x.url.includes('titlebar/index.html'));
      if (t) tb = await attach(t.webSocketDebuggerUrl);
    }
    if (!op) {
      const p = ts.find((x) => x.type === 'page' && x.url.startsWith('https://www.notion.so'));
      if (p) op = await attach(p.webSocketDebuggerUrl);
    }
    await sleep(1000);
  }
  if (!tb || !op) throw new Error('targets not found');
  for (let i = 0; i < 40; i++) {
    if (await evalOn(op, `document.readyState === 'complete' && !!document.querySelector('.notion-topbar')`)) break;
    await sleep(1000);
  }
  await sleep(2000);

  // 1) Notion 顶栏被压成 0 高（一体化隐藏）
  check('notion-topbar 高度为 0', await evalOn(op, `Math.round(document.querySelector('.notion-topbar').getBoundingClientRect().height)`), 0);

  // 2) 标题栏新按钮存在且顺序：sidebar-toggle 在最左，topbar-actions 在 controls 之前
  check('标题栏含四个新按钮', await evalOn(tb, `!!(document.getElementById('sidebar-toggle') && document.getElementById('tb-share') && document.getElementById('tb-favorite') && document.getElementById('tb-more'))`), true);
  check('☰ 位于标签区之前', await evalOn(tb, `document.getElementById('sidebar-toggle').compareDocumentPosition(document.getElementById('tabs')) === Node.DOCUMENT_POSITION_FOLLOWING`), true);
  check('Share/☆/⋯ 位于窗口控制之前', await evalOn(tb, `document.getElementById('topbar-actions').compareDocumentPosition(document.getElementById('controls')) === Node.DOCUMENT_POSITION_FOLLOWING`), true);

  // 3) 点 ⋯ → 页面弹出真实菜单；Escape 关闭
  let menuOpen = false;
  for (let a = 0; a < 3 && !menuOpen; a++) {
    await evalOn(tb, `document.getElementById('tb-more').click()`);
    for (let i = 0; i < 6 && !menuOpen; i++) { await sleep(500); menuOpen = await evalOn(op, overlayExpr); }
  }
  check('点 ⋯ 页面弹出菜单', menuOpen, true);
  await escapeOn(op);
  await sleep(800);
  check('Escape 后菜单关闭', await evalOn(op, overlayExpr), false);

  // 4) 点 Share → 页面弹出分享对话框；Escape 关闭
  let shareOpen = false;
  for (let a = 0; a < 3 && !shareOpen; a++) {
    await evalOn(tb, `document.getElementById('tb-share').click()`);
    for (let i = 0; i < 6 && !shareOpen; i++) { await sleep(500); shareOpen = await evalOn(op, `!!document.querySelector('[role="dialog"]')`); }
  }
  check('点 Share 页面弹出对话框', shareOpen, true);
  await escapeOn(op);
  await sleep(800);

  // 5) ☆ 状态一致：点标题栏 ☆ 翻状态，标题栏 class 与页面 svg.starFill 一致，再点回还原
  const favBefore = await evalOn(op, favStateExpr);
  console.log('页面初始收藏状态:', favBefore);
  if (favBefore !== null) {
    await evalOn(tb, `document.getElementById('tb-favorite').click()`);
    await sleep(1500);
    const favAfter = await evalOn(op, favStateExpr);
    check('点 ☆ 后页面收藏状态翻转', favAfter, !favBefore);
    const cls = await evalOn(tb, `document.getElementById('tb-favorite').className`);
    check('标题栏 ☆ 样式与页面一致', cls.includes('favorited'), favAfter === true);
    // 还原，不留测试痕迹
    await evalOn(tb, `document.getElementById('tb-favorite').click()`);
    await sleep(1500);
    check('还原后页面收藏状态', await evalOn(op, favStateExpr), favBefore);
  } else {
    console.log('SKIP 收藏状态断言（页面无收藏按钮）');
  }

  tb.close();
  op.close();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
