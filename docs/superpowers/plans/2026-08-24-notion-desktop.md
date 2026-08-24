# Notion Desktop（Electron 套壳）Implementation Plan

> **For agentic workers:** Implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个套壳 notion.so 的 Electron 桌面应用：无边框自绘标题栏跟随 Notion 浅色/深色主题变色，注入内置 CSS 并支持用户 custom.css 热更新，带系统托盘和窗口状态记忆。

**Architecture:** Electron BaseWindow + 双 WebContentsView：上方 36px 本地标题栏 View，下方加载 notion.so 的内容 View。内容 View 的 preload 用 MutationObserver 检测 Notion 根节点的 `.dark` 类，经主进程转发给标题栏 View 切换配色。CSS 通过 `webContents.insertCSS()` 注入，`fs.watch` 监视 custom.css 变化后重新注入。

**Tech Stack:** Electron（≥30，BaseWindow/WebContentsView 需要）、纯 JavaScript（无构建步骤）、Node 内置 `node:test` 做单元测试、electron-builder 打 NSIS 包。

## Global Constraints

- 工作目录：`H:\My_Software\Notion_Desktop`，平台 Windows。
- 所有源码用 CommonJS 纯 JS，不引入 TypeScript / 打包器 / 前端框架。
- 除 `electron`、`electron-builder`（devDependencies）外不引入任何第三方依赖。
- 内容 View 必须 `partition: 'persist:notion'`（登录会话持久化），保持默认的 `contextIsolation: true`、`nodeIntegration: false`。
- 标题栏高度常量 `TITLEBAR_HEIGHT = 36`。
- 内置样式文件 `assets/default.css` 内容 = 用户需求中提供的完整 CSS，逐字写入，不做修改。
- 用户样式文件路径：`app.getPath('userData')/custom.css`。
- 单元测试只覆盖纯逻辑模块（`window-state.js`、`css-manager.js`），Electron GUI 部分用手动冒烟验证。

## File Structure

- `package.json` — 入口、脚本、electron-builder 配置
- `assets/default.css` — 内置注入样式（用户提供的 CSS）
- `assets/tray.png` — 托盘图标（由 `scripts/make-icon.js` 生成）
- `scripts/make-icon.js` — 无依赖 PNG 图标生成脚本
- `src/main/index.js` — 主进程：窗口/双 View/托盘/IPC/外链拦截/错误页
- `src/main/window-state.js` — 窗口状态读写、可见性校验、防抖跟踪（纯逻辑）
- `src/main/css-manager.js` — custom.css 初始化、合并读取、文件监视（纯逻辑）
- `src/preload/titlebar.js` — 标题栏渲染进程的 contextBridge API
- `src/preload/content.js` — 内容 View 的主题检测 + 重试桥接
- `src/renderer/titlebar/index.html|style.css|titlebar.js` — 标题栏 UI
- `src/renderer/error.html` — 断网错误页
- `tests/window-state.test.js`、`tests/css-manager.test.js` — 单元测试

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `assets/default.css`
- Create: `src/main/`、`src/preload/`、`src/renderer/titlebar/`、`tests/`、`scripts/` 目录

**Interfaces:**
- Produces: `npm start`（electron 入口）、`npm test`、`npm run dist` 命令；`assets/default.css` 供 Task 6 注入。

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "notion-desktop",
  "version": "0.1.0",
  "private": true,
  "description": "Notion 桌面套壳：主题跟随 + CSS 注入",
  "main": "src/main/index.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/",
    "dist": "electron-builder"
  },
  "build": {
    "appId": "com.local.notion-desktop",
    "productName": "Notion Desktop",
    "files": ["src/**", "assets/**", "package.json"],
    "win": { "target": "nsis" },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "shortcutName": "Notion Desktop"
    }
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `npm install --save-dev electron@latest electron-builder@latest`
Expected: 安装成功；`npx electron --version` 输出版本 ≥ v30。

- [ ] **Step 3: 写 `assets/default.css`**

将用户需求中给出的完整 CSS（从 `/* ========== 文本自动对齐 ========== */` 到 `.dark a.notion-link-page` 规则结束）逐字写入该文件。

- [ ] **Step 4: 建立目录结构**

创建 `src/main`、`src/preload`、`src/renderer/titlebar`、`tests`、`scripts` 空目录。

---

### Task 2: window-state 模块（TDD）

**Files:**
- Create: `src/main/window-state.js`
- Test: `tests/window-state.test.js`

**Interfaces:**
- Produces（Task 4 消费）:
  - `loadState(filePath) -> { width, height, x?, y?, isMaximized }`，缺文件/损坏/非法值时回退默认 `{ width: 1200, height: 800, isMaximized: false }`；`width<400`、`height<300` 视为非法。
  - `saveState(filePath, state) -> void`（自动建目录）
  - `isVisibleOnSomeDisplay(bounds, displays) -> boolean`；无 x/y 坐标返回 `true`；`displays` 为 `{ workArea: {x,y,width,height} }[]`
  - `trackWindow(win, filePath, delay=500) -> void`；监听 resize/move/maximize/unmaximize/close，防抖保存 `getNormalBounds()` + 最大化标志

- [ ] **Step 1: 写失败测试 `tests/window-state.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  loadState, saveState, isVisibleOnSomeDisplay, trackWindow,
} = require('../src/main/window-state');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nd-')), name);
}

test('loadState 文件不存在时返回默认值', () => {
  assert.deepStrictEqual(loadState(tmpFile('missing.json')), {
    width: 1200, height: 800, isMaximized: false,
  });
});

test('loadState JSON 损坏时返回默认值', () => {
  const f = tmpFile('bad.json');
  fs.writeFileSync(f, '{oops');
  assert.deepStrictEqual(loadState(f), { width: 1200, height: 800, isMaximized: false });
});

test('loadState 过滤非法数值', () => {
  const f = tmpFile('s.json');
  fs.writeFileSync(f, JSON.stringify({ width: 100, height: 5000, x: 'bad', y: 20, isMaximized: 1 }));
  const s = loadState(f);
  assert.strictEqual(s.width, 1200);   // 100 < 400 回退默认
  assert.strictEqual(s.height, 5000);  // 合法，保留
  assert.strictEqual(s.x, undefined);
  assert.strictEqual(s.y, 20);
  assert.strictEqual(s.isMaximized, false);
});

test('saveState + loadState 往返一致', () => {
  const f = tmpFile('round.json');
  const s = { width: 1024, height: 768, x: 10, y: 20, isMaximized: true };
  saveState(f, s);
  assert.deepStrictEqual(loadState(f), s);
});

const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];

test('isVisibleOnSomeDisplay: 无坐标视为可见', () => {
  assert.strictEqual(isVisibleOnSomeDisplay({ width: 800, height: 600 }, displays), true);
});
test('isVisibleOnSomeDisplay: 与屏幕有重叠可见', () => {
  assert.strictEqual(isVisibleOnSomeDisplay({ x: 1900, y: 1000, width: 800, height: 600 }, displays), true);
});
test('isVisibleOnSomeDisplay: 完全在屏幕外不可见', () => {
  assert.strictEqual(isVisibleOnSomeDisplay({ x: 5000, y: 5000, width: 800, height: 600 }, displays), false);
});

test('trackWindow 防抖保存窗口状态', async () => {
  const f = tmpFile('state.json');
  const win = new EventEmitter();
  win.isDestroyed = () => false;
  win.isMaximized = () => false;
  win.getNormalBounds = () => ({ x: 1, y: 2, width: 800, height: 600 });
  trackWindow(win, f, 10);
  win.emit('resize');
  win.emit('move');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(loadState(f), { x: 1, y: 2, width: 800, height: 600, isMaximized: false });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../src/main/window-state'`

- [ ] **Step 3: 实现 `src/main/window-state.js`**

```js
const fs = require('fs');
const path = require('path');

const DEFAULT_STATE = { width: 1200, height: 800, isMaximized: false };

function loadState(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const state = { ...DEFAULT_STATE };
    if (Number.isFinite(raw.width) && raw.width >= 400) state.width = raw.width;
    if (Number.isFinite(raw.height) && raw.height >= 300) state.height = raw.height;
    if (Number.isFinite(raw.x)) state.x = raw.x;
    if (Number.isFinite(raw.y)) state.y = raw.y;
    if (raw.isMaximized === true) state.isMaximized = true;
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function isVisibleOnSomeDisplay(bounds, displays) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return true;
  return displays.some(({ workArea }) =>
    bounds.x < workArea.x + workArea.width &&
    bounds.x + bounds.width > workArea.x &&
    bounds.y < workArea.y + workArea.height &&
    bounds.y + bounds.height > workArea.y
  );
}

function trackWindow(win, filePath, delay = 500) {
  let timer = null;
  const persist = () => {
    if (win.isDestroyed()) return;
    saveState(filePath, { ...win.getNormalBounds(), isMaximized: win.isMaximized() });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, delay);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', persist);
}

module.exports = { DEFAULT_STATE, loadState, saveState, isVisibleOnSomeDisplay, trackWindow };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 8 个测试全部 PASS

---

### Task 3: css-manager 模块（TDD）

**Files:**
- Create: `src/main/css-manager.js`
- Test: `tests/css-manager.test.js`

**Interfaces:**
- Produces（Task 6 消费）:
  - `ensureCustomCss(userDataDir, defaultCssPath) -> customCssPath`；不存在则从默认样式复制，存在不覆盖
  - `readCombinedCss(defaultCssPath, customCssPath) -> string`；默认在前，单个文件缺失容错
  - `watchCustomCss(customCssPath, onChange, delay=300) -> { close() }`；防抖回调

- [ ] **Step 1: 写失败测试 `tests/css-manager.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureCustomCss, readCombinedCss, watchCustomCss } = require('../src/main/css-manager');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nd-'));
}

test('ensureCustomCss 缺失时从默认样式复制', () => {
  const dir = tmpDir();
  const def = path.join(dir, 'default.css');
  fs.writeFileSync(def, 'body{color:red}');
  const custom = ensureCustomCss(dir, def);
  assert.strictEqual(custom, path.join(dir, 'custom.css'));
  assert.strictEqual(fs.readFileSync(custom, 'utf8'), 'body{color:red}');
});

test('ensureCustomCss 已存在时不覆盖', () => {
  const dir = tmpDir();
  const def = path.join(dir, 'default.css');
  fs.writeFileSync(def, 'A');
  fs.writeFileSync(path.join(dir, 'custom.css'), 'B');
  ensureCustomCss(dir, def);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'custom.css'), 'utf8'), 'B');
});

test('readCombinedCss 合并默认与自定义，默认在前', () => {
  const dir = tmpDir();
  const def = path.join(dir, 'default.css');
  const custom = path.join(dir, 'custom.css');
  fs.writeFileSync(def, 'A');
  fs.writeFileSync(custom, 'B');
  const combined = readCombinedCss(def, custom);
  assert.ok(combined.includes('A') && combined.includes('B'));
  assert.ok(combined.indexOf('A') < combined.indexOf('B'));
});

test('readCombinedCss 文件缺失时容错', () => {
  const dir = tmpDir();
  assert.strictEqual(readCombinedCss(path.join(dir, 'x'), path.join(dir, 'y')).trim(), '');
});

test('watchCustomCss 修改文件触发回调（防抖）', async () => {
  const dir = tmpDir();
  const f = path.join(dir, 'custom.css');
  fs.writeFileSync(f, 'A');
  let calls = 0;
  const w = watchCustomCss(f, () => { calls += 1; }, 20);
  fs.writeFileSync(f, 'B');
  fs.writeFileSync(f, 'C');
  await new Promise((r) => setTimeout(r, 500));
  w.close();
  assert.ok(calls >= 1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../src/main/css-manager'`

- [ ] **Step 3: 实现 `src/main/css-manager.js`**

```js
const fs = require('fs');
const path = require('path');

function ensureCustomCss(userDataDir, defaultCssPath) {
  const customPath = path.join(userDataDir, 'custom.css');
  if (!fs.existsSync(customPath)) {
    fs.copyFileSync(defaultCssPath, customPath);
  }
  return customPath;
}

function readCombinedCss(defaultCssPath, customCssPath) {
  let out = '';
  try { out += fs.readFileSync(defaultCssPath, 'utf8'); } catch { /* 容错 */ }
  out += '\n';
  try { out += fs.readFileSync(customCssPath, 'utf8'); } catch { /* 容错 */ }
  return out;
}

function watchCustomCss(customCssPath, onChange, delay = 300) {
  let timer = null;
  const watcher = fs.watch(customCssPath, () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(customCssPath), delay);
  });
  return {
    close: () => { clearTimeout(timer); watcher.close(); },
  };
}

module.exports = { ensureCustomCss, readCombinedCss, watchCustomCss };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 累计 13 个测试全部 PASS

---

### Task 4: 主窗口 + 双 View + 标题栏 UI

**Files:**
- Create: `src/main/index.js`
- Create: `src/preload/titlebar.js`
- Create: `src/renderer/titlebar/index.html`、`style.css`、`titlebar.js`

**Interfaces:**
- Consumes: Task 2 的 `loadState / isVisibleOnSomeDisplay / trackWindow`
- Produces: 标题栏 IPC 通道 `window-minimize / window-toggle-maximize / window-close / get-theme / window-maximized`（Task 5 复用 `get-theme`）；主进程全局 `win / titlebarView / contentView`（后续任务在此基础上加功能）

- [ ] **Step 1: 写 `src/preload/titlebar.js`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('titlebarApi', {
  minimize: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getTheme: () => ipcRenderer.sendSync('get-theme'),
  onTheme: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
  onMaximized: (cb) => ipcRenderer.on('window-maximized', (_e, flag) => cb(flag)),
});
```

- [ ] **Step 2: 写 `src/renderer/titlebar/index.html`**

```html
<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self'" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="drag-region"><span id="app-title">Notion</span></div>
  <div id="controls">
    <button id="min" title="最小化">&#8211;</button>
    <button id="max" title="最大化">&#9634;</button>
    <button id="close" title="关闭">&#10005;</button>
  </div>
  <script src="titlebar.js"></script>
</body>
</html>
```

- [ ] **Step 3: 写 `src/renderer/titlebar/style.css`**（深/浅两套配色，深色底 `#191919` 与 Notion 深色一致）

```css
:root, html[data-theme="light"] {
  --bg: #ffffff; --fg: #37352f; --hover: rgba(0, 0, 0, 0.06);
}
html[data-theme="dark"] {
  --bg: #191919; --fg: #d4d4d4; --hover: rgba(255, 255, 255, 0.08);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 36px; overflow: hidden; }
body {
  display: flex;
  background: var(--bg); color: var(--fg);
  font-family: "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px;
  user-select: none;
}
#drag-region {
  flex: 1; -webkit-app-region: drag;
  display: flex; align-items: center; padding: 0 12px;
}
#controls { display: flex; }
#controls button {
  -webkit-app-region: no-drag;
  width: 46px; border: 0; background: transparent; color: var(--fg);
  font-size: 14px;
}
#controls button:hover { background: var(--hover); }
#close:hover { background: #e81123 !important; color: #fff; }
```

- [ ] **Step 4: 写 `src/renderer/titlebar/titlebar.js`**

```js
const btnMax = document.getElementById('max');

document.getElementById('min').addEventListener('click', () => window.titlebarApi.minimize());
btnMax.addEventListener('click', () => window.titlebarApi.toggleMaximize());
document.getElementById('close').addEventListener('click', () => window.titlebarApi.close());

document.documentElement.dataset.theme = window.titlebarApi.getTheme();

window.titlebarApi.onTheme((theme) => {
  document.documentElement.dataset.theme = theme;
});
window.titlebarApi.onMaximized((isMax) => {
  btnMax.innerHTML = isMax ? '&#10064;' : '&#9634;';
});
```

- [ ] **Step 5: 写 `src/main/index.js`**

```js
const path = require('path');
const { app, BaseWindow, WebContentsView, ipcMain, screen, nativeTheme } = require('electron');
const { loadState, isVisibleOnSomeDisplay, trackWindow } = require('./window-state');

const NOTION_URL = 'https://www.notion.so/';
const TITLEBAR_HEIGHT = 36;

let win;
let titlebarView;
let contentView;

function layoutViews() {
  const { width, height } = win.getContentBounds();
  titlebarView.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
  contentView.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: Math.max(0, height - TITLEBAR_HEIGHT) });
}

function createWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const state = loadState(stateFile);
  if (!isVisibleOnSomeDisplay(state, screen.getAllDisplays())) {
    delete state.x;
    delete state.y;
  }

  win = new BaseWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff',
  });

  titlebarView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'titlebar.js') },
  });
  contentView = new WebContentsView({
    webPreferences: { partition: 'persist:notion' },
  });

  win.contentView.addChildView(titlebarView);
  win.contentView.addChildView(contentView);
  layoutViews();

  titlebarView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'titlebar', 'index.html'));
  contentView.webContents.loadURL(NOTION_URL);

  if (state.isMaximized) win.maximize();

  win.on('resize', layoutViews);
  trackWindow(win, stateFile);

  win.on('maximize', () => titlebarView.webContents.send('window-maximized', true));
  win.on('unmaximize', () => titlebarView.webContents.send('window-maximized', false));
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-toggle-maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('window-close', () => win.close());
  ipcMain.on('get-theme', (e) => {
    e.returnValue = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 6: 手动验证**

Run: `npm start`
Expected: 无边框窗口打开，顶部 36px 标题栏（按系统主题着色），下方加载 notion.so 登录页；拖动标题栏可移动窗口；三个按钮分别最小化 / 最大化切换（图标变化）/ 关闭；调整窗口大小时两个 View 跟随布局。
验证后关闭窗口。

---

### Task 5: 主题跟随

**Files:**
- Create: `src/preload/content.js`
- Modify: `src/main/index.js`

**Interfaces:**
- Produces: IPC 通道 `notion-theme-changed`（payload `'dark' | 'light'`）、`retry-load`（Task 8 消费）；页面世界全局 `window.notionDesktop.retry()`

- [ ] **Step 1: 写 `src/preload/content.js`**

```js
const { contextBridge, ipcRenderer } = require('electron');

function currentTheme() {
  const html = document.documentElement;
  const body = document.body;
  const dark =
    html.classList.contains('dark') ||
    (body && body.classList.contains('dark')) ||
    !!document.querySelector('#notion-app.dark');
  return dark ? 'dark' : 'light';
}

let last = null;
function report() {
  const t = currentTheme();
  if (t !== last) {
    last = t;
    ipcRenderer.send('notion-theme-changed', t);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  report();
  const observer = new MutationObserver(report);
  const opts = { attributes: true, attributeFilter: ['class'] };
  observer.observe(document.documentElement, opts);
  if (document.body) observer.observe(document.body, opts);
  // 兜底：主题类若挂在更深层节点，低成本轮询保证不漏
  setInterval(report, 1500);
});

contextBridge.exposeInMainWorld('notionDesktop', {
  retry: () => ipcRenderer.send('retry-load'),
});
```

- [ ] **Step 2: 改 `src/main/index.js`**

共 4 处修改：

1. `contentView` 的 `webPreferences` 加 preload：

```js
  contentView = new WebContentsView({
    webPreferences: {
      partition: 'persist:notion',
      preload: path.join(__dirname, '..', 'preload', 'content.js'),
    },
  });
```

2. 顶部变量区加：

```js
let currentTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
```

3. `whenReady` 中替换 `get-theme` 处理器为：

```js
  ipcMain.on('get-theme', (e) => { e.returnValue = currentTheme; });
  ipcMain.on('notion-theme-changed', (_e, theme) => {
    if (theme !== 'dark' && theme !== 'light') return;
    currentTheme = theme;
    titlebarView.webContents.send('theme-changed', theme);
    win.setBackgroundColor(theme === 'dark' ? '#191919' : '#ffffff');
  });
```

- [ ] **Step 3: 手动验证**

Run: `npm start`，登录后在 Notion 设置（Settings → Appearance）切换 Dark / Light。
Expected: 切换后 1~2 秒内标题栏背景/按钮颜色跟随变化（浅=白底深字，深=`#191919` 底浅字）；窗口边缘背景色同步变化。

---

### Task 6: CSS 注入与热更新

**Files:**
- Modify: `src/main/index.js`

**Interfaces:**
- Consumes: Task 3 的 `ensureCustomCss / readCombinedCss / watchCustomCss`；Task 1 的 `assets/default.css`

- [ ] **Step 1: 改 `src/main/index.js`**

1. 顶部 require 区加：

```js
const { ensureCustomCss, readCombinedCss, watchCustomCss } = require('./css-manager');
```

2. 常量区加：

```js
const DEFAULT_CSS = path.join(__dirname, '..', '..', 'assets', 'default.css');
```

3. 变量区加 `let cssKey = null;`，并新增函数：

```js
async function injectCss(customCssPath) {
  const css = readCombinedCss(DEFAULT_CSS, customCssPath);
  if (cssKey) {
    try { await contentView.webContents.removeInsertedCSS(cssKey); } catch { /* 页面已重载时 key 失效，忽略 */ }
    cssKey = null;
  }
  cssKey = await contentView.webContents.insertCSS(css, { cssOrigin: 'author' });
}
```

4. `whenReady` 中 `createWindow()` 之后加：

```js
  const customCssPath = ensureCustomCss(app.getPath('userData'), DEFAULT_CSS);
  contentView.webContents.on('dom-ready', () => { injectCss(customCssPath); });
  watchCustomCss(customCssPath, () => { injectCss(customCssPath); });
  console.log('自定义样式文件:', customCssPath);
```

- [ ] **Step 2: 手动验证**

Run: `npm start`
Expected: 页面加载后正文字体变为思源宋体/衬线字体、正文两端对齐；打开控制台输出的 `custom.css` 路径，追加一条明显规则（如 `.notion-sidebar { background: red !important; }`）保存，侧边栏无需重启立即变红；验证完删掉测试规则。

---

### Task 7: 托盘图标 + 关闭到托盘

**Files:**
- Create: `scripts/make-icon.js`
- Create: `assets/tray.png`（脚本产物）
- Modify: `src/main/index.js`

- [ ] **Step 1: 写 `scripts/make-icon.js`**（无第三方依赖的 16x16 PNG 生成器：透明底、白色方块、深灰描边，深浅任务栏均可辨认）

```js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 16;

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pixel(x, y) {
  const inRect = x >= 2 && x <= 13 && y >= 2 && y <= 13;
  if (!inRect) return [0, 0, 0, 0];
  const border = x === 2 || x === 13 || y === 2 || y === 13;
  return border ? [60, 60, 60, 255] : [255, 255, 255, 255];
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixel(x, y);
    const p = rowStart + 1 + x * 4;
    raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'tray.png');
fs.writeFileSync(out, png);
console.log('written', out, png.length, 'bytes');
```

- [ ] **Step 2: 生成图标**

Run: `node scripts/make-icon.js`
Expected: 输出 `written ... assets\tray.png`，文件存在且能被图片查看器打开。

- [ ] **Step 3: 改 `src/main/index.js`**

1. require 行加入 `Tray, Menu`：

```js
const { app, BaseWindow, WebContentsView, ipcMain, screen, nativeTheme, Tray, Menu } = require('electron');
```

2. 变量区加 `let tray = null; let isQuitting = false;`

3. `createWindow()` 内 `win.on('unmaximize', ...)` 之后加：

```js
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
```

4. `whenReady` 中 `createWindow()` 之后加：

```js
  tray = new Tray(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  tray.setToolTip('Notion Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开', click: () => win.show() },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { if (win.isVisible()) { win.hide(); } else { win.show(); } });
```

5. 文件末尾 `window-all-closed` 之前加：

```js
app.on('before-quit', () => { isQuitting = true; });
```

- [ ] **Step 4: 手动验证**

Run: `npm start`
Expected: 点标题栏关闭按钮 → 窗口隐藏、进程仍在、托盘出现图标；点托盘图标 → 窗口重新显示；右键托盘 → 「退出」后进程真正结束。

---

### Task 8: 外链拦截 + Google 登录弹窗 + 断网错误页

**Files:**
- Create: `src/renderer/error.html`
- Modify: `src/main/index.js`

**Interfaces:**
- Consumes: Task 5 的 `window.notionDesktop.retry()` 桥接与 `retry-load` 通道

- [ ] **Step 1: 写 `src/renderer/error.html`**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>加载失败</title>
  <style>
    body {
      margin: 0; height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 12px;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      background: #fff; color: #37352f;
    }
    button {
      padding: 8px 20px; border: 1px solid #d4d4d4; border-radius: 6px;
      background: #fff; cursor: pointer; font-size: 14px;
    }
    button:hover { background: #f5f5f5; }
  </style>
</head>
<body>
  <h2>无法连接到 Notion</h2>
  <p>请检查网络连接后重试。</p>
  <button id="retry">重试</button>
  <script>
    document.getElementById('retry').addEventListener('click', () => window.notionDesktop.retry());
  </script>
</body>
</html>
```

- [ ] **Step 2: 改 `src/main/index.js`**

1. require 行加入 `shell`（与 `Tray, Menu` 同一解构）。

2. `whenReady` 中加：

```js
  const ALLOWED_POPUPS = ['https://www.notion.so', 'https://notion.so', 'https://accounts.google.com'];
  contentView.webContents.setWindowOpenHandler(({ url }) => {
    if (ALLOWED_POPUPS.some((p) => url.startsWith(p))) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  contentView.webContents.on('did-fail-load', (_e, _code, _desc, validatedURL, isMainFrame) => {
    if (isMainFrame && validatedURL.startsWith('http')) {
      contentView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'error.html'));
    }
  });

  ipcMain.on('retry-load', () => { contentView.webContents.loadURL(NOTION_URL); });
```

- [ ] **Step 3: 手动验证**

Run: `npm start`
Expected: 断网启动 → 内容区显示错误页，点「重试」（恢复网络后）重新加载 notion.so；页面中的外部链接在系统浏览器打开；Google 登录弹窗可正常弹出。

---

### Task 9: electron-builder 打包

**Files:**
- Modify: `package.json`（无新增字段，Task 1 已含 `build` 配置；本任务仅验证产物）

- [ ] **Step 1: 打包**

Run: `npm run dist`
Expected: `dist/` 下产出 `Notion Desktop Setup 0.1.0.exe`（图标暂用 Electron 默认；后续可放 `build/icon.ico` 替换，≥256x256）。

- [ ] **Step 2: 安装验证**

安装产物并运行。
Expected: 功能与 `npm start` 一致（标题栏、主题跟随、CSS 注入、托盘、窗口状态记忆）；custom.css 与 window-state.json 生成在安装版的 userData 目录。

---

### Task 10: 整体冒烟清单

- [ ] `npm test`：13 个单元测试全部 PASS
- [ ] 登录 notion.so，完全退出（托盘「退出」）后重开 → 仍为登录状态（`persist:notion` 生效）
- [ ] Notion 内切换 Dark/Light → 标题栏跟随
- [ ] 修改 custom.css 保存 → 样式热更新
- [ ] 关闭到托盘 → 托盘恢复 → 托盘退出
- [ ] 调整窗口大小/位置/最大化 → 重启恢复
- [ ] 断网 → 错误页 → 恢复网络重试成功
- [ ] `npm run dist` 安装包可安装运行

---

## Self-Review 记录

- **Spec 覆盖**：主题跟随 → Task 5；CSS 注入+热更新 → Task 1/3/6；无边框标题栏 → Task 4；托盘 → Task 7；窗口状态记忆 → Task 2/4；打包 → Task 9。无遗漏。
- **占位符扫描**：无 TBD/TODO；核心逻辑均含完整代码，机械步骤含命令与预期结果。
- **类型一致性**：`loadState/saveState/isVisibleOnSomeDisplay/trackWindow`（Task 2 定义 → Task 4 消费）、`ensureCustomCss/readCombinedCss/watchCustomCss`（Task 3 定义 → Task 6 消费）、`get-theme/theme-changed/notion-theme-changed/window-*` 通道名在 preload、renderer、main 三处一致。
- **长度**：约 700 行，在预算内。
