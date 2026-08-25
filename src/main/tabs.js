// 标签页粘合层：视图生命周期、导航跟踪、IPC 状态推送、持久化
// 纯状态逻辑在 tab-manager.js，这里只做 Electron 侧的事
const { WebContentsView, shell, ipcMain } = require('electron');
const { loadTabsFile, saveTabsFile, DEFAULT_MAX_TABS, themeBackground } = require('./tab-manager');
const { shortcutFor } = require('./tab-shortcuts');
const { normalizePickedUrl, QUICK_FIND_RETRY_DELAYS, needsEscape } = require('./quick-find');
const { findSlashCommand, runSlashCommand } = require('./slash-commands');
const { TOPBAR_ACTIONS, CONTENT_FONT_SELECTORS } = require('./topbar-actions');

const AUTH_POPUPS = [
  'https://accounts.google.com', 'https://appleid.apple.com',
  'https://login.microsoftonline.com', 'https://login.live.com',
  'https://auth.openai.com', 'https://auth0.openai.com',
];

function createTabs(deps) {
  const {
    win, manager, homeUrl, partition, preloadPath, errorPagePath,
    getTitlebarHeight, // () => number，标题栏高度（随缩放变化）
    getCss, getZoom,
    getTheme, // () => 'dark' | 'light'，视图加载期底色（防深色主题白闪）
    getSlashCommands, // () => [{ combo, command }]，斜杠命令快捷键配置
    onChanged,   // (payload) => void，payload = { tabs, canAdd }
    onEmpty,     // 最后一个标签被关闭
    onTopbarState, // ({ available, favorited }) => void，顶栏一体化状态推送
    onPageFont,  // (fontFamily) => void，活动页面实际生效字体（供标题栏跟随）
    saveFile,
  } = deps;

  const records = new Map(); // id → { id, url, title, view: null, cssKey: null, reloaded: false }

  // ── preload 探针往返 ──
  // 页面 preload（隔离世界）可同步读 DOM，wc.send/ipcRenderer.send 往返约 1ms；
  // executeJavaScript 在 Electron 43 上往返约 140ms（实测），延迟敏感路径全部走这里
  function queryWc(wc, reqChannel, payload, resChannel, timeoutMs = 400) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ipcMain.removeListener(resChannel, onReply);
        resolve(v);
      };
      const onReply = (e, data) => { if (e.sender === wc) finish(data); };
      const timer = setTimeout(() => finish(null), timeoutMs); // 页面未就绪/preload 未加载 → null
      ipcMain.on(resChannel, onReply);
      try { wc.send(reqChannel, payload); } catch { finish(null); }
    });
  }

  // ── 顶栏一体化：动作转发与收藏状态回读 ──────────────────
  // 页面顶栏被 CSS 隐藏，标题栏按钮点击经 preload 在页面内点对应隐藏按钮
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
    try { wc.send('topbar-click', TOPBAR_ACTIONS[action].selectors); } catch { /* 视图销毁则忽略 */ }
    if (action === 'favorite') setTimeout(pushTopbarState, 400); // 等 Notion 落状态再回读
  }

  let stateTimer = null;
  function pushTopbarState() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(async () => {
      const wc = activeNotionWc();
      if (!wc) { onTopbarState({ available: false, favorited: null }); return; }
      const favorited = await queryWc(
        wc, 'topbar-favorite-query', TOPBAR_ACTIONS.favorite.selectors, 'topbar-favorite-state'
      );
      onTopbarState({ available: true, favorited: typeof favorited === 'boolean' ? favorited : null });
    }, 300);
  }

  // 页面实际生效字体 → onPageFont（标题栏跟随）。CSS 注入完成时正文可能尚未
  // 渲染（Notion 懒加载），递远重试直到采到或放弃；custom.css 热更新由
  // reinjectCss 对活动视图复采
  async function probePageFont(rec, attempt = 0) {
    const wc = rec.view && rec.view.webContents;
    if (!wc || wc.isDestroyed() || wc.getURL().startsWith('file://')) return;
    const font = await queryWc(wc, 'page-font-query', CONTENT_FONT_SELECTORS, 'page-font');
    if (typeof font === 'string' && font.trim()) {
      if (onPageFont) onPageFont(font);
      return;
    }
    if (attempt < 4) setTimeout(() => probePageFont(rec, attempt + 1), 800 * (attempt + 1));
  }

  function layout() {
    const { width, height } = win.getContentBounds();
    const active = manager.active();
    const rec = active && records.get(active.id);
    if (rec && rec.view) {
      const tbHeight = getTitlebarHeight();
      rec.view.setBounds({
        x: 0, y: tbHeight,
        width, height: Math.max(0, height - tbHeight),
      });
    }
  }

  function ensureView(rec) {
    if (rec.view) return rec.view;
    const bg = themeBackground(getTheme ? getTheme() : 'light');
    // 加载期底色跟随主题：深色主题下默认白底会造成刺眼白闪。
    // 注意：Electron 43 的 WebContentsView 构造选项没有 backgroundColor（传了会被静默忽略），
    // 必须建实例后调用继承自 View 的 setBackgroundColor
    const view = new WebContentsView({
      webPreferences: { partition, preload: preloadPath },
    });
    view.setBackgroundColor(bg);
    rec.view = view;
    wireViewEvents(rec);
    view.webContents.loadURL(rec.url);
    view.webContents.on('dom-ready', () => {
      if (view.webContents.isDestroyed()) return;
      view.webContents.insertCSS(getCss(), { cssOrigin: 'author' })
        .then((k) => { rec.cssKey = k; probePageFont(rec); })
        .catch(() => { /* 页面重载后注入失败可忽略 */ });
      view.webContents.setZoomFactor(getZoom());
    });
    return view;
  }

  // 设置或自定义 CSS 变化后重刷所有已建视图；活动视图注入完成后复采页面字体
  function reinjectCss() {
    const active = manager.active();
    const activeRec = active ? records.get(active.id) : null;
    forEachView((v, rec) => {
      const wc = v.webContents;
      const pre = rec.cssKey ? wc.removeInsertedCSS(rec.cssKey).catch(() => {}) : Promise.resolve();
      pre.then(() => wc.insertCSS(getCss(), { cssOrigin: 'author' }))
        .then((k) => {
          rec.cssKey = k;
          if (rec === activeRec) probePageFont(rec);
        })
        .catch(() => {});
    });
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
      if (s) {
        e.preventDefault(); // 页面收不到这些键，避免与 Notion 编辑器快捷键冲突
        if (s.action === 'new-tab') newTabInteractive();
        else if (s.action === 'close-tab') { const a = manager.active(); if (a) closeTab(a.id); }
        else if (s.action === 'next-tab') nextTab();
        else if (s.action === 'prev-tab') prevTab();
        else if (s.action === 'position') activatePosition(s.position);
        return;
      }
      // 斜杠命令快捷键（用户配置，before-input-event 天然仅前台生效）
      if (!getSlashCommands) return;
      const cmd = findSlashCommand(getSlashCommands(), input);
      if (!cmd) return;
      e.preventDefault();
      // 延迟执行：等用户松开组合键（否则注入的 Enter 会带上未松开的 Ctrl/Shift），
      // 也避免在 input 事件栈里重入输入管线
      setTimeout(() => runSlashCommand(wc, cmd.command), 300);
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

  function triggerQuickFind(view, { dismissFirst = false, armedRec = null } = {}) {
    // 首轮 0ms：热页立即唤起。每轮先经 preload 查浮层状态（往返约 1ms），
    // 已开则自停止；无阻挡浮层时跳过 Escape 直接注入 Ctrl+K（省 150ms+）。
    // Ctrl+K 是开关式的，所以必须先查再注入；合成 KeyboardEvent 不可信，
    // Notion 不响应，sendInputEvent 走真实输入管线（本路径验证无卡死）。
    // armedRec（待命流程）下，待命解除（选中/取消/切标签）后必须停止后续轮次，
    // 否则会把选中时刚关掉的浮层重新打开
    for (const d of QUICK_FIND_RETRY_DELAYS) {
      setTimeout(async () => {
        if (armedRec && (!pendingSearch || pendingSearch.rec !== armedRec)) return;
        const wc = view.webContents;
        if (wc.isDestroyed()) return;
        wc.focus();
        const st = await queryWc(wc, 'quick-find-state-query', null, 'quick-find-state');
        if (armedRec && (!pendingSearch || pendingSearch.rec !== armedRec)) return;
        if (st && st.open) return;
        if (needsEscape(st, dismissFirst)) {
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
    triggerQuickFind(rec.view, { dismissFirst: true, armedRec: rec });
    return null;
  }

  function quickFindPicked(senderWc, href) {
    const rec = findByWebContents(senderWc);
    if (!pendingSearch || !rec || rec !== pendingSearch.rec) return;
    const url = normalizePickedUrl(href);
    if (!url) return;
    disarmSearch();
    // 先关来源页上的搜索浮层，再开新标签。两处时序坑（均实测）：
    // 1. newTab→attachActive 会把来源视图从窗口摘除，那之后注入的按键被丢弃；
    // 2. 即使先注入，同 tick 内立即摘除也会丢掉还在队列里的按键——
    //    必须留出 Escape 的处理时间再切标签
    if (!senderWc.isDestroyed()) {
      senderWc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      senderWc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }
    setTimeout(() => newTab(url), 150);
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

  // 主题切换时同步所有已建视图的加载底色（下次加载/刷新不再闪白）
  function setViewsBackground(theme) {
    forEachView((v) => v.setBackgroundColor(themeBackground(theme)));
  }

  return {
    newTab, closeTab, activateTab, nextTab, prevTab, activatePosition,
    reorder, restore, layout, forEachView, findByWebContents, reinjectCss,
    newTabInteractive, quickFindPicked, quickFindDismissed, topbarAction,
    setViewsBackground,
    activeView: () => {
      const a = manager.active();
      const rec = a && records.get(a.id);
      return rec ? rec.view : null;
    },
    payload: () => ({ tabs: manager.list(), canAdd: manager.size < DEFAULT_MAX_TABS }),
  };
}

module.exports = { createTabs };
