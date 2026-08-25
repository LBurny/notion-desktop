// Quick Find 选中后浮层残留的端到端验证（只读断言 + DOM 点击，不注入按键）
// 流程：标题栏点 + → 当前页弹出 Quick Find → 点击第一个结果链接
// 断言：新标签出现；来源页的 [role="dialog"] 被关闭（修复前会一直残留）
const CDP_PORT = process.argv[2] || '9222';
const { execSync } = require('child_process');

function listTargets() {
  const out = execSync(`curl -s -m 8 http://127.0.0.1:${CDP_PORT}/json`).toString();
  return JSON.parse(out);
}

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  return {
    send: (method, params = {}) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    }),
    close: () => ws.close(),
  };
}

async function evalOn(client, expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function main() {
  const before = listTargets();
  const titlebar = before.find((t) => t.url.endsWith('/titlebar/index.html'));
  const contents = before.filter((t) => t.type === 'page' && t.url.startsWith('https://www.notion.so')
    && !t.url.endsWith('sw.js'));
  const active = contents[0]; // 活动标签（页面1）
  if (!titlebar || !active) { console.log('FAIL 找不到标题栏或内容目标'); process.exit(1); }

  const tb = await attach(titlebar.webSocketDebuggerUrl);
  const page1 = await attach(active.webSocketDebuggerUrl);
  const page1Id = active.id;

  // 1. 点标题栏 + → 唤起当前页 Quick Find
  await evalOn(tb, `document.getElementById('new-tab').click()`);
  let qfOpen = false;
  for (let i = 0; i < 30; i++) {
    qfOpen = await evalOn(page1, `!!document.querySelector('[role="dialog"] input')`);
    if (qfOpen) break;
    await sleep(500);
  }
  check('页面1 弹出 Quick Find 搜索浮层', qfOpen === true);
  if (!qfOpen) { process.exit(1); }

  // 2. 点击第一个结果链接（preload 捕获监听会拦截并上报 picked）
  const picked = await evalOn(page1, `(() => {
    const a = document.querySelector('[role="dialog"] a[href]');
    if (!a) return null;
    const href = a.getAttribute('href');
    a.click();
    return href;
  })()`);
  check('点击搜索结果', typeof picked === 'string', String(picked).slice(0, 60));

  // 3. 等新标签出现（页面2）。注意排除 Notion 的 service worker（sw.js）
  let newTarget = null;
  for (let i = 0; i < 20; i++) {
    const now = listTargets();
    newTarget = now.find((t) => t.type === 'page' && t.url.startsWith('https://www.notion.so')
      && !t.url.endsWith('sw.js') && t.id !== page1Id
      && !before.some((b) => b.id === t.id));
    if (newTarget) break;
    await sleep(500);
  }
  check('选中新页面后打开新标签', !!newTarget, newTarget && newTarget.url.slice(0, 70));

  // 4. 关键断言：来源页的搜索浮层已关闭（修复前会残留/被重试阶梯重开）。
  // 必须查带 input 的浮层——裸 [role="dialog"] 会误中推广条等其它浮层
  await sleep(1500); // 留够 Escape 处理时间
  const stillOpen = await evalOn(page1, `!!document.querySelector('[role="dialog"] input')`);
  check('页面1 的搜索浮层已关闭', stillOpen === false);

  tb.close(); page1.close();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
