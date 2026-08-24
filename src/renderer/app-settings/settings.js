const $ = (id) => document.getElementById(id);

let settings = window.settingsApi.get();

function render() {
  for (const name of ['zoomIn', 'zoomOut', 'toggleWindow']) {
    $('hk-' + name).value = settings.hotkeys[name];
  }
  $('close-tray').checked = settings.closeAction !== 'quit';
  $('close-quit').checked = settings.closeAction === 'quit';
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
for (const name of ['zoomIn', 'zoomOut', 'toggleWindow']) {
  const input = $('hk-' + name);
  input.addEventListener('focus', () => {
    input.value = '';
    input.placeholder = '按下快捷键…';
    input.classList.add('capturing');
  });
  input.addEventListener('blur', () => {
    input.classList.remove('capturing');
    input.placeholder = '';
    input.value = settings.hotkeys[name];
  });
  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Escape') { input.blur(); return; }
    const combo = window.hotkeyCapture.comboFromKeyEvent(e);
    if (!combo) return; // 纯修饰键或不支持的按键，继续等
    settings.hotkeys[name] = combo;
    commit();
    input.blur();
  });
}

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
