const btnMax = document.getElementById('max');

document.getElementById('min').addEventListener('click', () => window.titlebarApi.minimize());
btnMax.addEventListener('click', () => window.titlebarApi.toggleMaximize());
document.getElementById('close').addEventListener('click', () => window.titlebarApi.close());

document.documentElement.dataset.theme = window.titlebarApi.getTheme();

window.titlebarApi.onTheme((theme) => {
  document.documentElement.dataset.theme = theme;
});
window.titlebarApi.onMaximized((isMax) => {
  btnMax.innerHTML = isMax ? '&#10064;' : '&#9634;';
});

// 标题栏属界面：跟随页面探测到的界面计算字体（侧栏/顶栏，含 custom.css 与
// fonts.ui 设置注入的效果），探测值未到时用设置页的界面字体字段兜底
let uiFont = '';
let lastStyle = null;
// 界面语言随设置到达（getStyle 初始 + onStyle 更新），tooltip 与标签内文案即时切换
let lang = 'zh-CN';
const tr = (k) => window.i18n.t(lang, k); // 命名避让：renderTabs 循环变量用 t 表示标签对象
function applyLang() {
  lang = window.i18n.resolveLanguage(lastStyle && lastStyle.language, window.titlebarApi.systemLocale());
  document.documentElement.lang = lang;
  window.i18n.applyLanguage(document, lang);
}
function applyTitleFont() {
  const ui = lastStyle && lastStyle.fonts && typeof lastStyle.fonts.ui === 'string' ? lastStyle.fonts.ui : '';
  document.body.style.fontFamily = window.titleFont.titlebarFontFamily(uiFont, ui);
}
function applyDivider() {
  const w = lastStyle && Number.isFinite(lastStyle.dividerWidth) ? lastStyle.dividerWidth : 1;
  document.body.style.borderBottomWidth = w + 'px'; // 0 = 隐藏分割线
}
function applyStyle() { applyTitleFont(); applyDivider(); }
lastStyle = window.titlebarApi.getStyle();
applyStyle();
applyLang();
window.titlebarApi.onStyle((s) => {
  const langChanged = window.i18n.resolveLanguage(s && s.language, window.titlebarApi.systemLocale()) !== lang;
  lastStyle = s;
  applyStyle();
  if (langChanged) { applyLang(); renderTabs(); } // 语言变了才重渲染（标签内文案随语言）
});
window.titlebarApi.onUiFont((f) => { uiFont = f; applyTitleFont(); });

// ---------- 标签条 ----------
const tabsEl = document.getElementById('tabs');
let currentTabs = [];
let suppressClick = false; // 拖拽松开后抑制随之而来的 click，避免误激活

window.tabsApi.onTabs(({ tabs, canAdd }) => {
  currentTabs = tabs;
  document.getElementById('new-tab').disabled = !canAdd;
  renderTabs();
});

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const t of currentTabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.active ? ' active' : '');
    el.dataset.id = t.id;
    el.innerHTML = `<span class="tab-title"></span><button class="tab-close" title="${tr('titlebar.closeTab')}">&#10005;</button>`;
    el.querySelector('.tab-title').textContent = t.title || tr('titlebar.loading');
    el.addEventListener('click', (e) => {
      if (suppressClick || e.target.classList.contains('tab-close')) return;
      window.tabsApi.activate(t.id);
    });
    el.querySelector('.tab-close').addEventListener('click', () => window.tabsApi.close(t.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) window.tabsApi.close(t.id); }); // 中键关闭
    attachDrag(el, t.id);
    tabsEl.appendChild(el);
  }
}

function attachDrag(el, id) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('tab-close') || e.button !== 0) return;
    const startX = e.clientX;
    let dragging = false;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!dragging && Math.abs(dx) > 4) { dragging = true; el.classList.add('dragging'); }
      if (dragging) el.style.transform = `translateX(${dx}px)`;
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      el.style.transform = '';
      if (!dragging) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      // 用其余标签的中点计算插入位，构造新顺序提交主进程
      const others = [...tabsEl.querySelectorAll('.tab')].filter((n) => n !== el);
      const rects = others.map((n) => {
        const r = n.getBoundingClientRect();
        return { left: r.left, width: r.width };
      });
      const idx = window.tabDrag.dropIndex(rects, ev.clientX);
      const ids = others.map((n) => n.dataset.id);
      ids.splice(idx, 0, id);
      window.tabsApi.reorder(ids); // 主进程重排后推 tabs-changed 触发重渲染
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

document.getElementById('new-tab').addEventListener('click', () => window.tabsApi.newTab());

// ---------- Notion 顶栏动作转发（顶栏一体化） ----------
document.getElementById('sidebar-toggle').addEventListener('click', () => window.topbarApi.act('sidebar'));
document.getElementById('tb-share').addEventListener('click', () => window.topbarApi.act('share'));
document.getElementById('tb-more').addEventListener('click', () => window.topbarApi.act('more'));

const favBtn = document.getElementById('tb-favorite');
favBtn.addEventListener('click', () => window.topbarApi.act('favorite'));

window.topbarApi.onState(({ available, favorited }) => {
  document.getElementById('sidebar-toggle').style.display = available ? '' : 'none';
  document.getElementById('topbar-actions').classList.toggle('hidden', !available);
  favBtn.classList.toggle('favorited', favorited === true);
  favBtn.innerHTML = favorited === true ? '&#9733;' : '&#9734;'; // ★/☆
});
