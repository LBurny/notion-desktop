// 安装器桌面快捷方式：v0.2.13 实测「装完桌面没有图标」的根因是旧记忆值 DesktopShortcut=0
// 被永久信任（完成页复选框因此默认不勾选、且只在完成页 LEAVE 建快捷方式）。
// 这里看护三件事：① 只认新版值、旧值一律忽略；② 卸载（非更新）时删掉快捷方式；
// ③ 完成页的「运行程序」复选框没被改坏。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const NSH = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('安装器不再读取不可信的旧值 DesktopShortcut', () => {
  assert.ok(
    !/ReadRegStr\s+\$\w+\s+HKCU\s+"\$\{INSTALL_REGISTRY_KEY\}"\s+"DesktopShortcut"/.test(NSH),
    '旧值 DesktopShortcut 可能是历史版本误写的 0，再读它会让快捷方式永久默认不建',
  );
  assert.ok(/"DesktopShortcutV2"/.test(NSH), '快捷方式选择应改用新值名 DesktopShortcutV2');
  assert.ok(
    /\$NDShortcutState\s*!=\s*"0"/.test(NSH),
    '只有新版安装器明确写入的 0 表示不建，缺失/旧值必须默认勾选',
  );
  assert.ok(/DeleteRegValue\s+HKCU\s+"\$\{INSTALL_REGISTRY_KEY\}"\s+"DesktopShortcut"/.test(NSH),
    '装完后应清掉旧值，避免以后排障时被残留的 0 误导');
});

test('完成页勾选时不建快捷方式仍由 FinishPageLeave 负责（与 createDesktopShortcut=false 配套）', () => {
  assert.equal(PKG.build.nsis.createDesktopShortcut, false);
  assert.ok(/CreateShortCut\s+"\$newDesktopLink"\s+"\$appExe"/.test(NSH), '完成页应创建桌面快捷方式');
  assert.ok(/WinShell::SetLnkAUMI\s+"\$newDesktopLink"/.test(NSH), '快捷方式应带上 AppUserModelID');
});

test('卸载时删除桌面快捷方式，升级（isUpdated）时保留', () => {
  const macro = NSH.match(/!macro customUnInstall([\s\S]*?)!macroend/);
  assert.ok(macro, '缺少 customUnInstall：createDesktopShortcut=false 会把 electron-builder 自带的删除逻辑编译掉');
  const body = macro[1];
  assert.ok(/\$\{ifNot\}\s+\$\{isUpdated\}/.test(body), '升级不该删掉用户的桌面图标');
  assert.ok(/Delete\s+"\$newDesktopLink"/.test(body), '卸载应删除桌面快捷方式');
});

test('完成页「运行程序」复选框（MUI_FINISHPAGE_RUN）保持可用', () => {
  assert.ok(/!define\s+MUI_FINISHPAGE_RUN\b/.test(NSH));
  assert.ok(/!insertmacro\s+MUI_PAGE_FINISH/.test(NSH), 'customFinishPage 必须插入完成页');
});
