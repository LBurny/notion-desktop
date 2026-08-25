// 端到端验证分区字体（fonts.{body,ui,code,math}）在 Notion 页面真实生效
// 前置：应用以 --remote-debugging-port=9222 启动并等页面就绪
// 用法：node scripts/cdp-fonts-check.js [port]
// 原理：读 %APPDATA%/notion-desktop/style-settings.json 算出各槽位期望字体
//   （body 空=思源宋体栈；ui 空=界面内置默认栈（同思源宋体栈，不跟随正文）；
//    code 空=Consolas 栈；math 空=KaTeX_Main），
//   向页面注入探针元素（正文/侧栏/代码块/内联公式）读计算 font-family 比对，
//   并采样真实正文文字叶节点（[contenteditable="true"]:first-of-type）——
//   那是 0,2,0 特异性路径，防「探针元素全过但真实正文没变」的假绿。
//   探针每轮重建，防 Notion React 重渲染时清掉附加子节点。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
  if (r && r.exceptionDetails) throw new Error('evaluate 异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r && r.result ? r.result.value : undefined;
}

// 与 style-settings.js 的回退规则保持一致的期望值推算
function expectedFonts() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'notion-desktop', 'style-settings.json'), 'utf8'));
  } catch { /* 文件缺失/损坏 → 全默认 */ }
  const fonts = s.fonts && typeof s.fonts === 'object' ? s.fonts : {};
  const clean = (v) => (typeof v === 'string' ? v.trim().replace(/["\\]/g, '') : '');
  // 旧版顶层 font 迁移进 body+ui（保留旧外观）
  const body = clean(fonts.body) || clean(s.font) || '思源宋体 CN';
  const ui = clean(fonts.ui) || clean(s.font) || '思源宋体 CN'; // ui 空 = 界面内置默认栈
  const code = clean(fonts.code) || 'Consolas';
  const math = clean(fonts.math) || 'KaTeX_Main';
  return { body, ui, code, math };
}

// 注入探针并读计算字体（每轮重建容器，防 React 重渲染清理）
const PROBE_EXPR = `(() => {
  const old = document.getElementById('__nd-font-probe');
  if (old) old.remove();
  const page = document.querySelector('.notion-page-content');
  const sidebar = document.querySelector('.notion-sidebar');
  if (!page || !sidebar) return null;
  const root = document.createElement('div');
  root.id = '__nd-font-probe';
  const bodyEl = document.createElement('span');
  bodyEl.textContent = 'probe';
  root.appendChild(bodyEl);
  const codeWrap = document.createElement('div');
  codeWrap.className = 'notion-code-block';
  const codeEl = document.createElement('code');
  codeEl.textContent = 'probe';
  codeWrap.appendChild(codeEl);
  root.appendChild(codeWrap);
  const textWrap = document.createElement('div');
  textWrap.className = 'notion-text-block';
  const mathEl = document.createElement('span');
  mathEl.className = 'katex';
  textWrap.appendChild(mathEl);
  root.appendChild(textWrap);
  page.appendChild(root);
  const uiEl = document.createElement('span');
  uiEl.id = '__nd-font-probe-ui';
  uiEl.textContent = 'probe';
  sidebar.appendChild(uiEl);
  const cs = (el) => getComputedStyle(el).fontFamily;
  // 真实正文文字叶节点：分区字体必须落到这里（探针 span 只覆盖低特异性路径，
  // 文字叶节点由 [contenteditable="true"]:first-of-type 这类 0,2,0 规则命中）
  const leaf = page.querySelector('.notion-text-block div[contenteditable="true"]');
  return { body: cs(bodyEl), ui: cs(uiEl), code: cs(codeEl), math: cs(mathEl), realLeaf: leaf ? cs(leaf) : null };
})()`;

let failures = 0;
function check(name, actual, want) {
  const ok = typeof actual === 'string' && actual.includes(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: 期望含 ${JSON.stringify(want)} 实际=${JSON.stringify(actual)}`);
}

async function main() {
  const want = expectedFonts();
  console.log('期望值（由 style-settings.json 推算）:', JSON.stringify(want));

  // 等 Notion 页面目标出现并就绪
  let pg = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const page = targets().find((t) => t.type === 'page' && t.url.startsWith('https://www.notion.so') && !t.url.includes('sw.js'));
    if (page) {
      pg = await attach(page.webSocketDebuggerUrl);
      const ready = await evalOn(pg, `!!document.querySelector('.notion-page-content') && !!document.querySelector('.notion-sidebar')`);
      if (ready) break;
      pg.close(); pg = null;
    }
    await sleep(500);
  }
  if (!pg) throw new Error('notion page 未就绪（90s 超时）');

  // 设置 CSS 注入与 React 渲染有窗口期，轮询到稳定
  let fonts = null;
  for (let i = 0; i < 20; i++) {
    fonts = await evalOn(pg, PROBE_EXPR);
    if (fonts) break;
    await sleep(500);
  }
  if (!fonts) throw new Error('探针注入失败');
  console.log('实际计算字体:', JSON.stringify(fonts));

  check('正文字体', fonts.body, want.body);
  check('界面字体（侧栏）', fonts.ui, want.ui);
  check('代码块字体', fonts.code, want.code);
  check('内联公式字体', fonts.math, want.math);
  check('真实正文文字叶节点', fonts.realLeaf, want.body); // 特异性 0,2,0 路径：防假绿

  pg.close();
  console.log(failures ? `FAIL (${failures} 项)` : 'PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
