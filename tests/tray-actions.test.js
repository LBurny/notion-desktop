const test = require('node:test');
const assert = require('node:assert');
const { resolveTrayAction } = require('../src/main/tray-actions');

test('托盘菜单 open：弹主窗，不开设置', () => {
  assert.deepStrictEqual(resolveTrayAction('open'), { showMain: true, settingsKind: null, quit: false });
});

test('托盘菜单 style/settings：开对应子窗口，不连带弹出主窗口（回归）', () => {
  // 主窗最小化到托盘时打开设置/样式，只应出现子窗口；
  // 设置窗居中定位用的 win.getBounds() 在主窗隐藏时仍有效
  assert.deepStrictEqual(resolveTrayAction('style'), { showMain: false, settingsKind: 'style', quit: false });
  assert.deepStrictEqual(resolveTrayAction('settings'), { showMain: false, settingsKind: 'app', quit: false });
});

test('托盘菜单 quit：退出；未知动作无操作', () => {
  assert.deepStrictEqual(resolveTrayAction('quit'), { showMain: false, settingsKind: null, quit: true });
  assert.deepStrictEqual(resolveTrayAction('bogus'), { showMain: false, settingsKind: null, quit: false });
});
