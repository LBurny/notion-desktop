# 顶栏一体化（单行控制条）实施计划

> **For agentic workers:** Implement this plan in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Notion 网页自带的第二行顶栏（☰ / 面包屑 / Share / ☆ / ⋯）合并进 36px 自定义标题栏，形成单行控制条：`☰ | 标签… + | 拖拽区 | Share ☆ ⋯ | — ▢ ✕`。

**Architecture:** 标题栏与 Notion 页面是两个独立的 web contents，无法真正拼接。采用「视觉隐藏 + 点击转发」：向页面注入 CSS 把 `.notion-topbar` 高度压为 0（保留布局，弹出的菜单锚点仍在内容区顶部，位置自然）；标题栏右侧新增 Share/☆/⋯ 按钮、最左新增 ☰，点击经 IPC 在主进程对活动视图 `executeJavaScript` 点击页面里对应的隐藏按钮，功能零重写。☆ 收藏状态从页面回读（`aria-pressed`）推送到标题栏。

**Tech Stack:** Electron 43（BaseWindow + WebContentsView）、`node --test` 单测、CDP e2e（`--remote-debugging-port=9222`）、electron-builder 打包。

## Global Constraints

- 标题栏高度保持 `TITLEBAR_HEIGHT = 36`（`src/main/index.js:12`），不改动 `layout()`/`layoutViews()` 的几何。
- 已有坑勿回退：改代码后必须重新 `npm run dist` 再验证；打包/启动前 `taskkill //F //IM "Notion Desktop.exe"`。
- 选择器不得依赖按钮文本（Notion UI 语言随账号变化），只用 class/role/aria。
- CSS 注入改动放 `assets/default.css`（`readCombinedCss` 总会读取，老用户的 `custom.css` 不受影响，无需迁移）。
- 单测框架 `node --test`；渲染层可测模块用 UMD 模式（参照 `src/renderer/titlebar/tab-drag.js`）。
- 验证流程：`node --test` → `taskkill` → `npm run dist` → `dist/win-unpacked` 启动带 9222 → e2e 全 PASS。

---

### Task 1: Notion 顶栏 DOM 侦察

选择器常量必须来自真实页面，先跑侦察脚本确认。

**Files:**
- Create: `scripts/cdp-topbar-scan.js`

**Interfaces:**
- Produces: 控制台打印 + `.playwright-mcp/topbar-scan.json`，内容为 topbar 内全部可点元素的 `{ selector, ariaLabel, role, text, rect }`，人工据此敲定 Task 2 的选择器常量。

- [x] **Step 1: 写侦察脚本**

参照 `scripts/cdp-probe.js` 的 CDP 连接骨架，evaluate 以下表达式：

```js
JSON.stringify((() => {
  const bar = document.querySelector('.notion-topbar');
  if (!bar) return { found: false };
  const items = [...bar.querySelectorAll('[role="button"], button, a')].map((el) => ({
    cls: el.className && String(el.className).slice(0, 120),
    ariaLabel: el.getAttribute('aria-label'),
    role: el.getAttribute('role'),
    text: (el.textContent || '').trim().slice(0, 30),
    rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
  }));
  return { found: true, barRect: bar.getBoundingClientRect().toJSON(), count: items.length, items };
})(), null, 1)
```

- [x] **Step 2: 启动应用并跑脚本**

```bash
taskkill //F //IM "Notion Desktop.exe" 2>/dev/null; "dist/win-unpacked/Notion Desktop.exe" --remote-debugging-port=9222 &
sleep 14
node scripts/cdp-topbar-scan.js 9222
```

预期：JSON 里能区分出侧栏开关、Share、收藏、更多四类按钮，记录它们的稳定 class（历史候选：`.notion-topbar-share-menu`、`.notion-topbar-favorite-button`、`.notion-topbar-more-button`，以实际为准）。若候选 class 不存在，改从 `aria-label`/`role`/结构位置提取稳定选择器，并写入 Task 2 常量。

> **侦察结果（已执行）**：四个稳定 class 全部命中——`.notion-open-sidebar` / `.notion-topbar-share-menu` / `.notion-topbar-favorite-button` / `.notion-topbar-more-button`，均带 `role=button`。收藏状态无 `aria-pressed`，信号为按钮内 `svg.starFill`（已收藏）/ `svg.star`（未收藏），语言无关；点击收藏按钮直接切换无菜单。补充侦察脚本：`scripts/cdp-topbar-tree2.js`、`scripts/cdp-favorite-probe.js`。

---

### Task 2: 顶栏动作模块 `src/main/topbar-actions.js`（TDD）

纯逻辑 UMD 模块：选择器常量表 + 页面内寻钮函数 + 生成 `executeJavaScript` 脚本串。页面内函数必须自包含（不引用模块作用域），因为要 `.toString()` 注入页面执行。

**Files:**
- Create: `src/main/topbar-actions.js`
- Test: `tests/topbar-actions.test.js`

**Interfaces:**
- Produces:
  - `TOPBAR_ACTIONS`：`{ sidebar|share|favorite|more: { selectors: string[] } }`（选择器按优先级排列，Task 1 敲定）
  - `pickTopbarButton(root, selectors)` → 第一个命中的元素或 `null`（注入页面用）
  - `buildClickScript(action)` → JS 字符串，页面内执行：找到即 `el.click()` 返回 `true`，否则 `false`
  - `buildFavoriteStateScript()` → JS 字符串，返回 `true`/`false`/`null`（按钮不存在）
- Consumes: 无（被 Task 5 的 `tabs.js` 引用）

- [x] **Step 1: 写失败测试 `tests/topbar-actions.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');
const { TOPBAR_ACTIONS, pickTopbarButton, buildClickScript, buildFavoriteStateScript } = require('../src/main/topbar-actions');

// 极简 DOM stub：按选择器表命中预设元素
function stubDoc(map) {
  return { querySelector: (sel) => map[sel] || null };
}

test('四个动作都有非空选择器表', () => {
  for (const k of ['sidebar', 'share', 'favorite', 'more']) {
    assert.ok(Array.isArray(TOPBAR_ACTIONS[k].selectors) && TOPBAR_ACTIONS[k].selectors.length > 0, k);
  }
});

test('pickTopbarButton 按优先级返回第一个命中', () => {
  const a = {}, b = {};
  const doc = stubDoc({ '.b': b });
  assert.strictEqual(pickTopbarButton(doc, ['.a', '.b']), b);
  assert.strictEqual(pickTopbarButton(stubDoc({ '.a': a, '.b': b }), ['.a', '.b']), a);
  assert.strictEqual(pickTopbarButton(stubDoc({}), ['.a']), null);
});

test('buildClickScript 命中时点击并返回 true，未命中返回 false', () => {
  let clicked = 0;
  const el = { click: () => { clicked++; } };
  const script = buildClickScript('share');
  const run = new Function('document', `return ${script}`);
  assert.strictEqual(run(stubDoc({ [TOPBAR_ACTIONS.share.selectors[0]]: el })), true);
  assert.strictEqual(clicked, 1);
  assert.strictEqual(run(stubDoc({})), false);
});

test('buildClickScript 对未知动作抛错', () => {
  assert.throws(() => buildClickScript('nope'));
});

test('buildFavoriteStateScript 读 aria-pressed，缺失返回 null', () => {
  const script = buildFavoriteStateScript();
  const run = new Function('document', `return ${script}`);
  const on = { getAttribute: (k) => (k === 'aria-pressed' ? 'true' : null) };
  const off = { getAttribute: () => 'false' };
  const none = { getAttribute: () => null };
  const key = TOPBAR_ACTIONS.favorite.selectors[0];
  assert.strictEqual(run(stubDoc({ [key]: on })), true);
  assert.strictEqual(run(stubDoc({ [key]: off })), false);
  assert.strictEqual(run(stubDoc({ [key]: none })), null);
  assert.strictEqual(run(stubDoc({})), null);
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `node --test tests/topbar-actions.test.js`
Expected: FAIL（`Cannot find module '../src/main/topbar-actions'`）

- [x] **Step 3: 实现 `src/main/topbar-actions.js`**

```js
// Notion 顶栏动作：选择器常量 + 页面内寻钮/读态脚本生成
// 选择器由 scripts/cdp-topbar-scan.js 侦察敲定，按优先级排列；Notion 改版时只需改这张表
const TOPBAR_ACTIONS = {
  sidebar:  { selectors: ['.notion-topbar-sidebar-toggle-button', /* Task 1 补充 */] },
  share:    { selectors: ['.notion-topbar-share-menu',           /* Task 1 补充 */] },
  favorite: { selectors: ['.notion-topbar-favorite-button',      /* Task 1 补充 */] },
  more:     { selectors: ['.notion-topbar-more-button',          /* Task 1 补充 */] },
};

// 注入页面执行，必须自包含（不得引用模块作用域）
function pickTopbarButton(root, selectors) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function buildClickScript(action) {
  const cfg = TOPBAR_ACTIONS[action];
  if (!cfg) throw new Error('unknown topbar action: ' + action);
  return `(() => {
    const el = (${pickTopbarButton.toString()})(document, ${JSON.stringify(cfg.selectors)});
    if (!el) return false;
    el.click();
    return true;
  })()`;
}

function buildFavoriteStateScript() {
  const sels = JSON.stringify(TOPBAR_ACTIONS.favorite.selectors);
  return `(() => {
    const el = (${pickTopbarButton.toString()})(document, ${sels});
    if (!el) return null;
    const pressed = el.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
    return null;
  })()`;
}

module.exports = { TOPBAR_ACTIONS, pickTopbarButton, buildClickScript, buildFavoriteStateScript };
```

（Task 1 若发现 aria-pressed 不存在，改为读 `aria-checked` 或 class 正则，并同步改测试。）

- [x] **Step 4: 跑测试确认通过**

Run: `node --test tests/topbar-actions.test.js`
Expected: PASS 5/5

---

### Task 3: CSS 隐藏 Notion 顶栏

**Files:**
- Modify: `assets/default.css`（追加段落）

**Interfaces:**
- Consumes: Task 1 确认的 `.notion-topbar` 容器选择器
- Produces: 页面顶部不再出现第二行；Notion 弹菜单锚点仍在内容区顶部

- [x] **Step 1: `assets/default.css` 末尾追加**

```css
/* ========== 顶栏一体化：隐藏 Notion 自带顶栏（功能由自定义标题栏接管） ========== */
/* 压成 0 高但保留布局与可脚本点击：display:none 会让弹菜单锚点丢失，勿用 */
.notion-topbar {
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important; /* 不挡内容区首行 hover/点击，脚本 .click() 不受影响 */
}
```

- [x] **Step 2: 手动验证**

`npm start` 启动（dev 直接读 src），确认：第二行消失、页面内容整体上移一行、Quick Find（Ctrl+T 流程）与侧栏开合正常。用 CDP 复核 `document.querySelector('.notion-topbar').getBoundingClientRect().height === 0`。

---

### Task 4: 标题栏 UI（☰ + Share/☆/⋯）

**Files:**
- Modify: `src/renderer/titlebar/index.html`
- Modify: `src/renderer/titlebar/style.css`
- Modify: `src/renderer/titlebar/titlebar.js`
- Modify: `src/preload/titlebar.js`

**Interfaces:**
- Produces（preload 新 API，Task 5 主进程对接）:
  - `topbarApi.act(action)` → `ipcRenderer.send('topbar-action', action)`，action ∈ `sidebar|share|favorite|more`
  - `topbarApi.onState(cb)` → 监听 `topbar-state`，载荷 `{ available: boolean, favorited: boolean|null }`
- Consumes: 无（不依赖 Task 5 也能编译，主进程未接线时按钮点击无效果）

- [x] **Step 1: `index.html` 结构调整**

```html
<body>
  <button id="sidebar-toggle" class="topbar-btn" title="打开侧边栏">&#9776;</button>
  <div id="tabs"></div>
  <button id="new-tab" title="新建标签页 (Ctrl+T)">&#43;</button>
  <div id="drag-region"></div>
  <div id="topbar-actions">
    <button id="tb-share" class="topbar-btn" title="分享">Share</button>
    <button id="tb-favorite" class="topbar-btn" title="收藏">&#9734;</button>
    <button id="tb-more" class="topbar-btn" title="更多">&#8943;</button>
  </div>
  <div id="controls"> …原有三个按钮… </div>
</body>
```

- [x] **Step 2: `style.css` 追加**

```css
#sidebar-toggle { flex: none; width: 36px; }
#topbar-actions { display: flex; align-items: stretch; }
.topbar-btn {
  -webkit-app-region: no-drag;
  min-width: 34px; padding: 0 8px; border: 0; background: transparent;
  color: var(--fg); font-size: 13px;
}
.topbar-btn:hover { background: var(--hover); }
#tb-favorite { font-size: 16px; }
#tb-favorite.favorited { color: #e8a13a; } /* 实心星着色 */
#topbar-actions.hidden { display: none; } /* 错误页等非 Notion 页面时隐藏 */
```

标签截断已由 `.tab .tab-title { text-overflow: ellipsis }` 保证，无需改动；空间不足时 `.tab` 现有 `flex: 0 1 180px; min-width: 72px` 先压缩，动作区与窗口控制固定。

- [x] **Step 3: `titlebar.js` 接线**

```js
// 顶栏动作转发 + 状态渲染
document.getElementById('sidebar-toggle').addEventListener('click', () => window.topbarApi.act('sidebar'));
document.getElementById('tb-share').addEventListener('click', () => window.topbarApi.act('share'));
document.getElementById('tb-more').addEventListener('click', () => window.topbarApi.act('more'));

const favBtn = document.getElementById('tb-favorite');
favBtn.addEventListener('click', () => window.topbarApi.act('favorite'));

window.topbarApi.onState(({ available, favorited }) => {
  document.getElementById('sidebar-toggle').style.display = available ? '' : 'none';
  document.getElementById('topbar-actions').classList.toggle('hidden', !available);
  favBtn.classList.toggle('favorited', favorited === true);
  favBtn.innerHTML = favorited === true ? '&#9733;' : '&#9734;'; // ★/☆
});
```

- [x] **Step 4: `preload/titlebar.js` 追加**

```js
contextBridge.exposeInMainWorld('topbarApi', {
  act: (action) => ipcRenderer.send('topbar-action', action),
  onState: (cb) => ipcRenderer.on('topbar-state', (_e, s) => cb(s)),
});
```

---

### Task 5: 主进程接线与 ☆ 状态同步

**Files:**
- Modify: `src/main/tabs.js`（createTabs 增加动作转发与状态回读）
- Modify: `src/main/index.js`（IPC 接线 + 状态转发标题栏）
- Test: `tests/topbar-actions.test.js` 已覆盖纯逻辑；此处为 Electron 胶水层，走 e2e 验证

**Interfaces:**
- Consumes: Task 2 的 `buildClickScript` / `buildFavoriteStateScript`；deps 新增 `onTopbarState(payload)` 回调（payload `{ available, favorited }`）
- Produces: `tabs.topbarAction(action)`；状态推送时机：切标签、导航、点击 favorite 后

- [x] **Step 1: `tabs.js` 增加动作转发**

```js
const { buildClickScript, buildFavoriteStateScript } = require('./topbar-actions');

// createTabs 内：
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
```

deps 解构加 `onTopbarState`；`onNav()` 与 `attachActive()` 末尾各加 `pushTopbarState()`；return 对象加 `topbarAction`。

- [x] **Step 2: `index.js` 接线**

```js
// createTabs deps 增加：
onTopbarState: (s) => {
  if (titlebarView && !titlebarView.webContents.isDestroyed()) {
    titlebarView.webContents.send('topbar-state', s);
  }
},
// IPC 区增加（白名单校验，防非法 action 触发 buildClickScript 抛错）：
ipcMain.on('topbar-action', (_e, action) => {
  if (!/^(sidebar|share|favorite|more)$/.test(action)) return;
  tabs.topbarAction(action);
});
// titlebar did-finish-load 补发初始状态处加：
tabs.topbarAction && titlebarView.webContents.send('topbar-state', { available: true, favorited: null });
```

（初始补发用保守值，真正的首次 `pushTopbarState` 在首个 `onNav` 时触发。）

- [x] **Step 3: 全量单测回归**

Run: `node --test`
Expected: 既有 63 + 新增 5 = 68 PASS

---

### Task 6: e2e 验证 + 打包

**Files:**
- Create: `scripts/cdp-topbar-check.js`

**Interfaces:**
- Consumes: 打包产物 `dist/win-unpacked/Notion Desktop.exe --remote-debugging-port=9222`
- Produces: 退出码 0 = 全 PASS

- [x] **Step 1: 写 e2e 脚本**，连接 CDP 后断言：

  1. 页面目标（notion.so）：`.notion-topbar` 的 `getBoundingClientRect().height === 0`
  2. 标题栏目标（`src/renderer/titlebar/index.html`）：存在 `#sidebar-toggle`、`#tb-share`、`#tb-favorite`、`#tb-more`，且顺序在 `#controls` 之前
  3. 对标题栏目标执行 `document.getElementById('tb-more').click()`，500ms 后在页面目标断言出现 `[role="menu"], .notion-overlay-container [role="dialog"]`（更多菜单弹出）；随后 `Escape` 关闭
  4. 点击 `#tb-share`，断言页面出现 `[role="dialog"]`；`Escape` 关闭
  5. 点击 `#tb-favorite`，1s 后标题栏 `#tb-favorite` 的 class 含/不含 `favorited` 与页面 `aria-pressed` 一致；再点一次还原（不留测试痕迹）

  （参照 `scripts/cdp-tabs-check.js` 的多目标连接与重试写法；点击类断言每步最多重试 3 次。）

- [x] **Step 2: 打包并跑 e2e**

```bash
node --test                                        # 68 PASS
taskkill //F //IM "Notion Desktop.exe"
npm run dist
"dist/win-unpacked/Notion Desktop.exe" --remote-debugging-port=9222 &
sleep 14
node scripts/cdp-topbar-check.js 9222
```

Expected: e2e 全 PASS

- [x] **Step 3: 人工走查**

单行控制条观感：标签截断、+ 号、拖拽区可拖窗、Share/☆/⋯ 点击出真实 Notion 菜单、窗口三键正常、最大化/还原、窄窗（640px 最小宽）不溢出。

---

## 风险与回退

| 风险 | 应对 |
|---|---|
| Notion 改版致选择器失效 | 选择器集中在 `topbar-actions.js` 一张表，按钮点击静默无效果（不崩）；重跑 Task 1 侦察脚本更新常量即可 |
| `aria-pressed` 不存在导致 ☆ 状态失真 | Task 1 侦察时确认；备选 `aria-checked`/class 正则；最差退化为纯按钮（`favorited` 恒 null，UI 不显实心） |
| 隐藏 topbar 后弹菜单锚点错位 | 已用「0 高 + 保留布局」而非 `display:none`；Task 6 步骤 3/4 实测菜单出现位置可接受 |
| 老用户 custom.css 覆盖了相关规则 | `default.css` 先读、`custom.css` 后读，用户自定义仍可覆盖，属预期行为 |

**回退**：删除 `assets/default.css` 追加段 + 标题栏三个文件的新增元素即恢复两行布局，`topbar-actions.js` 成为死代码无副作用。
