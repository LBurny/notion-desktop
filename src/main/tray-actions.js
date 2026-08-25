// 托盘菜单动作分派（纯函数，便于单测）。
// 行为约定：open 才弹主窗；style/settings 只开子窗口——主窗最小化到托盘时
// 不应被连带唤醒（设置窗居中定位用的 win.getBounds() 在主窗隐藏时仍有效）。
function resolveTrayAction(action) {
  switch (action) {
    case 'open': return { showMain: true, settingsKind: null, quit: false };
    case 'style': return { showMain: false, settingsKind: 'style', quit: false };
    case 'settings': return { showMain: false, settingsKind: 'app', quit: false };
    case 'quit': return { showMain: false, settingsKind: null, quit: true };
    default: return { showMain: false, settingsKind: null, quit: false };
  }
}

module.exports = { resolveTrayAction };
