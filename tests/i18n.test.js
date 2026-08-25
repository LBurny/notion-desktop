const test = require('node:test');
const assert = require('node:assert');
const { DICTS, resolveLanguage, t } = require('../src/renderer/shared/i18n');

// ── 语言解析：auto 跟随系统，非 zh 系统一律英文；显式选择直通 ──
test('resolveLanguage：auto 时 zh 系系统语言 → 中文，其余一律英文', () => {
  assert.strictEqual(resolveLanguage('auto', 'zh-CN'), 'zh-CN');
  assert.strictEqual(resolveLanguage('auto', 'zh'), 'zh-CN');
  assert.strictEqual(resolveLanguage('auto', 'zh-TW'), 'zh-CN');
  assert.strictEqual(resolveLanguage('auto', 'en-US'), 'en');
  assert.strictEqual(resolveLanguage('auto', 'en'), 'en');
  // 非中英文系统默认英文
  assert.strictEqual(resolveLanguage('auto', 'fr-FR'), 'en');
  assert.strictEqual(resolveLanguage('auto', 'ja-JP'), 'en');
  assert.strictEqual(resolveLanguage('auto', ''), 'en');
  assert.strictEqual(resolveLanguage('auto', undefined), 'en');
});

test('resolveLanguage：显式 zh-CN/en 直通；未知 pref 值按 auto 处理', () => {
  assert.strictEqual(resolveLanguage('zh-CN', 'en-US'), 'zh-CN');
  assert.strictEqual(resolveLanguage('en', 'zh-CN'), 'en');
  assert.strictEqual(resolveLanguage('bogus', 'zh-CN'), 'zh-CN'); // 未知值当 auto
  assert.strictEqual(resolveLanguage(undefined, 'fr'), 'en');
});

// ── 字典完整性：两本字典 key 集必须一致（漏译即断言失败） ──
test('DICTS：zh-CN 与 en 的 key 集完全一致', () => {
  const zhKeys = Object.keys(DICTS['zh-CN']).sort();
  const enKeys = Object.keys(DICTS.en).sort();
  assert.deepStrictEqual(zhKeys, enKeys, '两本字典 key 集不一致（有漏译）');
});

test('DICTS：所有值非空且不含引号/反斜杠以外的注入风险字符限制外的意外类型', () => {
  for (const lang of ['zh-CN', 'en']) {
    for (const [k, v] of Object.entries(DICTS[lang])) {
      assert.ok(typeof v === 'string' && v.length > 0, `${lang}:${k} 为空或非字符串`);
    }
  }
});

// ── t()：取词与回落 ──
test('t：按键取词；未知 key 返回 undefined；未知语言回落英文', () => {
  assert.strictEqual(t('zh-CN', 'settings.title'), '设置');
  assert.strictEqual(t('en', 'settings.title'), 'Settings');
  assert.strictEqual(t('zh-CN', 'no.such.key'), undefined);
  assert.strictEqual(t('klingon', 'settings.title'), 'Settings');
});
