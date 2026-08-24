# Notion Desktop

[English](../README.md) | 中文

---

Notion 网页版（notion.so）的 Windows 桌面套壳，基于 Electron 43。

## 功能

- **浏览器式多标签**：Ctrl+T 在当前页唤起搜索，选中结果才开新标签；Ctrl+W 关闭、Ctrl+数字 跳转、Ctrl+PageDown/PageUp 循环切换、拖拽排序、重启后懒加载恢复
- **一体化标题栏**：标签条 + 侧栏开关（☰）+ 分享/收藏/更多，隐藏 Notion 自带顶栏
- **主题跟随**：自动跟随 Notion 页面的深色/浅色模式，窗口、托盘菜单、设置页同步换肤
- **自定义样式**：注入自定义 CSS（字体/行距/段落间距/页面缩放/屏蔽帮助按钮），支持编辑 `custom.css` 热生效
- **托盘常驻**：最小化到托盘，托盘菜单快速打开样式/设置窗口；关闭动作可选「最小化到托盘」或「退出」
- **快捷键自定义**：缩放、显示/隐藏窗口的全局快捷键可在设置中改绑

## 开发

```bash
npm install
npm start        # 启动（开发模式）
npm test         # node:test 单元测试
npm run dist     # 打包 NSIS 安装包到 dist/
```

端到端验证（需先以 `--remote-debugging-port=9222` 启动应用）：

```bash
node scripts/cdp-tabs-check.js 9222 "Notion Desktop"
```

## 结构

```
src/main/       主进程（窗口、托盘、标签粘合层、快捷键、设置持久化）
src/preload/    预加载桥（页面、标题栏、托盘菜单、设置窗口）
src/renderer/   标题栏/托盘菜单/样式设置/应用设置四个渲染页
tests/          node:test 单元测试
scripts/        CDP 调试与端到端脚本
assets/         默认注入样式与图标
```

用户数据（设置、标签存档、custom.css）在 `%APPDATA%/notion-desktop/`。
