const test = require('node:test');
const assert = require('node:assert');
const { CANDIDATE_FONTS, filterAvailableFonts, pickMathDefaultFont } = require('../src/renderer/style-settings/font-detect');

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

// ── 公式内置默认：优先 Times New Roman，未装才回落 Modern 系模糊匹配 ──

test('pickMathDefaultFont 优先 Times New Roman（Windows 几乎必装，与正文拉丁字体一致）', () => {
  assert.strictEqual(pickMathDefaultFont(['Arial', 'Times New Roman', '宋体']), 'Times New Roman');
  // 即使本机装了 Modern 系，Times New Roman 仍优先
  assert.strictEqual(
    pickMathDefaultFont(['Arial', 'Times New Roman', 'Latin Modern Math']),
    'Times New Roman',
  );
  // 大小写/分隔符不敏感，返回原始写法
  assert.strictEqual(pickMathDefaultFont(['times new roman']), 'times new roman');
});

test('pickMathDefaultFont 未装 Times New Roman 才回落 Modern 系数学字族：Latin Modern Math > Modern Math > Latin Modern Roman > Modern', () => {
  assert.strictEqual(pickMathDefaultFont(['Arial', 'Modern Math', 'Modern', 'Latin Modern Roman']), 'Modern Math');
  assert.strictEqual(pickMathDefaultFont(['Arial', 'Latin Modern Math', 'Modern Math']), 'Latin Modern Math');
  assert.strictEqual(pickMathDefaultFont(['Arial', 'Latin Modern Roman', 'Modern']), 'Latin Modern Roman');
  assert.strictEqual(pickMathDefaultFont(['Arial', 'Modern']), 'Modern');
});

test('pickMathDefaultFont 匹配 Computer Modern 等含 modern 的变体名', () => {
  assert.strictEqual(pickMathDefaultFont(['Arial', 'Computer Modern']), 'Computer Modern');
  assert.strictEqual(pickMathDefaultFont(['Arial', 'CMU Serif', 'Computer Modern Math']), 'Computer Modern Math');
  // CMU Serif 不含 modern，不误匹配（仅 Modern 系参与）
});

test('pickMathDefaultFont 大小写/分隔符不敏感', () => {
  assert.strictEqual(pickMathDefaultFont(['lATIN modern-Math']), 'lATIN modern-Math');
  assert.strictEqual(pickMathDefaultFont(['  MODERN MATH ']), '  MODERN MATH ');
});

test('pickMathDefaultFont 选择与输入顺序无关（同分按名字序）', () => {
  const list = ['Modern Regular', 'Modern Sans'];
  const a = pickMathDefaultFont([...list].reverse());
  const b = pickMathDefaultFont(list);
  assert.strictEqual(a, b);
  assert.strictEqual(a, 'Modern Regular'); // 同分取名字序小者
});

test('pickMathDefaultFont Times New Roman 与 Modern 系都没装返回 null', () => {
  assert.strictEqual(pickMathDefaultFont(['Arial', '宋体', 'Segoe UI']), null);
  assert.strictEqual(pickMathDefaultFont([]), null);
  assert.strictEqual(pickMathDefaultFont(null), null);
  assert.strictEqual(pickMathDefaultFont(undefined), null);
});

test('pickMathDefaultFont 不把 Cambria Math 等非 Modern 系的数学字体当 Modern（Windows 必装 Cambria Math）', () => {
  // 只含 math 不含 modern：不是 Modern 系；Times New Roman 也不在场时回落 null
  assert.strictEqual(pickMathDefaultFont(['Arial', 'Cambria Math']), null);
  assert.strictEqual(pickMathDefaultFont(['Cambria Math', 'STIX Two Math']), null);
  // 真 Modern 系在场时仍由 Modern 胜出，不被 Cambria Math 抢位
  assert.strictEqual(pickMathDefaultFont(['Cambria Math', 'Latin Modern Math']), 'Latin Modern Math');
});
