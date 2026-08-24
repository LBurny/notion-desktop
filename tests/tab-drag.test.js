const test = require('node:test');
const assert = require('node:assert');
const { dropIndex } = require('../src/renderer/titlebar/tab-drag');

const rects = [{ left: 0, width: 100 }, { left: 100, width: 100 }, { left: 200, width: 100 }];

test('dropIndex 按指针越过的中点数定位', () => {
  assert.strictEqual(dropIndex(rects, 10), 0); // 第一个中点(50)之前
  assert.strictEqual(dropIndex(rects, 60), 1); // 越过第 1 个中点
  assert.strictEqual(dropIndex(rects, 160), 2);
  assert.strictEqual(dropIndex(rects, 999), 3); // 全部越过 → 末尾
});

test('dropIndex 空列表返回 0', () => {
  assert.strictEqual(dropIndex([], 100), 0);
});
