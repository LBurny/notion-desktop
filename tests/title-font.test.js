const test = require('node:test');
const assert = require('node:assert/strict');
const { titlebarFontFamily } = require('../src/renderer/titlebar/title-font');

test('优先使用页面探测到的计算字体（与页面渲染完全一致）', () => {
  assert.equal(titlebarFontFamily('"思源宋体 CN", "Times New Roman", serif', '微软雅黑'), '"思源宋体 CN", "Times New Roman", serif');
});

test('无探测结果时用设置字体，并拼接标题栏回退栈', () => {
  assert.equal(titlebarFontFamily('', '思源宋体 CN'), '"思源宋体 CN", "Segoe UI", sans-serif');
});

test('设置字体的引号/反斜杠被清洗（防 CSS 注入）', () => {
  assert.equal(titlebarFontFamily(null, 'a"b\\c'), '"abc", "Segoe UI", sans-serif');
});

test('两者皆空返回空串（回落到样式表默认字体）', () => {
  assert.equal(titlebarFontFamily('', ''), '');
  assert.equal(titlebarFontFamily(null, '   '), '');
});

test('空白探测值视为无，回落设置字体', () => {
  assert.equal(titlebarFontFamily('   ', '思源宋体 CN'), '"思源宋体 CN", "Segoe UI", sans-serif');
});
