const test = require('node:test');
const assert = require('node:assert');
const { comboFromKeyEvent } = require('../src/renderer/app-settings/hotkey-capture');

test('comboFromKeyEvent: 默认组合原样还原', () => {
  assert.strictEqual(comboFromKeyEvent({ code: 'Equal', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+=');
  assert.strictEqual(comboFromKeyEvent({ code: 'Minus', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+-');
  assert.strictEqual(comboFromKeyEvent({ code: 'Backquote', ctrlKey: true }), 'Ctrl+`');
});

test('comboFromKeyEvent: 字母与功能键', () => {
  assert.strictEqual(comboFromKeyEvent({ code: 'KeyQ', ctrlKey: true, altKey: true }), 'Ctrl+Alt+Q');
  assert.strictEqual(comboFromKeyEvent({ code: 'F5', ctrlKey: true, altKey: true }), 'Ctrl+Alt+F5');
  assert.strictEqual(comboFromKeyEvent({ code: 'Digit1', ctrlKey: true }), 'Ctrl+1');
});

test('comboFromKeyEvent: 修饰键顺序固定为 Ctrl→Alt→Shift，与按下顺序无关', () => {
  assert.strictEqual(comboFromKeyEvent({ code: 'KeyA', shiftKey: true, ctrlKey: true }), 'Ctrl+Shift+A');
  assert.strictEqual(comboFromKeyEvent({ code: 'KeyA', shiftKey: true, altKey: true, ctrlKey: true }), 'Ctrl+Alt+Shift+A');
});

test('comboFromKeyEvent: 只按修饰键时返回 null（等待后续按键）', () => {
  assert.strictEqual(comboFromKeyEvent({ code: 'ControlLeft', ctrlKey: true }), null);
  assert.strictEqual(comboFromKeyEvent({ code: 'ShiftRight', shiftKey: true }), null);
  assert.strictEqual(comboFromKeyEvent({ code: 'AltLeft', altKey: true }), null);
});

test('comboFromKeyEvent: 无 Ctrl/Alt/Shift 修饰时返回 null', () => {
  assert.strictEqual(comboFromKeyEvent({ code: 'KeyA' }), null);
  assert.strictEqual(comboFromKeyEvent({ code: 'F5' }), null);
  assert.strictEqual(comboFromKeyEvent({ code: 'KeyA', metaKey: true }), null);
});

test('comboFromKeyEvent: 无法识别的按键返回 null', () => {
  assert.strictEqual(comboFromKeyEvent({ code: 'MediaPlayPause', ctrlKey: true }), null);
  assert.strictEqual(comboFromKeyEvent({ code: '', ctrlKey: true }), null);
});
