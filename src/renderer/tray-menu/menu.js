document.documentElement.dataset.theme = window.trayMenuApi.getTheme();

window.trayMenuApi.onTheme((theme) => {
  document.documentElement.dataset.theme = theme;
});

document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', () => window.trayMenuApi.act(el.dataset.action));
});
