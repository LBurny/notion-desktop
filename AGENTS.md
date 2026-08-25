# AGENTS.md

Notion Desktop：notion.so 网页版的 Windows 桌面套壳，Electron 43（BaseWindow + 多 WebContentsView 标签）。私有仓库 LBurny/notion-desktop。

## 常用命令

```bash
npm start            # 开发模式启动
npm test             # node --test，单元测试在 tests/
npm run dist         # electron-builder 打 NSIS 安装包到 dist/（先杀掉运行中的实例，否则 EBUSY）

# 端到端验证（应用需先以 --remote-debugging-port=9222 启动并等页面就绪）
node scripts/cdp-tabs-check.js 9222 "Notion Desktop"

# 渲染层截图预览（产物在 .playwright-mcp/）
npx electron scripts/preview-menu.js [menu|style|settings|tabs]
```

## 结构

```
src/main/       主进程：index.js 总装配；tabs.js 标签状态机+Quick Find 交互；
                tab-manager.js 持久化；style-settings.js 设置清洗+CSS 生成；
                system-fonts.js 注册表字体枚举；topbar-actions.js 标题栏动作→Notion DOM
src/preload/    contextBridge 桥：content.js（Notion 页）、titlebar.js、settings.js、tray-menu.js
src/renderer/   titlebar / tray-menu / style-settings / app-settings 四个渲染页 + error.html
assets/         default.css 注入样式与图标
tests/          node:test 单测（新逻辑先写测试）
scripts/        CDP 调试/端到端/截图脚本
```

用户数据在 `%APPDATA%/notion-desktop/`（style-settings.json、tabs.json、custom.css、window-state.json）。

## 约定与坑

- **IPC**：频道名 kebab-case；同步读取走 sendSync（`get-style-settings`/`get-theme`/`system-fonts`），修改走 invoke/handle（`style-settings-update`），广播用 `xxx-changed`。
- **中文 Windows 编码**：`reg query` 等外部命令输出是 GBK，必须 `TextDecoder('gbk')` 解码，直接 utf8 会乱码。终端日志里的乱码只是显示问题，判断结果看 PASS/FAIL。
- **button 不继承字体**：`<button>` 用 UA 控件字体，需显式 `button { font-family: inherit; }` 才能跟随 body。
- **Notion 页面行为**：Ctrl+K 是开关（重发前先查 `[role="dialog"] input` 是否已存在）；"Open in desktop app?" 推广条也是 role=dialog 会吞掉注入按键；侧栏开关状态看 `.notion-sidebar` 的 x 坐标（-250 收起 / 0 展开），宽度恒为 270。注入按键在 Notion JS 就绪前会丢失，需带自检的重试。
- **渲染层共享逻辑**（font-detect.js、tab-drag.js 等）用 UMD 双导出，浏览器挂 window、Node 走 module.exports 以便测试。
- **`webContents.sendInputEvent` 致命坑（Electron 43.4.1）**：任何 key 的 sendInputEvent 都会卡死主进程（最小复现已验证）。注入文本用 `wc.insertText`；注入按键用 PowerShell SendKeys（见 src/main/slash-commands.js 的 sendEnterKey）。Notion 的菜单忽略 JS 派发的非可信 keydown。
- **按键注入相关**：`before-input-event` 的 `input.code` 依赖 scancode，SendKeys/远程桌面合成的事件 code 为空，需用 `input.key` 兜底（slash-commands.js 的 KEY_FALLBACK）。Ctrl+Shift+R 是 Chromium 保留键（强制刷新），事件根本到不了 before-input-event，别用作快捷键默认。e2e 里 CDP `Input.dispatchKeyEvent` 触发 before-input-event 的 preventDefault 会卡死 devtools 端点，按键触发一律用真实 SendKeys（cdp-tabs-check.js / cdp-slash-check.js 的 sendKeys），CDP 只做只读断言。Node 的 fetch/http 会卡死 Electron devtools HTTP 服务，`/json` 列表一律 `curl -s -m 8`。
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
