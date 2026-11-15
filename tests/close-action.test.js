// 主窗关闭动作决策：默认 hide→托盘；closeAction='quit' 必须主动 app.quit()。
// 回归点：quit 分支曾依赖 window-all-closed，而缓存/隐藏的托盘菜单窗与设置窗
// 让该事件永不触发（实测 Electron 43），进程残留且托盘点击抛 destroyed。
const test = require('node:test');
const assert = require('node:assert/strict');
const { windowClosePlan } = require('../src/main/close-action');

test('默认（tray）：拦截关闭并隐藏到托盘', () => {
  assert.deepEqual(windowClosePlan({ closeAction: 'tray' }), {
    preventDefault: true, hide: true, quit: false,
  });
  assert.deepEqual(windowClosePlan({}), {
    preventDefault: true, hide: true, quit: false,
  });
});

test('closeAction=quit：放行关闭并主动退出（不依赖 window-all-closed）', () => {
  assert.deepEqual(windowClosePlan({ closeAction: 'quit' }), {
    preventDefault: false, hide: false, quit: true,
  });
});

test('正在退出（托盘退出/系统关机）：不再拦截、不重复 quit', () => {
  for (const closeAction of ['tray', 'quit']) {
    assert.deepEqual(windowClosePlan({ closeAction, isQuitting: true }), {
      preventDefault: false, hide: false, quit: false,
    });
  }
});
