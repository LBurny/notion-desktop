const $ = (id) => document.getElementById(id);

let settings = window.settingsApi.get();

// 字体下拉：自绘可滚动列表（原生 datalist 弹层不跟主题、小窗内无法滚动）
// 只列出系统真实安装的候选字体，每项直接用该字体渲染预览；仍可手动输入任意字体名
(function setupFontCombo() {
  const input = $('font');
  const toggle = $('font-toggle');
  const listEl = $('font-options');
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
      li.textContent = '无匹配字体';
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
        settings.font = name;
        push();
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
  input.addEventListener('input', () => { render(input.value); listEl.hidden = false; });
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
        settings.font = input.value;
        push();
      }
      close();
    } else if (e.key === 'Escape' && isOpen()) {
      close();
      e.stopPropagation();
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (isOpen() && !$('font-combo').contains(e.target)) close();
  });
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
