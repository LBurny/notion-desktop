const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings, clampZoom, buildSettingsCss,
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
    hotkeys: { zoomIn: 'Ctrl+Alt+Q', zoomOut: 'Ctrl+Alt+W', toggleWindow: 'Ctrl+Alt+E' },
    closeAction: 'quit',
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
  assert.strictEqual(clampZoom('abc'), 1);
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

test('loadSettings 旧版文件（无快捷键字段）补齐默认值', () => {
  const f = tmpFile('old.json');
  fs.writeFileSync(f, JSON.stringify({ font: 'Test', lineHeight: 1.8, paragraphSpacing: 2, zoom: 1.1, hideHelp: true }));
  const s = loadSettings(f);
  assert.deepStrictEqual(s.hotkeys, DEFAULT_SETTINGS.hotkeys);
  assert.strictEqual(s.closeAction, 'tray');
  assert.strictEqual(s.font, 'Test');
});
