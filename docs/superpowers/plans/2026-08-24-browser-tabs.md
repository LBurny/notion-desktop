# 浏览器式标签页 Implementation Plan

> **For agentic workers:** Implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Notion Desktop 套壳增加浏览器式多标签页：每标签独立 WebContentsView、标题栏内嵌标签条、Ctrl+K 唤起 Notion 搜索新建、快捷键、拖拽排序、重启懒加载恢复。

**Architecture:** `tab-manager.js` 纯逻辑状态机（可单测）+ `tabs.js` Electron 粘合层（视图生命周期/事件/IPC/持久化）。切换标签 = `removeChildView` 旧视图 + `addChildView` 新视图，WebContents 常驻内存。标签条并入现有 36px 标题栏，主进程通过 `tabs-changed` 事件推送状态。

**Tech Stack:** Electron 43（BaseWindow / WebContentsView / globalShortcut / sendInputEvent）、Node 25 内置 `node:test`、无新增 npm 依赖。

## Global Constraints

- 渲染层 CSP 为 `script-src 'self'`：新脚本必须是独立文件，禁止内联脚本。
- 主题机制：`document.documentElement.dataset.theme` + 主进程 `theme-changed` 广播，新 UI 必须明暗双主题。
- 持久化文件都在 `app.getPath('userData')` 下，防抖写盘（参考 window-state.js 先例）。
- 标签上限 `DEFAULT_MAX_TABS = 10`。
- 关闭最后一个标签 = 关闭窗口，走现有 `closeAction`（tray/quit）逻辑，不新增分支。
- 登录分区固定 `persist:notion`，所有标签视图共用。
- 每个任务结束运行 `npm test`；全部完成后 `npm run dist` 前必须 `taskkill //F //IM "Notion Desktop.exe"`（文件占用教训）。

---

### Task 1: TabManager 纯逻辑状态机

**Files:**
- Create: `src/main/tab-manager.js`
- Test: `tests/tab-manager.test.js`

**Interfaces:**
- Produces（后续任务依赖的确切签名）:
  - `createTabManager({ maxTabs } = {}) → manager`
  - `manager.list() → [{ id, url, title, active }]`
  - `manager.byId(id) → { id, url, title } | null`
  - `manager.active() → tab | null`
  - `manager.add({ url, title = '' }) → tab | null`（达上限返回 null；新标签自动激活）
  - `manager.close(id) → { activeId, empty } | null`（激活右邻居，无右则左；全关 `empty: true, activeId: null`）
  - `manager.activate(id) → bool`
  - `manager.next() / manager.prev() → activeId | null`（循环）
  - `manager.activatePosition(n) → activeId | null`（1..8 按序，≥9 恒为最后一个）
  - `manager.reorder(ids) → bool`（id 集合必须完全一致，否则拒绝）
  - `manager.serialize() → { tabs: [{url,title}], activeIndex }`
  - `manager.restore(data) → bool`（非法数据清空并返回 false）
  - `manager.size → number`
  - `loadTabsFile(filePath) → object | null`；`saveTabsFile(filePath, data) → void`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTabManager, loadTabsFile, saveTabsFile, DEFAULT_MAX_TABS } = require('../src/main/tab-manager');

const URL = 'https://www.notion.so/';

function mgr(n) {
  const m = createTabManager();
  for (let i = 1; i <= n; i++) m.add({ url: URL + i, title: 'T' + i });
  return m;
}

test('add 自动激活新标签，list 标记 active', () => {
  const m = mgr(2);
  const l = m.list();
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[1].active, true);
  assert.strictEqual(m.active().title, 'T2');
});

test('add 达到上限返回 null', () => {
  const m = createTabManager({ maxTabs: 2 });
  m.add({ url: URL }); m.add({ url: URL });
  assert.strictEqual(m.add({ url: URL }), null);
  assert.strictEqual(m.size, 2);
});

test('close 激活右邻居，无右邻居则激活左侧', () => {
  const m = mgr(3);
  const [a, b, c] = m.list().map((t) => t.id);
  m.activate(b);
  assert.strictEqual(m.close(b).activeId, c); // 右邻居
  m.activate(a);
  assert.strictEqual(m.close(a).activeId, c); // a 无左邻居，取右（原 c）
});

test('close 最后一个标签返回 empty', () => {
  const m = mgr(1);
  const r = m.close(m.list()[0].id);
  assert.deepStrictEqual(r, { activeId: null, empty: true });
});

test('close 不存在 id 返回 null', () => {
  const m = mgr(1);
  assert.strictEqual(m.close('nope'), null);
});

test('next/prev 循环切换', () => {
  const m = mgr(3);
  const [a, b, c] = m.list().map((t) => t.id);
  m.activate(a);
  assert.strictEqual(m.next(), b);
  assert.strictEqual(m.next(), c);
  assert.strictEqual(m.next(), a); // 环绕
  assert.strictEqual(m.prev(), c); // 反向环绕
});

test('activatePosition：1..8 按序，9 恒为最后一个', () => {
  const m = mgr(5);
  const ids = m.list().map((t) => t.id);
  assert.strictEqual(m.activatePosition(1), ids[0]);
  assert.strictEqual(m.activatePosition(3), ids[2]);
  assert.strictEqual(m.activatePosition(9), ids[4]);
  assert.strictEqual(m.activatePosition(8), ids[4]); // 只有 5 个，钳位到最后
});

test('reorder 仅接受完全一致集合', () => {
  const m = mgr(3);
  const [a, b, c] = m.list().map((t) => t.id);
  assert.strictEqual(m.reorder([c, a, b]), true);
  assert.deepStrictEqual(m.list().map((t) => t.id), [c, a, b]);
  assert.strictEqual(m.reorder([a, b]), false);
  assert.strictEqual(m.reorder([a, b, 'x']), false);
});

test('serialize/restore 往返一致', () => {
  const m = mgr(3);
  m.activatePosition(2);
  const data = m.serialize();
  const m2 = createTabManager();
  assert.strictEqual(m2.restore(data), true);
  assert.deepStrictEqual(m2.list().map(({ url, title, active }) => ({ url, title, active })),
    m.list().map(({ url, title, active }) => ({ url, title, active })));
});

test('restore 非法数据返回 false 且清空', () => {
  const m = mgr(1);
  assert.strictEqual(m.restore({ tabs: [{ url: 'javascript:evil' }] }), false);
  assert.strictEqual(m.restore('junk'), false);
  assert.strictEqual(m.size, 0);
});

test('restore 超上限截断，activeIndex 越界钳位', () => {
  const m = createTabManager({ maxTabs: 2 });
  const tabs = [1, 2, 3].map((i) => ({ url: URL + i, title: 'T' + i }));
  assert.strictEqual(m.restore({ tabs, activeIndex: 99 }), true);
  assert.strictEqual(m.size, 2);
  assert.strictEqual(m.active().title, 'T2');
});

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nd-tab-')), name);
}

test('loadTabsFile 文件不存在或损坏返回 null，saveTabsFile 可往返', () => {
  const f = tmpFile('tabs.json');
  assert.strictEqual(loadTabsFile(f), null);
  fs.writeFileSync(f, '{bad');
  assert.strictEqual(loadTabsFile(f), null);
  const data = { tabs: [{ url: URL, title: 'A' }], activeIndex: 0 };
  saveTabsFile(f, data);
  assert.deepStrictEqual(loadTabsFile(f), data);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/tab-manager.test.js`
Expected: FAIL `Cannot find module '../src/main/tab-manager'`

- [ ] **Step 3: 实现 `src/main/tab-manager.js`**

```js
// 标签页状态机（纯逻辑，不依赖 Electron，可单测）
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_TABS = 10;

function createTabManager({ maxTabs = DEFAULT_MAX_TABS } = {}) {
  let tabs = []; // [{ id, url, title }]
  let activeId = null;
  let nextId = 1;

  const byId = (id) => tabs.find((t) => t.id === id) || null;

  function list() {
    return tabs.map((t) => ({ ...t, active: t.id === activeId }));
  }

  function add({ url, title = '' }) {
    if (tabs.length >= maxTabs) return null;
    const tab = { id: `t${nextId++}`, url, title };
    tabs.push(tab);
    activeId = tab.id;
    return { ...tab };
  }

  function close(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i === -1) return null;
    tabs.splice(i, 1);
    if (activeId === id) {
      const neighbor = tabs[i] || tabs[i - 1] || null;
      activeId = neighbor ? neighbor.id : null;
    }
    return { activeId, empty: tabs.length === 0 };
  }

  function activate(id) {
    if (!byId(id)) return false;
    activeId = id;
    return true;
  }

  function step(delta) {
    if (!tabs.length) return null;
    const i = tabs.findIndex((t) => t.id === activeId);
    activeId = tabs[(i + delta + tabs.length) % tabs.length].id;
    return activeId;
  }

  // Ctrl+1..8 按序，>=9 恒跳最后一个
  function activatePosition(n) {
    if (!tabs.length) return null;
    const i = n >= 9 ? tabs.length - 1 : Math.min(n - 1, tabs.length - 1);
    if (i < 0) return null;
    activeId = tabs[i].id;
    return activeId;
  }

  function reorder(ids) {
    if (!Array.isArray(ids) || ids.length !== tabs.length) return false;
    const set = new Set(ids);
    if (set.size !== tabs.length || !tabs.every((t) => set.has(t.id))) return false;
    tabs = ids.map((id) => byId(id));
    return true;
  }

  function serialize() {
    return {
      tabs: tabs.map(({ url, title }) => ({ url, title })),
      activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeId)),
    };
  }

  function restore(data) {
    tabs = [];
    activeId = null;
    if (!data || !Array.isArray(data.tabs)) return false;
    const ok = data.tabs.every((t) => t && typeof t.url === 'string' && t.url.startsWith('https://'));
    if (!ok) return false;
    for (const t of data.tabs.slice(0, maxTabs)) {
      tabs.push({ id: `t${nextId++}`, url: t.url, title: typeof t.title === 'string' ? t.title : '' });
    }
    const i = Number.isInteger(data.activeIndex) ? data.activeIndex : 0;
    activeId = tabs.length ? tabs[Math.min(Math.max(0, i), tabs.length - 1)].id : null;
    return tabs.length > 0;
  }

  return {
    list, byId, active: () => byId(activeId), add, close, activate,
    next: () => step(1), prev: () => step(-1),
    activatePosition, reorder, serialize, restore,
    get size() { return tabs.length; },
  };
}

function loadTabsFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveTabsFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = { createTabManager, loadTabsFile, saveTabsFile, DEFAULT_MAX_TABS };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/tab-manager.test.js`
Expected: 12 tests PASS

---

### Task 2: 快捷键映射纯模块

**Files:**
- Create: `src/main/tab-shortcuts.js`
- Test: `tests/tab-shortcuts.test.js`

**Interfaces:**
- Produces: `shortcutFor(input) → { action: 'new-tab'|'close-tab'|'next-tab'|'prev-tab' } | { action: 'position', position: number } | null`
- Consumes（Task 6）: Electron `before-input-event` 的 `input` 对象 `{ type, key, control, shift, alt }`

规则：`type==='keyDown'` 且 `control && !alt`；key 小写后匹配：`t`→new-tab，`w`→close-tab，`tab`→shift?prev-tab:next-tab，`1`..`9`→position。

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert');
const { shortcutFor } = require('../src/main/tab-shortcuts');

const kd = (key, mods = {}) => ({ type: 'keyDown', key, control: true, shift: false, alt: false, ...mods });

test('Ctrl+T / Ctrl+W / Ctrl+Tab / Ctrl+Shift+Tab', () => {
  assert.deepStrictEqual(shortcutFor(kd('t')), { action: 'new-tab' });
  assert.deepStrictEqual(shortcutFor(kd('T')), { action: 'new-tab' }); // 大小写不敏感
  assert.deepStrictEqual(shortcutFor(kd('w')), { action: 'close-tab' });
  assert.deepStrictEqual(shortcutFor(kd('Tab')), { action: 'next-tab' });
  assert.deepStrictEqual(shortcutFor(kd('Tab', { shift: true })), { action: 'prev-tab' });
});

test('Ctrl+1..9 映射 position', () => {
  assert.deepStrictEqual(shortcutFor(kd('1')), { action: 'position', position: 1 });
  assert.deepStrictEqual(shortcutFor(kd('9')), { action: 'position', position: 9 });
});

test('非 keyDown / 无 Ctrl / 带 Alt / 未注册键 → null', () => {
  assert.strictEqual(shortcutFor({ ...kd('t'), type: 'keyUp' }), null);
  assert.strictEqual(shortcutFor({ ...kd('t'), control: false }), null);
  assert.strictEqual(shortcutFor(kd('t', { alt: true })), null);
  assert.strictEqual(shortcutFor(kd('x')), null);
  assert.strictEqual(shortcutFor(kd('0')), null);
});
```

- [ ] **Step 2: 运行确认失败** — Run: `node --test tests/tab-shortcuts.test.js`，Expected: FAIL module not found

- [ ] **Step 3: 实现**

```js
// 浏览器式标签快捷键映射（纯逻辑）：Electron before-input-event 的 input → 动作
function shortcutFor(input) {
  if (!input || input.type !== 'keyDown' || !input.control || input.alt) return null;
  const k = String(input.key || '').toLowerCase();
  if (k === 't') return { action: 'new-tab' };
  if (k === 'w') return { action: 'close-tab' };
  if (k === 'tab') return { action: input.shift ? 'prev-tab' : 'next-tab' };
  if (/^[1-9]$/.test(k)) return { action: 'position', position: Number(k) };
  return null;
}

module.exports = { shortcutFor };
```

- [ ] **Step 4: 运行确认通过** — 3 tests PASS

---

### Task 3: 主进程粘合层 tabs.js + index.js 布局改造

**Files:**
- Create: `src/main/tabs.js`
- Modify: `src/main/index.js`（createWindow 内 contentView 相关、layoutViews、dom-ready/watch/zoom 三处、retry-load、ALLOWED_POPUPS handler、启动流程）

**Interfaces:**
- Consumes: Task 1 的 `createTabManager/loadTabsFile/saveTabsFile`；index.js 现有的 `readCombinedCss/buildSettingsCss/styleSettings` 等
- Produces:
  - `createTabs(deps) → tabs`
  - `tabs.newTab(url?, { search = false } = {}) → id | null`（search=true 时加载完成后触发 Ctrl+K）
  - `tabs.closeTab(id) → void`（最后一个触发 deps.onEmpty）
  - `tabs.activateTab(id) / tabs.nextTab() / tabs.prevTab() / tabs.activatePosition(n) → void`
  - `tabs.reorder(ids) → void`
  - `tabs.restore() → bool`（false 时调用方应 newTab 首页）
  - `tabs.forEachView(fn) → void`（对已创建视图的标签执行 fn(view)）
  - `tabs.activeView() → WebContentsView | null`
  - `tabs.layout() → void`（重排标题栏 + 活动视图边界）
  - deps 必填：`{ win, manager, homeUrl, partition, preloadPath, errorPagePath, getCss, getZoom, onChanged, onEmpty, saveFile }`
    - `getCss() → string`（combined css + settings css）、`getZoom() → number`
    - `onChanged() → void`（任何状态变化后调用，负责推送 titlebar + 防抖存盘）

**核心实现要点（写代码时照此结构）：**

```js
// 视图懒创建：恢复的标签首次激活才建视图
function ensureView(tab) {
  if (tab.view) return tab.view;
  const view = new WebContentsView({ webPreferences: { partition, preload: preloadPath } });
  tab.view = view;
  wireViewEvents(tab);
  view.webContents.loadURL(tab.url);
  view.webContents.on('dom-ready', () => {
    view.webContents.insertCSS(getCss(), { cssOrigin: 'author' }).then((k) => { tab.cssKey = k; });
    view.webContents.setZoomFactor(getZoom());
  });
  return view;
}

// 切换：旧视图 detach，新视图 attach 并重排
function attachActive() {
  const active = manager.active();
  for (const t of manager.list()) {
    const rec = byIdInternal(t.id);
    if (rec.view && rec.view !== (active && ensureView(rec).view)) {
      try { win.contentView.removeChildView(rec.view); } catch { /* 未挂载忽略 */ }
    }
  }
  if (active) {
    const rec = byIdInternal(active.id);
    const view = ensureView(rec);
    win.contentView.addChildView(view);
    layout();
    view.webContents.focus();
  }
}
```

`wireViewEvents(tab)` 内挂：
- `page-title-updated` → `tab.title = e.title || tab.title`，`onChanged()`
- `did-navigate` / `did-navigate-in-page`（isMainFrame）→ `tab.url = webContents.getURL()`，`onChanged()`
- `render-process-gone` → `webContents.reload()` 一次（设 `tab.reloaded` 防循环）
- `before-input-event` → 调用 Task 2 的 `shortcutFor`（Task 6 接线，本任务留空 hook 注释 `// Task 6 在此接入快捷键`）

**index.js 改造（diff 级）：**
1. 删除 `createWindow` 里 `contentView` 的创建、`loadURL(NOTION_URL)`、`contentView.webContents.on('dom-ready'...)`、`setWindowOpenHandler`、`did-fail-load` 五处（全部移入 tabs.js，Task 5 补 handler）。
2. `layoutViews()` 改为调用 `tabs.layout()`（保留 win resize 监听）；titlebar 边界逻辑不变。
3. `injectCss(customCssPath)` / `applyZoom()` 两个函数改为：
   - `getCss = () => readCombinedCss(DEFAULT_CSS, customCssPath) + '\n' + buildSettingsCss(styleSettings || {})`
   - watch/settings 更新时：`tabs.forEachView((v) => { v.webContents.insertCSS(getCss(), ...); v.webContents.setZoomFactor(styleSettings.zoom); })`
4. 启动流程：`createWindow()` 后 `initTabs()`（构造 manager + createTabs，onChanged 里推送 `tabs-changed` 给 titlebarView 并防抖写 saveFile）；`tabs.restore()` 返回 false 则 `tabs.newTab(NOTION_URL)`（不 search）。
5. `ipcMain.on('retry-load', ...)` 改为按 sender 路由：`const rec = tabs.findByWebContents(e.sender); if (rec) rec.view.webContents.loadURL(rec.url);` → tabs.js 需导出 `findByWebContents(wc) → rec | null`。
6. `win.on('close')` 与托盘逻辑不动；`onEmpty` 回调 = `win.close()`。

**去抖存盘**（tabs.js 内）：
```js
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveTabsFile(saveFile, manager.serialize()), 400);
}
// onChanged 内部：push() 推 titlebar + scheduleSave()
```

- [ ] **Step 1: 语法检查 + 既有测试** — Run: `node --check src/main/tabs.js && node --check src/main/index.js && npm test`
  Expected: 全绿（此任务无新单测，Electron 粘合由 Task 9 活体验证）
- [ ] **Step 2: 冒烟启动** — Run: `npx electron .`（dev 模式），观察窗口出现且加载 Notion 首页、单标签
  Expected: 正常渲染（若遇首启黑屏抖动，重试一次并用 `scripts/cdp-probe.js` 取证）

---

### Task 4: 标题栏标签条 UI + IPC

**Files:**
- Modify: `src/renderer/titlebar/index.html`、`src/renderer/titlebar/titlebar.js`、`src/renderer/titlebar/style.css`
- Modify: `src/preload/titlebar.js`
- Modify: `src/main/index.js`（IPC：`tabs-activate/tabs-close/tabs-new/tabs-reorder`，推送 `tabs-changed`）
- Modify: `scripts/preview-menu.js`（新增 tabs 场景）

**Interfaces:**
- Consumes: Task 3 的 `tabs.activateTab/closeTab/newTab/reorder`
- Produces:
  - preload `tabsApi`：`onTabs(cb)` / `activate(id)` / `close(id)` / `newTab()` / `reorder(ids)`
  - 主→渲染 `tabs-changed` 载荷：`{ tabs: manager.list(), canAdd: manager.size < DEFAULT_MAX_TABS }`

- [ ] **Step 1: preload/titlebar.js 追加**（保留现有 titlebarApi）

```js
contextBridge.exposeInMainWorld('tabsApi', {
  onTabs: (cb) => ipcRenderer.on('tabs-changed', (_e, data) => cb(data)),
  activate: (id) => ipcRenderer.send('tabs-activate', id),
  close: (id) => ipcRenderer.send('tabs-close', id),
  newTab: () => ipcRenderer.send('tabs-new'),
  reorder: (ids) => ipcRenderer.send('tabs-reorder', ids),
});
```

- [ ] **Step 2: index.html 结构改造**（`#app-title` 移除，标签条取而代之）

```html
<body>
  <div id="tabs"></div>
  <button id="new-tab" title="新建标签页 (Ctrl+T)">&#43;</button>
  <div id="drag-region"></div>
  <div id="controls">
    <button id="min" title="最小化">&#8211;</button>
    <button id="max" title="最大化">&#9634;</button>
    <button id="close" title="关闭">&#10005;</button>
  </div>
  <script src="tab-drag.js"></script>
  <script src="titlebar.js"></script>
</body>
```

- [ ] **Step 3: style.css 追加**

```css
#tabs {
  flex: 0 1 auto; display: flex; align-items: stretch;
  overflow: hidden; height: 100%;
  -webkit-app-region: no-drag;
}
.tab {
  flex: 0 1 180px; min-width: 72px;
  display: flex; align-items: center; gap: 6px;
  padding: 0 6px 0 10px; margin: 5px 1px 0;
  border-radius: 6px 6px 0 0;
  color: var(--hint); font-size: 12px;
  cursor: default; position: relative;
}
.tab.active { background: var(--input-bg); color: var(--fg); }
.tab:not(.active):hover { background: var(--hover); }
.tab .tab-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab .tab-close {
  flex: none; width: 18px; height: 18px; border: 0; border-radius: 4px;
  background: transparent; color: inherit; font-size: 11px; line-height: 1;
}
.tab .tab-close:hover { background: var(--hover); }
.tab.dragging { opacity: 0.85; z-index: 10; }
#new-tab {
  flex: none; width: 28px; margin: 5px 2px 0; border: 0; border-radius: 6px 6px 0 0;
  background: transparent; color: var(--fg); font-size: 15px;
  -webkit-app-region: no-drag;
}
#new-tab:hover { background: var(--hover); }
#new-tab:disabled { opacity: 0.35; }
#drag-region { flex: 1; -webkit-app-region: drag; }
```

（`body` 需改为 `display: flex`，`#controls` 保持原样右置。）

- [ ] **Step 4: titlebar.js 追加标签渲染**（保留主题/最大化/窗口控制代码）

```js
const tabsEl = document.getElementById('tabs');
let currentTabs = [];

window.tabsApi.onTabs(({ tabs, canAdd }) => {
  currentTabs = tabs;
  document.getElementById('new-tab').disabled = !canAdd;
  renderTabs();
});

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const t of currentTabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.active ? ' active' : '');
    el.dataset.id = t.id;
    el.innerHTML = '<span class="tab-title"></span><button class="tab-close" title="关闭 (Ctrl+W)">&#10005;</button>';
    el.querySelector('.tab-title').textContent = t.title || '加载中…';
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      window.tabsApi.activate(t.id);
    });
    el.querySelector('.tab-close').addEventListener('click', () => window.tabsApi.close(t.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) window.tabsApi.close(t.id); }); // 中键关闭
    attachDrag(el, t.id); // Task 7 实现于 tab-drag.js，本任务先写空函数占位
    tabsEl.appendChild(el);
  }
}
function attachDrag() { /* Task 7 填充 */ }

document.getElementById('new-tab').addEventListener('click', () => window.tabsApi.newTab());
```

- [ ] **Step 5: 主进程 IPC（index.js，initTabs 内）**

```js
ipcMain.on('tabs-activate', (_e, id) => tabs.activateTab(id));
ipcMain.on('tabs-close', (_e, id) => tabs.closeTab(id));
ipcMain.on('tabs-new', () => tabs.newTab(NOTION_URL, { search: true }));
ipcMain.on('tabs-reorder', (_e, ids) => tabs.reorder(ids));
```

推送载荷（tabs.js 的 push 内）：
```js
titlebarView.webContents.send('tabs-changed', { tabs: manager.list(), canAdd: manager.size < DEFAULT_MAX_TABS });
```
注意 titlebarView 需在 `did-finish-load` 后补推一次（消除竞态，参照现有 theme 补发先例）。

- [ ] **Step 6: preview-menu.js 加 tabs 场景并截图验证**

TARGETS 追加：`tabs: { width: 900, height: 36, dir: 'titlebar', preload: 'titlebar.js' }`；
stub：`ipcMain.on('tabs-activate', () => {})` 等四个通道；加载后：

```js
const demo = [
  { id: 't1', url: '', title: 'Paper', active: false },
  { id: 't2', url: '', title: 'Agent驱动的涡轮设计审稿意见', active: true },
  { id: 't3', url: '', title: '基于主动学习的物理信息神经网络高效采样方法', active: false },
];
await win.webContents.executeJavaScript('void 0');
win.webContents.send('tabs-changed', { tabs: demo, canAdd: true });
```
截图 `tabs-light/dark.png`；再发 10 个长标题标签截 `tabs-overflow.png`。
Run: `npx electron scripts/preview-menu.js tabs`
Expected: 三张截图，标签条排版正确、活动标签高亮、溢出压缩不换行

---

### Task 5: 新建标签触发 Ctrl+K + window.open 拦截 + 错误页 per-tab

**Files:**
- Modify: `src/main/tabs.js`

**Interfaces:**
- Consumes: Task 3 的 `ensureView/wireViewEvents/newTab`
- Produces: `tabs.openInNewTab(url) → id | null`；`tabs.findByWebContents(wc) → rec | null`

- [ ] **Step 1: Ctrl+K 唤起 Quick Find**

`newTab(url, { search })` 中，视图 `did-finish-load` 后：

```js
function triggerQuickFind(view) {
  // Notion 的 Quick Find 监听需在应用 JS 就绪后，做三次递远重试兜底
  const delays = [600, 1500, 3000];
  delays.forEach((d) => setTimeout(() => {
    if (view.webContents.isDestroyed()) return;
    view.webContents.focus();
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'k', modifiers: ['control'] });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'k', modifiers: ['control'] });
  }, d));
}
```
仅在 `search === true`（用户主动新建）时调用；恢复的标签不触发。触发失败兜底 = 停在首页，不报错。

- [ ] **Step 2: setWindowOpenHandler（wireViewEvents 内，每视图）**

```js
const AUTH_POPUPS = [
  'https://accounts.google.com', 'https://appleid.apple.com',
  'https://login.microsoftonline.com', 'https://login.live.com',
  'https://auth.openai.com', 'https://auth0.openai.com',
];
view.webContents.setWindowOpenHandler(({ url }) => {
  if (AUTH_POPUPS.some((p) => url.startsWith(p))) return { action: 'allow' }; // 登录弹窗保持独立窗口
  if (url.startsWith('https://www.notion.so') || url.startsWith('https://notion.so')) {
    openInNewTab(url); // Ctrl+Click / 「在新标签页打开」→ 前台新标签
    return { action: 'deny' };
  }
  shell.openExternal(url);
  return { action: 'deny' };
});
```
同时删除 index.js 里旧的 `ALLOWED_POPUPS` handler（Task 3 已移除引用，本步删定义）。

- [ ] **Step 3: did-fail-load per-tab（wireViewEvents 内）**

```js
view.webContents.on('did-fail-load', (_e, _code, _desc, validatedURL, isMainFrame) => {
  if (isMainFrame && validatedURL.startsWith('http')) {
    view.webContents.loadFile(errorPagePath);
  }
});
```
`errorPagePath` = `renderer/error.html`；retry 路由已在 Task 3 的 index.js 改造中完成（按 sender 找到 tab 重载 `tab.url`）。

- [ ] **Step 4: 语法检查 + 全量测试** — Run: `node --check src/main/tabs.js && npm test`，Expected: 全绿

---

### Task 6: 标签快捷键接线（实现时修订）

> **实现时发现的设计变更**：`Ctrl+Tab` 和 `Ctrl+PageDown/PageUp` 都是 Chromium 的保留标签切换键，在到达 `before-input-event` 之前就被吞掉；应用菜单加速器同样拦不到；`globalShortcut.register('CommandOrControl+Tab')` 在 Windows 上 `RegisterHotKey` 直接失败。最终方案：
> - `Ctrl+T / Ctrl+W / Ctrl+1..9` → 视图层 `before-input-event` 拦截（`shortcutFor` 映射）
> - `Ctrl+PageDown / Ctrl+Shift+PageUp`（循环切换）→ **主窗口聚焦期间注册为全局快捷键**，失焦即注销，不影响其他应用
> - `Ctrl+Tab` 不支持（所有可拦截层都拿不到），文档化说明

**Files:**
- Modify: `src/main/tabs.js`（wireViewEvents 内的 before-input-event）
- Modify: `src/main/index.js`（registerTabSwitchKeys + win focus/blur 接线，registerHotkeys 末尾重挂）

**Interfaces:**
- Consumes: Task 2 `shortcutFor`；Task 3 `newTab/closeTab/nextTab/prevTab/activatePosition`

- [x] **Step 1: before-input-event 接线（t/w/1-9/pagedown/pageup）**

```js
const { shortcutFor } = require('./tab-shortcuts');
// wireViewEvents 内：
view.webContents.on('before-input-event', (e, input) => {
  const s = shortcutFor(input);
  if (!s) return;
  e.preventDefault(); // 页面收不到这些键，避免与 Notion 编辑器冲突
  if (s.action === 'new-tab') newTab(homeUrl, { search: true });
  else if (s.action === 'close-tab') { const a = manager.active(); if (a) closeTab(a.id); }
  else if (s.action === 'next-tab') nextTab();
  else if (s.action === 'prev-tab') prevTab();
  else if (s.action === 'position') activatePosition(s.position);
});
```

- [x] **Step 2: 聚焦期全局快捷键（index.js）**

```js
function registerTabSwitchKeys() {
  if (!win || !win.isFocused() || !tabs) return;
  try { globalShortcut.register('CommandOrControl+PageDown', () => tabs.nextTab()); } catch { }
  try { globalShortcut.register('CommandOrControl+Shift+PageUp', () => tabs.prevTab()); } catch { }
}
function unregisterTabSwitchKeys() {
  try { globalShortcut.unregister('CommandOrControl+PageDown'); } catch { }
  try { globalShortcut.unregister('CommandOrControl+Shift+PageUp'); } catch { }
}
// whenReady 内：win.on('focus', registerTabSwitchKeys); win.on('blur', unregisterTabSwitchKeys); registerTabSwitchKeys();
// registerHotkeys() 末尾追加 registerTabSwitchKeys()（unregisterAll 会一并清掉它们）
```

- [x] **Step 3: 全量测试 + e2e** — `npm test` 全绿；`scripts/cdp-tabs-check.js` 的 Ctrl+PageDown / Ctrl+2 检查 PASS

---

### Task 7: 拖拽排序

**Files:**
- Create: `src/renderer/titlebar/tab-drag.js`（UMD，浏览器挂 `window.tabDrag`，Node 走 exports）
- Test: `tests/tab-drag.test.js`
- Modify: `src/renderer/titlebar/titlebar.js`（填充 attachDrag）

**Interfaces:**
- Produces: `dropIndex(rects, pointerX) → number`（rects = 非拖拽标签的 `[{ left, width }]`，按 DOM 顺序；返回插入位 0..len）
- Consumes: preload `tabsApi.reorder(ids)`；Task 1 `manager.reorder`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert');
const { dropIndex } = require('../src/renderer/titlebar/tab-drag');

const rects = [{ left: 0, width: 100 }, { left: 100, width: 100 }, { left: 200, width: 100 }];

test('dropIndex 按指针越过的中点数定位', () => {
  assert.strictEqual(dropIndex(rects, 10), 0);   // 第一个中点(50)之前
  assert.strictEqual(dropIndex(rects, 60), 1);   // 越过第1个中点
  assert.strictEqual(dropIndex(rects, 160), 2);
  assert.strictEqual(dropIndex(rects, 999), 3);  // 全部越过 → 末尾
});

test('dropIndex 空列表返回 0', () => {
  assert.strictEqual(dropIndex([], 100), 0);
});
```

- [ ] **Step 2: 运行确认失败** — Run: `node --test tests/tab-drag.test.js`，Expected: FAIL module not found

- [ ] **Step 3: 实现 tab-drag.js**

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.tabDrag = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // 指针越过了多少个兄弟标签的中点，就插入到第几位
  function dropIndex(rects, pointerX) {
    let i = 0;
    for (const r of rects) {
      if (pointerX > r.left + r.width / 2) i++;
    }
    return i;
  }
  return { dropIndex };
});
```

- [ ] **Step 4: 运行确认通过** — 2 tests PASS

- [ ] **Step 5: titlebar.js 填充 attachDrag**

```js
function attachDrag(el, id) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('tab-close') || e.button !== 0) return;
    const startX = e.clientX;
    let dragging = false;
    let dx = 0;
    const onMove = (ev) => {
      dx = ev.clientX - startX;
      if (!dragging && Math.abs(dx) > 4) { dragging = true; el.classList.add('dragging'); }
      if (dragging) el.style.transform = `translateX(${dx}px)`;
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      el.style.transform = '';
      if (!dragging) return;
      // 用其余标签的中点计算插入位，构造新顺序提交
      const others = [...tabsEl.querySelectorAll('.tab')].filter((n) => n !== el);
      const rects = others.map((n) => { const r = n.getBoundingClientRect(); return { left: r.left, width: r.width }; });
      let idx = window.tabDrag.dropIndex(rects, ev.clientX);
      const ids = others.map((n) => n.dataset.id);
      ids.splice(idx, 0, id);
      window.tabsApi.reorder(ids); // 主进程重排后会推 tabs-changed 触发重渲染
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}
```

- [ ] **Step 6: 全量测试** — Run: `npm test`，Expected: 全绿

---

### Task 8: 持久化恢复接线 + 崩溃重载防循环收尾

**Files:**
- Modify: `src/main/index.js`（startup）、`src/main/tabs.js`

- [ ] **Step 1: restore 实现（tabs.js）**

```js
function restore() {
  const data = loadTabsFile(saveFile);
  if (!data || !manager.restore(data)) return false;
  const active = manager.active();
  if (active) activateTab(active.id); // ensureView 懒创建：仅活动标签立即加载
  push(); // 推 titlebar
  return true;
}
```

- [ ] **Step 2: index.js 启动接入**

```js
const tabsFile = path.join(app.getPath('userData'), 'tabs.json');
// initTabs(...) 之后：
if (!tabs.restore()) tabs.newTab(NOTION_URL);
```

- [ ] **Step 3: 确认 render-process-gone 只重载一次**（Task 3 的 `tab.reloaded` 标记：重载后置 true，再次 gone 则保留错误页）

- [ ] **Step 4: 全量测试** — Run: `npm test`，Expected: 全绿

---

### Task 9: 端到端验证 + 打包

**Files:**
- Modify: `scripts/preview-menu.js`（如需补场景）

- [ ] **Step 1: 全量测试** — Run: `npm test`，Expected: 全绿（约 55+ 条）
- [ ] **Step 2: 标签条预览截图** — Run: `npx electron scripts/preview-menu.js tabs`，确认 `tabs-light/dark/overflow.png` 正确
- [ ] **Step 3: dev 活体验证** — Run: `npx electron . --remote-debugging-port=9222`，人工/探针核对：
  - Ctrl+T 新建 → 新标签加载首页且 Quick Find 浮层被唤起（`document.querySelector('[role="dialog"]')` 非空）
  - Ctrl+W / Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+1 / Ctrl+9 行为正确
  - 标签点击切换瞬时完成且滚动位置保留
  - 拖拽标签换序，重启 `npx electron .` 后标签恢复（仅活动标签立即加载）
  - 关闭最后一个标签 → 窗口按 closeAction 行为
- [ ] **Step 4: 打包** — Run: `taskkill //F //IM "Notion Desktop.exe"; npm run dist`
  Expected: `dist/Notion Desktop Setup 0.1.0.exe` 重新生成
- [ ] **Step 5: 产物验证** — `npx asar list dist/win-unpacked/resources/app.asar` 含 `tab-manager.js`、`tabs.js`、`tab-shortcuts.js`、`tab-drag.js`

---

## Self-Review 记录

- Spec 覆盖：独立实例(M3) / Ctrl+K 新建(M5) / 标题栏标签条(M4) / 快捷键(M2+M6) / 拖拽(M7) / 重启恢复(M1+M8) / 上限 10(M1+M4 canAdd) / 关最后标签=关窗(M3 onEmpty) / 错误页 per-tab(M5) — 全部有对应任务。
- 类型一致性：`manager.*` 方法名在 Task 1 定义、Task 3/6/7 消费一致；`tabs-changed` 载荷 `{tabs, canAdd}` 在 Task 4 两侧一致；`tabsApi` 五个通道名一致。
- 占位符扫描：Task 4 的 `attachDrag` 空函数在 Task 7 填充，两处均明确标注。

## 实施后变更（2026-08-24）：新建标签交互对齐官方客户端

Task 5 原设计是“先开新标签加载首页，再注入 Ctrl+K”。官方客户端实际是反过来的：Ctrl+T 在**当前页**唤起 Quick Find，选中结果的瞬间才以目标页开新标签。已按官方改版：

- `tabs.newTabInteractive()`：待命（arm）当前页 preload 的捕获监听 + 注入 Ctrl+K，不开标签；preload 捕获阶段拦截 Quick Find 内的点击/回车，取结果 `a[href]` 上报主进程 → `newTab(url)`，并向来源页送真实 Escape 关浮层。
- 兜底链：结果不是链接形态时放行跳转，`did-navigate-in-page` 检测到待命页导航 → 开新标签 + `navigationHistory.goBack()` 退回来源页。当前页不可搜索（错误页/未建视图）时退回 Task 5 旧逻辑。
- 实现期发现 Notion 页面行为三个坑：① “在桌面应用打开？”推广条也是 `role=dialog` 且会吞 Ctrl+K——首轮注入前先送 Escape 清场；② Ctrl+K 是开关式——每轮注入前用 `executeJavaScript` 查 `[role="dialog"] input`，已开则跳过；③ 结果锚点无 `aria-selected`，回车默认取第一个 `a[href]`。
- 解除待命：选中/Escape/点浮层外/切标签/30s 超时。URL 白名单校验在 `src/main/quick-find.js`（仅放行 notion.so 的 https 地址）。
