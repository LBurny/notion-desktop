const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings, clampZoom, buildSettingsCss,
  titlebarHeightForZoom, settingsWindowSize,
} = require('../src/main/style-settings');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nd-')), name);
}

test('loadSettings 文件不存在时返回默认值', () => {
  assert.deepStrictEqual(loadSettings(tmpFile('x.json')), DEFAULT_SETTINGS);
});

test('loadSettings JSON 损坏时返回默认值', () => {
  const f = tmpFile('bad.json');
  fs.writeFileSync(f, '{oops');
  assert.deepStrictEqual(loadSettings(f), DEFAULT_SETTINGS);
});

test('saveSettings + loadSettings 往返一致', () => {
  const f = tmpFile('s.json');
  const s = {
    fonts: { body: '思源宋体 CN', ui: '', code: 'JetBrains Mono', math: '' },
    lineHeight: 1.8, paragraphSpacing: 6, zoom: 1.05, hideHelp: true,
    dividerWidth: 2.5, align: 'center',
    hotkeys: { zoomIn: 'Ctrl+Alt+Q', zoomOut: 'Ctrl+Alt+W', toggleWindow: 'Ctrl+Alt+E', newTab: 'Ctrl+T', closeTab: 'Ctrl+W' },
    closeAction: 'quit', language: 'en', launchAtLogin: true,
    slashCommands: [{ combo: 'Ctrl+Shift+R', command: 'math' }],
  };
  saveSettings(f, s);
  assert.deepStrictEqual(loadSettings(f), s);
});

test('sanitizeSettings 钳位非法值', () => {
  const s = sanitizeSettings({
    fonts: { body: 42, ui: 'X' }, lineHeight: 5, paragraphSpacing: -3, zoom: 9, hideHelp: 'yes',
  });
  assert.strictEqual(s.fonts.body, '');
  assert.strictEqual(s.fonts.ui, 'X');
  assert.strictEqual(s.lineHeight, 3);
  assert.strictEqual(s.paragraphSpacing, 0);
  assert.strictEqual(s.zoom, 2);
  assert.strictEqual(s.hideHelp, false);
});

test('clampZoom 步进 1% 且限制在 50%~200%', () => {
  assert.strictEqual(clampZoom(1.234), 1.23);
  assert.strictEqual(clampZoom(0.01), 0.5);
  assert.strictEqual(clampZoom(99), 2);
  assert.strictEqual(clampZoom('abc'), 1);
});

test('默认页面缩放为 100%', () => {
  assert.strictEqual(DEFAULT_SETTINGS.zoom, 1);
  assert.strictEqual(sanitizeSettings(null).zoom, 1);
  assert.strictEqual(sanitizeSettings({ zoom: 'x' }).zoom, 1);
});

test('buildSettingsCss 默认设置下发默认字体栈（雅黑兜底）+ 行距规则', () => {
  const css = buildSettingsCss(DEFAULT_SETTINGS);
  assert.ok(css.includes('line-height: 1.73'));
  // 默认栈无条件下发（兜底覆盖 custom.css 旧副本）：思源宋体 → Times → 微软雅黑 → serif
  assert.ok(css.includes('"思源宋体 CN", "Times New Roman", "Source Han Serif CN", "Noto Serif CJK SC", "Microsoft YaHei", serif'));
  assert.ok(!css.includes('margin-top'));
  assert.ok(!css.includes('notion-help-button'));
  // 默认零变化：正文/界面选择器分组覆盖旧 FONT_SELECTORS 全集，且不下发代码/公式规则
  assert.ok(css.includes('.notion-page-content'));
  assert.ok(css.includes('.notion-sidebar'));
  assert.ok(css.includes('[role="dialog"]'));
  assert.ok(css.includes('[data-testid="page-title"]'));
  assert.ok(!css.includes('.notion-code-block'), '默认不下发代码兜底（交给 default.css）');
  assert.ok(!css.includes('katex'), '默认不下发公式规则（交给 default.css）');
});

test('buildSettingsCss 全量设置生成对应规则', () => {
  const css = buildSettingsCss({
    fonts: { body: '思源宋体 CN', ui: '', code: '', math: '' },
    lineHeight: 1.8, paragraphSpacing: 6, zoom: 1.1, hideHelp: true,
  });
  assert.ok(css.includes('font-family: "思源宋体 CN"'));
  // 自定义字体的 CJK 回退也垫微软雅黑（拉丁-only 字体的中文不至于落到宋体）
  assert.ok(css.includes('"思源宋体 CN", "Times New Roman", "Microsoft YaHei", serif'));
  assert.ok(css.includes('line-height: 1.8'));
  assert.ok(css.includes('margin-top: 6px'));
  assert.ok(css.includes('.notion-help-button'));
  assert.ok(css.includes('.notion-assistant-corner-origin-container'));
  assert.ok(css.includes('display: none'));
  // 自定义字体不波及代码块
  assert.ok(css.includes('.notion-code-block'));
});

test('buildSettingsCss 字体名过滤引号与反斜杠', () => {
  const css = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: 'Evil"; \\', ui: '', code: '', math: '' } });
  assert.ok(!css.includes('Evil"'));
  assert.ok(!css.includes('\\'));
});

test('sanitizeSettings 校验快捷键：非法回退默认，合法保留', () => {
  const s = sanitizeSettings({
    hotkeys: { zoomIn: 'Ctrl+Alt+Q', zoomOut: 'abc', toggleWindow: 42 },
  });
  assert.strictEqual(s.hotkeys.zoomIn, 'Ctrl+Alt+Q');
  assert.strictEqual(s.hotkeys.zoomOut, DEFAULT_SETTINGS.hotkeys.zoomOut);
  assert.strictEqual(s.hotkeys.toggleWindow, DEFAULT_SETTINGS.hotkeys.toggleWindow);
});

test('sanitizeSettings 校验关闭行为：仅接受 tray/quit', () => {
  assert.strictEqual(sanitizeSettings({ closeAction: 'quit' }).closeAction, 'quit');
  assert.strictEqual(sanitizeSettings({ closeAction: 'tray' }).closeAction, 'tray');
  assert.strictEqual(sanitizeSettings({ closeAction: 'xxx' }).closeAction, 'tray');
  assert.strictEqual(sanitizeSettings({}).closeAction, 'tray');
});

test('sanitizeSettings 分割线粗细：钳位 0–4、半步取整、默认 1.5', () => {
  assert.strictEqual(sanitizeSettings(null).dividerWidth, 1.5);
  assert.strictEqual(sanitizeSettings({ dividerWidth: 2.4 }).dividerWidth, 2.5);
  assert.strictEqual(sanitizeSettings({ dividerWidth: 0 }).dividerWidth, 0);
  assert.strictEqual(sanitizeSettings({ dividerWidth: 4 }).dividerWidth, 4);
  assert.strictEqual(sanitizeSettings({ dividerWidth: -1 }).dividerWidth, 0);
  assert.strictEqual(sanitizeSettings({ dividerWidth: 99 }).dividerWidth, 4);
  assert.strictEqual(sanitizeSettings({ dividerWidth: 'x' }).dividerWidth, 1.5);
});

test('sanitizeSettings 文字对齐：枚举校验，默认 justify', () => {
  assert.strictEqual(sanitizeSettings(null).align, 'justify');
  assert.strictEqual(sanitizeSettings({ align: 'left' }).align, 'left');
  assert.strictEqual(sanitizeSettings({ align: 'right' }).align, 'right');
  assert.strictEqual(sanitizeSettings({ align: 'center' }).align, 'center');
  assert.strictEqual(sanitizeSettings({ align: 'justify' }).align, 'justify');
  assert.strictEqual(sanitizeSettings({ align: 'both' }).align, 'justify');
  assert.strictEqual(sanitizeSettings({ align: 1 }).align, 'justify');
});

test('buildSettingsCss 按 align 生成 text-align 规则（压过 default.css 的 justify）', () => {
  assert.ok(buildSettingsCss({ ...DEFAULT_SETTINGS, align: 'left' }).includes('text-align: left !important'));
  assert.ok(buildSettingsCss({ ...DEFAULT_SETTINGS, align: 'center' }).includes('text-align: center !important'));
  assert.ok(buildSettingsCss({ ...DEFAULT_SETTINGS, align: 'right' }).includes('text-align: right !important'));
  assert.ok(buildSettingsCss(DEFAULT_SETTINGS).includes('text-align: justify !important'));
  assert.ok(buildSettingsCss(DEFAULT_SETTINGS).includes('.notion-text-block'));
});

test('loadSettings 旧版文件（无快捷键字段）补齐默认值', () => {
  const f = tmpFile('old.json');
  fs.writeFileSync(f, JSON.stringify({ font: 'Test', lineHeight: 1.8, paragraphSpacing: 2, zoom: 1.1, hideHelp: true }));
  const s = loadSettings(f);
  assert.deepStrictEqual(s.hotkeys, DEFAULT_SETTINGS.hotkeys);
  assert.strictEqual(s.closeAction, 'tray');
  assert.strictEqual(s.fonts.body, 'Test');
});

test('slashCommands 默认预置 math', () => {
  const s = sanitizeSettings(null);
  assert.deepStrictEqual(s.slashCommands, [{ combo: 'Ctrl+Shift+M', command: 'math' }]);
});

test('slashCommands 清洗：去斜杠、剔非法项、上限 10 条', () => {
  const s = sanitizeSettings({
    slashCommands: [
      { combo: 'Ctrl+Shift+R', command: '/math' },
      { combo: 'not a hotkey', command: 'x' },
      { combo: 'Ctrl+Alt+T', command: '   ' },
      ...Array.from({ length: 12 }, (_, i) => ({ combo: `Ctrl+Shift+F${(i % 12) + 1}`, command: 'c' + i })),
    ],
  });
  assert.ok(s.slashCommands.some((c) => c.combo === 'Ctrl+Shift+R' && c.command === 'math'));
  assert.ok(!s.slashCommands.some((c) => c.combo === 'not a hotkey'));
  assert.ok(!s.slashCommands.some((c) => !c.command));
  assert.ok(s.slashCommands.length <= 10);
});

test('slashCommands 返回值不共享 DEFAULT_SETTINGS 引用', () => {
  const s = sanitizeSettings(null);
  s.slashCommands.push({ combo: 'Ctrl+Shift+Q', command: 'x' });
  assert.strictEqual(DEFAULT_SETTINGS.slashCommands.length, 1);
});

// ── 标题栏随页面缩放（src/main/style-settings.js） ──

test('titlebarHeightForZoom 按缩放比例取整', () => {
  assert.strictEqual(titlebarHeightForZoom(36, 1), 36);
  assert.strictEqual(titlebarHeightForZoom(36, 1.5), 54);
  assert.strictEqual(titlebarHeightForZoom(36, 0.5), 18);
  assert.strictEqual(titlebarHeightForZoom(36, 2), 72);
});

test('titlebarHeightForZoom 非法缩放回退基准高度', () => {
  assert.strictEqual(titlebarHeightForZoom(36, NaN), 36);
  assert.strictEqual(titlebarHeightForZoom(36, 0), 36);
  assert.strictEqual(titlebarHeightForZoom(36, undefined), 36);
});

test('settingsWindowSize 宽高随缩放取整且不超工作区上限', () => {
  assert.deepStrictEqual(settingsWindowSize(340, 380, 1, 3000, 900), { width: 340, height: 380 });
  assert.deepStrictEqual(settingsWindowSize(340, 380, 1.5, 3000, 900), { width: 510, height: 570 });
  assert.deepStrictEqual(settingsWindowSize(340, 380, 2, 3000, 900), { width: 680, height: 760 });
  assert.deepStrictEqual(settingsWindowSize(340, 380, 2, 600, 700), { width: 600, height: 700 }); // 钳到上限
  assert.deepStrictEqual(settingsWindowSize(340, 380, NaN, 3000, 900), { width: 340, height: 380 });
  assert.deepStrictEqual(settingsWindowSize(340, 380, 1.5), { width: 510, height: 570 }); // 无上限时不钳
});

test('buildSettingsCss 无条件附带悬停 peek 触发区规则（压过旧版 custom.css 副本）', () => {
  // 旧版 default.css 的顶栏块（overflow:hidden + pointer-events:none）会使 peek 失效；
  // custom.css 是从 default.css 复制的，排在 default.css 之后，必须用最后注入的
  // 设置 CSS 兜底覆盖，保证存量用户的悬停 peek 不被旧副本打死
  const css = buildSettingsCss(DEFAULT_SETTINGS);
  assert.ok(css.includes('overflow: visible'), '需覆盖旧副本的 overflow:hidden');
  assert.ok(css.includes('.notion-open-sidebar'), '需恢复侧栏把手 pointer-events');
  assert.ok(css.includes('pointer-events: auto'));
});

// ── 分区字体（fonts.{body,ui,code,math}） ──

test('sanitizeSettings 旧版顶层 font 迁移进 fonts.body+ui（新字段优先）', () => {
  const m = sanitizeSettings({ font: 'X' });
  assert.strictEqual(m.fonts.body, 'X');
  assert.strictEqual(m.fonts.ui, 'X'); // 旧版全局字体同时作用界面，迁移保留旧外观
  assert.strictEqual(sanitizeSettings({ font: 'X', fonts: { body: 'Y' } }).fonts.body, 'Y');
  assert.strictEqual(sanitizeSettings({ font: 'X', fonts: { ui: 'Z' } }).fonts.ui, 'Z');
  assert.deepStrictEqual(sanitizeSettings(null).fonts, { body: '', ui: '', code: '', math: '' });
});

test('sanitizeSettings fonts 返回值不共享 DEFAULT_SETTINGS 引用', () => {
  const s = sanitizeSettings(null);
  s.fonts.body = 'X';
  assert.strictEqual(DEFAULT_SETTINGS.fonts.body, '');
});

// ── 界面语言（language）与开机静默启动（launchAtLogin） ──

test('sanitizeSettings language：合法值直通，非法/缺失回落 auto（跟随系统）', () => {
  assert.strictEqual(DEFAULT_SETTINGS.language, 'auto');
  assert.strictEqual(sanitizeSettings(null).language, 'auto');
  assert.strictEqual(sanitizeSettings({ language: 'zh-CN' }).language, 'zh-CN');
  assert.strictEqual(sanitizeSettings({ language: 'en' }).language, 'en');
  assert.strictEqual(sanitizeSettings({ language: 'auto' }).language, 'auto');
  assert.strictEqual(sanitizeSettings({ language: 'fr' }).language, 'auto'); // 不支持的语言当 auto
  assert.strictEqual(sanitizeSettings({ language: 1 }).language, 'auto');
});

test('sanitizeSettings launchAtLogin：布尔直通，非布尔/缺失回落 false', () => {
  assert.strictEqual(DEFAULT_SETTINGS.launchAtLogin, false);
  assert.strictEqual(sanitizeSettings(null).launchAtLogin, false);
  assert.strictEqual(sanitizeSettings({ launchAtLogin: true }).launchAtLogin, true);
  assert.strictEqual(sanitizeSettings({ launchAtLogin: false }).launchAtLogin, false);
  assert.strictEqual(sanitizeSettings({ launchAtLogin: 1 }).launchAtLogin, false);
  assert.strictEqual(sanitizeSettings({ launchAtLogin: 'yes' }).launchAtLogin, false);
});

test('buildSettingsCss 界面槽留空用内置默认栈（不跟随正文），填入后独立', () => {
  const def = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: 'Aa', ui: '', code: '', math: '' } });
  assert.ok(/\.notion-sidebar[^{]*\{[^}]*font-family: "思源宋体 CN", "Times New Roman", "Source Han Serif CN"/.test(def), 'ui 留空应回落内置界面默认栈');
  assert.ok(/\.notion-page-content[^{]*\{[^}]*font-family: "Aa"/.test(def), '正文不受影响');
  const own = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: 'Aa', ui: 'Bb', code: '', math: '' } });
  assert.ok(/\.notion-sidebar[^{]*\{[^}]*font-family: "Bb", "Segoe UI", "Microsoft YaHei", sans-serif/.test(own), 'ui 填入后独立（无衬线回退链）');
  assert.ok(/\.notion-page-content[^{]*\{[^}]*font-family: "Aa"/.test(own), 'body 不受影响');
});

test('buildSettingsCss 正文规则镜像旧全集选择器（含 contenteditable 高特异性路径）', () => {
  const css = buildSettingsCss(DEFAULT_SETTINGS);
  // 根因回归：.notion-page-content * 只有 (0,1,0)，压不过 custom.css 旧副本里
  // 命中正文文字叶节点的 [contenteditable="true"]:first-of-type (0,2,0)；
  // 正文规则必须携带同特异性镜像选择器（设置 CSS 最后注入 → 同特异性者赢）
  assert.ok(css.includes('[contenteditable="true"]:first-of-type'));
  assert.ok(css.includes('.notion-page-block div[contenteditable="true"]'));
  assert.ok(css.includes('.notion-page-block > div > div[contenteditable="true"]'));
  assert.ok(css.includes('.notion-table_of_contents-block *'));
});

test('buildSettingsCss 代码槽：body 自定义时兜底等宽，code 自定义时换成用户字体', () => {
  const fallback = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: 'Aa', ui: '', code: '', math: '' } });
  assert.ok(/\.notion-code-block[^{]*\{[^}]*font-family: "Consolas"/.test(fallback), 'body 自定义时代码块重新兜底等宽（回归旧行为）');
  const custom = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: '', ui: '', code: 'JetBrains Mono', math: '' } });
  assert.ok(/\.notion-code-block[^{]*\{[^}]*font-family: "JetBrains Mono", "Consolas"/.test(custom));
  assert.ok(custom.includes('[role="dialog"] .notion-code-block'), '浮层预览里的代码块一并覆盖');
});

test('buildSettingsCss 代码正文 contenteditable 专项选择器：压过正文 (0,2,1) 防代码体落到正文字体', () => {
  // 代码正文在 div[contenteditable="true"] 内，被正文 .notion-page-block div[contenteditable]
  // "true" * (0,2,1) 压过——需镜像同结构 .notion-code-block div[contenteditable="true"] *
  // (0,2,1)，同特异性后注入者赢。否则代码体显示正文字体，仅语言标签生效。
  const css = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: 'Aa', ui: '', code: '', math: '' } });
  assert.ok(css.includes('.notion-code-block div[contenteditable="true"] *'), '代码正文 contenteditable 专项选择器');
  assert.ok(css.includes('[role="dialog"] .notion-code-block div[contenteditable="true"] *'), '浮层预览代码正文同样覆盖');
});

test('buildSettingsCss 行内代码选择器：覆盖 .notion-inline-code-container（Notion 行内代码真实结构）', () => {
  // Notion 行内代码是 div.notion-inline-code-container（非 <code>），内部 span 带内联等宽
  // font-family（无 !important）被正文 .notion-page-content * (0,1,0) !important 压过。
  // .notion-page-content .notion-inline-code-container * (0,2,0) !important 压过正文 0,1,0，
  // 并等于 :first-of-type 0,2,0（后注入者赢）；contenteditable 专项 (0,3,1) 兜底 pageBlock 在场。
  const css = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: 'Aa', ui: '', code: '', math: '' } });
  assert.ok(css.includes('.notion-page-content .notion-inline-code-container'), '行内代码容器选择器');
  assert.ok(css.includes('.notion-page-content .notion-inline-code-container *'), '行内代码内部 span（带内联 font-family）覆盖');
  assert.ok(css.includes('.notion-page-content div[contenteditable="true"] .notion-inline-code-container'), 'contenteditable 专项 (0,3,1) 兜底 pageBlock 在场');
  assert.ok(css.includes('[role="dialog"] .notion-inline-code-container'), '浮层预览行内代码同样覆盖');
});

test('buildSettingsCss 公式槽：默认不下发，自定义时内联+展示+浮层全覆盖并垫 KaTeX_Main', () => {
  const custom = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: '', ui: '', code: '', math: 'Cambria Math' } });
  assert.ok(custom.includes('"Cambria Math", "KaTeX_Main", "Times New Roman", serif'));
  // .notion-text-block 专项 (0,4,0) 复用 default.css 同特异性 :not 选择器（同特异性后注入者赢）
  assert.ok(custom.includes('.notion-text-block .katex:not(.katex-display .katex)'));
  // 通用行内选择器覆盖标题/列表/引用/Callout 等其它块里的行内公式（压过正文 0,2,0）
  assert.ok(custom.includes('.katex:not(.katex-display .katex)'), '行内公式全块类型覆盖');
  assert.ok(custom.includes('.katex-display .katex'), '展示公式一并覆盖');
  assert.ok(custom.includes('[role="dialog"] .katex'), '浮层预览里的公式一并覆盖');
});

test('buildSettingsCss 公式字体名同样过滤引号与反斜杠', () => {
  const css = buildSettingsCss({ ...DEFAULT_SETTINGS, fonts: { body: '', ui: '', code: '', math: 'Evil"; \\' } });
  // 注入的引号/反斜杠被剥掉，字体名被干净地包进回退链
  assert.ok(css.includes('"Evil; ", "KaTeX_Main", "Times New Roman", serif'));
  assert.ok(!css.includes('Evil"'));
  assert.ok(!css.includes('\\'));
});

test('buildSettingsCss 公式槽留空：内置默认优先 Times New Roman，未装才回落 Modern 系', () => {
  // 装了 Times New Roman 时默认即 Times New Roman（即便同时装有 Modern 系）；
  // 回退栈中同名条目去重，避免 "Times New Roman" 在链中重复出现
  const css = buildSettingsCss(DEFAULT_SETTINGS, ['Arial', 'Latin Modern Math', 'Times New Roman', '宋体']);
  assert.ok(css.includes('"Times New Roman", "KaTeX_Main", serif'), '默认链垫 KaTeX_Main 防缺字形，去重后无重复 Times New Roman');
  assert.ok(!css.includes('"Times New Roman", "KaTeX_Main", "Times New Roman"'), '回退栈去重，Times New Roman 不重复');
  assert.ok(css.includes('.katex-display .katex'), '展示公式一并覆盖');
  assert.ok(css.includes('.katex:not(.katex-display .katex)'), '行内公式全块覆盖');
  // 未装 Times New Roman 才回落 Modern 系（安装名不一：Modern Math / Latin Modern Roman / Modern）
  assert.ok(buildSettingsCss(DEFAULT_SETTINGS, ['Arial', 'Modern Math']).includes('"Modern Math",'));
  assert.ok(buildSettingsCss(DEFAULT_SETTINGS, ['Modern']).includes('"Modern",'));
});

test('buildSettingsCss 公式槽留空且未装 Times New Roman 与 Modern 系：仍不下发（默认维持 default.css）', () => {
  // Cambria Math 是 Windows 必装的非 Modern 系数学字体，不能误匹配（实测根因：
  // 只看 math 关键词会让所有 Windows 机器的默认公式字体解析成 Cambria Math）
  const css = buildSettingsCss(DEFAULT_SETTINGS, ['Arial', '宋体', 'Consolas', 'Cambria Math']);
  assert.ok(!css.includes('katex'), 'Times New Roman 与 Modern 系都没装时零变化');
});

test('buildSettingsCss 公式槽用户填入优先于 Modern 默认', () => {
  const css = buildSettingsCss(
    { ...DEFAULT_SETTINGS, fonts: { body: '', ui: '', code: '', math: 'Cambria Math' } },
    ['Arial', 'Latin Modern Math'],
  );
  assert.ok(css.includes('"Cambria Math", "KaTeX_Main", "Times New Roman", serif'));
  assert.ok(!css.includes('"Latin Modern Math"'), '用户选择不被 Modern 默认覆盖');
});
