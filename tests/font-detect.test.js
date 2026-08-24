const test = require('node:test');
const assert = require('node:assert');
const { CANDIDATE_FONTS, filterAvailableFonts } = require('../src/renderer/style-settings/font-detect');

test('filterAvailableFonts 只保留谓词判定可用的字体', () => {
  const available = new Set(['思源宋体 CN', '微软雅黑']);
  const out = filterAvailableFonts(['思源宋体 CN', '不存在的字体', '微软雅黑'], (f) => available.has(f));
  assert.deepStrictEqual(out, ['思源宋体 CN', '微软雅黑']);
});

test('filterAvailableFonts 全部不可用时返回空数组', () => {
  assert.deepStrictEqual(filterAvailableFonts(['Foo', 'Bar'], () => false), []);
});

test('CANDIDATE_FONTS 包含内置默认字体且无非法字符、无重复', () => {
  assert.ok(CANDIDATE_FONTS.includes('思源宋体 CN')); // default.css 的内置字体栈首选
  assert.ok(CANDIDATE_FONTS.length >= 8);
  assert.strictEqual(new Set(CANDIDATE_FONTS).size, CANDIDATE_FONTS.length);
  for (const f of CANDIDATE_FONTS) {
    assert.ok(typeof f === 'string' && f.trim().length > 0, `非法字体名: ${f}`);
    assert.ok(!/["\\]/.test(f), `字体名含引号或反斜杠会被 CSS 注入过滤掉: ${f}`);
  }
});
