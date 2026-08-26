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
// 探针结构镜像 Notion 真实 DOM：代码正文/行内代码都在 div[contenteditable="true"] 内，
// 行内代码内部 span 带「内联等宽 font-family（无 !important）」——正文 !important 规则
// 会压过内联样式，仅靠代码选择器 !important + 同等/更高特异性才能夺回（实测坑）。
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
  // 块级代码：.notion-code-block > div[contenteditable] > pre > code（镜像真实嵌套，
  // 代码正文在 contenteditable 内，被正文 (0,2,1) 压过需 contenteditable 专项选择器夺回）
  const codeWrap = document.createElement('div');
  codeWrap.className = 'notion-code-block';
  const codeCe = document.createElement('div');
  codeCe.setAttribute('contenteditable', 'true');
  const codePre = document.createElement('pre');
  const codeEl = document.createElement('code');
  codeEl.textContent = 'probe';
  codePre.appendChild(codeEl); codeCe.appendChild(codePre); codeWrap.appendChild(codeCe);
  root.appendChild(codeWrap);
  // 行内代码：.notion-text-block > div[contenteditable] > div.notion-inline-code-container
  // > span（内联 font-family: monospace 无 !important，镜像 Notion 真实结构）
  const textWrap = document.createElement('div');
  textWrap.className = 'notion-text-block';
  const textCe = document.createElement('div');
  textCe.setAttribute('contenteditable', 'true');
  const inlineWrap = document.createElement('div');
  inlineWrap.className = 'notion-inline-code-container';
  const inlineSpan = document.createElement('span');
  inlineSpan.textContent = 'probe';
  inlineSpan.setAttribute('style', 'font-family: "SFMono-Regular", Menlo, Consolas, monospace');
  inlineWrap.appendChild(inlineSpan); textCe.appendChild(inlineWrap); textWrap.appendChild(textCe);
  root.appendChild(textWrap);
  // 内联公式：.notion-text-block > .katex
  const mathWrap = document.createElement('div');
  mathWrap.className = 'notion-text-block';
  const mathEl = document.createElement('span');
  mathEl.className = 'katex';
  mathWrap.appendChild(mathEl);
  root.appendChild(mathWrap);
  page.appendChild(root);
  const uiEl = document.createElement('span');
  uiEl.id = '__nd-font-probe-ui';
  uiEl.textContent = 'probe';
  sidebar.appendChild(uiEl);
  const cs = (el) => getComputedStyle(el).fontFamily;
  // 真实正文文字叶节点：分区字体必须落到这里（探针 span 只覆盖低特异性路径，
  // 文字叶节点由 [contenteditable="true"]:first-of-type 这类 0,2,0 规则命中）
  const leaf = page.querySelector('.notion-text-block div[contenteditable="true"]');
  // 真实行内代码：页面若已有 .notion-inline-code-container，校验其内部 span 的计算字体
  const realInline = page.querySelector('.notion-inline-code-container span, .notion-inline-code-container');
  return {
    body: cs(bodyEl), ui: cs(uiEl),
    code: cs(codeEl),             // 块级代码正文（contenteditable 内）
    inlineCode: cs(inlineSpan),  // 行内代码内部 span（内联 font-family 被 !important 夺回）
    math: cs(mathEl),
    realLeaf: leaf ? cs(leaf) : null,
    realInlineCode: realInline ? cs(realInline) : null,
  };
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
  check('行内代码字体', fonts.inlineCode, want.code); // 内联 font-family 被 !important 夺回路径：防假绿
  check('内联公式字体', fonts.math, want.math);
  check('真实正文文字叶节点', fonts.realLeaf, want.body); // 特异性 0,2,0 路径：防假绿
  // 页面真实行内代码（若有）：.notion-inline-code-container 内部 span 的计算字体
  if (fonts.realInlineCode) check('真实行内代码', fonts.realInlineCode, want.code);

  pg.close();
  console.log(failures ? `FAIL (${failures} 项)` : 'PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
