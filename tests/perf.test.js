const test = require('node:test');
const assert = require('node:assert/strict');
const { createPerf } = require('../src/main/perf');

test('禁用时 mark 不产生任何输出', () => {
  const logs = [];
  const perf = createPerf({ enabled: false, log: (m) => logs.push(m) });
  perf.mark('a');
  assert.equal(logs.length, 0);
});

test('启用时输出里程碑与相对耗时', () => {
  const logs = [];
  let t = 1000;
  const perf = createPerf({ enabled: true, now: () => t, log: (m) => logs.push(m) });
  t = 1250;
  perf.mark('first-view-loaded');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /first-view-loaded/);
  assert.match(logs[0], /250/);
});
