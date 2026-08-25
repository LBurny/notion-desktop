// 会话级请求拦截：屏蔽 Notion 页面内嵌的第三方遥测/广告域名。
// 实测（2026-08，国内网络）这些域名单个请求挂起 1~10s，把 load 事件拖到 22~27s；
// 屏蔽后 load 收敛到 ~4.6s。全部为遥测/营销端点，与笔记/同步/AI 功能无关；
// 绝不加入 notion.so / app.notion.com 任何子域（aif/exp/identity 等功能域保留）。
const BLOCKED_HOSTS = [
  'splunkcloud.com',       // http-inputs-notion.splunkcloud.com — Splunk 日志遥测（48×~1.1s）
  'gist.build',            // consumer.cloud.gist.build — 营销自动化（8×~1.2s）
  'track.customer.io',     // customer.io 营销推送跟踪
  'transcend-cdn.com',     // Transcend 隐私管理 CDN
  'analytics.twitter.com', // X 广告像素（国内连接被重置，2×10s 超时）
  'doubleclick.net',       // Google 广告转化像素（6×~2s）
  'wcs.naver.com',         // Naver 分析 ping（~3.3s）
  'pdscrb.com',            // verifi.pdscrb.com 广告验证像素（~2s）
];

// 精确匹配主机名或其后缀子域（'gist.build' 命中 a.gist.build，但不命中 gist.build.cn）
function hostMatches(hostname, blocked) {
  return hostname === blocked || hostname.endsWith('.' + blocked);
}

function isBlockedUrl(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false; // 非法/非 http(s) URL 放行
  }
  return BLOCKED_HOSTS.some((h) => hostMatches(hostname, h));
}

// 挂到指定 session（persist:notion）。URL patterns 先做 Chromium 侧粗滤，
// 命中的请求才进 JS 回调，回调里再用 isBlockedUrl 精确复核（双保险，代价为零）
function attachRequestFilter(ses) {
  const patterns = BLOCKED_HOSTS.map((h) => `*://*.${h}/*`);
  ses.webRequest.onBeforeRequest({ urls: patterns }, (details, callback) => {
    callback({ cancel: isBlockedUrl(details.url) });
  });
}

module.exports = { BLOCKED_HOSTS, isBlockedUrl, hostMatches, attachRequestFilter };
