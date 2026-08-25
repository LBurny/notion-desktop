// 标签页状态机（纯逻辑，不依赖 Electron，可单测）
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_TABS = 10;

function createTabManager({ maxTabs = DEFAULT_MAX_TABS } = {}) {
  let tabs = []; // [{ id, url, title }]
  let activeId = null;
  let nextId = 1;

  const byId = (id) => tabs.find((t) => t.id === id) || null;

  function list() {
    return tabs.map((t) => ({ ...t, active: t.id === activeId }));
  }

  function add({ url, title = '' }) {
    if (tabs.length >= maxTabs) return null;
    const tab = { id: `t${nextId++}`, url, title };
    tabs.push(tab);
    activeId = tab.id;
    return { ...tab };
  }

  function close(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i === -1) return null;
    tabs.splice(i, 1);
    if (activeId === id) {
      const neighbor = tabs[i] || tabs[i - 1] || null;
      activeId = neighbor ? neighbor.id : null;
    }
    return { activeId, empty: tabs.length === 0 };
  }

  function activate(id) {
    if (!byId(id)) return false;
    activeId = id;
    return true;
  }

  // 导航/标题变化写回（tabs.js 的视图事件经此同步到状态机）
  function update(id, patch) {
    const t = byId(id);
    if (!t) return false;
    if (typeof patch.title === 'string') t.title = patch.title;
    if (typeof patch.url === 'string') t.url = patch.url;
    return true;
  }

  function step(delta) {
    if (!tabs.length) return null;
    const i = tabs.findIndex((t) => t.id === activeId);
    activeId = tabs[(i + delta + tabs.length) % tabs.length].id;
    return activeId;
  }

  // Ctrl+1..8 按序，>=9 恒跳最后一个
  function activatePosition(n) {
    if (!tabs.length) return null;
    const i = n >= 9 ? tabs.length - 1 : Math.min(n - 1, tabs.length - 1);
    if (i < 0) return null;
    activeId = tabs[i].id;
    return activeId;
  }

  function reorder(ids) {
    if (!Array.isArray(ids) || ids.length !== tabs.length) return false;
    const set = new Set(ids);
    if (set.size !== tabs.length || !tabs.every((t) => set.has(t.id))) return false;
    tabs = ids.map((id) => byId(id));
    return true;
  }

  function serialize() {
    return {
      tabs: tabs.map(({ url, title }) => ({ url, title })),
      activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeId)),
    };
  }

  function restore(data) {
    tabs = [];
    activeId = null;
    if (!data || !Array.isArray(data.tabs)) return false;
    const ok = data.tabs.every((t) => t && typeof t.url === 'string' && t.url.startsWith('https://'));
    if (!ok) return false;
    for (const t of data.tabs.slice(0, maxTabs)) {
      tabs.push({ id: `t${nextId++}`, url: t.url, title: typeof t.title === 'string' ? t.title : '' });
    }
    const i = Number.isInteger(data.activeIndex) ? data.activeIndex : 0;
    activeId = tabs.length ? tabs[Math.min(Math.max(0, i), tabs.length - 1)].id : null;
    return tabs.length > 0;
  }

  return {
    list, byId, active: () => byId(activeId), add, close, activate, update,
    next: () => step(1), prev: () => step(-1),
    activatePosition, reorder, serialize, restore,
    get size() { return tabs.length; },
  };
}

function loadTabsFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveTabsFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// 新标签加载期的视图底色：深色主题用 Notion 深色底（#191919），避免白闪
function themeBackground(theme) {
  return theme === 'dark' ? '#191919' : '#ffffff';
}

module.exports = { createTabManager, loadTabsFile, saveTabsFile, DEFAULT_MAX_TABS, themeBackground };
