// 浏览器式标签快捷键映射（纯逻辑）：Electron before-input-event 的 input → 动作
function shortcutFor(input) {
  if (!input || input.type !== 'keyDown' || !input.control || input.alt) return null;
  const k = String(input.key || '').toLowerCase();
  if (k === 't') return { action: 'new-tab' };
  if (k === 'w') return { action: 'close-tab' };
  if (k === 'tab') return { action: input.shift ? 'prev-tab' : 'next-tab' };
  // Chromium 会在 before-input-event 之前吞掉 Ctrl+Tab，PageDown/PageUp 是浏览器同义键，一并支持
  if (k === 'pagedown') return { action: 'next-tab' };
  if (k === 'pageup') return { action: 'prev-tab' };
  if (/^[1-9]$/.test(k)) return { action: 'position', position: Number(k) };
  return null;
}

module.exports = { shortcutFor };
