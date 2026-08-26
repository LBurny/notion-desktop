const test = require('node:test');
const assert = require('node:assert');
const { extractDrafts, mergeDrafts } = require('../src/renderer/app-settings/slash-drafts');

test('extractDrafts 提取命令为空的行（草稿），保留有效行', () => {
  const drafts = extractDrafts([
    { combo: 'Ctrl+Shift+M', command: 'math' },
    { combo: 'Ctrl+Shift+X', command: '' },
    { combo: 'Ctrl+Alt+T', command: '   ' },
  ]);
  assert.deepStrictEqual(drafts, [
    { combo: 'Ctrl+Shift+X', command: '' },
    { combo: 'Ctrl+Alt+T', command: '' },
  ]);
});

test('extractDrafts 非数组 / 空数组返回空列表', () => {
  assert.deepStrictEqual(extractDrafts(null), []);
  assert.deepStrictEqual(extractDrafts([]), []);
  assert.deepStrictEqual(extractDrafts(undefined), []);
});

test('mergeDrafts 将草稿并回主进程干净快照（尾追）', () => {
  const merged = mergeDrafts(
    [{ combo: 'Ctrl+Shift+M', command: 'math' }],
    [{ combo: 'Ctrl+Shift+X', command: '' }],
  );
  assert.deepStrictEqual(merged, [
    { combo: 'Ctrl+Shift+M', command: 'math' },
    { combo: 'Ctrl+Shift+X', command: '' },
  ]);
});

test('mergeDrafts 跳过与已有有效项同 combo 的草稿（去重）', () => {
  const merged = mergeDrafts(
    [{ combo: 'Ctrl+Shift+X', command: 'math' }],
    [{ combo: 'Ctrl+Shift+X', command: '' }],
  );
  assert.deepStrictEqual(merged, [{ combo: 'Ctrl+Shift+X', command: 'math' }]);
});

test('mergeDrafts 总数上限 10（草稿不溢出）', () => {
  const clean = Array.from({ length: 9 }, (_, i) => ({ combo: `Ctrl+Shift+F${i + 1}`, command: 'c' }));
  const drafts = [
    { combo: 'Ctrl+Alt+A', command: '' },
    { combo: 'Ctrl+Alt+B', command: '' },
  ];
  const merged = mergeDrafts(clean, drafts);
  assert.strictEqual(merged.length, 10);
  assert.strictEqual(merged[9].combo, 'Ctrl+Alt+A');
});

test('mergeDrafts 不修改传入的干净列表（返回副本）', () => {
  const clean = [{ combo: 'Ctrl+Shift+M', command: 'math' }];
  mergeDrafts(clean, [{ combo: 'Ctrl+Shift+X', command: '' }]);
  assert.strictEqual(clean.length, 1);
});

test('端到端：onLanguage 刷新后草稿行存活（模拟 commit→sanitize→回播）', () => {
  // 1) 用户点「+ 添加」：本地 push 草稿（不 commit）
  let local = [
    { combo: 'Ctrl+Shift+M', command: 'math' },
    { combo: 'Ctrl+Shift+X', command: '' }, // 草稿
  ];
  // 2) 草稿未提交，主进程快照不含它
  const cleanFromMain = [{ combo: 'Ctrl+Shift+M', command: 'math' }];
  // 3) onLanguage 刷新：先提取草稿，再用主进程快照 + 草稿重建
  const drafts = extractDrafts(local);
  local = mergeDrafts(cleanFromMain, drafts);
  assert.ok(local.some((c) => c.combo === 'Ctrl+Shift+X' && c.command === ''), '草稿行在刷新后存活');
  assert.ok(local.some((c) => c.combo === 'Ctrl+Shift+M' && c.command === 'math'), '有效行保留');
});