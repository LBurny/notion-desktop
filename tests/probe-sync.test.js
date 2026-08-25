// content.js 探针生成区与 topbar-actions.js 同源校验（单一事实源）。
// stale 时测试失败，提示运行 npm run sync-probes
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

test('content.js 探针生成区与 topbar-actions.js 同源', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, '..', 'scripts', 'build-preload-probes.js'), '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(
    r.status,
    0,
    `探针区过期，请运行 npm run sync-probes\n${r.stdout}${r.stderr}`,
  );
});
