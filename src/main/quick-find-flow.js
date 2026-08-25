// “新建标签”待命状态机（对齐官方客户端交互）：点 +/Ctrl+T 先在当前页唤起 Quick Find，
// 选中结果的瞬间才以目标页开新标签，来源页保持不动。
// Escape 后不等固定 150ms：探针轮询浮层关闭即走（往返约 1ms，典型 30~60ms）；
// 探针不通（页面未就绪）退回 fallbackWaitMs 固定节奏，与旧行为一致。
// 不变量（均实测）：摘除来源视图前必须让 Escape 处理完；待命解除后重试阶梯停轮。
const { normalizePickedUrl, QUICK_FIND_RETRY_DELAYS, needsEscape } = require('./quick-find');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createQuickFindFlow({
  queryWc, newTab, homeUrl, getActiveRec, findByWebContents,
  retryDelays = QUICK_FIND_RETRY_DELAYS,
  pollMs = 30, escapeMaxWaitMs = 400, fallbackWaitMs = 150,
  armTimeoutMs = 30000, dismissGraceMs = 800,
}) {
  let pendingSearch = null; // { rec, armedAt, timer }

  function sendEscape(wc) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  }

  function sendCtrlK(wc) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'k', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'k', modifiers: ['control'] });
  }

  // 轮询等浮层满足 pred；探针不通/超时退回固定节奏兜底。
  // 不变量：谓词未命中时返回前至少经过 fallbackWaitMs（Escape 被页面处理的
  // 最小时间），之后才允许摘除视图，否则按键被丢弃
  async function waitOverlay(wc, pred) {
    const t0 = Date.now();
    while (!wc.isDestroyed() && Date.now() - t0 < escapeMaxWaitMs) {
      const st = await queryWc(wc, 'quick-find-state-query', null, 'quick-find-state', 100);
      if (st && pred(st)) return;
      if (st === null) break; // 页面未就绪：退回旧固定等待
      await sleep(pollMs);
    }
    const elapsed = Date.now() - t0;
    if (elapsed < fallbackWaitMs) await sleep(fallbackWaitMs - elapsed);
  }

  function disarm() {
    if (!pendingSearch) return;
    clearTimeout(pendingSearch.timer);
    const view = pendingSearch.rec.view;
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send('quick-find-arm', false);
    }
    pendingSearch = null;
  }

  const stillArmed = (armedRec) => !!pendingSearch && pendingSearch.rec === armedRec;

  // 每轮先经 preload 查浮层状态（往返约 1ms），已开则自停止；无阻挡浮层时跳过
  // Escape 直接注入 Ctrl+K。Ctrl+K 是开关式的，必须先查再注入；合成 KeyboardEvent
  // 不可信（Notion 不响应），sendInputEvent 走真实输入管线（本路径验证无卡死）。
  // armedRec（待命流程）下，待命解除后必须停止后续轮次，否则把刚关掉的浮层重新打开
  function trigger(view, { dismissFirst = false, armedRec = null } = {}) {
    for (const d of retryDelays) {
      setTimeout(async () => {
        if (armedRec && !stillArmed(armedRec)) return;
        const wc = view.webContents;
        if (wc.isDestroyed()) return;
        wc.focus();
        const st = await queryWc(wc, 'quick-find-state-query', null, 'quick-find-state');
        if (armedRec && !stillArmed(armedRec)) return;
        if (st && st.open) return;
        if (needsEscape(st, dismissFirst)) {
          sendEscape(wc);
          await waitOverlay(wc, (s) => !s.anyDialog);
          if (wc.isDestroyed()) return;
          if (armedRec && !stillArmed(armedRec)) return; // 等待期间待命解除也要停轮
        }
        sendCtrlK(wc);
      }, d);
    }
  }

  function armSearch(rec) {
    disarm();
    pendingSearch = { rec, armedAt: Date.now(), timer: setTimeout(disarm, armTimeoutMs) };
    rec.view.webContents.send('quick-find-arm', true);
  }

  function newTabInteractive() {
    const rec = getActiveRec();
    const wc = rec && rec.view && rec.view.webContents;
    // 当前页不可搜索（未建视图/停在错误页）时退回旧逻辑：先开首页标签再唤起搜索
    if (!wc || wc.isDestroyed() || wc.getURL().startsWith('file://')) {
      return newTab(homeUrl, { search: true });
    }
    armSearch(rec);
    trigger(rec.view, { dismissFirst: true, armedRec: rec });
    return null;
  }

  async function picked(senderWc, href) {
    const rec = findByWebContents(senderWc);
    if (!pendingSearch || !rec || rec !== pendingSearch.rec) return;
    const url = normalizePickedUrl(href);
    if (!url) return;
    disarm();
    // 先关来源页上的搜索浮层，再开新标签：newTab→attachActive 会把来源视图摘除，
    // 那之后注入的按键会被丢弃——必须等 Escape 真正处理完（浮层关闭探针命中）
    if (!senderWc.isDestroyed()) {
      sendEscape(senderWc);
      await waitOverlay(senderWc, (s) => !s.open);
    }
    newTab(url);
  }

  function dismissed(senderWc) {
    if (!pendingSearch || findByWebContents(senderWc) !== pendingSearch.rec) return;
    // 预热 Escape（关推广浮层用）也会触发 dismissed，宽限期内忽略
    if (Date.now() - pendingSearch.armedAt < dismissGraceMs) return;
    disarm();
  }

  // 待命期间来源页自己跳转了（如回车选中了非链接形态的结果）：
  // 把这次跳转变成新标签，来源页退回原处。消费返回 true
  function handleNav(rec, url, wc) {
    if (!pendingSearch || pendingSearch.rec !== rec) return false;
    disarm();
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    newTab(url);
    return true;
  }

  return {
    trigger, newTabInteractive, picked, dismissed, handleNav,
    onActiveChanged: (activeRec) => {
      // 待命标签被切走/关掉时解除待命
      if (pendingSearch && (!activeRec || pendingSearch.rec !== activeRec)) disarm();
    },
    disarmIf: (rec) => { if (pendingSearch && pendingSearch.rec === rec) disarm(); },
    isArmedFor: (rec) => !!pendingSearch && pendingSearch.rec === rec,
  };
}

module.exports = { createQuickFindFlow };
