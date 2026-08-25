// 标题栏字体决策：页面探测字体（computed font-family，含 custom.css/设置注入效果）
// 优先；其次才是设置页的字体字段；皆空返回空串，回落样式表默认栈。
// UMD 双导出：标题栏页面挂 window.titleFont，Node 单测走 module.exports
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.titleFont = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function titlebarFontFamily(pageFont, settingsFont) {
    const p = (pageFont ? String(pageFont) : '').trim();
    if (p) return p;
    const f = (settingsFont ? String(settingsFont) : '').trim().replace(/["\\]/g, '');
    return f ? `"${f}", "Segoe UI", sans-serif` : '';
  }
  return { titlebarFontFamily };
});
