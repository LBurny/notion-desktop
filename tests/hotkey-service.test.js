const test = require('node:test');
const assert = require('node:assert/strict');
const { createHotkeys } = require('../src/main/hotkey-service');
const { comboToAccelerator } = require('../src/main/hotkeys');

function makeGlobalShortcut({ failOn = [] } = {}) {
  const registered = new Map(); // accelerator → fn
  const calls = [];
  return {
    calls,
    registered,
    register(acc, fn) {
      calls.push(['register', acc]);
      if (failOn.includes(acc)) throw new Error('invalid accelerator');
      registered.set(acc, fn);
    },
    unregister(acc) {
      calls.push(['unregister', acc]);
      if (!registered.has(acc)) throw new Error('not registered');
      registered.delete(acc);
    },
    unregisterAll() { calls.push(['unregisterAll']); registered.clear(); },
    trigger(acc) { const fn = registered.get(acc); if (fn) fn(); },
  };
}

function setup({ focused = true, combos = null, gsOpts = {} } = {}) {
  const gs = makeGlobalShortcut(gsOpts);
  const fired = [];
  const state = { focused };
  const hk = createHotkeys({
    globalShortcut: gs,
    comboToAccelerator,
    isFocused: () => state.focused,
    getCombos: () => combos,
    actions: {
      zoomIn: () => fired.push('zoomIn'),
      zoomOut: () => fired.push('zoomOut'),
      toggleWindow: () => fired.push('toggleWindow'),
      nextTab: () => fired.push('nextTab'),
      prevTab: () => fired.push('prevTab'),
    },
  });
  return { gs, fired, state, hk };
}

const COMBOS = { zoomIn: 'Ctrl+Shift+=', zoomOut: 'Ctrl+Shift+-', toggleWindow: 'Ctrl+`' };
const ZOOM_IN_ACC = 'CommandOrControl+Shift+=';
const ZOOM_OUT_ACC = 'CommandOrControl+Shift+-';
const TOGGLE_ACC = 'CommandOrControl+`';

test('registerAll：只无条件注册 toggleWindow（曾把缩放键也全局注册导致失焦误触，v0.2.10 修）', () => {
  const { gs, hk } = setup({ combos: COMBOS, focused: false });
  hk.registerAll();
  assert.equal(gs.calls[0][0], 'unregisterAll');
  assert.ok(gs.registered.has(TOGGLE_ACC), '显隐键保持全局（隐藏时唤回）');
  assert.ok(!gs.registered.has(ZOOM_IN_ACC), '缩放键不得全局注册');
  assert.ok(!gs.registered.has(ZOOM_OUT_ACC), '缩放键不得全局注册');
  assert.ok(!gs.registered.has('CommandOrControl+PageDown'), '未聚焦不注册聚焦期键');
});

test('聚焦期：缩放键随 registerFocusedKeys 注册并触发动作', () => {
  const { gs, fired, hk } = setup({ combos: COMBOS, focused: true });
  hk.registerAll();
  assert.ok(gs.registered.has(ZOOM_IN_ACC));
  assert.ok(gs.registered.has(ZOOM_OUT_ACC));
  gs.trigger(ZOOM_IN_ACC);
  gs.trigger(ZOOM_OUT_ACC);
  gs.trigger(TOGGLE_ACC);
  gs.trigger('CommandOrControl+PageDown');
  assert.deepEqual(fired, ['zoomIn', 'zoomOut', 'toggleWindow', 'nextTab']);
});

test('失焦注销：缩放键与标签切换键一并注销，toggleWindow 保留', () => {
  const { gs, state, hk } = setup({ combos: COMBOS, focused: true });
  hk.registerAll();
  state.focused = false;
  hk.unregisterFocusedKeys();
  assert.ok(!gs.registered.has(ZOOM_IN_ACC), '失焦必须注销缩放键');
  assert.ok(!gs.registered.has(ZOOM_OUT_ACC));
  assert.ok(!gs.registered.has('CommandOrControl+PageDown'));
  assert.ok(gs.registered.has(TOGGLE_ACC), '用户键 toggleWindow 不受影响');
});

test('非法缩放组合被忽略，不影响其他键注册', () => {
  const { gs, hk } = setup({ combos: COMBOS, gsOpts: { failOn: [ZOOM_IN_ACC] } });
  hk.registerAll();
  assert.ok(!gs.registered.has(ZOOM_IN_ACC));
  assert.ok(gs.registered.has(ZOOM_OUT_ACC));
  assert.ok(gs.registered.has(TOGGLE_ACC));
});

test('getCombos 为 null 时不注册任何用户键（聚焦期也只剩标签切换键）', () => {
  const { gs, hk } = setup({ combos: null, focused: true });
  hk.registerAll();
  assert.equal(gs.registered.size, 2, '仅 Ctrl+PageDown / Ctrl+Shift+PageUp');
});

test('组合键改绑后聚焦期注销按新组合清理', () => {
  const { gs, hk } = setup({ combos: COMBOS, focused: true });
  hk.registerAll();
  const hk2 = hk; // 同一实例，getCombos 返回值换新组合
  // 模拟设置更新：直接换 combos 再走 registerAll（内部 unregisterAll 兜底），
  // 这里只验证 unregisterFocusedKeys 对当前 getCombos 生效
  gs.registered.clear();
  gs.register(ZOOM_IN_ACC, () => {});
  hk2.unregisterFocusedKeys();
  assert.ok(!gs.registered.has(ZOOM_IN_ACC));
});