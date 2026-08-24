const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRegOutput, mergeFontLists, decodeRegOutput } = require('../src/main/system-fonts');

const SAMPLE = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts
    Arial (TrueType)    REG_SZ    arial.ttf
    Arial Bold (TrueType)    REG_SZ    arialbd.ttf
    Arial Italic (TrueType)    REG_SZ    ariali.ttf
    Arial Bold Italic (TrueType)    REG_SZ    arialbi.ttf
    Arial Black (TrueType)    REG_SZ    arblim.ttf
    Bahnschrift (TrueType)    REG_SZ    bahnschrift.ttf
    微软雅黑 (TrueType)    REG_SZ    msyh.ttc
    微软雅黑 Light (TrueType)    REG_SZ    msyhl.ttc
    思源宋体 CN (OpenType)    REG_SZ    SourceHanSerifCN.otf
    Cascadia Code Regular (TrueType)    REG_SZ    CascadiaCode.ttf
`;

test('parseRegOutput 提取字体名并剥离 (TrueType)/(OpenType) 后缀', () => {
  const fonts = parseRegOutput(SAMPLE);
  assert.ok(fonts.includes('Arial'));
  assert.ok(fonts.includes('微软雅黑'));
  assert.ok(fonts.includes('思源宋体 CN'));
  assert.ok(!fonts.some((f) => f.includes('TrueType') || f.includes('OpenType')));
});

test('parseRegOutput 过滤粗斜体等样式变体，保留独立字族', () => {
  const fonts = parseRegOutput(SAMPLE);
  // Arial Bold/Italic/Bold Italic 是 Arial 的字重变体，CSS 里不是独立字族
  assert.ok(!fonts.includes('Arial Bold'));
  assert.ok(!fonts.includes('Arial Italic'));
  assert.ok(!fonts.includes('Arial Bold Italic'));
  assert.ok(!fonts.includes('Cascadia Code Regular'));
  // Arial Black / 微软雅黑 Light 是独立字族（Word 也单独列出）
  assert.ok(fonts.includes('Arial Black'));
  assert.ok(fonts.includes('微软雅黑 Light'));
});

test('parseRegOutput 空输入返回空表', () => {
  assert.deepEqual(parseRegOutput(''), []);
  assert.deepEqual(parseRegOutput('not a reg output\nnoise'), []);
});

test('decodeRegOutput 按 GBK 解码中文 Windows 的 reg 输出', () => {
  // 中文系统里 reg.exe 用 ANSI(GBK) 输出：’微软雅黑’ 的 GBK 字节如下
  const gbk = Buffer.from('CE A2 C8 ED D1 C5 BA DA'.replace(/ /g, ''), 'hex');
  const buf = Buffer.concat([Buffer.from('    '), gbk, Buffer.from(' (TrueType)    REG_SZ    msyh.ttc\r\n')]);
  const fonts = parseRegOutput(decodeRegOutput(buf));
  assert.ok(fonts.includes('微软雅黑'));
});

test('parseRegOutput 拆分 TTC 合并注册项（A & B）', () => {
  const text = '    Microsoft YaHei & Microsoft YaHei UI (TrueType)    REG_SZ    msyh.ttc\r\n'
    + '    Microsoft YaHei Light & Microsoft YaHei UI Light (TrueType)    REG_SZ    msyhl.ttc\r\n';
  const fonts = parseRegOutput(text);
  assert.ok(fonts.includes('Microsoft YaHei'));
  assert.ok(fonts.includes('Microsoft YaHei UI'));
  assert.ok(fonts.includes('Microsoft YaHei Light'));
  assert.ok(fonts.includes('Microsoft YaHei UI Light'));
});

test('mergeFontLists 合并去重并按中文排序', () => {
  const merged = mergeFontLists(['Georgia', '微软雅黑'], ['Arial', '微软雅黑', '宋体']);
  assert.deepEqual([...merged].sort(), ['Arial', 'Georgia', '宋体', '微软雅黑'].sort());
  assert.equal(merged.length, 4);
  // zh-CN 排序下汉字排在拉丁字母前（与本机实际枚举结果一致）
  assert.ok(merged.indexOf('宋体') < merged.indexOf('Arial'));
});
