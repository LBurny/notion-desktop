// 枚举 Windows 已安装字体：读注册表 Fonts 键（与 Word 等应用同源）
// HKLM=系统级安装，HKCU=当前用户安装（Win10+ 用户安装字体在 HKCU）
const { execSync } = require('child_process');

const REG_KEYS = [
  'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
];

// 纯字重/样式变体（CSS 里不是独立 font-family），从列表剔除；
// Arial Black、微软雅黑 Light 这类独立字族保留
const VARIANT_RE = /(\s+(Bold|Italic|Bold Italic|Regular|Oblique|Bold Oblique|Italic Bold))$/i;

function parseRegOutput(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s+(.+?)\s+REG_SZ\s+/);
    if (!m) continue;
    const name = m[1].replace(/\s+\((TrueType|OpenType|PostScript)\)\s*$/, '').trim();
    if (!name || VARIANT_RE.test(name)) continue;
    out.push(name);
  }
  return out;
}

function mergeFontLists(...lists) {
  const set = new Set();
  for (const l of lists) for (const f of l) set.add(f);
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function listSystemFonts() {
  const lists = [];
  for (const key of REG_KEYS) {
    try {
      const out = execSync(`reg query "${key}"`, { encoding: 'utf8', windowsHide: true });
      lists.push(parseRegOutput(out));
    } catch { /* 某个键不存在时忽略 */ }
  }
  return mergeFontLists(...lists);
}

module.exports = { parseRegOutput, mergeFontLists, listSystemFonts };
