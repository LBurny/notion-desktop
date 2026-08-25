// 标签页粘合层：视图生命周期、导航跟踪、IPC 状态推送、持久化
// 纯状态逻辑在 tab-manager.js，这里只做 Electron 侧的事
const { WebContentsView, shell, ipcMain } = require('electron');
const { loadTabsFile, saveTabsFile, DEFAULT_MAX_TABS, themeBackground } = require('./tab-manager');
const { shortcutFor } = require('./tab-shortcuts');
const { createQuickFindFlow } = require('./quick-find-flow');
const { findSlashCommand, runSlashCommand } = require('./slash-commands');
const { createTopbarRelay } = require('./topbar-relay');

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

  // Quick Find 待命状态机（选中才开新标签的交互）抽至 quick-find-flow.js
  const flow = createQuickFindFlow({
    queryWc, newTab, homeUrl,
    getActiveRec: () => {
      const a = manager.active();
      return a ? records.get(a.id) || null : null;
    },
    findByWebContents,
  });

  // 顶栏一体化（动作转发/收藏回读/页面字体）抽至 topbar-relay.js
  const relay = createTopbarRelay({
    queryWc, getActiveWc: activeNotionWc, onTopbarState, onPageFont,
  });

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

  // ── 顶栏一体化活动视图 ──
  // 页面顶栏被 CSS 隐藏，标题栏按钮点击经 preload 在页面内点对应隐藏按钮
  function activeNotionWc() {
    const a = manager.active();
    const rec = a && records.get(a.id);
    const wc = rec && rec.view && rec.view.webContents;
    if (!wc || wc.isDestroyed() || wc.getURL().startsWith('file://')) return null;
    return wc;
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
      webPreferences: { partition, preload: preloadPath, backgroundThrottling: false },
    });
    view.setBackgroundColor(bg);
    rec.view = view;
    wireViewEvents(rec);
    view.webContents.loadURL(rec.url);
    view.webContents.on('dom-ready', () => {
      if (view.webContents.isDestroyed()) return;
      view.webContents.insertCSS(getCss(), { cssOrigin: 'author' })
        .then((k) => { rec.cssKey = k; relay.probePageFont(rec); })
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
          if (rec === activeRec) relay.probePageFont(rec);
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
      // 待命期间来源页自己跳转了：flow 消费（回退 + 新标签），否则常规记账
      if (flow.handleNav(rec, wc.getURL(), wc)) return;
      manager.update(rec.id, { url: wc.getURL(), title: cleanTitle(wc.getTitle()) });
      onChanged();
      relay.schedulePush();
    };
    wc.on('did-navigate', () => onNav());
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => onNav(_e, isMainFrame));
    wc.on('render-process-gone', () => {
      flow.disarmIf(rec);
      if (!rec.reloaded && !wc.isDestroyed()) {
        rec.reloaded = true; // 只自动重载一次，防崩溃循环
        wc.reload();
      }
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (AUTH_POPUPS.some((p) => url.startsWith(p))) return { action: 'allow' };
      if (url.startsWith('https://www.notion.so') || url.startsWith('https://notion.so')) {
        newTab(url);
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
    // 待命标签被切走/关掉时解除待命
    flow.onActiveChanged(manager.active() ? records.get(manager.active().id) : null);
    detachOthers();
    const active = manager.active();
    if (!active) { layout(); return; }
    const rec = records.get(active.id);
    const view = ensureView(rec);
    win.contentView.addChildView(view);
    layout();
    view.webContents.focus();
    relay.pushNow(); // 切标签即刷顶栏状态，不等导航防抖窗口
  }

  function newTab(url = homeUrl, { search = false } = {}) {
    const tab = manager.add({ url, title: '' });
    if (!tab) return null;
    records.set(tab.id, { id: tab.id, url: tab.url, title: tab.title, view: null, cssKey: null, reloaded: false });
    attachActive();
    onChanged();
    if (search) {
      const rec = records.get(tab.id);
      rec.view.webContents.once('did-finish-load', () => flow.trigger(rec.view, { dismissFirst: true }));
    }
    return tab.id;
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
    setViewsBackground,
    topbarAction: relay.topbarAction,
    // Quick Find 待命交互门面（实现在 quick-find-flow.js）
    newTabInteractive: flow.newTabInteractive,
    quickFindPicked: flow.picked,
    quickFindDismissed: flow.dismissed,
    activeView: () => {
      const a = manager.active();
      const rec = a && records.get(a.id);
      return rec ? rec.view : null;
    },
    payload: () => ({ tabs: manager.list(), canAdd: manager.size < DEFAULT_MAX_TABS }),
  };
}

module.exports = { createTabs };
