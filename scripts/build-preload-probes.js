// 单一事实源：src/main/topbar-actions.js 的探针纯函数 → 内联进 content.js 标记区间
// （沙箱 preload 不能 require 本地模块，只能生成式共享）。--check 只校验不写文件。
const fs = require('fs');
const path = require('path');

const BEGIN = '// [probes:generated begin]';
const END = '// [probes:generated end]';
const FUNCS = ['pickTopbarButton', 'favoriteStateOf', 'quickFindStateOf', 'pageFontOf'];

function buildBlock() {
  const m = require('../src/main/topbar-actions');
  const lines = [
    BEGIN,
    '// 本区块由 scripts/build-preload-probes.js 生成，勿手改。',
    '// 改探针逻辑请改 src/main/topbar-actions.js 后运行 npm run sync-probes',
    `const CONTENT_FONT_SELECTORS = ${JSON.stringify(m.CONTENT_FONT_SELECTORS)};`,
  ];
  for (const name of FUNCS) {
    if (typeof m[name] !== 'function') throw new Error(`topbar-actions 缺少导出: ${name}`);
    lines.push(m[name].toString());
  }
  lines.push(END);
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const file = path.join(__dirname, '..', 'src', 'preload', 'content.js');
  const src = fs.readFileSync(file, 'utf8');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}`);
  const block = buildBlock();
  if (!re.test(src)) {
    console.error('content.js 缺少探针标记区间（[probes:generated begin/end]）');
    process.exit(2);
  }
  if (check) {
    const current = src.match(re)[0];
    if (current !== block) {
      console.error('探针区与 topbar-actions.js 不同源，请运行 npm run sync-probes');
      process.exit(1);
    }
    console.log('probes up-to-date');
    return;
  }
  fs.writeFileSync(file, src.replace(re, block));
  console.log('probes regenerated');
}

main();
