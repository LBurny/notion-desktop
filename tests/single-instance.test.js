const test = require('node:test');
const assert = require('node:assert');
const { secondInstanceAction } = require('../src/main/single-instance');

test('主窗可见且未最小化：仅 focus（show/restore 都不需要）', () => {
  assert.deepStrictEqual(
    secondInstanceAction({ destroyed: false, minimized: false, visible: true }),
    { show: false, restore: false, focus: true },
  );
});

test('主窗最小化：仅 restore（不重复 show/focus——restore 本身已激活前台）', () => {
  assert.deepStrictEqual(
    secondInstanceAction({ destroyed: false, minimized: true, visible: true }),
    { show: false, restore: true, focus: false },
  );
});

test('主窗隐藏到托盘（不可见）：仅 show（不重复 focus—show 本身已激活前台）', () => {
  assert.deepStrictEqual(
    secondInstanceAction({ destroyed: false, minimized: false, visible: false }),
    { show: true, restore: false, focus: false },
  );
});

test('主窗已销毁：不操作', () => {
  assert.deepStrictEqual(
    secondInstanceAction({ destroyed: true, minimized: false, visible: true }),
    { show: false, restore: false, focus: false },
  );
});

test('winState 为 null（win 尚未创建）：不操作', () => {
  assert.deepStrictEqual(secondInstanceAction(null), { show: false, restore: false, focus: false });
});