// 开机自启（静默到托盘）：Electron 登录项薄封装，app 以参数注入便于单测。
// Windows 下 setLoginItemSettings 写注册表 Run 键；带静默标记参数，
// 登录项拉起时 shouldStartHidden 据此不弹主窗（wasOpenedAtLogin 为主，argv 标记双保险）。
const SILENT_ARG = '--silent-start';

function syncLoginItem(app, enabled) {
  app.setLoginItemSettings(enabled
    ? { openAtLogin: true, args: [SILENT_ARG] }
    : { openAtLogin: false });
}

function shouldStartHidden(app) {
  if (process.argv.includes(SILENT_ARG)) return true;
  return app.getLoginItemSettings().wasOpenedAtLogin === true;
}

module.exports = { SILENT_ARG, syncLoginItem, shouldStartHidden };
