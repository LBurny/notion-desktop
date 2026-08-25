// Notion 顶栏动作：选择器常量 + 页面内寻钮/读态脚本生成
// 选择器由 scripts/cdp-topbar-scan.js / cdp-topbar-tree2.js 侦察敲定，按优先级排列；
// notion-* 类名稳定，aria-label 兜底（随界面语言变化）。Notion 改版时只需改这张表。
const TOPBAR_ACTIONS = {
  // sidebar 是状态感知开关（toggle）：Notion 的开/收按钮随侧栏状态此消彼长，
  // 且冷加载/切标签后懒挂载——盲发点击会静默落空（☰ 点开后再点收不回）。
  // 开点击 openSelectors、收点击 closeSelectors；selectors 保持并集供旧路径/测试用。
  sidebar:  { toggle: true,
    openSelectors: ['.notion-open-sidebar', '.notion-topbar [aria-label="Lock sidebar open"]', '.notion-topbar [aria-label="Open sidebar"]'],
    closeSelectors: ['.notion-sidebar [aria-label="Close sidebar"]'],
    selectors: ['.notion-open-sidebar', '.notion-topbar [aria-label="Lock sidebar open"]', '.notion-topbar [aria-label="Open sidebar"]', '.notion-sidebar [aria-label="Close sidebar"]'] },
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

// 侧栏状态：x=0 展开 / x=-250 收起（宽度恒 270，见 AGENTS.md）；元素缺失 = null（页面未渲染）。
// 阈值取中点 -125，动画途中读到哪侧都算哪侧——同向点击幂等，误判无害。
function sidebarStateOf(root) {
  const sb = root.querySelector('.notion-sidebar');
  if (!sb || typeof sb.getBoundingClientRect !== 'function') return null;
  return sb.getBoundingClientRect().x > -125 ? 'open' : 'closed';
}

// 侧栏开关执行器：状态感知选方向 + 效果校验重试。方向一次定死（按下时的反态），
// 同向重复点击天然幂等（生效后对应按钮消失）；每轮先查是否已翻转再决定点不点。
// gen 闸口：新一次按下作废旧重试循环，防并发互踩。依赖注入以便单测。
function createSidebarToggleRunner({ pickTopbarButton, sidebarStateOf, getRoot, sleep, maxAttempts = 12 }) {
  let gen = 0;
  return async function toggleSidebar(cfg) {
    const myGen = ++gen;
    const wantOpen = sidebarStateOf(getRoot()) !== 'open'; // null（未渲染）按收起→目标开
    const sels = wantOpen ? cfg.openSelectors : cfg.closeSelectors;
    const flipped = () => {
      const s = sidebarStateOf(getRoot());
      return wantOpen ? s === 'open' : s === 'closed';
    };
    for (let n = 0; n < maxAttempts; n++) {
      if (myGen !== gen || flipped()) return;
      const el = pickTopbarButton(getRoot(), sels);
      if (el) el.click();
      await sleep(Math.min(250 + n * 200, 900)); // 按钮可能尚未挂载，退避重试（总窗口约 9s）
    }
  };
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
  TOPBAR_ACTIONS, pickTopbarButton, sidebarStateOf, createSidebarToggleRunner,
  favoriteStateOf, quickFindStateOf,
  pageFontOf, CONTENT_FONT_SELECTORS,
};
