const test = require('node:test');
const assert = require('node:assert');
const { secondInstanceAction } = require('../src/main/single-instance');

test('主窗可见且未最小化：仅 focus（不重复 show/restore）', () => {
  assert.deepStrictEqual(
    secondInstanceAction({ destroyed: false, minimized: false, visible: true }),
    { show: false, restore: false, focus: true },
  );
});

test('主窗最小化：先 restore 再 focus（不重复 show）', () => {
  assert.deepStrictEqual(
    secondInstanceAction({ destroyed: false, minimized: true, visible: true }),
    { show: false, restore: true, focus: true },
  );
});

test('主窗隐藏到托盘（不可见）：show + focus', () => {
  assert.deepStrictEqual(
    secondInstanceAction({ destroyed: false, minimized: false, visible: false }),
    { show: true, restore: false, focus: true },
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