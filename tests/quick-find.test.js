const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePickedUrl } = require('../src/main/quick-find');

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
