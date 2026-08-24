// 托盘菜单弹窗定位：默认居中于图标上方，水平方向钳位到工作区内，
// 上方空间不足（任务栏在屏幕顶部）时改放图标下方。
function calcMenuPosition(trayBounds, menuSize, workArea) {
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - menuSize.width / 2);
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - menuSize.width));
  let y = trayBounds.y - menuSize.height - 4;
  if (y < workArea.y) y = trayBounds.y + trayBounds.height + 4;
  return { x, y };
}

module.exports = { calcMenuPosition };
