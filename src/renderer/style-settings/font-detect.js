// 字体候选列表与可用性探测：canvas 测宽法判断字体是否已安装
// 浏览器里挂 window.fontDetect，Node 测试里走 module.exports
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.fontDetect = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Windows 常见中英文字体，按内置默认（思源宋体 CN）在前、常见在后排序
  const CANDIDATE_FONTS = [
    '思源宋体 CN', '思源黑体 CN',
    'Source Han Serif CN', 'Source Han Sans CN', 'Noto Serif CJK SC', 'Noto Sans CJK SC',
    '微软雅黑', '微软雅黑 UI', '等线',
    '宋体', '新宋体', '楷体', '仿宋', '黑体',
    '华文宋体', '华文楷体', '华文仿宋', '华文细黑',
    'Segoe UI', 'Georgia', 'Times New Roman', 'Arial', 'Verdana', 'Trebuchet MS', 'Consolas',
  ];

  function filterAvailableFonts(candidates, isAvailable) {
    return candidates.filter((f) => isAvailable(f));
  }

  // 用等宽字体做基准渲染同一段文字，宽度不同说明候选字体真实存在
  let ctx = null;
  function isFontAvailable(name) {
    if (typeof document === 'undefined') return false;
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    const text = 'mmmmmmmmmmlli国字';
    ctx.font = '72px monospace';
    const baseline = ctx.measureText(text).width;
    ctx.font = `72px "${name}", monospace`;
    return ctx.measureText(text).width !== baseline;
  }

  return { CANDIDATE_FONTS, filterAvailableFonts, isFontAvailable };
});
