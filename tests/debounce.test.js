const test = require('node:test');
const assert = require('node:assert/strict');
const { debounce } = require('../src/main/debounce');

test('防抖窗口内多次调用只执行最后一次', async () => {
  let calls = 0;
  const fn = debounce(() => calls++, 40);
  fn(); fn(); fn();
  assert.equal(calls, 0);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls, 1);
});

test('cancel 后不再执行', async () => {
  let calls = 0;
  const fn = debounce(() => calls++, 30);
  fn();
  fn.cancel();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 0);
});
