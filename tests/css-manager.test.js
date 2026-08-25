const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureCustomCss, readCombinedCss, watchCustomCss, createCssProvider } = require('../src/main/css-manager');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nd-'));
}

test('ensureCustomCss 缺失时从默认样式复制', () => {
  const dir = tmpDir();
  const def = path.join(dir, 'default.css');
  fs.writeFileSync(def, 'body{color:red}');
  const custom = ensureCustomCss(dir, def);
  assert.strictEqual(custom, path.join(dir, 'custom.css'));
  assert.strictEqual(fs.readFileSync(custom, 'utf8'), 'body{color:red}');
});

test('ensureCustomCss 已存在时不覆盖', () => {
  const dir = tmpDir();
  const def = path.join(dir, 'default.css');
  fs.writeFileSync(def, 'A');
  fs.writeFileSync(path.join(dir, 'custom.css'), 'B');
  ensureCustomCss(dir, def);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'custom.css'), 'utf8'), 'B');
});

test('readCombinedCss 合并默认与自定义，默认在前', () => {
  const dir = tmpDir();
  const def = path.join(dir, 'default.css');
  const custom = path.join(dir, 'custom.css');
  fs.writeFileSync(def, 'A');
  fs.writeFileSync(custom, 'B');
  const combined = readCombinedCss(def, custom);
  assert.ok(combined.includes('A') && combined.includes('B'));
  assert.ok(combined.indexOf('A') < combined.indexOf('B'));
});

test('readCombinedCss 文件缺失时容错', () => {
  const dir = tmpDir();
  assert.strictEqual(readCombinedCss(path.join(dir, 'x'), path.join(dir, 'y')).trim(), '');
});

test('watchCustomCss 修改文件触发回调（防抖）', async () => {
  const dir = tmpDir();
  const f = path.join(dir, 'custom.css');
  fs.writeFileSync(f, 'A');
  let calls = 0;
  const w = watchCustomCss(f, () => { calls += 1; }, 20);
  fs.writeFileSync(f, 'B');
  fs.writeFileSync(f, 'C');
  await new Promise((r) => setTimeout(r, 500));
  w.close();
  assert.ok(calls >= 1);
});

test('createCssProvider 缓存合并结果，invalidate 后重读', () => {
  const dir = tmpDir();
  const def = path.join(dir, 'default.css');
  const custom = path.join(dir, 'custom.css');
  fs.writeFileSync(def, 'a{}');
  fs.writeFileSync(custom, 'b{}');
  const p = createCssProvider(def, custom);
  assert.strictEqual(p.combined(), 'a{}\nb{}');
  fs.writeFileSync(custom, 'c{}');
  assert.strictEqual(p.combined(), 'a{}\nb{}'); // 缓存命中，不重读
  p.invalidate();
  assert.strictEqual(p.combined(), 'a{}\nc{}');
});
