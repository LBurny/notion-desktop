const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  font: '',            // 空 = 使用内置 default.css 的字体栈
  lineHeight: 1.73,
  paragraphSpacing: 0, // px，块与块之间的额外上边距
  zoom: 1,             // setZoomFactor，默认 100%
  dividerWidth: 1.5,   // 标题栏与内容之间的分割线粗细（px），0 = 隐藏
  align: 'justify',    // 正文对齐：justify 两端 / left / right / center
  hideHelp: false,     // 隐藏右下角帮助按钮
  hotkeys: {
    zoomIn: 'Ctrl+Shift+=',      // 页面放大 1%
    zoomOut: 'Ctrl+Shift+-',     // 页面缩小 1%
    toggleWindow: 'Ctrl+`',      // 显示 / 最小化到托盘
  },
  closeAction: 'tray', // 'tray' = 最小化到托盘；'quit' = 退出程序
  slashCommands: [{ combo: 'Ctrl+Shift+M', command: 'math' }], // 斜杠命令快捷键（前台注入 /word + Enter）。注意 Ctrl+Shift+R 是 Chromium 保留键（强制刷新），事件到不了 before-input-event，不能作默认
};

const HOTKEY_RE = /^(Ctrl|Alt|Shift)(\+(Ctrl|Alt|Shift))*\+[^+]+$/;

function isValidHotkey(v) {
  return typeof v === 'string' && v.length <= 40 && HOTKEY_RE.test(v);
}

function clampZoom(z) {
  const v = Math.round(Number(z) * 100) / 100;
  if (!Number.isFinite(v)) return 1;
  return Math.min(2, Math.max(0.5, v));
}

// 标题栏高度随页面缩放等比伸缩（视图 bounds 单位是 DIP，zoomFactor 会把
// 36px 的标题栏内容渲染成 36*zoom，bounds 必须同步，否则内容被裁剪）
function titlebarHeightForZoom(base, zoom) {
  const z = Number(zoom);
  if (!Number.isFinite(z) || z <= 0) return base;
  return Math.round(base * z);
}

// 设置子窗口随页面缩放等比放大（窗口尺寸是 DIP，内容随 zoomFactor 放大，
// 宽高不同步就会裁掉右边和底部）；maxWidth/maxHeight 为工作区上限，可选
function settingsWindowSize(baseWidth, baseHeight, zoom, maxWidth, maxHeight) {
  let w = titlebarHeightForZoom(baseWidth, zoom);
  let h = titlebarHeightForZoom(baseHeight, zoom);
  if (Number.isFinite(maxWidth) && maxWidth > 0) w = Math.min(w, maxWidth);
  if (Number.isFinite(maxHeight) && maxHeight > 0) h = Math.min(h, maxHeight);
  return { width: w, height: h };
}

function sanitizeSettings(raw) {
  // hotkeys / slashCommands 需深拷贝，避免合并用户值时改动 DEFAULT_SETTINGS
  const s = {
    ...DEFAULT_SETTINGS,
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys },
    slashCommands: DEFAULT_SETTINGS.slashCommands.map((c) => ({ ...c })),
  };
  if (raw && typeof raw === 'object') {
    if (typeof raw.font === 'string') s.font = raw.font.slice(0, 100);
    if (Number.isFinite(raw.lineHeight)) s.lineHeight = Math.min(3, Math.max(1, raw.lineHeight));
    if (Number.isFinite(raw.paragraphSpacing)) {
      s.paragraphSpacing = Math.min(30, Math.max(0, Math.round(raw.paragraphSpacing)));
    }
    if (raw.zoom !== undefined) s.zoom = clampZoom(raw.zoom);
    if (Number.isFinite(raw.dividerWidth)) {
      s.dividerWidth = Math.min(4, Math.max(0, Math.round(raw.dividerWidth * 2) / 2));
    }
    if (['justify', 'left', 'right', 'center'].includes(raw.align)) s.align = raw.align;
    if (typeof raw.hideHelp === 'boolean') s.hideHelp = raw.hideHelp;
    if (raw.hotkeys && typeof raw.hotkeys === 'object') {
      for (const name of Object.keys(s.hotkeys)) {
        if (isValidHotkey(raw.hotkeys[name])) s.hotkeys[name] = raw.hotkeys[name];
      }
    }
    if (raw.closeAction === 'tray' || raw.closeAction === 'quit') s.closeAction = raw.closeAction;
    if (Array.isArray(raw.slashCommands)) {
      const list = [];
      for (const item of raw.slashCommands) {
        if (!item || !isValidHotkey(item.combo)) continue;
        const command = String(item.command || '').replace(/^\/+/, '').trim().slice(0, 50);
        if (!command) continue;
        list.push({ combo: item.combo, command });
        if (list.length >= 10) break;
      }
      s.slashCommands = list;
    }
  }
  return s;
}

function loadSettings(filePath) {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return sanitizeSettings(null);
  }
}

function saveSettings(filePath, settings) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sanitizeSettings(settings), null, 2));
}

// 默认字体栈：思源宋体（装了就用）→ Times New Roman（拉丁）→ 微软雅黑（CJK 兜底，
// 防未装思源宋体的机器落到 system serif=宋体）。无条件下发：custom.css 是旧版
// default.css 的副本，其字体规则排在 default.css 之后会盖住新栈，靠最后注入兜底
const DEFAULT_FONT_STACK = '"思源宋体 CN", "Times New Roman", "Source Han Serif CN", "Noto Serif CJK SC", "Microsoft YaHei", serif';
const FONT_SELECTORS = '.notion-page-content, .notion-page-content *, .notion-sidebar, .notion-sidebar *, .notion-topbar, .notion-topbar *, .notion-breadcrumb, .notion-breadcrumb *, [data-testid="page-title"], [role="dialog"], [role="dialog"] *';

// 把设置编译成追加注入的 CSS（排在 default.css / custom.css 之后，优先级最高）
function buildSettingsCss(s) {
  // 无条件：恢复悬停 peek 触发区。custom.css 是旧版 default.css 的副本，
  // 其顶栏块（overflow:hidden + 整区 pointer-events:none）排在 default.css 之后，
  // 会把修复打回原型；这里最后注入兜底覆盖
  let css = '.notion-topbar { overflow: visible !important; }\n'
    + '.notion-open-sidebar, .notion-topbar [aria-label="Lock sidebar open"], .notion-topbar [aria-label="Open sidebar"] { pointer-events: auto !important; }\n';
  // 文字对齐无条件下发：default.css 写死 justify，custom.css 旧副本同样带 justify，
  // 必须靠最后注入的设置 CSS 覆盖才能切到左/右/居中
  css += `.notion-text-block { text-align: ${s.align} !important; }\n`;
  // 字体无条件下发（同上兜底理由）；自定义字体时换成用户选择，回退链同样垫雅黑
  if (s.font && s.font.trim()) {
    const f = s.font.trim().replace(/["\\]/g, '');
    css += `${FONT_SELECTORS} { font-family: "${f}", "Times New Roman", "Microsoft YaHei", serif !important; }\n`;
    css += '.notion-code-block, .notion-code-block * { font-family: "Consolas", "SFMono-Regular", "Menlo", "Monaco", "Courier New", monospace !important; }\n';
  } else {
    css += `${FONT_SELECTORS} { font-family: ${DEFAULT_FONT_STACK} !important; }\n`;
  }
  if (Number.isFinite(s.lineHeight) && s.lineHeight > 0) {
    css += '.notion-text-block, .notion-bulleted_list-block, .notion-numbered_list-block, .notion-to_do-block, .notion-quote-block, .notion-callout-block, .notion-toggle-block, .notion-header-block, .notion-sub_header-block, .notion-sub_sub_header-block, [data-testid="page-title"]'
      + ` { line-height: ${s.lineHeight} !important; }\n`;
  }
  if (Number.isFinite(s.paragraphSpacing) && s.paragraphSpacing > 0) {
    css += `.notion-page-content [data-block-id] { margin-top: ${s.paragraphSpacing}px !important; }\n`;
  }
  if (s.hideHelp) {
    // 旧版右下角帮助按钮 + 新版 AI 悬浮按钮所在的角落容器
    css += '.notion-help-button, .notion-assistant-corner-origin-container { display: none !important; }\n';
  }
  return css;
}

module.exports = { DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings, clampZoom, buildSettingsCss, titlebarHeightForZoom, settingsWindowSize };
