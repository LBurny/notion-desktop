// request-filter 单测：黑名单命中/误伤/容错
const test = require('node:test');
const assert = require('node:assert');
const { isBlockedUrl, BLOCKED_HOSTS } = require('../src/main/request-filter');

test('命中黑名单（精确域与子域）', () => {
  assert.strictEqual(isBlockedUrl('https://http-inputs-notion.splunkcloud.com/services/collector/raw'), true);
  assert.strictEqual(isBlockedUrl('https://consumer.cloud.gist.build/api/v4/users?x=1'), true);
  assert.strictEqual(isBlockedUrl('https://track.customer.io/events'), true);
  assert.strictEqual(isBlockedUrl('https://transcend-cdn.com/tag'), true);
  assert.strictEqual(isBlockedUrl('https://analytics.twitter.com/i/adsct?x=1'), true);
  assert.strictEqual(isBlockedUrl('https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123/'), true);
  assert.strictEqual(isBlockedUrl('https://wcs.naver.com/b'), true);
  assert.strictEqual(isBlockedUrl('https://verifi.pdscrb.com/tag?x=1'), true);
});

test('不误伤 Notion 功能域与同名字符串域', () => {
  assert.strictEqual(isBlockedUrl('https://www.notion.so/api/v3/loadPageChunk'), false);
  assert.strictEqual(isBlockedUrl('https://app.notion.com/api/v3/syncRecordValues'), false);
  assert.strictEqual(isBlockedUrl('https://aif.notion.so/v1/x'), false);
  assert.strictEqual(isBlockedUrl('https://exp.notion.so/v1/initialize?k=1'), false);
  assert.strictEqual(isBlockedUrl('https://msgstore-002.www.notion.so/x'), false);
  // 后缀撞名但非同族域不得误杀
  assert.strictEqual(isBlockedUrl('https://notion.so.evil-gist.build.example.com/x'), false);
  assert.strictEqual(isBlockedUrl('https://gist.build.example.org/x'), false);
  assert.strictEqual(isBlockedUrl('https://splunkcloud.com.cn/x'), false);
});

test('非法/空 URL 不抛异常', () => {
  assert.strictEqual(isBlockedUrl(''), false);
  assert.strictEqual(isBlockedUrl('not a url'), false);
  assert.strictEqual(isBlockedUrl('about:blank'), false);
});

test('黑名单恰好 8 项且全为小写主机名', () => {
  assert.strictEqual(BLOCKED_HOSTS.length, 8);
  for (const h of BLOCKED_HOSTS) assert.match(h, /^[a-z0-9.-]+$/);
});
