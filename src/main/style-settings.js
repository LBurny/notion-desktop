const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  fonts: { body: '', ui: '', code: '', math: '' }, // 分区字体：空 = 各槽内置默认栈（ui 不再跟随正文）
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

const FONT_SLOTS = ['body', 'ui', 'code', 'math'];

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
  // fonts / hotkeys / slashCommands 需深拷贝，避免合并用户值时改动 DEFAULT_SETTINGS
  const s = {
    ...DEFAULT_SETTINGS,
    fonts: { ...DEFAULT_SETTINGS.fonts },
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys },
    slashCommands: DEFAULT_SETTINGS.slashCommands.map((c) => ({ ...c })),
  };
  if (raw && typeof raw === 'object') {
    if (raw.fonts && typeof raw.fonts === 'object') {
      for (const k of FONT_SLOTS) {
        if (typeof raw.fonts[k] === 'string') s.fonts[k] = raw.fonts[k].slice(0, 100);
      }
    }
    // 旧版迁移：顶层 font → fonts.body + fonts.ui（旧版全局字体同时作用正文与界面，
    // 双双写入保留旧外观——ui 从「跟随 body」改为「内置默认/独立槽」后，只迁 body
    // 会让存量用户界面字体在升级时静默跳变；新字段非空时优先）
    if (!s.fonts.body && typeof raw.font === 'string') s.fonts.body = raw.font.slice(0, 100);
    if (!s.fonts.ui && typeof raw.font === 'string') s.fonts.ui = raw.font.slice(0, 100);
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
const CODE_FONT_STACK = '"Consolas", "SFMono-Regular", "Menlo", "Monaco", "Courier New", monospace';
const MATH_FONT_STACK = '"KaTeX_Main", "Times New Roman", serif';

// 正文/界面选择器分组：两组合计与旧版统一 FONT_SELECTORS 完全同集（default.css 全局字体表
// 的内容侧/界面侧拆分，默认外观零变化）。必须镜像完整选择器表，不能用 .notion-page-content *
// 简化：* 不贡献特异性（0,1,0），压不过 custom.css 旧副本里命中正文文字叶节点的
// [contenteditable="true"]:first-of-type (0,2,0)——正文文字会落在旧栈上（分区字体失效的根因，
// CDP 实测）。同特异性镜像 + 设置 CSS 最后注入 → 稳定覆盖 custom.css 旧副本。
// 页面大标题是内容的组成部分归正文；Quick Find 等浮层归界面（与现状一致）
const BODY_SELECTORS = [
  '[data-testid="page-title"]',
  '.notion-page-block .notion-page-block',
  '.notion-page-block .notion-selectable',
  '.notion-scroller > div > [data-block-id] .notion-page-block',
  '.notion-page-block > div > div[contenteditable="true"]',
  '.notion-page-block > div > div[contenteditable="true"] *',
  '.notion-header-block', '.notion-sub_header-block', '.notion-sub_sub_header-block',
  '.notion-header-block *', '.notion-sub_header-block *', '.notion-sub_sub_header-block *',
  '.notion-text-block', '.notion-to_do-block', '.notion-bulleted_list-block',
  '.notion-numbered_list-block', '.notion-quote-block', '.notion-callout-block',
  '.notion-toggle-block', '.notion-table-block', '.notion-bookmark-block',
  '.notion-page-content', '.notion-page-content *',
  'h1', 'h1 *',
  '[placeholder="Untitled"]', '[placeholder="Page title"]', '[placeholder="Heading 1"]',
  '[contenteditable="true"]:first-of-type', '[contenteditable="true"]:first-of-type *',
  '.notion-table_of_contents-block', '.notion-table_of_contents-block *',
  '.notion-link-page', '.notion-link-page *',
  '.notion-page-link', '.notion-page-link *',
  '.notion-page-view-header', '.notion-page-view-header *',
  '.notion-page-header', '.notion-page-header *',
  '.notion-page-block div[contenteditable="true"]', '.notion-page-block div[contenteditable="true"] *',
].join(', ');
const UI_SELECTORS = [
  '.notion-sidebar', '.notion-sidebar *',
  '.notion-topbar', '.notion-topbar *',
  '.notion-breadcrumb', '.notion-breadcrumb *',
  '[role="dialog"]', '[role="dialog"] *',
  '[role="search"]', '[role="search"] *',
  '[placeholder="Search"]', '[placeholder="Search"] *',
  '[placeholder="Search or jump to…"]', '[placeholder="Search or jump to…"] *',
  '[placeholder="Type a command or search…"]', '[placeholder="Type a command or search…"] *',
  'input[type="text"]', 'input[type="text"] *',
  '.notion-overlay-container', '.notion-overlay-container *',
  '.notion-dialog', '.notion-dialog *',
  '.notion-quick-find', '.notion-quick-find *',
  '.notion-search', '.notion-search *',
].join(', ');
const CODE_SELECTORS = '.notion-code-block, .notion-code-block *, [role="dialog"] .notion-code-block, [role="dialog"] .notion-code-block *';
// 公式内联规则必须复用 default.css 同特异性 (0,4,0) 的 :not 选择器（同特异性后注入者赢）；
// 展示公式与浮层预览无竞争，直接覆盖
const MATH_SELECTORS = '.notion-text-block .katex:not(.katex-display .katex), .notion-text-block .katex:not(.katex-display .katex) *, .katex-display .katex, .katex-display .katex *, [role="dialog"] .katex, [role="dialog"] .katex *';

// 自定义字体名过滤引号/反斜杠（防 CSS 注入）
function cleanFontName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/["\\]/g, '');
}

// 自定义字体 + 回退链；空/非法返回 null（调用方回退默认栈）
function customFontChain(name, fallbacks) {
  const f = cleanFontName(name);
  return f ? `"${f}", ${fallbacks}` : null;
}

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
  // 分区字体无条件下发（兜底覆盖 custom.css 旧副本，同对齐规则的理由）；
  // 各槽空 = 内置默认栈；ui 空 = 界面内置默认栈（与正文同栈，默认外观与现状一致，
  // 但不再跟随正文——控制条/侧栏/浮层字体独立于正文）；自定义回退链统一垫雅黑防
  // 拉丁-only 字体的中文落宋体（界面垫 Segoe UI 走无衬线）
  const bodyChain = customFontChain(s.fonts.body, '"Times New Roman", "Microsoft YaHei", serif') || DEFAULT_FONT_STACK;
  css += `${BODY_SELECTORS} { font-family: ${bodyChain} !important; }\n`;
  const uiChain = customFontChain(s.fonts.ui, '"Segoe UI", "Microsoft YaHei", sans-serif') || DEFAULT_FONT_STACK;
  css += `${UI_SELECTORS} { font-family: ${uiChain} !important; }\n`;
  // 代码块：正文/界面自定义时 .notion-page-content * 等同特异性规则会盖过 default.css
  // 的等宽规则，必须重新兜底；code 槽自定义时换成用户字体
  const codeChain = customFontChain(s.fonts.code, CODE_FONT_STACK);
  if (codeChain || cleanFontName(s.fonts.body) || cleanFontName(s.fonts.ui)) {
    css += `${CODE_SELECTORS} { font-family: ${codeChain || CODE_FONT_STACK} !important; }\n`;
  }
  // 公式：默认完全交给 default.css（内联 KaTeX_Main / 浮层 Consolas，维持现状），
  // math 槽自定义时才下发（垫 KaTeX_Main 防缺字形出方框）
  const mathChain = customFontChain(s.fonts.math, MATH_FONT_STACK);
  if (mathChain) {
    css += `${MATH_SELECTORS} { font-family: ${mathChain} !important; }\n`;
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
