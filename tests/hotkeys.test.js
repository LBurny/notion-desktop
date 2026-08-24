const test = require('node:test');
const assert = require('node:assert');
const { comboToAccelerator } = require('../src/main/hotkeys');

test('comboToAccelerator: Ctrl 转 CommandOrControl', () => {
  assert.strictEqual(comboToAccelerator('Ctrl+Shift+='), 'CommandOrControl+Shift+=');
  assert.strictEqual(comboToAccelerator('Ctrl+Shift+-'), 'CommandOrControl+Shift+-');
  assert.strictEqual(comboToAccelerator('Ctrl+`'), 'CommandOrControl+`');
  assert.strictEqual(comboToAccelerator('Ctrl+Alt+F5'), 'CommandOrControl+Alt+F5');
});
