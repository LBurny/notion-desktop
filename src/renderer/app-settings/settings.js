const $ = (id) => document.getElementById(id);

let settings = window.settingsApi.get();
// 界面语言：resolveLanguage(设置项, 系统语言)；onLanguage 收到的是主进程已解析的结果
let lang = window.i18n.resolveLanguage(settings.language, window.settingsApi.systemLocale());
const t = (k) => window.i18n.t(lang, k);

function applyLang() {
  document.documentElement.lang = lang;
  window.i18n.applyLanguage(document, lang);
}

function render() {
  for (const name of ['zoomIn', 'zoomOut', 'toggleWindow']) {
    $('hk-' + name).value = settings.hotkeys[name];
  }
  $('close-tray').checked = settings.closeAction !== 'quit';
  $('close-quit').checked = settings.closeAction === 'quit';
  $('launch-at-login').checked = settings.launchAtLogin === true;
  document.querySelector(`input[name="language"][value="${settings.language}"]`).checked = true;
  renderSlash();
}

let timer = null;
function push() {
  clearTimeout(timer);
  timer = setTimeout(commit, 300);
}

let savedTimer = null;
function showSaved() {
  const el = $('hint');
  el.textContent = t('common.saved');
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

async function commit() {
  try {
    await window.settingsApi.update(settings);
    showSaved();
  } catch { /* 保存失败则不提示 */ }
}

// 快捷键捕获：点击输入框后按下组合键即录入，Esc 取消
function attachCapture(input, get, set) {
  input.addEventListener('focus', () => {
    input.value = '';
    input.placeholder = t('settings.hotkeyCapture');
    input.classList.add('capturing');
  });
  input.addEventListener('blur', () => {
    input.classList.remove('capturing');
    input.placeholder = '';
    input.value = get();
  });
  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Escape') { input.blur(); return; }
    const combo = window.hotkeyCapture.comboFromKeyEvent(e);
    if (!combo) return; // 纯修饰键或不支持的按键，继续等
    set(combo);
    commit();
    input.blur();
  });
}

for (const name of ['zoomIn', 'zoomOut', 'toggleWindow']) {
  attachCapture($('hk-' + name), () => settings.hotkeys[name], (c) => { settings.hotkeys[name] = c; });
}

// 斜杠命令快捷键列表：组合键 + 命令词，可增删
function renderSlash() {
  const box = $('slash-list');
  box.textContent = '';
  settings.slashCommands.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'row slash-row';

    const hk = document.createElement('input');
    hk.className = 'hotkey slash-hk';
    hk.type = 'text';
    hk.readOnly = true;
    hk.value = item.combo;
    hk.title = t('settings.hotkeyTitle');
    attachCapture(hk, () => settings.slashCommands[i].combo, (c) => { settings.slashCommands[i].combo = c; });

    const cmd = document.createElement('input');
    cmd.className = 'slash-cmd';
    cmd.type = 'text';
    cmd.value = item.command;
    cmd.placeholder = t('settings.slashCmdPlaceholder');
    cmd.spellcheck = false;
    cmd.addEventListener('input', () => {
      settings.slashCommands[i].command = cmd.value.replace(/^\/+/, '');
      push();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'slash-del';
    del.textContent = '✕';
    del.title = t('settings.delete');
    del.addEventListener('click', () => {
      settings.slashCommands.splice(i, 1);
      renderSlash();
      commit();
    });

    row.append(hk, cmd, del);
    box.appendChild(row);
  });
}

$('slash-add').addEventListener('click', () => {
  if (settings.slashCommands.length >= 10) return;
  settings.slashCommands.push({ combo: 'Ctrl+Shift+X', command: '' });
  renderSlash();
  push();
});

$('close-tray').addEventListener('change', () => {
  if ($('close-tray').checked) { settings.closeAction = 'tray'; commit(); }
});
$('close-quit').addEventListener('change', () => {
  if ($('close-quit').checked) { settings.closeAction = 'quit'; commit(); }
});

$('launch-at-login').addEventListener('change', (e) => {
  settings.launchAtLogin = e.target.checked;
  commit();
});

// 语言切换：本地即时生效（不等广播往返），提交后主进程广播统一各窗口
document.querySelectorAll('input[name="language"]').forEach((r) => {
  r.addEventListener('change', (e) => {
    settings.language = e.target.value;
    lang = window.i18n.resolveLanguage(settings.language, window.settingsApi.systemLocale());
    applyLang();
    renderSlash(); // JS 动态文案（占位符/tooltip）随语言重建
    commit();
  });
});

$('close').addEventListener('click', () => window.settingsApi.close());

document.documentElement.dataset.theme = window.settingsApi.getTheme();
window.settingsApi.onTheme((theme) => {
  document.documentElement.dataset.theme = theme;
});

// 语言广播：另一个窗口改了语言后本窗即时跟随；同时刷新本地设置快照，
// 避免之后本窗提交把对方改过的字段（含 language 本身）写回旧值
window.settingsApi.onLanguage((l) => {
  settings = window.settingsApi.get();
  lang = l;
  applyLang();
  render();
});

applyLang();
render();
