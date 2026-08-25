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
    font: '思源宋体 CN', lineHeight: 1.8, paragraphSpacing: 6, zoom: 1.05, hideHelp: true,
    dividerWidth: 2.5, align: 'center',
    hotkeys: { zoomIn: 'Ctrl+Alt+Q', zoomOut: 'Ctrl+Alt+W', toggleWindow: 'Ctrl+Alt+E' },
    closeAction: 'quit',
    slashCommands: [{ combo: 'Ctrl+Shift+R', command: 'math' }],
  };
  saveSettings(f, s);
  assert.deepStrictEqual(loadSettings(f), s);
});

test('sanitizeSettings 钳位非法值', () => {
  const s = sanitizeSettings({
    font: 42, lineHeight: 5, paragraphSpacing: -3, zoom: 9, hideHelp: 'yes',
  });
  assert.strictEqual(s.font, '');
  assert.strictEqual(s.lineHeight, 3);
  assert.strictEqual(s.paragraphSpacing, 0);
  assert.strictEqual(s.zoom, 2);
  assert.strictEqual(s.hideHelp, false);
});

test('clampZoom 步进 1% 且限制在 50%~200%', () => {
  assert.strictEqual(clampZoom(1.234), 1.23);
  assert.strictEqual(clampZoom(0.01), 0.5);
  assert.strictEqual(clampZoom(99), 2);
  assert.strictEqual(clampZoom('abc'), 1.1);
});

test('默认页面缩放为 110%', () => {
  assert.strictEqual(DEFAULT_SETTINGS.zoom, 1.1);
  assert.strictEqual(sanitizeSettings(null).zoom, 1.1);
  assert.strictEqual(sanitizeSettings({ zoom: 'x' }).zoom, 1.1);
});

test('buildSettingsCss 默认设置只含行距规则', () => {
  const css = buildSettingsCss(DEFAULT_SETTINGS);
  assert.ok(css.includes('line-height: 1.73'));
  assert.ok(!css.includes('font-family'));
  assert.ok(!css.includes('margin-top'));
  assert.ok(!css.includes('notion-help-button'));
});

test('buildSettingsCss 全量设置生成对应规则', () => {
  const css = buildSettingsCss({
    font: '思源宋体 CN', lineHeight: 1.8, paragraphSpacing: 6, zoom: 1.1, hideHelp: true,
  });
  assert.ok(css.includes('font-family: "思源宋体 CN"'));
  assert.ok(css.includes('line-height: 1.8'));
  assert.ok(css.includes('margin-top: 6px'));
  assert.ok(css.includes('.notion-help-button'));
  assert.ok(css.includes('.notion-assistant-corner-origin-container'));
  assert.ok(css.includes('display: none'));
  // 自定义字体不波及代码块
  assert.ok(css.includes('.notion-code-block'));
});

test('buildSettingsCss 字体名过滤引号与反斜杠', () => {
  const css = buildSettingsCss({ ...DEFAULT_SETTINGS, font: 'Evil"; \\' });
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
  assert.strictEqual(s.font, 'Test');
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
