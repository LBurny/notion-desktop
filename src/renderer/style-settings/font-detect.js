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

  // 公式内置默认字体：优先 Times New Roman（Windows 几乎必装，与正文拉丁字体一致）；
  // 未装才回落 Modern 系数学字体——同款字体在不同机器的安装名不一
  // （Latin Modern Math / Modern Math / Latin Modern Roman / Modern），按已装字体名
  // 模糊匹配，名字必须含 modern 才算 Modern 系（Cambria Math 等非 Modern 系的数学字体
  // 不参与，否则 Windows 必装的 Cambria Math 会抢位），系内含 math 的数学字族最优先、
  // Latin Modern 次之、其余含 modern 的名字（如 Computer Modern）最后；
  // 返回 null 表示 Times New Roman 与 Modern 系均未装（调用方回落 KaTeX_Main 默认栈）
  function pickMathDefaultFont(fontNames) {
    const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const list = fontNames || [];
    // 优先 Times New Roman：取首个精确匹配的原始名（保留用户机器上的实际写法）
    for (const name of list) {
      if (norm(name) === 'times new roman') return name;
    }
    // 回落：Modern 系数学字体模糊匹配
    let best = null;
    let bestScore = 0;
    for (const name of list) {
      const n = norm(name);
      if (!n) continue;
      let score = 0;
      if (n.includes('latin modern')) score += 20;
      if (n.includes('modern')) score += 30;
      if (score === 0) continue; // 必须含 modern 才入候选
      if (n.includes('math')) score += 50; // 系内：数学字族优先
      if (score > bestScore || (score === bestScore && best !== null && n < norm(best))) {
        best = name;
        bestScore = score;
      }
    }
    return best;
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

  return { CANDIDATE_FONTS, filterAvailableFonts, isFontAvailable, pickMathDefaultFont };
});
