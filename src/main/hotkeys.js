// 设置文件里的按键组合（Ctrl+Shift+=）转成 Electron accelerator（CommandOrControl+Shift+=）
// Electron 用 CommandOrControl 跨平台表示 Ctrl / Cmd
function comboToAccelerator(combo) {
  return String(combo)
    .split('+')
    .map((p) => (p === 'Ctrl' ? 'CommandOrControl' : p))
    .join('+');
}

module.exports = { comboToAccelerator };
