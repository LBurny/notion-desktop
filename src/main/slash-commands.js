// 斜杠命令快捷键：组合键匹配 + 向聚焦页面注入 '/word' + 真实 Enter
// insertText 走 Chromium 文本提交通道，绕过系统 IME（中文输入法激活也能触发菜单）
// Enter 必须真实按键（Notion 菜单忽略非可信 keydown）；webContents.sendInputEvent 在
// Electron 43 上会卡死主进程，故经 PowerShell SendKeys 发 OS 级按键
const { execFile } = require('child_process');
const { comboFromKeyEvent } = require('../renderer/app-settings/hotkey-capture');

// 合成按键（SendKeys/远程桌面/部分 IME）没有 scancode，input.code 为空，
// 退回用 input.key 拼出与设置页捕获一致的写法（单字符大写，命名键查表）
const KEY_FALLBACK = {
  ' ': 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};
for (let i = 1; i <= 24; i++) KEY_FALLBACK['F' + i] = 'F' + i;

// before-input-event 的 input（control/shift/alt/code/key）适配成设置里的组合键写法
function comboFromInput(input) {
  if (!input || input.type !== 'keyDown') return null;
  const mods = [];
  if (input.control) mods.push('Ctrl');
  if (input.alt) mods.push('Alt');
  if (input.shift) mods.push('Shift');
  if (mods.length === 0) return null;
  const byCode = input.code ? comboFromKeyEvent({
    code: input.code,
    ctrlKey: !!input.control, altKey: !!input.alt, shiftKey: !!input.shift,
  }) : null;
  if (byCode) return byCode;
  let name = null;
  if (typeof input.key === 'string') {
    name = KEY_FALLBACK[input.key] || (input.key.length === 1 ? input.key.toUpperCase() : null);
  }
  return name ? mods.join('+') + '+' + name : null;
}

function findSlashCommand(list, input) {
  const combo = comboFromInput(input);
  if (!combo || !Array.isArray(list)) return null;
  return list.find((c) => c.combo === combo) || null;
}

// 向自己窗口发真实 Enter：前置窗口后 SendKeys('{ENTER}')
function sendEnterKey(pid = process.pid) {
  const ps = [
    `Add-Type -AssemblyName System.Windows.Forms`,
    `$u = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int p);' -Name U32E -PassThru`,
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    `if (-not $p -or $p.MainWindowHandle -eq 0) { exit 3 }`,
    `$u::AllowSetForegroundWindow(-1) | Out-Null`,
    `$u::SetForegroundWindow($p.MainWindowHandle) | Out-Null`,
    `Start-Sleep -Milliseconds 120`,
    `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`,
  ].join('; ');
  execFile('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }, () => {});
}

function runSlashCommand(wc, command, opts = {}) {
  const word = String(command || '').replace(/^\/+/, '').trim();
  if (!word || !wc) return false;
  const enterDelay = opts.enterDelay ?? 300;
  const sendEnter = opts.sendEnter || sendEnterKey;
  try { wc.focus(); } catch { return false; }
  // '/word' 一次性文本提交：编辑器聚焦时 '/' 会打开斜杠菜单，word 作为过滤词
  wc.insertText('/' + word);
  setTimeout(() => { if (!wc.isDestroyed()) sendEnter(); }, enterDelay);
  return true;
}

module.exports = { comboFromInput, findSlashCommand, runSlashCommand, sendEnterKey };
