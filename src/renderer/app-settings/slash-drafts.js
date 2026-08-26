// 斜杠命令草稿行（命令为空的未提交新增项）合并工具。
// 根因：主进程 sanitizeSettings 会丢弃空命令项 → commit 后回播的 language-changed
// 让 onLanguage 用主进程干净快照覆盖本地 settings，正在编辑的新增行凭空消失。
// 解法：onLanguage 刷新前从旧 settings 提取草稿，刷新后并回干净快照。
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.slashDrafts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // 从旧 slashCommands 提取草稿行（命令为空但组合键合法的未提交项）
  function extractDrafts(slashCommands) {
    if (!Array.isArray(slashCommands)) return [];
    return slashCommands
      .filter((c) => c && typeof c.combo === 'string' && !String(c.command || '').trim())
      .map((c) => ({ combo: c.combo, command: '' }));
  }
  // 将草稿行并回主进程刷新后的干净 slashCommands（去重 + 上限 10）
  function mergeDrafts(cleanList, drafts) {
    const result = (Array.isArray(cleanList) ? cleanList : []).slice();
    for (const d of drafts) {
      if (result.length >= 10) break;
      if (result.some((c) => c && c.combo === d.combo)) continue;
      result.push({ combo: d.combo, command: '' });
    }
    return result;
  }
  return { extractDrafts, mergeDrafts };
});