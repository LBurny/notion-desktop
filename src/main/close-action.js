// 主窗关闭动作（纯函数，便于单测）。
// 关键坑（实测，Electron 43）：closeAction='quit' 时不能只靠「放行关闭 → window-all-closed
// → app.quit()」——托盘菜单窗与缓存的样式/设置窗是**隐藏但未销毁**的 BrowserWindow，
// 它们的存在让 window-all-closed 永远不触发：主窗消失、进程残留，之后点托盘图标
// （win.isVisible()/show()）直接抛 "Object has been destroyed"。
// 所以 quit 分支必须主动 app.quit()。
function windowClosePlan({ closeAction, isQuitting = false } = {}) {
  if (isQuitting) return { preventDefault: false, hide: false, quit: false };
  // 不拦截本次关闭：主窗照常销毁，随后（setImmediate）主动 app.quit() 收掉隐藏子窗
  if (closeAction === 'quit') return { preventDefault: false, hide: false, quit: true };
  return { preventDefault: true, hide: true, quit: false };
}

module.exports = { windowClosePlan };
