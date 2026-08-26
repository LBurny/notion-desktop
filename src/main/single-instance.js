// 单实例锁：第二实例启动时，将已运行的第一实例主窗唤起并聚焦。
// 纯函数便于单测；index.js 负责实际调用 win.restore/show/focus。
// 行为约定：主窗隐藏到托盘（closeAction=tray）时双击快捷方式应唤回；
// 主窗被最小化时先 restore 再 focus；窗口已销毁则不操作。
// Windows 下 show()/restore() 本身已激活窗口前台，再调 focus() 会触发
// 二次激活导致可见抖动——所以 show/restore 时不重复 focus（仅当两者都
// 不需要、窗口已可见但可能失焦时才单独 focus）

function secondInstanceAction(winState) {
  if (!winState || winState.destroyed) return { show: false, restore: false, focus: false };
  const needsShow = !winState.visible;
  const needsRestore = !!winState.minimized;
  return {
    show: needsShow,
    restore: needsRestore,
    focus: !needsShow && !needsRestore,
  };
}

module.exports = { secondInstanceAction };