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
test('样式设置页字体下拉箭头字号不小于 18px', () => {
  const m = STYLE_SETTINGS_CSS.match(/\.font-toggle\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(m, '缺少 .font-toggle font-size');
  assert.ok(Number(m[1]) >= 18, `箭头字号 ${m[1]}px 过小`);
});

// ── 设置/样式子窗口圆角：body 背景会传播到根画布（整窗矩形），把 border-radius 顶掉。
//    所以 body 必须透明，背景+圆角由 #win 内层容器绘制（与托盘菜单 #menu 同款结构） ──
for (const [name, dir] of [['设置', 'app-settings'], ['样式', 'style-settings']]) {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', dir, 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', dir, 'index.html'), 'utf8');
  test(`${name}窗口 body 保持透明（不透明 body 背景经传播会顶掉圆角）`, () => {
    assert.ok(/body\s*\{[^}]*background:\s*transparent/.test(css), 'body 背景必须 transparent');
  });
  test(`${name}窗口 #win 容器承担背景/圆角并裁剪圆角处子元素`, () => {
    assert.ok(/#win\s*\{[^}]*background:\s*var\(--bg\)/.test(css), '#win 缺少背景');
    assert.ok(/#win\s*\{[^}]*border-radius:\s*4px/.test(css), '#win 缺少与托盘菜单同款的 4px 圆角');
    assert.ok(/#win\s*\{[^}]*overflow:\s*hidden/.test(css), '#win 缺少 overflow:hidden（关闭按钮 hover 红块会溢出圆角）');
    assert.ok(/<div id="win">/.test(html), 'HTML 缺少 #win 包裹容器');
  });
}

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
