# Notion Desktop

English | [中文](docs/README.zh-CN.md)

---

A Windows desktop wrapper for [Notion](https://notion.so), built on Electron 43.

## Features

- **Browser-style tabs**: Ctrl+T opens Notion's Quick Find on the current page — a new tab is created only when you pick a result. Ctrl+W to close, Ctrl+1-9 to jump, Ctrl+PageDown/PageUp to cycle, drag to reorder, lazy-loaded session restore on restart
- **Unified title bar**: tab strip + sidebar toggle (☰) + Share/Favorite/Actions, replacing Notion's own top bar
- **Theme following**: tracks Notion's dark/light mode across the window, tray menu and settings
- **Custom styles**: injected CSS (per-slot fonts: body / UI / code / math, line-height, paragraph spacing, page zoom, hide help button), edit `custom.css` with hot reload
- **Tray resident**: minimize to tray with quick access to style & settings windows; choose whether closing the window quits or hides to tray
- **Customizable hotkeys**: rebind global shortcuts for zoom and show/hide
- **Slash-command hotkeys**: bind any `/command` to a shortcut — pressing it types `/word` and hits Enter for you (e.g. Ctrl+Shift+M → block equation). IME-safe, works while a Chinese input method is active

## Develop

```bash
npm install
npm start        # dev mode
npm test         # unit tests (node:test)
npm run dist     # build NSIS installer into dist/
```

End-to-end check (launch the app with `--remote-debugging-port=9222` first):

```bash
node scripts/cdp-tabs-check.js 9222 "Notion Desktop"
```

## Structure

```
src/main/       main process (window, tray, tab glue, hotkeys, settings persistence)
src/preload/    preload bridges (page, title bar, tray menu, settings)
src/renderer/   four renderer pages: title bar / tray menu / style / settings
tests/          node:test unit tests
scripts/        CDP debugging & e2e scripts
assets/         default injected CSS and icons
```

User data (settings, tab archive, `custom.css`) lives in `%APPDATA%/notion-desktop/`.
