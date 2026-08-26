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

test('可配置新建/关闭标签：按 settings.hotkeys 匹配', () => {
  const hk = { newTab: 'Ctrl+T', closeTab: 'Ctrl+W' };
  assert.deepStrictEqual(shortcutFor(kd('t'), hk), { action: 'new-tab' });
  assert.deepStrictEqual(shortcutFor(kd('w'), hk), { action: 'close-tab' });
});

test('改键后旧键不触发，新键生效', () => {
  const hk = { newTab: 'Ctrl+N', closeTab: 'Ctrl+E' };
  assert.strictEqual(shortcutFor(kd('t'), hk), null, 'Ctrl+T 已改键，不再新建');
  assert.strictEqual(shortcutFor(kd('w'), hk), null, 'Ctrl+W 已改键，不再关闭');
  assert.deepStrictEqual(shortcutFor(kd('n'), hk), { action: 'new-tab' });
  assert.deepStrictEqual(shortcutFor(kd('e'), hk), { action: 'close-tab' });
});

test('配置下 Ctrl+Tab/PageDown/数字位 仍可用且不受改键影响', () => {
  const hk = { newTab: 'Ctrl+N', closeTab: 'Ctrl+E' };
  assert.deepStrictEqual(shortcutFor(kd('Tab'), hk), { action: 'next-tab' });
  assert.deepStrictEqual(shortcutFor(kd('1'), hk), { action: 'position', position: 1 });
});
