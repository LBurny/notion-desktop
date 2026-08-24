// Notion 顶栏动作：选择器常量 + 页面内寻钮/读态脚本生成
// 选择器由 scripts/cdp-topbar-scan.js / cdp-topbar-tree2.js 侦察敲定，按优先级排列；
// notion-* 类名稳定，aria-label 兜底（随界面语言变化）。Notion 改版时只需改这张表。
const TOPBAR_ACTIONS = {
  sidebar:  { selectors: ['.notion-open-sidebar', '.notion-topbar [aria-label="Lock sidebar open"]', '.notion-topbar [aria-label="Open sidebar"]'] },
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

module.exports = { TOPBAR_ACTIONS, pickTopbarButton, buildClickScript, buildFavoriteStateScript };
