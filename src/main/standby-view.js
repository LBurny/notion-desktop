// 预热视图：常驻一个 detached WebContentsView，预加载 Notion 首页（带 preload/CSS/底色）。
// newTab 优先认领它并经 SPA 内导航（content.js 的 spa-navigate）瞬时跳转，
// 避免每个新标签冷加载整个 Notion SPA（实测 ~4.6s，期间 Ctrl+K 被丢、☰ 按钮未挂载）。
// 未就绪/被认领后调用方回退原冷加载路径，无回归。
// 关键：SPA 跳转改 location.href 但不反映到 webContents.getURL()，故兜底判定用
// location.href 探针（见 tabs.js），而非 getURL()——否则会误判后整页重载（v0.2.0 翻车点）。
const { WebContentsView } = require('electron');
const { themeBackground } = require('./tab-manager');

function createStandbyView({ partition, preloadPath, homeUrl, getCss, getTheme }) {
  let view = null;       // 当前预热 WebContentsView
  let cssKey = null;     // 注入 CSS 的移除句柄
  let warming = false;   // 加温中（建视图→did-finish-load）
  let ready = false;     // did-finish-load 已触发

  function reset() { view = null; cssKey = null; warming = false; ready = false; }

  function makeView() {
    const v = new WebContentsView({
      webPreferences: { partition, preload: preloadPath, backgroundThrottling: false },
    });
    v.setBackgroundColor(themeBackground(getTheme()));
    const wc = v.webContents;
    wc.on('dom-ready', () => {
      if (wc.isDestroyed()) return;
      wc.insertCSS(getCss(), { cssOrigin: 'author' })
        .then((k) => { cssKey = k; })
        .catch(() => {});
    });
    wc.on('did-finish-load', () => { warming = false; ready = true; });
    // 首页加载失败：清理以便 rewarm 重试，避免永久卡 warming=true 阻断后续预热
    wc.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
      if (!isMainFrame) return;
      if (!wc.isDestroyed()) wc.close();
      reset();
    });
    return v;
  }

  function warm() {
    if (view || warming) return; // 幂等：已有视图或正在加温则不重建
    warming = true; ready = false;
    view = makeView();
    view.webContents.loadURL(homeUrl);
  }

  // 就绪时返回 { view, cssKey } 并清空内部引用（调用方须 rewarm 重建）；否则 null
  function claim() {
    if (!view || !ready) return null;
    const out = { view, cssKey };
    reset();
    return out;
  }

  function rewarm() { if (!view && !warming) warm(); }

  function setTheme(theme) { if (view) view.setBackgroundColor(themeBackground(theme)); }

  function reinjectCss(getCssFn) {
    if (!view) return;
    const wc = view.webContents;
    const pre = cssKey ? wc.removeInsertedCSS(cssKey).catch(() => {}) : Promise.resolve();
    pre.then(() => wc.insertCSS(getCssFn(), { cssOrigin: 'author' }))
      .then((k) => { cssKey = k; })
      .catch(() => {});
  }

  function dispose() {
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    reset();
  }

  return { warm, claim, rewarm, setTheme, reinjectCss, dispose,
    isWarming: () => warming, isReady: () => ready };
}

module.exports = { createStandbyView };