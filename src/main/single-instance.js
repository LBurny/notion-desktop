// 单实例锁：第二实例启动时，将已运行的第一实例主窗唤起并聚焦。
// 纯函数便于单测；index.js 负责实际调用 win.restore/show/focus。
// 行为约定：主窗隐藏到托盘（closeAction=tray）时双击快捷方式应唤回；
// 主窗被最小化时先 restore 再 focus；窗口已销毁则不操作

function secondInstanceAction(winState) {
  if (!winState || winState.destroyed) return { show: false, restore: false, focus: false };
  return {
    show: !winState.visible,
    restore: !!winState.minimized,
    focus: true,
  };
}

module.exports = { secondInstanceAction };