const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTabManager, loadTabsFile, saveTabsFile, DEFAULT_MAX_TABS, themeBackground } = require('../src/main/tab-manager');

const URL = 'https://www.notion.so/';

function mgr(n) {
  const m = createTabManager();
  for (let i = 1; i <= n; i++) m.add({ url: URL + i, title: 'T' + i });
  return m;
}

test('add 自动激活新标签，list 标记 active', () => {
  const m = mgr(2);
  const l = m.list();
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[1].active, true);
  assert.strictEqual(m.active().title, 'T2');
});

test('add 达到上限返回 null', () => {
  const m = createTabManager({ maxTabs: 2 });
  m.add({ url: URL }); m.add({ url: URL });
  assert.strictEqual(m.add({ url: URL }), null);
  assert.strictEqual(m.size, 2);
});

test('close 激活右邻居，无右邻居则激活左侧', () => {
  const m = mgr(3);
  const [a, b, c] = m.list().map((t) => t.id);
  m.activate(b);
  assert.strictEqual(m.close(b).activeId, c); // 右邻居
  m.activate(a);
  assert.strictEqual(m.close(a).activeId, c); // a 无左邻居，取右（原 c）
});

test('close 最后一个标签返回 empty', () => {
  const m = mgr(1);
  const r = m.close(m.list()[0].id);
  assert.deepStrictEqual(r, { activeId: null, empty: true });
});

test('close 不存在 id 返回 null', () => {
  const m = mgr(1);
  assert.strictEqual(m.close('nope'), null);
});

test('update 写回 title/url 并体现在 list 与 serialize', () => {
  const m = mgr(2);
  const id = m.list()[0].id;
  assert.strictEqual(m.update(id, { title: '新标题', url: 'https://www.notion.so/abc' }), true);
  assert.strictEqual(m.list()[0].title, '新标题');
  assert.strictEqual(m.serialize().tabs[0].url, 'https://www.notion.so/abc');
  assert.strictEqual(m.update('nope', { title: 'x' }), false);
});

test('next/prev 循环切换', () => {
  const m = mgr(3);
  const [a, b, c] = m.list().map((t) => t.id);
  m.activate(a);
  assert.strictEqual(m.next(), b);
  assert.strictEqual(m.next(), c);
  assert.strictEqual(m.next(), a); // 环绕
  assert.strictEqual(m.prev(), c); // 反向环绕
});

test('activatePosition：1..8 按序，9 恒为最后一个', () => {
  const m = mgr(5);
  const ids = m.list().map((t) => t.id);
  assert.strictEqual(m.activatePosition(1), ids[0]);
  assert.strictEqual(m.activatePosition(3), ids[2]);
  assert.strictEqual(m.activatePosition(9), ids[4]);
  assert.strictEqual(m.activatePosition(8), ids[4]); // 只有 5 个，钳位到最后
});

test('reorder 仅接受完全一致集合', () => {
  const m = mgr(3);
  const [a, b, c] = m.list().map((t) => t.id);
  assert.strictEqual(m.reorder([c, a, b]), true);
  assert.deepStrictEqual(m.list().map((t) => t.id), [c, a, b]);
  assert.strictEqual(m.reorder([a, b]), false);
  assert.strictEqual(m.reorder([a, b, 'x']), false);
});

test('serialize/restore 往返一致', () => {
  const m = mgr(3);
  m.activatePosition(2);
  const data = m.serialize();
  const m2 = createTabManager();
  assert.strictEqual(m2.restore(data), true);
  assert.deepStrictEqual(m2.list().map(({ url, title, active }) => ({ url, title, active })),
    m.list().map(({ url, title, active }) => ({ url, title, active })));
});

test('restore 非法数据返回 false 且清空', () => {
  const m = mgr(1);
  assert.strictEqual(m.restore({ tabs: [{ url: 'javascript:evil' }] }), false);
  assert.strictEqual(m.restore('junk'), false);
  assert.strictEqual(m.size, 0);
});

test('restore 超上限截断，activeIndex 越界钳位', () => {
  const m = createTabManager({ maxTabs: 2 });
  const tabs = [1, 2, 3].map((i) => ({ url: URL + i, title: 'T' + i }));
  assert.strictEqual(m.restore({ tabs, activeIndex: 99 }), true);
  assert.strictEqual(m.size, 2);
  assert.strictEqual(m.active().title, 'T2');
});

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nd-tab-')), name);
}

test('loadTabsFile 文件不存在或损坏返回 null，saveTabsFile 可往返', () => {
  const f = tmpFile('tabs.json');
  assert.strictEqual(loadTabsFile(f), null);
  fs.writeFileSync(f, '{bad');
  assert.strictEqual(loadTabsFile(f), null);
  const data = { tabs: [{ url: URL, title: 'A' }], activeIndex: 0 };
  saveTabsFile(f, data);
  assert.deepStrictEqual(loadTabsFile(f), data);
});

// ── 视图加载底色（新标签加载期防白闪） ──
test('themeBackground 深色给 Notion 深色底、其余给白底', () => {
  assert.strictEqual(themeBackground('dark'), '#191919');
  assert.strictEqual(themeBackground('light'), '#ffffff');
  assert.strictEqual(themeBackground('xxx'), '#ffffff');
  assert.strictEqual(themeBackground(undefined), '#ffffff');
});
