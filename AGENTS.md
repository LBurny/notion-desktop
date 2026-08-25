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
                topbar-relay.js 顶栏动作转发/收藏回读/页面字体探测；
                theme-service.js 主题归口（宽限期/落盘/广播）；settings-windows.js
                样式/设置子窗口（关闭改隐藏缓存）；hotkey-service.js 全局快捷键；
                style-settings.js 设置清洗+CSS 生成；system-fonts.js 注册表字体枚举；
                css-manager.js 合并 CSS 缓存；perf.js 里程碑观测；debounce.js 防抖
src/preload/    contextBridge 桥：content.js（Notion 页，探针区为生成块）、
                titlebar.js、settings.js、tray-menu.js
src/renderer/   titlebar / tray-menu / style-settings / app-settings 四个渲染页 + error.html
assets/         default.css 注入样式与图标
tests/          node:test 单测（新逻辑先写测试）
scripts/        CDP 调试/端到端/截图脚本 + build-preload-probes.js（探针生成器）
```

用户数据在 `%APPDATA%/notion-desktop/`（style-settings.json、tabs.json、custom.css、window-state.json）。

## 约定与坑

- **IPC**：频道名 kebab-case；同步读取走 sendSync（`get-style-settings`/`get-theme`/`system-fonts`），修改走 invoke/handle（`style-settings-update`），广播用 `xxx-changed`。
- **中文 Windows 编码**：`reg query` 等外部命令输出是 GBK，必须 `TextDecoder('gbk')` 解码，直接 utf8 会乱码。终端日志里的乱码只是显示问题，判断结果看 PASS/FAIL。
- **button 不继承字体**：`<button>` 用 UA 控件字体，需显式 `button { font-family: inherit; }` 才能跟随 body。
- **Notion 页面行为**：Ctrl+K 是开关（重发前先查 `[role="dialog"] input` 是否已存在）；"Open in desktop app?" 推广条也是 role=dialog 会吞掉注入按键；侧栏开关状态看 `.notion-sidebar` 的 x 坐标（-250 收起 / 0 展开），宽度恒为 270。注入按键在 Notion JS 就绪前会丢失，需带自检的重试。
- **渲染层共享逻辑**（font-detect.js、tab-drag.js 等）用 UMD 双导出，浏览器挂 window、Node 走 module.exports 以便测试。
- **Quick Find 选中后关浮层三坑（均实测）**：① Notion 只在 keydown 目标位于浮层内部时才响应 Escape（焦点在 body 上连可信 Escape 都不关），选中拦截时 preload 必须先把 DOM 焦点放回输入框（content.js refocusDialogInput）；② 视图被 removeChildView 摘除后注入的按键会被丢弃，同 tick 先注入再摘除也丢（队列未来得及处理），需要 Escape 处理完才能摘除——quick-find-flow.js 用探针轮询浮层关闭即走（快于旧固定 150ms），探针不通退回 150ms 兜底，绝不裸 setTimeout 直接摘；③ trigger 的重试阶梯（0~8s）在待命解除（选中/取消/切标签）后必须停轮（armedRec 闸口），否则把刚关掉的浮层重新打开。e2e 断言浮层关闭要查 `[role="dialog"] input`，裸 `[role="dialog"]` 会误中推广条；`/json` 里 notion 目标要排除 sw.js（service worker）。
- **`webContents.sendInputEvent` 致命坑（Electron 43.4.1）**：任何 key 的 sendInputEvent 都会卡死主进程（最小复现已验证）。注入文本用 `wc.insertText`；注入按键用 PowerShell SendKeys（见 src/main/slash-commands.js 的 sendEnterKey）。Notion 的菜单忽略 JS 派发的非可信 keydown。
- **合成 KeyboardEvent 对 Notion 无效（实测）**：JS dispatch 的 keydown/keyup 是不可信事件，Quick Find（Ctrl+K）与浮层 Escape 均不响应；唤键必须走真实输入管线（sendInputEvent / SendKeys）。
- **`executeJavaScript` 延迟坑（Electron 43.4.1，实测）**：主进程 → 页面 executeJavaScript 往返约 140ms（同页面 CDP Runtime.evaluate 仅约 1ms）。延迟敏感的页面交互（顶栏点击、收藏状态、Quick Find 浮层检查、页面字体探测）一律走 preload 探针：`wc.send` + preload 隔离世界同步读 DOM + ipcRenderer 回复，往返约 1ms（tabs.js 的 queryWc + content.js 探针区）。沙箱 preload 无法 require 本地模块，content.js 探针由 `scripts/build-preload-probes.js` 从 topbar-actions.js 生成（标记区间 `[probes:generated begin/end]`）；改探针函数后必须 `npm run sync-probes`，tests/probe-sync.test.js 校验新鲜度（stale 时 CI/测试直接失败）。
- **设置子窗口随页面缩放**：样式/设置窗的宽高都要按 `settingsWindowSize(340, 基准高, zoom, 工作区上限)` 等比放大并 setZoomFactor（只放高度会横向裁剪），打开时和 `applyZoomEverywhere` 里都要同步。新增表单行时同步加大 configs 基准高度（样式页 380 起）。窗口关闭是**隐藏缓存**（settings-windows.js 拦截 close + hide），重开即显；应用退出（isQuitting）才真正销毁。
- **标题栏随页面缩放**：标题栏是独立 WebContentsView，setZoomFactor 与高度（`titlebarHeightForZoom(36, zoom)`）都要同步，否则内容被 36px 固定 bounds 裁剪。标题栏字体跟随的是**页面探测到的计算 font-family**（probe 自 `.notion-page-content`），不是设置字段——用户字体可能在 custom.css 里。
- **按键注入相关**：`before-input-event` 的 `input.code` 依赖 scancode，SendKeys/远程桌面合成的事件 code 为空，需用 `input.key` 兜底（slash-commands.js 的 KEY_FALLBACK）。Ctrl+Shift+R 是 Chromium 保留键（强制刷新），事件根本到不了 before-input-event，别用作快捷键默认。e2e 里 CDP `Input.dispatchKeyEvent` 触发 before-input-event 的 preventDefault 会卡死 devtools 端点，按键触发一律用真实 SendKeys（cdp-tabs-check.js / cdp-slash-check.js 的 sendKeys），CDP 只做只读断言。Node 的 fetch/http 会卡死 Electron devtools HTTP 服务，`/json` 列表一律 `curl -s -m 8`。
- **悬停 peek 侧栏**：触发区是 `.notion-topbar` 里的 `.notion-open-sidebar` 按钮（页面坐标约 (12,10)）。我们把 topbar 压成 0 高 + `pointer-events:none` 后，必须 `overflow:visible`（0 高 + hidden 会裁剪子元素命中区）并给触发按钮显式 `pointer-events:auto`，否则原生 peek 失灵。该规则同时写进 buildSettingsCss 兜底（custom.css 注入在 default.css 之后，旧副本会覆盖修复）。
- **视图加载底色防白闪**：WebContentsView 默认白底，深色主题下新标签/刷新会闪白。**Electron 43 的 WebContentsView 构造选项没有 backgroundColor，传了会被静默忽略**（构造项只有 webPreferences/webContents），必须建实例后调继承自 View 的 `view.setBackgroundColor(themeBackground(getTheme()))`（tab-manager.js 的纯函数）；主题切换时对所有已建视图 `setViewsBackground`。CDP 截图抓的是页面文档（已被 CSS 染深），看不到视图底色层的白闪，验证白闪要看真实屏幕。
- **后台标签防节流**：标签 WebContentsView 的 webPreferences 带 `backgroundThrottling: false`——后台标签不被 Chromium 节流，切回无重绘顿挫；代价是后台 Notion 定时器持续运行（最多 10 标签，实测可接受）。跟页面缩放一样，标签视图职责在 tabs.js 的 ensureView。
- **性能相关约定**：缩放快捷键（每 1%）落盘走 debounce.js 防抖（应用缩放本身即时）；合并 CSS 在 css-manager.js 的 createCssProvider 缓存，custom.css 由 watcher 失效；标签切换后顶栏状态走 topbar-relay.js 的 pushNow（探针约 1ms，不等防抖窗口），导航事件才走 schedulePush 防抖合并。启动耗时量化用 `ND_PERF=1`。
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
