// 端到端验证 ☰ 侧栏开关（状态感知 + 效果校验重试的回归看护）
// 前置：应用以 --remote-debugging-port=9222 启动
// 用法：node scripts/cdp-sidebar-check.js [port]
// 覆盖两条路径：
//   A 温热路径——当前活动标签上 开→关 各一次，轮询确认状态翻转
//   B 冷路径（原始 bug 场景）——激活一个未加载标签，页面目标一出现立即按 ☰，
//     此时开/收按钮尚未懒挂载，旧实现静默落空（收不回去），新实现靠重试落地
const { execFileSync } = require('child_process');
const port = process.argv[2] || '9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function targets() {
  // Node fetch/http 会卡死 Electron devtools HTTP 服务（AGENTS.md），一律 curl
  const out = execFileSync('curl', ['-s', '-m', '8', `http://127.0.0.1:${port}/json`]).toString();
  return JSON.parse(out);
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

const sidebarXExpr = `document.querySelector('.notion-sidebar') ? Math.round(document.querySelector('.notion-sidebar').getBoundingClientRect().x) : null`;
const stateOf = (x) => (x === null ? null : x > -125 ? 'open' : 'closed');
// 标题栏活动标签标题（去 " | Notion" 后缀）。预热视图也作为 notion.so 目标出现在
// /json 中，按此标题精确选中活动标签，避免误选 detached 预热视图。
const activeTitleExpr = `((document.querySelector('#tabs .tab.active .tab-title') || {}).textContent || '').replace(/\\s*\\|\\s*Notion$/, '').trim()`;
const cleanT = (t) => (t || '').replace(/\s*\|\s*Notion$/, '').trim();

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
}

async function notionPage(activeTitle) {
  const all = targets().filter((t) => t.type === 'page' && t.url.startsWith('https://www.notion.so') && !t.url.includes('sw.js'));
  if (activeTitle && activeTitle !== '加载中…') {
    const hit = all.find((p) => cleanT(p.title) === activeTitle);
    if (hit) return hit;
  }
  return all[0];
}

// 按 ☰（真实 IPC 路径：标题栏按钮 → main → preload 执行器）
async function pressToggle(tb) {
  await evalOn(tb, `document.getElementById('sidebar-toggle').click()`);
}

// 轮询等状态翻转（重试执行器落地需要时间），超时返回最终状态
async function waitState(pg, want, timeoutMs) {
  const t0 = Date.now();
  let cur = null;
  while (Date.now() - t0 < timeoutMs) {
    cur = stateOf(await evalOn(pg, sidebarXExpr));
    if (cur === want) return cur;
    await sleep(200);
  }
  return cur;
}

async function main() {
  const tbTarget = targets().find((t) => t.url.includes('titlebar/index.html'));
  if (!tbTarget) throw new Error('titlebar target not found（应用需先启动）');
  const tb = await attach(tbTarget.webSocketDebuggerUrl);

  // —— A：温热路径 ——
  let page = await notionPage(await evalOn(tb, activeTitleExpr));
  if (!page) throw new Error('notion page target not found');
  let pg = await attach(page.webSocketDebuggerUrl);
  const s0 = stateOf(await evalOn(pg, sidebarXExpr));
  if (!s0) throw new Error('侧栏元素不存在，页面未就绪');
  const wantA = s0 === 'open' ? 'closed' : 'open';
  await pressToggle(tb);
  check('A1 温热路径：按一次翻转', await waitState(pg, wantA, 10000), wantA);
  await pressToggle(tb);
  check('A2 温热路径：再按翻回', await waitState(pg, s0, 10000), s0);
  pg.close();

  // —— B：冷路径（回归看护）——找一个未加载的标签激活，页面目标一出现立即按 ☰
  const tabCount = await evalOn(tb, `document.querySelectorAll('#tabs .tab').length`);
  const activeId = await evalOn(tb, `(document.querySelector('#tabs .tab.active') || {}).dataset.id || ''`);
  let coldIdx = -1;
  for (let i = 0; i < tabCount; i++) {
    const id = await evalOn(tb, `(document.querySelectorAll('#tabs .tab')[${i}] || { dataset: {} }).dataset.id || ''`);
    if (id && id !== activeId) { coldIdx = i; break; }
  }
  if (coldIdx === -1) {
    console.log('SKIP B：只有一个标签，无法测冷路径');
  } else {
    const before = targets().filter((t) => t.type === 'page' && t.url.startsWith('https://www.notion.so')).map((t) => t.id);
    await evalOn(tb, `document.querySelectorAll('#tabs .tab')[${coldIdx}].click()`);
    // 等该标签的页面目标出现（可能新加载）；按活动标题选中活动（冷）标签，避开预热视图
    let cold = null;
    for (let i = 0; i < 60 && !cold; i++) {
      await sleep(500);
      const at = cleanT(await evalOn(tb, activeTitleExpr));
      const all = targets().filter((t) => t.type === 'page' && t.url.startsWith('https://www.notion.so') && !t.url.includes('sw.js'));
      cold = (at && at !== '加载中…' && all.find((p) => cleanT(p.title) === at)) || all[0];
    }
    if (!cold || before.includes(cold.id)) {
      // 目标早已加载过也算冷启动等价场景跳过说明
      console.log('B 提示：目标标签视图此前已加载，仍按冷路径流程断言');
    }
    pg = await attach(cold.webSocketDebuggerUrl);
    // 不等页面渲染完毕，立即连按两次（旧实现：第二次必然落空）
    await pressToggle(tb);
    const sB1 = await waitState(pg, 'open', 15000);
    check('B1 冷路径：按钮未挂载也最终展开（重试落地）', sB1, 'open');
    await pressToggle(tb);
    check('B2 冷路径：再按最终收起（原「收不回去」回归）', await waitState(pg, 'closed', 15000), 'closed');
    pg.close();
  }

  tb.close();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
