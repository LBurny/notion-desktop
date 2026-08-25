// 顶栏一体化中继：动作转发、收藏状态回读、页面字体探测。
// 页面顶栏被 CSS 隐藏，标题栏按钮点击经 preload 在页面内点对应隐藏按钮；
// 状态/字体读取走 preload 探针（往返约 1ms；executeJavaScript 约 140ms 已弃用）
const { TOPBAR_ACTIONS } = require('./topbar-actions');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createTopbarRelay({
  queryWc, getActiveWc, onTopbarState, onPageFont,
  navDebounceMs = 300, favoriteSettleMs = 400, fontRetryBaseMs = 800,
}) {
  async function topbarAction(action) {
    const wc = getActiveWc();
    if (!wc) { schedulePush(); return; }
    try { wc.send('topbar-click', TOPBAR_ACTIONS[action].selectors); } catch { /* 视图销毁则忽略 */ }
    if (action === 'favorite') setTimeout(pushNow, favoriteSettleMs); // 等 Notion 落状态再回读
  }

  async function probeState() {
    const wc = getActiveWc();
    if (!wc) { onTopbarState({ available: false, favorited: null }); return; }
    const favorited = await queryWc(
      wc, 'topbar-favorite-query', TOPBAR_ACTIONS.favorite.selectors, 'topbar-favorite-state',
    );
    onTopbarState({ available: true, favorited: typeof favorited === 'boolean' ? favorited : null });
  }

  let stateTimer = null;
  // 导航事件合并：连续跳转只探测一回
  function schedulePush() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(probeState, navDebounceMs);
  }

  // 切标签等即时路径：不等防抖窗口（探针往返约 1ms，无谓等待只拖慢顶栏刷新）
  function pushNow() {
    clearTimeout(stateTimer);
    probeState();
  }

  // 页面实际生效字体 → onPageFont（标题栏跟随）。CSS 注入完成时正文可能尚未
  // 渲染（Notion 懒加载），递远重试直到采到或放弃
  async function probePageFont(rec, attempt = 0) {
    const wc = rec.view && rec.view.webContents;
    if (!wc || wc.isDestroyed() || wc.getURL().startsWith('file://')) return;
    const font = await queryWc(wc, 'page-font-query', null, 'page-font');
    if (typeof font === 'string' && font.trim()) {
      if (onPageFont) onPageFont(font);
      return;
    }
    if (attempt < 4) {
      await sleep(fontRetryBaseMs * (attempt + 1));
      return probePageFont(rec, attempt + 1);
    }
    return undefined;
  }

  return { topbarAction, schedulePush, pushNow, probePageFont };
}

module.exports = { createTopbarRelay };
