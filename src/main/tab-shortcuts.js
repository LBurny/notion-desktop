const { comboFromInput } = require('./slash-commands');

// 浏览器式标签快捷键映射（纯逻辑）：Electron before-input-event 的 input → 动作
// newTab/closeTab 可在设置里改键（传 hotkeys 配置按组合键匹配）；未传则回退硬编码 Ctrl+T/Ctrl+W。
// next/prev/position 为浏览器同义键，不可配置。
function shortcutFor(input, hotkeys) {
  if (!input || input.type !== 'keyDown' || !input.control || input.alt) return null;
  const k = String(input.key || '').toLowerCase();
  if (hotkeys) {
    const combo = comboFromInput(input);
    if (combo) {
      if (combo === hotkeys.newTab) return { action: 'new-tab' };
      if (combo === hotkeys.closeTab) return { action: 'close-tab' };
    }
  } else if (k === 't') {
    return { action: 'new-tab' };
  } else if (k === 'w') {
    return { action: 'close-tab' };
  }
  if (k === 'tab') return { action: input.shift ? 'prev-tab' : 'next-tab' };
  // Chromium 会在 before-input-event 之前吞掉 Ctrl+Tab，PageDown/PageUp 是浏览器同义键，一并支持
  if (k === 'pagedown') return { action: 'next-tab' };
  if (k === 'pageup') return { action: 'prev-tab' };
  if (/^[1-9]$/.test(k)) return { action: 'position', position: Number(k) };
  return null;
}

module.exports = { shortcutFor };
