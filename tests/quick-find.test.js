const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePickedUrl, QUICK_FIND_RETRY_DELAYS, needsEscape } = require('../src/main/quick-find');

test('相对路径解析为 notion.so 绝对地址', () => {
  assert.equal(
    normalizePickedUrl('/Note-abc123'),
    'https://www.notion.so/Note-abc123',
  );
});

test('保留 query 和 hash', () => {
  assert.equal(
    normalizePickedUrl('/Note-abc?p=1#frag'),
    'https://www.notion.so/Note-abc?p=1#frag',
  );
});

test('notion.so 完整地址原样放行', () => {
  assert.equal(
    normalizePickedUrl('https://www.notion.so/Page-x'),
    'https://www.notion.so/Page-x',
  );
  assert.equal(
    normalizePickedUrl('https://notion.so/Page-x'),
    'https://notion.so/Page-x',
  );
});

test('拒绝站外地址', () => {
  assert.equal(normalizePickedUrl('https://evil.com/x'), null);
  assert.equal(normalizePickedUrl('https://www.notion.so.evil.com/x'), null);
});

test('拒绝非 http 协议', () => {
  assert.equal(normalizePickedUrl('javascript:alert(1)'), null);
  assert.equal(normalizePickedUrl('file:///C:/x'), null);
});

test('非法输入返回 null', () => {
  assert.equal(normalizePickedUrl(''), null);
  assert.equal(normalizePickedUrl(null), null);
  assert.equal(normalizePickedUrl(undefined), null);
  assert.equal(normalizePickedUrl(42), null);
});

// ── 唤起延迟优化：重试阶梯与 Escape 决策（src/main/quick-find.js） ──

test('重试阶梯首轮为 0（热页立即触发），后续递增兜底冷启动', () => {
  assert.equal(QUICK_FIND_RETRY_DELAYS[0], 0);
  for (let i = 1; i < QUICK_FIND_RETRY_DELAYS.length; i++) {
    assert.ok(QUICK_FIND_RETRY_DELAYS[i] > QUICK_FIND_RETRY_DELAYS[i - 1], '阶梯必须递增');
  }
  assert.ok(QUICK_FIND_RETRY_DELAYS[QUICK_FIND_RETRY_DELAYS.length - 1] >= 5000, '冷启动兜底要拉到数秒');
});

test('needsEscape：页面上无任何浮层时跳过 Escape（省掉 150ms 等待与注入）', () => {
  assert.equal(needsEscape({ open: false, anyDialog: false }, true), false);
});

test('needsEscape：有其它浮层（推广条等）阻挡时才先送 Escape', () => {
  assert.equal(needsEscape({ open: false, anyDialog: true }, true), true);
});

test('needsEscape：Quick Find 已开/未要求 dismiss/状态未知三态', () => {
  assert.equal(needsEscape({ open: true, anyDialog: true }, true), false); // 已开：不会再注入 Ctrl+K，也无需 Escape
  assert.equal(needsEscape({ open: false, anyDialog: true }, false), false); // 非 dismissFirst 从不送
  assert.equal(needsEscape(null, true), true); // 状态查询失败（页面加载中）：保守送，维持旧行为
});
