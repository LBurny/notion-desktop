# AGENTS.md

Notion Desktop：notion.so 网页版的 Windows 桌面套壳，Electron 43（BaseWindow + 多 WebContentsView 标签）。私有仓库 LBurny/notion-desktop。

## 常用命令

```bash
npm start            # 开发模式启动
npm test             # node --test，单元测试在 tests/
npm run dist         # electron-builder 打 NSIS 安装包到 dist/（先杀掉运行中的实例，否则 EBUSY）
npm run sync-probes  # content.js 探针生成区 ← topbar-actions.js（单一事实源）
ND_PERF=1 npm start  # 输出启动/加载里程碑耗时（[perf] 行）

# 端到端验证（应用需先以 --remote-debugging-port=9222 启动并等页面就绪）
node scripts/cdp-tabs-check.js 9222 "Notion Desktop"

# 渲染层截图预览（产物在 .playwright-mcp/）
npx electron scripts/preview-menu.js [menu|style|settings|tabs]
```

## 结构

```
src/main/       主进程：index.js 只剩装配；结构归口到独立模块——
                tabs.js 视图生命周期与导航（状态机在 tab-manager.js）；
                quick-find-flow.js「新建标签」待命状态机（Quick Find 选中才开标签）；
                topbar-relay.js 顶栏动作转发/收藏回读/界面字体探测；
                theme-service.js 主题归口（宽限期/落盘/广播）；settings-windows.js
                样式/设置子窗口（关闭改隐藏缓存）；hotkey-service.js 全局快捷键；
                style-settings.js 设置清洗+CSS 生成；system-fonts.js 注册表字体枚举；
                request-filter.js 遥测/广告域名黑名单拦截（persist:notion 会话）；
                css-manager.js 合并 CSS 缓存；perf.js 里程碑观测；debounce.js 防抖
src/preload/    contextBridge 桥：content.js（Notion 页，探针区为生成块）、
                titlebar.js、settings.js、tray-menu.js
src/renderer/   titlebar / tray-menu / style-settings / app-settings 四个渲染页 + error.html；
                shared/base-win.css 子窗口共享基础样式（主题变量/圆角结构/表单行/分区/滚动）
assets/         default.css 注入样式；icon.ico/icon.png/tray.png 由
                scripts/render-icon.js 从 build/icon.svg 离屏渲染（ico 内嵌 16–256 七档，
                Windows 按 DPI 自选尺寸，高分屏任务栏/Alt-Tab 不糊；tray.png 32px 同理）
tests/          node:test 单测（新逻辑先写测试）
scripts/        CDP 调试/端到端/截图脚本 + build-preload-probes.js（探针生成器）
```

用户数据在 `%APPDATA%/notion-desktop/`（style-settings.json、tabs.json、custom.css、window-state.json）。

## 约定与坑

- **IPC**：频道名 kebab-case；同步读取走 sendSync（`get-style-settings`/`get-theme`/`system-fonts`/`system-locale`），修改走 invoke/handle（`style-settings-update`），广播用 `xxx-changed`。
- **中文 Windows 编码**：`reg query` 等外部命令输出是 GBK，必须 `TextDecoder('gbk')` 解码，直接 utf8 会乱码。终端日志里的乱码只是显示问题，判断结果看 PASS/FAIL。
- **button 不继承字体**：`<button>` 用 UA 控件字体，需显式 `button { font-family: inherit; }` 才能跟随 body。
- **顶栏按钮懒挂载坑（实测）**：Notion 的开/收侧栏等顶栏按钮在冷加载/标签激活后异步挂载（骨架先出、按钮后到，窗口期实测秒级以上），盲发 `el.click()` 会静默落空（典型症状：☰ 能展开却收不回）。☰ 走 `createSidebarToggleRunner`：按 `.notion-sidebar` 实测 x 选方向 + 点击后轮询状态翻转、未翻则退避重试（约 9s 窗口），gen 闸口防连按互踩；主进程 `topbar-click` 只发动作名，选择器表由 preload 探针区解析（TOPBAR_ACTIONS 也随探针生成进 content.js）。e2e 看护：scripts/cdp-sidebar-check.js（覆盖温热路径与冷激活立即连按路径）。
- **Notion 页面行为**：Ctrl+K 是开关（重发前先查 `[role="dialog"] input` 是否已存在）；"Open in desktop app?" 推广条也是 role=dialog 会吞掉注入按键；侧栏开关状态看 `.notion-sidebar` 的 x 坐标（-250 收起 / 0 展开），宽度恒为 270。注入按键在 Notion JS 就绪前会丢失，需带自检的重试。
- **渲染层共享逻辑**（font-detect.js、tab-drag.js 等）用 UMD 双导出，浏览器挂 window、Node 走 module.exports 以便测试。
- **Quick Find 选中后关浮层三坑（均实测）**：① Notion 只在 keydown 目标位于浮层内部时才响应 Escape（焦点在 body 上连可信 Escape 都不关），选中拦截时 preload 必须先把 DOM 焦点放回输入框（content.js refocusDialogInput）；② 视图被 removeChildView 摘除后注入的按键会被丢弃，同 tick 先注入再摘除也丢（队列未来得及处理），需要 Escape 处理完才能摘除——quick-find-flow.js 用探针轮询浮层关闭即走（快于旧固定 150ms），探针不通退回 150ms 兜底，绝不裸 setTimeout 直接摘；③ trigger 的重试阶梯（0~8s）在待命解除（选中/取消/切标签）后必须停轮（armedRec 闸口），否则把刚关掉的浮层重新打开。e2e 断言浮层关闭要查 `[role="dialog"] input`，裸 `[role="dialog"]` 会误中推广条；`/json` 里 notion 目标要排除 sw.js（service worker）。
- **`webContents.sendInputEvent` 致命坑（Electron 43.4.1）**：任何 key 的 sendInputEvent 都会卡死主进程（最小复现已验证）。注入文本用 `wc.insertText`；注入按键用 PowerShell SendKeys（见 src/main/slash-commands.js 的 sendEnterKey）。Notion 的菜单忽略 JS 派发的非可信 keydown。
- **合成 KeyboardEvent 对 Notion 无效（实测）**：JS dispatch 的 keydown/keyup 是不可信事件，Quick Find（Ctrl+K）与浮层 Escape 均不响应；唤键必须走真实输入管线（sendInputEvent / SendKeys）。
- **`executeJavaScript` 延迟坑（Electron 43.4.1，实测）**：主进程 → 页面 executeJavaScript 往返约 140ms（同页面 CDP Runtime.evaluate 仅约 1ms）。延迟敏感的页面交互（顶栏点击、收藏状态、Quick Find 浮层检查、界面字体探测）一律走 preload 探针：`wc.send` + preload 隔离世界同步读 DOM + ipcRenderer 回复，往返约 1ms（tabs.js 的 queryWc + content.js 探针区）。沙箱 preload 无法 require 本地模块，content.js 探针由 `scripts/build-preload-probes.js` 从 topbar-actions.js 生成（标记区间 `[probes:generated begin/end]`）；改探针函数后必须 `npm run sync-probes`，tests/probe-sync.test.js 校验新鲜度（stale 时 CI/测试直接失败）。
- **设置子窗口随页面缩放**：样式/设置窗的宽高都要按 `settingsWindowSize(基准宽, 基准高, zoom, 工作区上限)` 等比放大并 setZoomFactor（只放高度会横向裁剪），打开时和 `applyZoomEverywhere` 里都要同步。configs 里每个 kind 可单独定 width/height（index.js：样式/设置同宽 400 统一回落 baseWidth；高度样式 585=表单 10 行+3 分区头+hint、设置 595=5 分区含启动/语言），未给定宽时回落统一 baseWidth。#form 统一可滚动兜底（shared/base-win.css），新增表单行不必再调基准高度。窗口关闭是**隐藏缓存**（settings-windows.js 拦截 close + hide），重开即显；应用退出（isQuitting）才真正销毁。窗口为 `transparent: true`（不再设 backgroundColor），圆角 4px 与托盘菜单同款。**圆角坑（CSS 背景传播，实测）**：body 的不透明背景会传播到根画布按整窗矩形绘制，把 body 自己的 border-radius 顶掉（四角仍不透明）——所以两页 body 保持 transparent，背景+圆角+overflow:hidden 裁剪放在 `#win` 内层容器（同托盘菜单 #menu 结构），tests/ui-css.test.js 有回归断言。
- **标题栏随页面缩放**：标题栏是独立 WebContentsView，setZoomFactor 与高度（`titlebarHeightForZoom(36, zoom)`）都要同步，否则内容被 36px 固定 bounds 裁剪。标题栏字体跟随的是**页面探测到的界面计算 font-family**（probe 自 `.notion-sidebar`/`.notion-topbar`，即 fonts.ui 效果），不是设置字段——用户字体可能在 custom.css 里；分区改装后标题栏属界面（页签/Share 按钮都是界面），不跟随正文字体。
- **按键注入相关**：`before-input-event` 的 `input.code` 依赖 scancode，SendKeys/远程桌面合成的事件 code 为空，需用 `input.key` 兜底（slash-commands.js 的 KEY_FALLBACK）。Ctrl+Shift+R 是 Chromium 保留键（强制刷新），事件根本到不了 before-input-event，别用作快捷键默认。e2e 里 CDP `Input.dispatchKeyEvent` 触发 before-input-event 的 preventDefault 会卡死 devtools 端点，按键触发一律用真实 SendKeys（cdp-tabs-check.js / cdp-slash-check.js 的 sendKeys），CDP 只做只读断言。Node 的 fetch/http 会卡死 Electron devtools HTTP 服务，`/json` 列表一律 `curl -s -m 8`。
- **悬停 peek 侧栏**：触发区是 `.notion-topbar` 里的 `.notion-open-sidebar` 按钮（页面坐标约 (12,10)）。我们把 topbar 压成 0 高 + `pointer-events:none` 后，必须 `overflow:visible`（0 高 + hidden 会裁剪子元素命中区）并给触发按钮显式 `pointer-events:auto`，否则原生 peek 失灵。该规则同时写进 buildSettingsCss 兜底（custom.css 注入在 default.css 之后，旧副本会覆盖修复）。
- **分区字体选择器必须镜像旧全集（实测根因）**：users 的 custom.css 是旧版 default.css 的副本（排在 default.css 与设置 CSS 之后）。正文文字叶节点由 `[contenteditable="true"]:first-of-type` 这类 **(0,2,0)** 规则命中，而 `.notion-page-content *` 只有 (0,1,0)（`*` 不贡献特异性）——设置字体规则压不过旧副本，表现是「改正文字体只有目录/条目编号等容器变了，真正文字没变」（cdp-fonts-check 带真实叶节点断言防此类假绿）。所以 style-settings.js 的 BODY_SELECTORS/UI_SELECTORS 必须镜像旧版 default.css 全局字体表的完整选择器（同特异性 + 设置 CSS 最后注入 → 稳定覆盖）；想简化选择器前先看这条。**代码块/公式正文同款坑**：代码正文与行内公式都在 `div[contenteditable="true"]` 内，被正文 `.notion-page-block div[contenteditable="true"] *` **(0,2,1)** 压过——`CODE_SELECTORS`/`MATH_SELECTORS` 若只到 `.notion-code-block *` (0,1,0) 或 `.notion-code-block code` (0,1,1)，代码体/行内公式会落到正文字体（仅语言标签等非 contenteditable 部分生效）。`CODE_SELECTORS` 需镜像 `.notion-code-block div[contenteditable="true"] *` (0,2,1)，同特异性 + 设置 CSS 后注入者赢；`MATH_SELECTORS` 行内同理用 `.katex:not(.katex-display .katex)` 高特异性覆盖。cdp-fonts-check 的代码探针只造 `.notion-code-block > code`（无 contenteditable 包裹），测不出此坑，改代码/公式选择器后须人工验真实代码体。
- **视图加载底色防白闪**：WebContentsView 默认白底，深色主题下新标签/刷新会闪白。**Electron 43 的 WebContentsView 构造选项没有 backgroundColor，传了会被静默忽略**（构造项只有 webPreferences/webContents），必须建实例后调继承自 View 的 `view.setBackgroundColor(themeBackground(getTheme()))`（tab-manager.js 的纯函数）；主题切换时对所有已建视图 `setViewsBackground`。CDP 截图抓的是页面文档（已被 CSS 染深），看不到视图底色层的白闪，验证白闪要看真实屏幕。
- **后台标签防节流**：标签 WebContentsView 的 webPreferences 带 `backgroundThrottling: false`——后台标签不被 Chromium 节流，切回无重绘顿挫；代价是后台 Notion 定时器持续运行（最多 10 标签，实测可接受）。跟页面缩放一样，标签视图职责在 tabs.js 的 ensureView。
- **性能相关约定**：缩放快捷键（每 1%）落盘走 debounce.js 防抖（应用缩放本身即时）；合并 CSS 在 css-manager.js 的 createCssProvider 缓存，custom.css 由 watcher 失效；标签切换后顶栏状态走 topbar-relay.js 的 pushNow（探针约 1ms，不等防抖窗口），导航事件才走 schedulePush 防抖合并。启动耗时量化用 `ND_PERF=1`。
- **遥测/广告域名拦截（request-filter.js）**：Notion 页面内嵌的第三方遥测/营销域名（splunkcloud、gist.build、doubleclick、twitter 广告像素等 8 个）在国内网络下单请求挂起 1~10s，实测把 load 事件拖到 22~27s；会话级拦截后冷启动 load 收敛到 ~4s。清单只收**实测拖慢**的纯遥测/广告域，禁止加入 notion.so / app.notion.com 任何子域（aif/exp/identity 等功能域保留）；新增条目须先用 scripts/cdp-host-timing.js 拿到实测依据。
- **子页面设计规范**：新增设置类子页面照现有两页模板——HTML 用 `#win`（背景/圆角/裁剪）+ `#titlebar` + `#form` 结构，先引 `../shared/base-win.css` 再引页面 `style.css`（页面文件只放特有控件，禁止把共享规则复制回页面，tests/ui-css.test.js 有防回潮断言）；表单行 `.row` + `.name`（标签列 92px、控件高 28px、行距 12px），分组用 `.section`（首区 `.first` 无分隔线），多选一用 `.segmented` 分段控件（共享）；UA 原生控件（number 调节钮/滚动条）明暗靠主题块的 `color-scheme`（缺了暗色下 spinner 是白底）；原生弹层控件（select/datalist）不跟主题必须自绘（参照字体下拉）。**文案一律走 i18n**：静态文本/占位符/tooltip 在元素上标 `data-i18n` / `data-i18n-placeholder` / `data-i18n-title`，JS 动态文案用 `window.i18n.t(lang, key)`；字典在 `shared/i18n.js`（UMD），新增 key 中英两条同步加（tests/i18n.test.js 校验 key 集一致）；新渲染页引 `../shared/i18n.js`，语言解析 `resolveLanguage(settings.language, systemLocale())`（auto 时非 zh 系统一律英文），语言切换走 `language-changed` 广播即时重渲染（标题栏随 style-changed 的设置自行解析）。**渲染页共享设置快照的坑**：onLanguage 里必须重新 `settingsApi.get()` 刷新本地 settings，否则另一窗口改过的字段会被本窗之后的 commit 写回旧值。
- **开机静默启动（login-item.js）**：`syncLoginItem(app, enabled)` 写注册表 Run 键（带 `--silent-start` 参数，仅 `app.isPackaged` 时执行，开发态不污染）；`shouldStartHidden` = wasOpenedAtLogin 或 argv 含标记（双保险），为真则 createWindow `show:false` 不弹主窗（托盘/全局快捷键照常）。设置页「启动」分区勾选即存 `launchAtLogin` 并在 `style-settings-update` 里同步登录项。
- **托盘菜单动作分派在 tray-actions.js（纯函数）**：`open` 才 `win.show()`；style/settings 只开子窗口——主窗最小化到托盘时不连带唤醒（曾无条件 `win.show()`，开设置就弹主窗）；分派表由 tests/tray-actions.test.js 看护。
- **公式默认字体优先 Times New Roman**：`pickMathDefaultFont`（font-detect.js）优先返回已装的 Times New Roman（Windows 几乎必装，与正文拉丁字体一致）；未装才回落 Modern 系模糊匹配——名字含 `modern` 才入候选，`math` 仅系内加权（只看 math 会被 Windows 必装的 Cambria Math 抢位，实测坑，占位符曾显示"默认：Cambria Math"）；Times New Roman 与 Modern 系都没装才完全交给 default.css 的 KaTeX_Main。`buildSettingsCss` 第二参数传已装字体表（index.js `getSystemFontsCached` 共享注册表枚举缓存）；用户填入的字体名只 `cleanFontName` 一次（再经 customFontChain 二次 trim 会改变清洗结果）；回退栈 `MATH_FONT_FALLBACKS` 与已选字体 `normalizeFontName` 去重，避免默认 Times New Roman 在链中重复。**行内公式选择器**：`MATH_SELECTORS` 里 `.notion-text-block .katex:not(.katex-display .katex)` (0,4,0) 复用 default.css 同特异性 `:not` 选择器压过 custom.css 旧副本；通用 `.katex:not(.katex-display .katex)` (0,3,0) 覆盖标题/列表/引用/Callout 等其它块里的行内公式（这些块无 custom.css 公式规则，只需压过正文 (0,2,0)）——只覆盖 `.notion-text-block` 会导致非段落块的行内公式落到正文字体。
- **主题探测与持久化**：Notion 账户主题要等 JS 就绪后才打 dark class，启动早期探测恒为 light——持久化（theme.json，theme-store.js）优先于 `nativeTheme.shouldUseDarkColors`（混合模式系统拿到的是浅色）；启动 15s 宽限期内忽略与持久化 dark 冲突的 light 上报，否则 theme.json 被假象污染。加载期白闪双保险：视图 `backgroundColor` + content.js 的 document-start 早期 `<style>html{background:#191919}`（sendSync get-theme 取值，主题反转时摘除）。
- **不要提交**：dist/、node_modules/、.playwright-mcp/、docs/superpowers/（均已 gitignore）。

## GitHub 与发布

- 本机直连 GitHub 有 DNS 污染/TLS 拦截；仓库已配 `http.proxy=http://127.0.0.1:7890`（本地 Clash）。API 调用用 `curl --proxy http://127.0.0.1:7890`。
- 推送用每命令级 Basic 头，token 只在 `$GH_TOKEN` 环境变量，**绝不写进 git 配置/远程 URL/文件**：
  `B64=$(echo -n "x-access-token:$GH_TOKEN" | base64 -w0); git -c http.extraheader="Authorization: Basic $B64" push origin main`
- 推送后必须 `ls-remote` 验证（拦截连接会谎报 "Everything up-to-date"）。
- **发布流程**：package.json 升版本 → `npm run dist` → 写 `docs/releases/vX.Y.Z.zh-CN.md`（中文说明）→ commit + tag + push → API 建 release → 上传 `dist/Notion Desktop Setup X.Y.Z.exe` → 清理临时文件（如 release-body.json）。
- **发行版命名规范**：release 标题用 `Notion Desktop vX.Y.Z`（带产品名，不是裸 `vX.Y.Z`）；附件名 `Notion.Desktop.Setup.X.Y.Z.exe`（点分、无空格、不带 v）。
- **release 说明中英文结构**：正文仅英文，首行 `English | [中文说明](https://github.com/LBurny/notion-desktop/blob/main/docs/releases/vX.Y.Z.zh-CN.md)`；中文全文放 docs/releases/vX.Y.Z.zh-CN.md（对应文件首行反向链接 release 页）。不要把中文段落直接塞进 release 正文。

## 文档

- README.md 仅英文；中文说明在 docs/README.zh-CN.md。改 README 时两边同步。
- docs/superpowers/plans/ 有设计与排障记录（仅本地，不入库），改标签/Quick Find/标题栏相关逻辑前值得一读。
