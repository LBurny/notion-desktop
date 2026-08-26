const $ = (id) => document.getElementById(id);

let settings = window.settingsApi.get();
// 界面语言：resolveLanguage(设置项, 系统语言)；onLanguage 收到的是主进程已解析的结果
let lang = window.i18n.resolveLanguage(settings.language, window.settingsApi.systemLocale());
const t = (k) => window.i18n.t(lang, k);

// 四个字体槽的占位符显示「前缀 + 内置默认名」；公式槽内置默认优先 Times New Roman
// （Windows 几乎必装），未装才回落本机已装的 Modern 系（Latin Modern Math /
// Modern Math / Modern 等），都没有才显示 KaTeX_Main
function applyPlaceholders() {
  const prefix = t('style.defaultPrefix');
  $('font-body').placeholder = prefix + '思源宋体 CN';
  $('font-ui').placeholder = prefix + '思源宋体 CN';
  $('font-code').placeholder = prefix + 'Consolas';
  $('font-math').placeholder = prefix + (window.fontDetect.pickMathDefaultFont(window.settingsApi.systemFonts()) || 'KaTeX_Main');
}

function applyLang() {
  document.documentElement.lang = lang;
  window.i18n.applyLanguage(document, lang);
  applyPlaceholders();
}

// 字体下拉：自绘可滚动列表（原生 datalist 弹层不跟主题、小窗内无法滚动）
// 只列出系统真实安装的候选字体，每项直接用该字体渲染预览；仍可手动输入任意字体名
// 四个字体槽位（正文/界面/代码/公式）各实例化一个，onChange 接收新值
function setupFontCombo(inputId, onChange) {
  const input = $(inputId);
  const combo = input.parentElement;
  const toggle = combo.querySelector('.font-toggle');
  const listEl = combo.querySelector('.font-options');
  const { CANDIDATE_FONTS, filterAvailableFonts, isFontAvailable } = window.fontDetect;
  // 优先列出系统全部已安装字体（注册表枚举，与 Word 同源）；
  // 枚举失败（如非 Windows）时退回候选名单 + canvas 探测
  const sysFonts = window.settingsApi.systemFonts();
  const fonts = (sysFonts && sysFonts.length)
    ? sysFonts
    : filterAvailableFonts(CANDIDATE_FONTS, isFontAvailable);
  let activeIdx = -1;

  const isOpen = () => !listEl.hidden;
  function close() { listEl.hidden = true; activeIdx = -1; }
  function open() { render(''); listEl.hidden = false; } // 展开总是显示全量，过滤只发生在输入时

  function render(filter) {
    const f = (filter || '').trim().toLowerCase();
    const shown = fonts.filter((n) => !f || n.toLowerCase().includes(f));
    listEl.textContent = '';
    activeIdx = -1;
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t('style.fontEmpty');
      listEl.appendChild(li);
      return;
    }
    for (const name of shown) {
      const li = document.createElement('li');
      li.textContent = name;
      li.style.fontFamily = `"${name}"`;
      // mousedown 先于 input 的 blur，preventDefault 保住焦点不打断选择
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = name;
        onChange(input.value);
        close();
      });
      listEl.appendChild(li);
    }
  }

  function moveActive(step) {
    const items = listEl.querySelectorAll('li:not(.empty)');
    if (!items.length) return;
    activeIdx = (activeIdx + step + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    items[activeIdx].scrollIntoView({ block: 'nearest' });
  }

  toggle.addEventListener('mousedown', (e) => e.preventDefault()); // 别抢 input 焦点
  toggle.addEventListener('click', () => {
    if (isOpen()) { close(); } else { open(); }
    input.focus();
  });
  input.addEventListener('focus', open);
  input.addEventListener('input', () => { onChange(input.value); render(input.value); listEl.hidden = false; });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen()) { open(); return; }
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && isOpen()) {
      const items = listEl.querySelectorAll('li:not(.empty)');
      if (activeIdx >= 0 && items[activeIdx]) {
        input.value = items[activeIdx].textContent;
        onChange(input.value);
      }
      close();
    } else if (e.key === 'Escape' && isOpen()) {
      close();
      e.stopPropagation();
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (isOpen() && !combo.contains(e.target)) close();
  });
}

for (const slot of ['body', 'ui', 'code', 'math']) {
  setupFontCombo(`font-${slot}`, (v) => { settings.fonts[slot] = v; push(); });
}

function render() {
  for (const slot of ['body', 'ui', 'code', 'math']) {
    $(`font-${slot}`).value = settings.fonts[slot];
  }
  $('lineHeight').value = settings.lineHeight;
  $('paragraphSpacing').value = settings.paragraphSpacing;
  $('dividerWidth').value = settings.dividerWidth;
  document.querySelector(`input[name="align"][value="${settings.align}"]`).checked = true;
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

$('lineHeight').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (Number.isFinite(v)) { settings.lineHeight = v; push(); }
});
$('paragraphSpacing').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (Number.isFinite(v)) { settings.paragraphSpacing = v; push(); }
});
$('dividerWidth').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (Number.isFinite(v)) { settings.dividerWidth = v; push(); }
});
document.querySelectorAll('input[name="align"]').forEach((r) => {
  r.addEventListener('change', (e) => { settings.align = e.target.value; commit(); });
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
