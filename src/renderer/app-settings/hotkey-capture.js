// 设置窗捕获 keydown，转成设置文件里的组合键写法（如 Ctrl+Shift+=）
// 浏览器里挂 window.hotkeyCapture，Node 测试里走 module.exports
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.hotkeyCapture = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY_BY_CODE = {
    Equal: '=', Minus: '-', Backquote: '`',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  };
  for (let i = 0; i < 26; i++) KEY_BY_CODE['Key' + String.fromCharCode(65 + i)] = String.fromCharCode(65 + i);
  for (let i = 0; i <= 9; i++) KEY_BY_CODE['Digit' + i] = String(i);
  for (let i = 1; i <= 24; i++) KEY_BY_CODE['F' + i] = 'F' + i;

  const MODIFIER_CODES = new Set([
    'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  ]);

  function comboFromKeyEvent(e) {
    if (!e || MODIFIER_CODES.has(e.code)) return null;
    const key = KEY_BY_CODE[e.code];
    if (!key) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    // 必须带 Ctrl/Alt/Shift 之一（HOTKEY_RE 也只认这三个），Meta 不参与
    if (mods.length === 0) return null;
    return mods.join('+') + '+' + key;
  }

  return { comboFromKeyEvent };
});
