// 顶栏一体化中继：动作转发、收藏状态回读、页面字体探测。
// 页面顶栏被 CSS 隐藏，标题栏按钮点击经 preload 在页面内点对应隐藏按钮；
// 状态/字体读取走 preload 探针（往返约 1ms；executeJavaScript 约 140ms 已弃用）
const { TOPBAR_ACTIONS } = require('./topbar-actions');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createTopbarRelay({
  queryWc, getActiveWc, onTopbarState, onUiFont,
  navDebounceMs = 300, favoriteSettleMs = 400, fontRetryBaseMs = 800,
}) {
  async function topbarAction(action) {
    const wc = getActiveWc();
    if (!wc) { schedulePush(); return; }
    // 只发动作名：选择器表/按钮懒挂载重试逻辑在 preload 探针区（生成自 topbar-actions.js）
    try { wc.send('topbar-click', action); } catch { /* 视图销毁则忽略 */ }
    if (action === 'favorite') settlePush(); // 兜底：preload 未回报（视图销毁等）也回读一次
  }

  // 收藏态在点击**真的落下**之后才回读：按钮懒挂载时 preload 会重试到挂载才点中，
  // 固定延时可能早于点击（回读到旧状态）。clickApplied 由 preload 点中后回报，
  // 重排回读定时器（点得早就与固定延时同刻，只多探一次约 1ms）。
  let settleTimer = null;
  function settlePush() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(pushNow, favoriteSettleMs);
  }

  function clickApplied(action) {
    if (action === 'favorite') settlePush();
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

  // 页面实际生效的界面字体 → onUiFont（标题栏跟随，标题栏属界面而非正文）。
  // CSS 注入完成时侧栏/顶栏可能尚未渲染（Notion 懒加载），递远重试直到采到或放弃
  async function probeUiFont(rec, attempt = 0) {
    const wc = rec.view && rec.view.webContents;
    if (!wc || wc.isDestroyed() || wc.getURL().startsWith('file://')) return;
    const font = await queryWc(wc, 'ui-font-query', null, 'ui-font');
    if (typeof font === 'string' && font.trim()) {
      if (onUiFont) onUiFont(font);
      return;
    }
    if (attempt < 4) {
      await sleep(fontRetryBaseMs * (attempt + 1));
      return probeUiFont(rec, attempt + 1);
    }
    return undefined;
  }

  return { topbarAction, clickApplied, schedulePush, pushNow, probeUiFont };
}

module.exports = { createTopbarRelay };
