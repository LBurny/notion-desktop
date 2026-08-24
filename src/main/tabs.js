// 标签页粘合层：视图生命周期、导航跟踪、IPC 状态推送、持久化
// 纯状态逻辑在 tab-manager.js，这里只做 Electron 侧的事
const { WebContentsView, shell } = require('electron');
const { loadTabsFile, saveTabsFile, DEFAULT_MAX_TABS } = require('./tab-manager');
const { shortcutFor } = require('./tab-shortcuts');
const { normalizePickedUrl } = require('./quick-find');
const { buildClickScript, buildFavoriteStateScript } = require('./topbar-actions');

const AUTH_POPUPS = [
  'https://accounts.google.com', 'https://appleid.apple.com',
  'https://login.microsoftonline.com', 'https://login.live.com',
  'https://auth.openai.com', 'https://auth0.openai.com',
];

function createTabs(deps) {
  const {
    win, manager, homeUrl, partition, preloadPath, errorPagePath,
    titlebarHeight,
    getCss, getZoom,
    onChanged,   // (payload) => void，payload = { tabs, canAdd }
    onEmpty,     // 最后一个标签被关闭
    onTopbarState, // ({ available, favorited }) => void，顶栏一体化状态推送
    saveFile,
  } = deps;

  const records = new Map(); // id → { id, url, title, view: null, cssKey: null, reloaded: false }

  // ── 顶栏一体化：动作转发与收藏状态回读 ──────────────────
  // 页面顶栏被 CSS 隐藏，标题栏按钮点击转发到这里，在活动页面内点对应隐藏按钮
  function activeNotionWc() {
    const a = manager.active();
    const rec = a && records.get(a.id);
    const wc = rec && rec.view && rec.view.webContents;
    if (!wc || wc.isDestroyed() || wc.getURL().startsWith('file://')) return null;
    return wc;
  }

  async function topbarAction(action) {
    const wc = activeNotionWc();
    if (!wc) { pushTopbarState(); return; }
    try {
      await wc.executeJavaScript(buildClickScript(action));
    } catch { /* 页面加载中，忽略 */ }
    if (action === 'favorite') setTimeout(pushTopbarState, 400); // 等 Notion 落状态再回读
  }

  let stateTimer = null;
  function pushTopbarState() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(async () => {
      const wc = activeNotionWc();
      if (!wc) { onTopbarState({ available: false, favorited: null }); return; }
      let favorited = null;
      try { favorited = await wc.executeJavaScript(buildFavoriteStateScript()); } catch { /* 保持 null */ }
      onTopbarState({ available: true, favorited });
    }, 300);
  }

  function layout() {
    const { width, height } = win.getContentBounds();
    const active = manager.active();
    const rec = active && records.get(active.id);
    if (rec && rec.view) {
      rec.view.setBounds({
        x: 0, y: titlebarHeight,
        width, height: Math.max(0, height - titlebarHeight),
      });
    }
  }

  function ensureView(rec) {
    if (rec.view) return rec.view;
    const view = new WebContentsView({
      webPreferences: { partition, preload: preloadPath },
    });
    rec.view = view;
    wireViewEvents(rec);
    view.webContents.loadURL(rec.url);
    view.webContents.on('dom-ready', () => {
      if (view.webContents.isDestroyed()) return;
      view.webContents.insertCSS(getCss(), { cssOrigin: 'author' })
        .then((k) => { rec.cssKey = k; })
        .catch(() => { /* 页面重载后注入失败可忽略 */ });
      view.webContents.setZoomFactor(getZoom());
    });
    return view;
  }

  // Notion 的 document.title 统一带 " | Notion" 后缀，标签条上纯属浪费宽度
  const cleanTitle = (t) => (t || '').replace(/\s*\|\s*Notion$/, '');

  function wireViewEvents(rec) {
    const wc = rec.view.webContents;
    wc.on('page-title-updated', (e) => {
      e.preventDefault(); // 标题只用于标签条，不写成窗口标题
      if (manager.update(rec.id, { title: cleanTitle(wc.getTitle()) })) onChanged();
    });
    // 兜底：初始标题可能先于 page-title-updated 监听就绪
    wc.on('did-finish-load', () => {
      if (manager.update(rec.id, { title: cleanTitle(wc.getTitle()) })) onChanged();
    });
    const onNav = (_e, isMainFrame) => {
      if (isMainFrame === false) return;
      // 待命期间来源页自己跳转了（如回车选中了非链接形态的结果）：
      // 把这次跳转变成新标签，来源页退回原处
      if (pendingSearch && pendingSearch.rec === rec) {
        const url = wc.getURL();
        disarmSearch();
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        newTab(url);
        return;
      }
      manager.update(rec.id, { url: wc.getURL(), title: cleanTitle(wc.getTitle()) });
      onChanged();
      pushTopbarState();
    };
    wc.on('did-navigate', () => onNav());
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => onNav(_e, isMainFrame));
    wc.on('render-process-gone', () => {
      if (pendingSearch && pendingSearch.rec === rec) disarmSearch();
      if (!rec.reloaded && !wc.isDestroyed()) {
        rec.reloaded = true; // 只自动重载一次，防崩溃循环
        wc.reload();
      }
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (AUTH_POPUPS.some((p) => url.startsWith(p))) return { action: 'allow' };
      if (url.startsWith('https://www.notion.so') || url.startsWith('https://notion.so')) {
        openInNewTab(url);
        return { action: 'deny' };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('did-fail-load', (_e, _code, _desc, validatedURL, isMainFrame) => {
      if (isMainFrame && validatedURL.startsWith('http')) {
        wc.loadFile(errorPagePath);
      }
    });
    wc.on('before-input-event', (e, input) => {
      const s = shortcutFor(input);
      if (!s) return;
      e.preventDefault(); // 页面收不到这些键，避免与 Notion 编辑器快捷键冲突
      if (s.action === 'new-tab') newTabInteractive();
      else if (s.action === 'close-tab') { const a = manager.active(); if (a) closeTab(a.id); }
      else if (s.action === 'next-tab') nextTab();
      else if (s.action === 'prev-tab') prevTab();
      else if (s.action === 'position') activatePosition(s.position);
    });
  }

  function detachOthers() {
    const active = manager.active();
    for (const rec of records.values()) {
      if (rec.view && (!active || rec.id !== active.id)) {
        try { win.contentView.removeChildView(rec.view); } catch { /* 未挂载忽略 */ }
      }
    }
  }

  function attachActive() {
    // 待命标签被切走/关掉时解除待命（pendingSearch 的 rec 已不属于活动标签）
    const activeNow = manager.active();
    if (pendingSearch && (!activeNow || pendingSearch.rec.id !== activeNow.id)) disarmSearch();
    detachOthers();
    const active = manager.active();
    if (!active) { layout(); return; }
    const rec = records.get(active.id);
    const view = ensureView(rec);
    win.contentView.addChildView(view);
    layout();
    view.webContents.focus();
    pushTopbarState();
  }

  function newTab(url = homeUrl, { search = false } = {}) {
    const tab = manager.add({ url, title: '' });
    if (!tab) return null;
    records.set(tab.id, { id: tab.id, url: tab.url, title: tab.title, view: null, cssKey: null, reloaded: false });
    attachActive();
    onChanged();
    if (search) {
      const rec = records.get(tab.id);
      rec.view.webContents.once('did-finish-load', () => triggerQuickFind(rec.view, { dismissFirst: true }));
    }
    return tab.id;
  }

  function triggerQuickFind(view, { dismissFirst = false } = {}) {
    // Notion 的 Quick Find 监听需在应用 JS 就绪后，三次递远重试兜底。
    // Ctrl+K 是开关式的，所以每轮先查浮层是否已开，开了就不再注入；
    // dismissFirst：未开时先送 Escape，关掉挡 shortcut 的其它浮层（如“在桌面应用打开？”推广条）。
    // 冷启动首载很慢（注入早了会被丢弃），重试拉满 8s；自停止让多余轮次零成本
    for (const d of [600, 1500, 3000, 5000, 8000]) {
      setTimeout(async () => {
        const wc = view.webContents;
        if (wc.isDestroyed()) return;
        wc.focus();
        let open = false;
        try {
          open = await wc.executeJavaScript(`!!document.querySelector('[role="dialog"] input')`);
        } catch { /* 页面尚在加载，按未开处理继续注入 */ }
        if (open) return;
        if (dismissFirst) {
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          await new Promise((r) => setTimeout(r, 150));
          if (wc.isDestroyed()) return;
        }
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'k', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'k', modifiers: ['control'] });
      }, d);
    }
  }

  function openInNewTab(url) {
    return newTab(url);
  }

  // ── “新建标签”待命状态机（对齐官方客户端交互） ──────────────
  // 点击 +/Ctrl+T：不开新标签，先在当前页唤起 Quick Find；
  // 用户选中结果的瞬间才以目标页开新标签，来源页保持不动。
  let pendingSearch = null; // { rec, timer }

  function disarmSearch() {
    if (!pendingSearch) return;
    clearTimeout(pendingSearch.timer);
    const view = pendingSearch.rec.view;
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send('quick-find-arm', false);
    }
    pendingSearch = null;
  }

  function armSearch(rec) {
    disarmSearch();
    pendingSearch = { rec, armedAt: Date.now(), timer: setTimeout(disarmSearch, 30000) };
    rec.view.webContents.send('quick-find-arm', true);
  }

  function newTabInteractive() {
    const a = manager.active();
    const rec = a && records.get(a.id);
    const wc = rec && rec.view && rec.view.webContents;
    // 当前页不可搜索（未建视图/停在错误页）时退回旧逻辑：先开首页标签再唤起搜索
    if (!wc || wc.isDestroyed() || wc.getURL().startsWith('file://')) {
      return newTab(homeUrl, { search: true });
    }
    armSearch(rec);
    triggerQuickFind(rec.view, { dismissFirst: true });
    return null;
  }

  function quickFindPicked(senderWc, href) {
    const rec = findByWebContents(senderWc);
    if (!pendingSearch || !rec || rec !== pendingSearch.rec) return;
    const url = normalizePickedUrl(href);
    if (!url) return;
    disarmSearch();
    newTab(url);
    // 关掉来源页上的搜索浮层（合成事件页面可能不认，走真实输入管线）
    if (!senderWc.isDestroyed()) {
      senderWc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      senderWc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }
  }

  function quickFindDismissed(senderWc) {
    if (!pendingSearch || findByWebContents(senderWc) !== pendingSearch.rec) return;
    // 预热 Escape（关推广浮层用）也会触发 dismissed，宽限期内忽略
    if (Date.now() - pendingSearch.armedAt < 800) return;
    disarmSearch();
  }

  function destroyRec(rec) {
    if (rec.view) {
      try { win.contentView.removeChildView(rec.view); } catch { /* 未挂载忽略 */ }
      if (!rec.view.webContents.isDestroyed()) rec.view.webContents.close();
      rec.view = null;
    }
    records.delete(rec.id);
  }

  function closeTab(id) {
    const rec = records.get(id);
    if (!rec) return;
    const r = manager.close(id);
    destroyRec(rec);
    if (r && r.empty) {
      onChanged();
      onEmpty();
      return;
    }
    attachActive();
    onChanged();
  }

  function activateTab(id) {
    if (!manager.activate(id)) return;
    attachActive();
    onChanged();
  }

  function nextTab() {
    if (manager.next()) { attachActive(); onChanged(); }
  }

  function prevTab() {
    if (manager.prev()) { attachActive(); onChanged(); }
  }

  function activatePosition(n) {
    if (manager.activatePosition(n)) { attachActive(); onChanged(); }
  }

  function reorder(ids) {
    if (manager.reorder(ids)) onChanged();
  }

  function restore() {
    const data = loadTabsFile(saveFile);
    if (!data || !manager.restore(data)) return false;
    for (const t of manager.list()) {
      records.set(t.id, { id: t.id, url: t.url, title: t.title, view: null, cssKey: null, reloaded: false });
    }
    attachActive(); // 懒加载：只有活动标签会真正建视图加载
    onChanged();
    return true;
  }

  function forEachView(fn) {
    for (const rec of records.values()) {
      if (rec.view && !rec.view.webContents.isDestroyed()) fn(rec.view, rec);
    }
  }

  function findByWebContents(wc) {
    for (const rec of records.values()) {
      if (rec.view && rec.view.webContents === wc) return rec;
    }
    return null;
  }

  return {
    newTab, closeTab, activateTab, nextTab, prevTab, activatePosition,
    reorder, restore, layout, forEachView, findByWebContents,
    newTabInteractive, quickFindPicked, quickFindDismissed, topbarAction,
    activeView: () => {
      const a = manager.active();
      const rec = a && records.get(a.id);
      return rec ? rec.view : null;
    },
    payload: () => ({ tabs: manager.list(), canAdd: manager.size < DEFAULT_MAX_TABS }),
  };
}

module.exports = { createTabs };
