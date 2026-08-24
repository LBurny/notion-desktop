const test = require('node:test');
const assert = require('node:assert');
const { shortcutFor } = require('../src/main/tab-shortcuts');

const kd = (key, mods = {}) => ({ type: 'keyDown', key, control: true, shift: false, alt: false, ...mods });

test('Ctrl+T / Ctrl+W / Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageDown / Ctrl+PageUp', () => {
  assert.deepStrictEqual(shortcutFor(kd('t')), { action: 'new-tab' });
  assert.deepStrictEqual(shortcutFor(kd('T')), { action: 'new-tab' }); // 大小写不敏感
  assert.deepStrictEqual(shortcutFor(kd('w')), { action: 'close-tab' });
  assert.deepStrictEqual(shortcutFor(kd('Tab')), { action: 'next-tab' });
  assert.deepStrictEqual(shortcutFor(kd('Tab', { shift: true })), { action: 'prev-tab' });
  assert.deepStrictEqual(shortcutFor(kd('PageDown')), { action: 'next-tab' });
  assert.deepStrictEqual(shortcutFor(kd('PageUp')), { action: 'prev-tab' });
});

test('Ctrl+1..9 映射 position', () => {
  assert.deepStrictEqual(shortcutFor(kd('1')), { action: 'position', position: 1 });
  assert.deepStrictEqual(shortcutFor(kd('9')), { action: 'position', position: 9 });
});

test('非 keyDown / 无 Ctrl / 带 Alt / 未注册键 → null', () => {
  assert.strictEqual(shortcutFor({ ...kd('t'), type: 'keyUp' }), null);
  assert.strictEqual(shortcutFor({ ...kd('t'), control: false }), null);
  assert.strictEqual(shortcutFor(kd('t', { alt: true })), null);
  assert.strictEqual(shortcutFor(kd('x')), null);
  assert.strictEqual(shortcutFor(kd('0')), null);
});
