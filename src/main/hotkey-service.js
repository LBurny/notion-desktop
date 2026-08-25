// 全局快捷键归口：用户自定义三键（缩放/显隐）+ 聚焦期标签切换键。
// Ctrl+Tab 与 Ctrl+PageDown/PageUp 是 Chromium 保留键，到不了 before-input-event，
// 只能在主窗口聚焦期间注册为全局快捷键，失焦即注销，不影响其他应用
function createHotkeys({ globalShortcut, comboToAccelerator, isFocused, getCombos, actions }) {
  const TAB_KEYS = [
    ['CommandOrControl+PageDown', () => actions.nextTab()],
    ['CommandOrControl+Shift+PageUp', () => actions.prevTab()],
  ];

  function registerTabSwitch() {
    if (!isFocused()) return;
    for (const [acc, fn] of TAB_KEYS) {
      try { globalShortcut.register(acc, fn); } catch { /* 已注册则忽略 */ }
    }
  }

  function unregisterTabSwitch() {
    for (const [acc] of TAB_KEYS) {
      try { globalShortcut.unregister(acc); } catch { /* 未注册则忽略 */ }
    }
  }

  function registerAll() {
    globalShortcut.unregisterAll();
    const combos = getCombos();
    if (combos) {
      const bind = (combo, fn) => {
        try { globalShortcut.register(comboToAccelerator(combo), fn); } catch { /* 非法组合直接忽略 */ }
      };
      bind(combos.zoomIn, actions.zoomIn);
      bind(combos.zoomOut, actions.zoomOut);
      bind(combos.toggleWindow, actions.toggleWindow);
    }
    registerTabSwitch();
  }

  return { registerAll, registerTabSwitch, unregisterTabSwitch };
}

module.exports = { createHotkeys };
