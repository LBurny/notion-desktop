const test = require('node:test');
const assert = require('node:assert');
const {
  TOPBAR_ACTIONS, pickTopbarButton,
  favoriteStateOf, quickFindStateOf, pageFontOf, CONTENT_FONT_SELECTORS,
} = require('../src/main/topbar-actions');

// 极简 DOM stub：按选择器表命中预设元素
function stubDoc(map) {
  return { querySelector: (sel) => map[sel] || null };
}

test('四个动作都有非空选择器表', () => {
  for (const k of ['sidebar', 'share', 'favorite', 'more']) {
    assert.ok(Array.isArray(TOPBAR_ACTIONS[k].selectors) && TOPBAR_ACTIONS[k].selectors.length > 0, k);
  }
});

test('pickTopbarButton 按优先级返回第一个命中', () => {
  const a = {}, b = {};
  assert.strictEqual(pickTopbarButton(stubDoc({ '.b': b }), ['.a', '.b']), b);
  assert.strictEqual(pickTopbarButton(stubDoc({ '.a': a, '.b': b }), ['.a', '.b']), a);
  assert.strictEqual(pickTopbarButton(stubDoc({}), ['.a']), null);
});

test('sidebar 动作是开关：开态下有收起按钮可点（选择器表含 Close sidebar）', () => {
  const closeSel = TOPBAR_ACTIONS.sidebar.selectors.find((s) => s.includes('Close sidebar'));
  assert.ok(closeSel, 'sidebar 选择器表缺少收起按钮');
});

test('favoriteStateOf 按 svg.starFill/star 判态，按钮缺失返回 null', () => {
  const favBtn = (svgCls) => ({
    querySelector: (sel) => (sel === 'svg.starFill' && svgCls === 'starFill') || (sel === 'svg.star' && svgCls === 'star') ? {} : null,
  });
  const key = TOPBAR_ACTIONS.favorite.selectors[0];
  assert.strictEqual(favoriteStateOf(stubDoc({ [key]: favBtn('starFill') }), TOPBAR_ACTIONS.favorite.selectors), true);
  assert.strictEqual(favoriteStateOf(stubDoc({ [key]: favBtn('star') }), TOPBAR_ACTIONS.favorite.selectors), false);
  assert.strictEqual(favoriteStateOf(stubDoc({ [key]: favBtn('other') }), TOPBAR_ACTIONS.favorite.selectors), null);
  assert.strictEqual(favoriteStateOf(stubDoc({}), TOPBAR_ACTIONS.favorite.selectors), null);
});

test('quickFindStateOf：带输入框的浮层才算 Quick Find 打开', () => {
  const both = stubDoc({ '[role="dialog"] input': {}, '[role="dialog"]': {} });
  assert.deepStrictEqual(quickFindStateOf(both), { open: true, anyDialog: true });
  // 推广条也是 role=dialog 但没有 input：算有浮层、不算已开
  const promo = { querySelector: (sel) => (sel === '[role="dialog"]' ? {} : null) };
  assert.deepStrictEqual(quickFindStateOf(promo), { open: false, anyDialog: true });
  assert.deepStrictEqual(quickFindStateOf(stubDoc({})), { open: false, anyDialog: false });
});

test('pageFontOf 返回 .notion-page-content 的计算字体', () => {
  const el = {};
  const gcs = (e) => ({ fontFamily: e === el ? '"思源宋体 CN", serif' : 'should-not-use' });
  assert.strictEqual(pageFontOf(stubDoc({ '.notion-page-content': el }), gcs), '"思源宋体 CN", serif');
});

test('pageFontOf 首选元素缺失时按 CONTENT_FONT_SELECTORS 顺序回退', () => {
  const el = {};
  const fallbackSel = CONTENT_FONT_SELECTORS[1];
  const gcs = (e) => ({ fontFamily: e === el ? '"X", serif' : '' });
  assert.strictEqual(pageFontOf(stubDoc({ [fallbackSel]: el }), gcs), '"X", serif');
});

test('pageFontOf 页面未就绪或字体为空时返回 null', () => {
  assert.strictEqual(pageFontOf(stubDoc({}), () => ({ fontFamily: 'x' })), null);
  const el = {};
  assert.strictEqual(pageFontOf(stubDoc({ [CONTENT_FONT_SELECTORS[0]]: el }), () => ({ fontFamily: '' })), null);
  assert.strictEqual(pageFontOf(stubDoc({ [CONTENT_FONT_SELECTORS[0]]: el }), () => ({ fontFamily: '   ' })), null);
});
