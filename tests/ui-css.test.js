const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DEFAULT_CSS = fs.readFileSync(path.join(__dirname, '..', 'assets', 'default.css'), 'utf8');
const TITLEBAR_CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'titlebar', 'style.css'), 'utf8');

// ── 顶栏一体化：Notion 自带顶栏压成 0 高但保留布局 ──
test('default.css 顶栏仍保持 0 高/透明/不挡内容', () => {
  assert.ok(/\.notion-topbar\s*\{[^}]*height:\s*0\s*!important/.test(DEFAULT_CSS), '顶栏必须保持 0 高');
  assert.ok(/\.notion-topbar\s*\{[^}]*opacity:\s*0\s*!important/.test(DEFAULT_CSS), '顶栏必须保持透明');
  assert.ok(/\.notion-topbar\s*\{[^}]*pointer-events:\s*none\s*!important/.test(DEFAULT_CSS), '顶栏整体不挡内容点击');
});

// ── 悬停 peek：0 高顶栏不能 overflow 裁剪，否则左区侧栏把手无法被 hover ──
test('default.css 顶栏放开 overflow 让子元素可命中（视觉仍透明）', () => {
  assert.ok(/\.notion-topbar\s*\{[^}]*overflow:\s*visible\s*!important/.test(DEFAULT_CSS),
    '顶栏 overflow:hidden 会裁掉子元素命中区，peek 触发失效');
});

test('default.css 恢复左区侧栏把手的 pointer-events（悬停 peek 触发区）', () => {
  assert.ok(/\.notion-open-sidebar[^{}]*\{[^}]*pointer-events:\s*auto\s*!important/.test(DEFAULT_CSS),
    '.notion-open-sidebar 必须可 hover/点击');
});

// ── 标题栏与内容之间的分割线（随主题变色） ──
test('标题栏样式表定义明暗两套 --divider 并用于底部分割线', () => {
  assert.ok(/html\[data-theme="light"\][^{}]*\{[^}]*--divider:/.test(TITLEBAR_CSS), '缺少浅色 --divider');
  assert.ok(/html\[data-theme="dark"\][^{}]*\{[^}]*--divider:/.test(TITLEBAR_CSS), '缺少深色 --divider');
  assert.ok(/border-bottom:\s*1px\s+solid\s+var\(--divider\)/.test(TITLEBAR_CSS), '缺少底部分割线');
});

// ── 字体下拉箭头要足够大（用户反馈 11px/15px 均嫌小） ──
const STYLE_SETTINGS_CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style-settings', 'style.css'), 'utf8');
const APP_SETTINGS_CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app-settings', 'style.css'), 'utf8');
const STYLE_SETTINGS_HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style-settings', 'index.html'), 'utf8');
const APP_SETTINGS_HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app-settings', 'index.html'), 'utf8');
test('样式设置页字体下拉箭头字号不小于 18px', () => {
  const m = STYLE_SETTINGS_CSS.match(/\.font-toggle\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(m, '缺少 .font-toggle font-size');
  assert.ok(Number(m[1]) >= 18, `箭头字号 ${m[1]}px 过小`);
});

// ── 子窗口共享基础样式：设置/样式两页（及未来新增子页面）共用
//    src/renderer/shared/base-win.css，页面 style.css 只留特有控件 ──
const BASE_WIN_CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'shared', 'base-win.css'), 'utf8');

// body 背景会传播到根画布（整窗矩形），把 border-radius 顶掉。
// 所以 body 必须透明，背景+圆角由 #win 内层容器绘制（与托盘菜单 #menu 同款结构）
test('子窗口共享样式：body 保持透明（不透明 body 背景经传播会顶掉圆角）', () => {
  assert.ok(/body\s*\{[^}]*background:\s*transparent/.test(BASE_WIN_CSS), 'body 背景必须 transparent');
});

test('子窗口共享样式：#win 容器承担背景/圆角并裁剪圆角处子元素', () => {
  assert.ok(/#win\s*\{[^}]*background:\s*var\(--bg\)/.test(BASE_WIN_CSS), '#win 缺少背景');
  assert.ok(/#win\s*\{[^}]*border-radius:\s*4px/.test(BASE_WIN_CSS), '#win 缺少与托盘菜单同款的 4px 圆角');
  assert.ok(/#win\s*\{[^}]*overflow:\s*hidden/.test(BASE_WIN_CSS), '#win 缺少 overflow:hidden（关闭按钮 hover 红块会溢出圆角）');
});

test('设置/样式页 HTML：#win 包裹容器 + 共享样式表先于页面样式引入', () => {
  for (const [name, html] of [['样式', STYLE_SETTINGS_HTML], ['设置', APP_SETTINGS_HTML]]) {
    assert.ok(/<div id="win">/.test(html), `${name}页缺少 #win 包裹容器`);
    const i = html.indexOf('../shared/base-win.css');
    assert.ok(i > -1, `${name}页缺 base-win.css 引用`);
    assert.ok(i < html.indexOf('href="style.css"'), `${name}页共享样式必须先于页面样式（页面特有规则才可能覆盖）`);
  }
});

test('页面 style.css 不再复制共享规则（防回潮）', () => {
  for (const [name, css] of [['样式', STYLE_SETTINGS_CSS], ['设置', APP_SETTINGS_CSS]]) {
    assert.ok(!/#win\s*\{/.test(css), `${name}页 style.css 不应再定义 #win（已归共享表）`);
    assert.ok(!/html\[data-theme="dark"\]/.test(css), `${name}页不应再定义主题变量块（已归共享表）`);
  }
});

// ── UA 原生控件（number 调节钮/滚动条）跟随明暗主题：暗色下 spinner 不能是白底 ──
test('子窗口共享样式声明 color-scheme：UA 控件（数字调节钮/滚动条）跟随明暗主题', () => {
  assert.ok(/:root,\s*html\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light/.test(BASE_WIN_CSS), '缺 color-scheme: light（系统暗色+浅色主题时 UA 控件会反向失控）');
  assert.ok(/html\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/.test(BASE_WIN_CSS), '缺 color-scheme: dark（暗色下数字调节钮白底）');
});

// ── 子窗口内容统一可滚动：新增控件不必再调窗口基准高度 ──
test('子窗口共享样式 #form 可滚动（内容超出窗口时底部可达）', () => {
  assert.ok(/#form\s*\{[^}]*overflow-y:\s*auto/.test(BASE_WIN_CSS), '#form 缺 overflow-y: auto');
  assert.ok(/#form\s*\{[^}]*min-height:\s*0/.test(BASE_WIN_CSS), '#form 缺 min-height: 0（flex 子项不缩则无法滚动）');
  assert.ok(/#form::-webkit-scrollbar\s*\{[^}]*width:\s*8px/.test(BASE_WIN_CSS), '#form 缺主题化滚动条');
});

// ── 分区头：两页同用 .section 分段（首区 .first 无分隔线），样式归共享表 ──
test('.section 分区样式归共享表；样式页与设置页同风格分段', () => {
  assert.ok(/\.section\s*\{[^}]*border-top:\s*1px\s+solid\s+var\(--border\)/.test(BASE_WIN_CSS), '.section 缺顶部分隔线');
  assert.ok(/\.section\.first\s*\{[^}]*border-top:\s*0/.test(BASE_WIN_CSS), '.section.first 应无分隔线');
  assert.ok(/class="section first"[^>]*>字体</.test(STYLE_SETTINGS_HTML), '样式页缺「字体」首区');
  assert.ok(/class="section"[^>]*>版式</.test(STYLE_SETTINGS_HTML), '样式页缺「版式」分区');
  assert.ok(/class="section"[^>]*>其他</.test(STYLE_SETTINGS_HTML), '样式页缺「其他」分区');
  assert.ok(/class="section first"[^>]*>启动</.test(APP_SETTINGS_HTML), '设置页缺「启动」首区');
  assert.ok(/class="section"[^>]*>语言</.test(APP_SETTINGS_HTML), '设置页缺「语言」分区');
  assert.ok(/class="section"[^>]*>快捷键</.test(APP_SETTINGS_HTML), '设置页缺「快捷键」分区');
});

// ── 标题栏排版一致性：按钮族同宽、顶栏动作与窗口控制之间有主题色分隔线 ──
test('标题栏侧栏开关与新建标签按钮同宽 36px（按钮族一致）', () => {
  assert.ok(/#sidebar-toggle\s*\{[^}]*width:\s*36px/.test(TITLEBAR_CSS), '#sidebar-toggle 应为 36px');
  assert.ok(/#new-tab\s*\{[^}]*width:\s*36px/.test(TITLEBAR_CSS), '#new-tab 应为 36px');
});

test('标题栏顶栏动作组末尾带竖分隔线（与窗口控制分组，随主题变色）', () => {
  assert.ok(/#topbar-actions::after\s*\{[^}]*width:\s*1px/.test(TITLEBAR_CSS), '缺少 #topbar-actions::after 分隔线');
  assert.ok(/#topbar-actions::after\s*\{[^}]*var\(--divider\)/.test(TITLEBAR_CSS), '分隔线应使用 --divider 随主题变色');
});

test('最大化按钮字形字号收窄（□ 字形同字号下视觉偏大）', () => {
  const m = TITLEBAR_CSS.match(/#max\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(m, '缺少 #max font-size');
  assert.ok(Number(m[1]) <= 12, `#max 字号 ${m[1]}px 应 ≤12px`);
});
