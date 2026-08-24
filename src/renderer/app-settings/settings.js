const $ = (id) => document.getElementById(id);

let settings = window.settingsApi.get();

function render() {
  for (const name of ['zoomIn', 'zoomOut', 'toggleWindow']) {
    $('hk-' + name).value = settings.hotkeys[name];
  }
  $('close-tray').checked = settings.closeAction !== 'quit';
  $('close-quit').checked = settings.closeAction === 'quit';
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
  el.textContent = '已保存';
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
    input.placeholder = '按下快捷键…';
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
    hk.title = '点击后按下新快捷键，Esc 取消';
    attachCapture(hk, () => settings.slashCommands[i].combo, (c) => { settings.slashCommands[i].combo = c; });

    const cmd = document.createElement('input');
    cmd.className = 'slash-cmd';
    cmd.type = 'text';
    cmd.value = item.command;
    cmd.placeholder = '命令词，如 math';
    cmd.spellcheck = false;
    cmd.addEventListener('input', () => {
      settings.slashCommands[i].command = cmd.value.replace(/^\/+/, '');
      push();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'slash-del';
    del.textContent = '✕';
    del.title = '删除';
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

$('close').addEventListener('click', () => window.settingsApi.close());

document.documentElement.dataset.theme = window.settingsApi.getTheme();
window.settingsApi.onTheme((theme) => {
  document.documentElement.dataset.theme = theme;
});

render();
