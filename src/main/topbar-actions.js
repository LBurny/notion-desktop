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

// 探针纯函数：单一事实源。沙箱 preload 无法 require 本地模块，
// content.js 里的同名函数由 scripts/build-preload-probes.js 从此内联生成，
// 修改后运行 npm run sync-probes（tests/probe-sync.test.js 保新鲜）。

// 寻钮：按优先级返回第一个命中（aria-label 随界面语言变化，所以多级兜底）
function pickTopbarButton(root, selectors) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// 收藏状态：svg.starFill = 已收藏，svg.star = 未收藏（侦察确认，语言无关）
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
  TOPBAR_ACTIONS, pickTopbarButton, favoriteStateOf, quickFindStateOf,
  pageFontOf, CONTENT_FONT_SELECTORS,
};
