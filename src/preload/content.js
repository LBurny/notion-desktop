const { contextBridge, ipcRenderer } = require('electron');

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
  ipcRenderer.send('quick-find-picked', href);
}, true);

contextBridge.exposeInMainWorld('notionDesktop', {
  retry: () => ipcRenderer.send('retry-load'),
});
