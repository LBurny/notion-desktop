const $ = (id) => document.getElementById(id);

let settings = window.settingsApi.get();

// 字体下拉只列出系统里真实安装的候选字体，仍可手动输入任意字体名
(function fillFontList() {
  const list = $('font-list');
  const { CANDIDATE_FONTS, filterAvailableFonts, isFontAvailable } = window.fontDetect;
  for (const name of filterAvailableFonts(CANDIDATE_FONTS, isFontAvailable)) {
    const opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  }
})();

function render() {
  $('font').value = settings.font;
  $('lineHeight').value = settings.lineHeight;
  $('paragraphSpacing').value = settings.paragraphSpacing;
  $('zoom-label').textContent = Math.round(settings.zoom * 100) + '%';
  $('hideHelp').checked = settings.hideHelp;
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

$('font').addEventListener('input', (e) => { settings.font = e.target.value; push(); });
$('lineHeight').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (Number.isFinite(v)) { settings.lineHeight = v; push(); }
});
$('paragraphSpacing').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (Number.isFinite(v)) { settings.paragraphSpacing = v; push(); }
});
$('zoom-out').addEventListener('click', () => {
  settings.zoom = Math.round((settings.zoom - 0.01) * 100) / 100;
  render();
  commit();
});
$('zoom-in').addEventListener('click', () => {
  settings.zoom = Math.round((settings.zoom + 0.01) * 100) / 100;
  render();
  commit();
});
$('hideHelp').addEventListener('change', (e) => {
  settings.hideHelp = e.target.checked;
  commit();
});

$('close').addEventListener('click', () => window.settingsApi.close());

document.documentElement.dataset.theme = window.settingsApi.getTheme();
window.settingsApi.onTheme((theme) => {
  document.documentElement.dataset.theme = theme;
});

render();
