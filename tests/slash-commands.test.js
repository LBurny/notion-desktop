const test = require('node:test');
const assert = require('node:assert/strict');
const { comboFromInput, findSlashCommand, runSlashCommand } = require('../src/main/slash-commands');

test('comboFromInput 转换 Electron input 为设置文件 combo', () => {
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: 'KeyR', control: true, shift: true }), 'Ctrl+Shift+R');
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: 'F2', alt: true }), 'Alt+F2');
  assert.strictEqual(comboFromInput({ type: 'keyUp', code: 'KeyR', control: true }), null); // 只认 keyDown
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: 'KeyR' }), null); // 无修饰键
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: 'ControlLeft', control: true }), null); // 纯修饰键
});

test('comboFromInput code 为空时退回 key（SendKeys 等合成事件无 scancode）', () => {
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: '', key: 'M', control: true, shift: true }), 'Ctrl+Shift+M');
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: '', key: 'z', control: true }), 'Ctrl+Z'); // 无 shift 时小写
  assert.strictEqual(comboFromInput({ type: 'keyDown', key: 'F2', control: true }), 'Ctrl+F2'); // code 缺失
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: '', key: ' ', alt: true }), 'Alt+Space');
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: '', key: 'Control', control: true }), null); // 修饰键自身
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: '', key: 'm' }), null); // 无修饰键
  // code 有效时优先 code（真实键盘路径，布局无关）
  assert.strictEqual(comboFromInput({ type: 'keyDown', code: 'KeyR', key: 'r', control: true }), 'Ctrl+R');
});

test('findSlashCommand 命中配置', () => {
  const list = [{ combo: 'Ctrl+Shift+R', command: 'math' }];
  assert.strictEqual(findSlashCommand(list, { type: 'keyDown', code: 'KeyR', control: true, shift: true }), list[0]);
  assert.strictEqual(findSlashCommand(list, { type: 'keyDown', code: 'KeyQ', control: true, shift: true }), null);
  assert.strictEqual(findSlashCommand(null, { type: 'keyDown', code: 'KeyR', control: true }), null);
});

test('runSlashCommand 注入序列：insertText /word → 真实 Enter', async () => {
  const calls = [];
  const wc = {
    focus: () => calls.push('focus'),
    insertText: (t) => calls.push('text:' + t),
    isDestroyed: () => false,
  };
  assert.strictEqual(runSlashCommand(wc, '/math', { enterDelay: 0, sendEnter: () => calls.push('enter') }), true);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(calls, ['focus', 'text:/math', 'enter']);
});

test('runSlashCommand 默认 300ms 后发 Enter', async () => {
  const calls = [];
  const wc = { focus: () => {}, insertText: () => {}, isDestroyed: () => false };
  runSlashCommand(wc, 'math', { sendEnter: () => calls.push('enter') });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(calls.length, 0); // 还没到点
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(calls.length, 1);
});

test('runSlashCommand 空命令不动作', () => {
  assert.strictEqual(runSlashCommand({ focus() {} }, '  '), false);
});
