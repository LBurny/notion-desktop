const { contextBridge, ipcRenderer } = require('electron');

// ── 加载期底色补丁（防白闪）────────────────────────────────
// preload 在文档最早期执行，趁首帧渲染前打上主题底色；
// Notion 启动后自带主题会覆盖同色系背景，主题反转时由 report() 摘除
const EARLY_BG_ID = 'nd-early-bg';
// 覆盖 html/body/#notion-app：Notion 的浅色初始样式打在 body 上，只补 html 会被盖住
const EARLY_BG_CSS = 'html, body, #notion-app { background: #191919 !important; }';
function applyEarlyBg(theme) {
  let el = document.getElementById(EARLY_BG_ID);
  if (theme === 'dark') {
    if (!el) {
      el = document.createElement('style');
      el.id = EARLY_BG_ID;
      el.textContent = EARLY_BG_CSS;
      (document.head || document.documentElement).appendChild(el);
    }
  } else if (el) {
    el.remove();
  }
}
// get-theme 是同步频道，preload 阶段即可拿到主进程已知的主题（含持久化值）。
// document-start 时 documentElement 可能尚未解析出来，用观察器等它出现
(function injectEarlyBg() {
  const t0 = ipcRenderer.sendSync('get-theme');
  if (document.documentElement) { applyEarlyBg(t0); return; }
  const mo = new MutationObserver(() => {
    if (document.documentElement) { applyEarlyBg(t0); mo.disconnect(); }
  });
  mo.observe(document, { childList: true, subtree: true });
})();

function currentTheme() {
  const html = document.documentElement;
  const body = document.body;
  const dark =
    html.classList.contains('dark') ||
    (body && body.classList.contains('dark')) ||
    !!document.querySelector('#notion-app.dark');
  return dark ? 'dark' : 'light';
}

let last = null;
function report() {
  const t = currentTheme();
  if (t !== last) {
    last = t;
    applyEarlyBg(t); // Notion 真实主题就绪后校准早期补丁（主题反转时摘除）
    ipcRenderer.send('notion-theme-changed', t);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  report();
  const observer = new MutationObserver(report);
  const opts = { attributes: true, attributeFilter: ['class'] };
  observer.observe(document.documentElement, opts);
  if (document.body) observer.observe(document.body, opts);
  // 兜底：主题类若挂在更深层节点，低成本轮询保证不漏
  setInterval(report, 1500);
});

// “新建标签”待命态：主进程唤起 Quick Find 前置位，选中结果时拦截跳转改开新标签
let qfArmed = false;
ipcRenderer.on('quick-find-arm', (_e, on) => { qfArmed = !!on; });

// Notion 的 Quick Find 只在 keydown 目标位于浮层内部时才响应 Escape（实测：
// 焦点在 body 上时可信 Escape 也不关）。选中结果后焦点可能不在输入框，
// 主动把 DOM 焦点放回去（隔离世界 focus() 实测有效），保证主进程注入的
// Escape 能真正关掉浮层
function refocusDialogInput(dlg) {
  const input = dlg && dlg.querySelector('input');
  if (input) input.focus();
}

// 捕获阶段挂在 window 上，先于页面自身的冒泡监听触发
window.addEventListener('click', (e) => {
  if (!qfArmed) return;
  const dlg = e.target && e.target.closest ? e.target.closest('[role="dialog"]') : null;
  if (!dlg) {
    ipcRenderer.send('quick-find-dismissed'); // 点到浮层外：搜索被关掉，解除待命
    return;
  }
  const a = e.target.closest('a[href]');
  const href = a && a.getAttribute('href');
  if (!href) return; // 点在浮层空白处，保持待命
  e.preventDefault();
  e.stopPropagation();
  refocusDialogInput(dlg); // 让随后的 Escape 落在浮层内，Notion 才会关它
  ipcRenderer.send('quick-find-picked', href);
}, true);

window.addEventListener('keydown', (e) => {
  if (!qfArmed) return;
  if (e.key === 'Escape') {
    // 只有搜索浮层（带输入框）真的开着才算用户主动取消；
    // 主进程预热时会送 Escape 关其它浮层（如推广条），那种不算
    if (document.querySelector('[role="dialog"] input')) {
      ipcRenderer.send('quick-find-dismissed');
    }
    return; // 不拦截，让 Notion 自己关浮层
  }
  if (e.key !== 'Enter') return;
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return;
  const sel = dlg.querySelector('[aria-selected="true"] a[href]') || dlg.querySelector('a[href]');
  const href = sel && sel.getAttribute('href');
  if (!href) return; // 结果不是链接形态则放行，主进程有导航兜底
  e.preventDefault();
  e.stopPropagation();
  refocusDialogInput(dlg);
  ipcRenderer.send('quick-find-picked', href);
}, true);

// ── 主进程探针：顶栏点击 / 收藏状态 / Quick Find 状态 / 页面字体 ──
// 隔离世界可同步读 DOM，wc.send 往返约 1ms，取代 executeJavaScript
//（Electron 43 上约 140ms）。选择器由主进程随消息下发（源：topbar-actions.js）；
// 沙箱 preload 无法 require 本地模块，寻钮/判态逻辑镜像 topbar-actions.js，
// 修改时两边同步。
function pickFirst(root, selectors) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

ipcRenderer.on('topbar-click', (_e, selectors) => {
  if (!Array.isArray(selectors)) return;
  const el = pickFirst(document, selectors);
  if (el) el.click();
});

ipcRenderer.on('topbar-favorite-query', (_e, selectors) => {
  if (!Array.isArray(selectors)) return;
  const el = pickFirst(document, selectors);
  let state = null;
  if (el) {
    if (el.querySelector('svg.starFill')) state = true;
    else if (el.querySelector('svg.star')) state = false;
  }
  ipcRenderer.send('topbar-favorite-state', state);
});

ipcRenderer.on('quick-find-state-query', () => {
  ipcRenderer.send('quick-find-state', {
    open: !!document.querySelector('[role="dialog"] input'),
    anyDialog: !!document.querySelector('[role="dialog"]'),
  });
});

ipcRenderer.on('page-font-query', (_e, selectors) => {
  let font = null;
  if (Array.isArray(selectors)) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const f = (window.getComputedStyle(el).fontFamily || '').trim();
      if (f) { font = f; break; }
    }
  }
  ipcRenderer.send('page-font', font);
});

contextBridge.exposeInMainWorld('notionDesktop', {
  retry: () => ipcRenderer.send('retry-load'),
});
