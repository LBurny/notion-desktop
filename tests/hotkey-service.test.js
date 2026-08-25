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

test('registerAll：先全注销，再注册 3 个用户键（Ctrl→CommandOrControl），附挂标签切换键', () => {
  const { gs, hk } = setup({ combos: COMBOS, focused: true });
  hk.registerAll();
  assert.equal(gs.calls[0][0], 'unregisterAll');
  assert.ok(gs.registered.has('CommandOrControl+Shift+='));
  assert.ok(gs.registered.has('CommandOrControl+Shift+-'));
  assert.ok(gs.registered.has('CommandOrControl+`'));
  assert.ok(gs.registered.has('CommandOrControl+PageDown'));
});

test('快捷键触发映射到对应动作', () => {
  const { gs, fired, hk } = setup({ combos: COMBOS });
  hk.registerAll();
  gs.trigger('CommandOrControl+Shift+=');
  gs.trigger('CommandOrControl+`');
  gs.trigger('CommandOrControl+PageDown');
  assert.deepEqual(fired, ['zoomIn', 'toggleWindow', 'nextTab']);
});

test('非法组合被忽略，不影响其他键注册', () => {
  const { gs, hk } = setup({ combos: COMBOS, gsOpts: { failOn: ['CommandOrControl+Shift+='] } });
  hk.registerAll();
  assert.ok(!gs.registered.has('CommandOrControl+Shift+='));
  assert.ok(gs.registered.has('CommandOrControl+Shift+-'));
});

test('getCombos 为 null 时不注册用户键', () => {
  const { gs, hk } = setup({ combos: null, focused: false });
  hk.registerAll();
  assert.equal(gs.registered.size, 0);
});

test('标签切换键仅聚焦期注册；失焦注销且不影响用户键', () => {
  const { gs, state, hk } = setup({ combos: COMBOS, focused: false });
  hk.registerAll();
  assert.ok(!gs.registered.has('CommandOrControl+PageDown'), '未聚焦不注册切换键');

  state.focused = true;
  hk.registerTabSwitch();
  assert.ok(gs.registered.has('CommandOrControl+PageDown'));
  assert.ok(gs.registered.has('CommandOrControl+Shift+PageUp'));

  hk.unregisterTabSwitch();
  assert.ok(!gs.registered.has('CommandOrControl+PageDown'));
  assert.ok(!gs.registered.has('CommandOrControl+Shift+PageUp'));
  assert.ok(gs.registered.has('CommandOrControl+`'), '用户键不受影响');
});
