// Notion 顶栏动作：选择器常量 + 页面内寻钮/读态脚本生成
// 选择器由 scripts/cdp-topbar-scan.js / cdp-topbar-tree2.js 侦察敲定，按优先级排列；
// notion-* 类名稳定，aria-label 兜底（随界面语言变化）。Notion 改版时只需改这张表。
const TOPBAR_ACTIONS = {
  // sidebar 是开关：收起态命中前几个“打开”钮，展开态它们全部落空、落到“收起”钮
  sidebar:  { selectors: ['.notion-open-sidebar', '.notion-topbar [aria-label="Lock sidebar open"]', '.notion-topbar [aria-label="Open sidebar"]', '.notion-sidebar [aria-label="Close sidebar"]'] },
  share:    { selectors: ['.notion-topbar-share-menu', '.notion-topbar [aria-label="Share"]'] },
  favorite: { selectors: ['.notion-topbar-favorite-button', '.notion-topbar [aria-label="Favorite"]', '.notion-topbar [aria-label="Favorited"]'] },
  more:     { selectors: ['.notion-topbar-more-button', '.notion-topbar [aria-label="Actions"]'] },
};

// 注入页面执行，必须自包含（不得引用模块作用域）
function pickTopbarButton(root, selectors) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function buildClickScript(action) {
  const cfg = TOPBAR_ACTIONS[action];
  if (!cfg) throw new Error('unknown topbar action: ' + action);
  return `(() => {
    const el = (${pickTopbarButton.toString()})(document, ${JSON.stringify(cfg.selectors)});
    if (!el) return false;
    el.click();
    return true;
  })()`;
}

// 收藏状态：svg.starFill = 已收藏，svg.star = 未收藏（侦察确认，语言无关）
function buildFavoriteStateScript() {
  const sels = JSON.stringify(TOPBAR_ACTIONS.favorite.selectors);
  return `(() => {
    const el = (${pickTopbarButton.toString()})(document, ${sels});
    if (!el) return null;
    if (el.querySelector('svg.starFill')) return true;
    if (el.querySelector('svg.star')) return false;
    return null;
  })()`;
}

// ── preload 探针的同源纯函数 ──
// 顶栏点击/状态读取已改走 preload IPC（executeJavaScript 在 Electron 43 上
// 往返约 140ms，preload IPC 约 1ms）。沙箱 preload 无法 require 本地模块，
// src/preload/content.js 里的实现镜像以下函数，修改时两边必须同步。

// 与 buildFavoriteStateScript 相同的判态逻辑（直接函数版）
function favoriteStateOf(root, selectors) {
  const el = pickTopbarButton(root, selectors);
  if (!el) return null;
  if (el.querySelector('svg.starFill')) return true;
  if (el.querySelector('svg.star')) return false;
  return null;
}

// Quick Find 浮层状态：open = 带输入框的搜索浮层已开；anyDialog = 有任何
// role=dialog（含"在桌面应用打开？"推广条——它也会挡快捷键）
function quickFindStateOf(root) {
  return {
    open: !!root.querySelector('[role="dialog"] input'),
    anyDialog: !!root.querySelector('[role="dialog"]'),
  };
}

// 页面正文代表元素（探测计算字体的采样点）：default.css / custom.css /
// 设置字体三类注入都覆盖这些选择器；都不存在 = 页面尚未渲染就绪
const CONTENT_FONT_SELECTORS = ['.notion-page-content', '[data-testid="page-title"]'];

// 读页面实际生效的 font-family（getComputedStyle 跟随全部注入 CSS，含 custom.css）
function pageFontOf(root, getComputedStyle) {
  for (const sel of CONTENT_FONT_SELECTORS) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const font = (getComputedStyle(el).fontFamily || '').trim();
    if (font) return font;
  }
  return null;
}

module.exports = {
  TOPBAR_ACTIONS, pickTopbarButton, buildClickScript, buildFavoriteStateScript,
  favoriteStateOf, quickFindStateOf, pageFontOf, CONTENT_FONT_SELECTORS,
};
