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

module.exports = { normalizePickedUrl };
