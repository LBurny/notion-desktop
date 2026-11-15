const { comboFromInput } = require('./slash-commands');

// 浏览器式标签快捷键映射（纯逻辑）：Electron before-input-event 的 input → 动作
// newTab/closeTab 可在设置里改键（传 hotkeys 配置按组合键匹配）；未传则回退硬编码 Ctrl+T/Ctrl+W。
// next/prev/position 为浏览器同义键，不可配置。
function shortcutFor(input, hotkeys) {
  if (!input || input.type !== 'keyDown') return null;
  const k = String(input.key || '').toLowerCase();
  // 可配置键：设置页允许捕获 Ctrl/Alt 组合（HOTKEY_RE 同款），匹配必须放在
  // 「只认 Ctrl」的浏览器同义键闸口之前，否则用户改成的 Alt+T 永远走不到这里
  if (hotkeys && (input.control || input.alt)) {
    const combo = comboFromInput(input);
    if (combo) {
      if (combo === hotkeys.newTab) return { action: 'new-tab' };
      if (combo === hotkeys.closeTab) return { action: 'close-tab' };
    }
  }
  if (!input.control || input.alt) return null;
  if (!hotkeys) {
    if (k === 't') return { action: 'new-tab' };
    if (k === 'w') return { action: 'close-tab' };
  }
  if (k === 'tab') return { action: input.shift ? 'prev-tab' : 'next-tab' };
  // Chromium 会在 before-input-event 之前吞掉 Ctrl+Tab，PageDown/PageUp 是浏览器同义键，一并支持
  if (k === 'pagedown') return { action: 'next-tab' };
  if (k === 'pageup') return { action: 'prev-tab' };
  if (/^[1-9]$/.test(k)) return { action: 'position', position: Number(k) };
  return null;
}

module.exports = { shortcutFor };
