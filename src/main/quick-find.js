// Quick Find 选中结果的 URL 归一化：只放行 notion.so 站内 https 地址
const BASE = 'https://www.notion.so';

function normalizePickedUrl(href) {
  if (typeof href !== 'string' || href.length === 0) return null;
  let url;
  try {
    url = new URL(href, BASE);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 'www.notion.so' && url.hostname !== 'notion.so') return null;
  return url.toString();
}

// 唤起 Quick Find 的重试阶梯：首轮 0ms——热页（已完成加载）立即响应；
// 后续递远轮次只为冷启动首载兜底（注入早于 Notion JS 就绪会被丢弃）。
// 每轮先查浮层状态，已开则自停止，多余轮次零成本。
const QUICK_FIND_RETRY_DELAYS = [0, 600, 1500, 3000, 5000, 8000];

// 是否需要在注入 Ctrl+K 前先送 Escape 关阻挡浮层（如"在桌面应用打开？"推广条）。
// state = { open, anyDialog }（preload 探测），null = 查询失败（页面加载中）。
// 无浮层时跳过 Escape：省掉 150ms 等待与一次无谓的按键注入
function needsEscape(state, dismissFirst) {
  if (!dismissFirst) return false;
  if (state === null) return true; // 状态未知：保守维持旧行为
  if (state.open) return false;    // Quick Find 已开，本轮不再注入，也无需 Escape
  return state.anyDialog;
}

module.exports = { normalizePickedUrl, QUICK_FIND_RETRY_DELAYS, needsEscape };
