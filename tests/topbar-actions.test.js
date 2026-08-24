const test = require('node:test');
const assert = require('node:assert');
const { TOPBAR_ACTIONS, pickTopbarButton, buildClickScript, buildFavoriteStateScript } = require('../src/main/topbar-actions');

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

test('buildClickScript 命中时点击并返回 true，未命中返回 false', () => {
  let clicked = 0;
  const el = { click: () => { clicked++; } };
  const script = buildClickScript('share');
  const run = new Function('document', `return ${script}`);
  assert.strictEqual(run(stubDoc({ [TOPBAR_ACTIONS.share.selectors[0]]: el })), true);
  assert.strictEqual(clicked, 1);
  assert.strictEqual(run(stubDoc({})), false);
});

test('buildClickScript 对未知动作抛错', () => {
  assert.throws(() => buildClickScript('nope'));
});

test('sidebar 动作是开关：开态下有收起按钮可点（选择器表含 Close sidebar）', () => {
  // 开态：前几个“打开”选择器全部落空，必须落到收起按钮
  const closeSel = TOPBAR_ACTIONS.sidebar.selectors.find((s) => s.includes('Close sidebar'));
  assert.ok(closeSel, 'sidebar 选择器表缺少收起按钮');
  let clicked = 0;
  const el = { click: () => { clicked++; } };
  const run = new Function('document', `return ${buildClickScript('sidebar')}`);
  assert.strictEqual(run(stubDoc({ [closeSel]: el })), true);
  assert.strictEqual(clicked, 1);
});

test('buildFavoriteStateScript 按 svg.starFill/star 判态，按钮缺失返回 null', () => {
  const script = buildFavoriteStateScript();
  const run = new Function('document', `return ${script}`);
  const favBtn = (svgCls) => ({
    querySelector: (sel) => (sel === 'svg.starFill' && svgCls === 'starFill') || (sel === 'svg.star' && svgCls === 'star') ? {} : null,
  });
  const key = TOPBAR_ACTIONS.favorite.selectors[0];
  assert.strictEqual(run(stubDoc({ [key]: favBtn('starFill') })), true);
  assert.strictEqual(run(stubDoc({ [key]: favBtn('star') })), false);
  assert.strictEqual(run(stubDoc({ [key]: favBtn('other') })), null);
  assert.strictEqual(run(stubDoc({})), null);
});
