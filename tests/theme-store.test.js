const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadTheme, saveTheme } = require('../src/main/theme-store');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nd-')), name);
}

test('loadTheme 文件不存在时返回 null', () => {
  assert.strictEqual(loadTheme(tmpFile('x.json')), null);
});

test('saveTheme + loadTheme 往返一致', () => {
  const f = tmpFile('t.json');
  saveTheme(f, 'dark');
  assert.strictEqual(loadTheme(f), 'dark');
  saveTheme(f, 'light');
  assert.strictEqual(loadTheme(f), 'light');
});

test('loadTheme 非法内容回退 null', () => {
  const f = tmpFile('bad.json');
  fs.writeFileSync(f, '{oops');
  assert.strictEqual(loadTheme(f), null);
  fs.writeFileSync(f, JSON.stringify({ theme: 'purple' }));
  assert.strictEqual(loadTheme(f), null);
  fs.writeFileSync(f, JSON.stringify({ theme: 42 }));
  assert.strictEqual(loadTheme(f), null);
});

test('saveTheme 忽略非法主题名（不写文件）', () => {
  const f = tmpFile('t.json');
  saveTheme(f, 'purple');
  assert.ok(!fs.existsSync(f));
});
