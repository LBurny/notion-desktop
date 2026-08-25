document.documentElement.dataset.theme = window.trayMenuApi.getTheme();

window.trayMenuApi.onTheme((theme) => {
  document.documentElement.dataset.theme = theme;
});

// 菜单窗口缓存复用：加载时按设置解析一次语言，之后每次弹出由主进程补发
// language-changed（设置里切过语言后下次弹出即生效）
function applyLang(lang) {
  document.documentElement.lang = lang;
  window.i18n.applyLanguage(document, lang);
}

applyLang(window.i18n.resolveLanguage(
  window.trayMenuApi.getStyle().language,
  window.trayMenuApi.systemLocale(),
));
window.trayMenuApi.onLanguage(applyLang);

document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', () => window.trayMenuApi.act(el.dataset.action));
});
