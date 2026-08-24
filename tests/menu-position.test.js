const test = require('node:test');
const assert = require('node:assert');
const { calcMenuPosition } = require('../src/main/menu-position');

// 任务栏在底部（高度 40px）的典型场景
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const menu = { width: 150, height: 88 };

test('菜单居中于托盘图标上方', () => {
  const pos = calcMenuPosition({ x: 900, y: 1040, width: 24, height: 40 }, menu, workArea);
  assert.deepStrictEqual(pos, { x: 837, y: 948 }); // 900+12-75, 1040-88-4
});

test('图标在屏幕右边缘时菜单不超出工作区', () => {
  const pos = calcMenuPosition({ x: 1890, y: 1040, width: 24, height: 40 }, menu, workArea);
  assert.strictEqual(pos.x, 1770); // 1920-150 钳位
  assert.strictEqual(pos.y, 948);
});

test('图标在左边缘时菜单不超出工作区左侧', () => {
  const pos = calcMenuPosition({ x: 0, y: 1040, width: 24, height: 40 }, menu, workArea);
  assert.strictEqual(pos.x, 0);
});

test('上方空间不足时改放图标下方（任务栏在顶部）', () => {
  const pos = calcMenuPosition({ x: 900, y: 0, width: 24, height: 40 }, menu, workArea);
  assert.deepStrictEqual(pos, { x: 837, y: 44 }); // 0+40+4
});

test('多显示器：工作区有偏移时定位正确', () => {
  const wa2 = { x: 1920, y: 0, width: 1920, height: 1040 };
  const pos = calcMenuPosition({ x: 3800, y: 1040, width: 24, height: 40 }, menu, wa2);
  assert.deepStrictEqual(pos, { x: 1920 + 1920 - 150, y: 948 });
});
