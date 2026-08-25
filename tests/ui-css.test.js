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
  const m = STYLE_SETTINGS_CSS.match(/#font-toggle\s*\{[^}]*font-size:\s*(\d+)px/);
  assert.ok(m, '缺少 #font-toggle font-size');
  assert.ok(Number(m[1]) >= 18, `箭头字号 ${m[1]}px 过小`);
});
