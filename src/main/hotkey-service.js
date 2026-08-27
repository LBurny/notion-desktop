// 全局快捷键归口：显隐键常驻全局 + 聚焦期键（缩放/标签切换）。
// Ctrl+Tab 与 Ctrl+PageDown/PageUp 是 Chromium 保留键，到不了 before-input-event，
// 只能在主窗口聚焦期间注册为全局快捷键，失焦即注销，不影响其他应用。
// 缩放键同理只应在聚焦时生效——曾无条件全局注册，失焦误触且系统级占键（v0.2.10 修）；
// toggleWindow 必须保持全局：窗口隐藏到托盘时也要能唤回。
function createHotkeys({ globalShortcut, comboToAccelerator, isFocused, getCombos, actions }) {
  const TAB_KEYS = [
    ['CommandOrControl+PageDown', () => actions.nextTab()],
    ['CommandOrControl+Shift+PageUp', () => actions.prevTab()],
  ];

  // 聚焦期键 = Chromium 保留的标签切换键 + 用户可配置的缩放两键（组合可改，注册时现取）
  function focusedKeyPairs() {
    const pairs = [...TAB_KEYS];
    const combos = getCombos();
    if (combos) {
      pairs.push([comboToAccelerator(combos.zoomIn), actions.zoomIn]);
      pairs.push([comboToAccelerator(combos.zoomOut), actions.zoomOut]);
    }
    return pairs;
  }

  function registerFocusedKeys() {
    if (!isFocused()) return;
    for (const [acc, fn] of focusedKeyPairs()) {
      try { globalShortcut.register(acc, fn); } catch { /* 已注册则忽略 */ }
    }
  }

  function unregisterFocusedKeys() {
    for (const [acc] of focusedKeyPairs()) {
      try { globalShortcut.unregister(acc); } catch { /* 未注册则忽略 */ }
    }
  }

  function registerAll() {
    globalShortcut.unregisterAll();
    const combos = getCombos();
    if (combos) {
      try { globalShortcut.register(comboToAccelerator(combos.toggleWindow), actions.toggleWindow); } catch { /* 非法组合直接忽略 */ }
    }
    registerFocusedKeys();
  }

  return { registerAll, registerFocusedKeys, unregisterFocusedKeys };
}

module.exports = { createHotkeys };