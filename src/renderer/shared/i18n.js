// 壳界面文案 i18n：中英双字典 + 语言解析 + 批量应用。
// 浏览器里挂 window.i18n，Node 测试里走 module.exports（同 font-detect 模式）。
// 约定：静态文案在 HTML 上标 data-i18n（textContent）/ data-i18n-placeholder /
// data-i18n-title（tooltip），JS 动态文案用 t(lang, key)；新增 key 两本字典同步加
// （tests/i18n.test.js 校验 key 集一致）。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.i18n = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DICTS = {
    'zh-CN': {
      // 通用
      'common.close': '关闭',
      'common.saved': '已保存',
      // 设置页（app-settings）
      'settings.title': '设置',
      'settings.hotkeys': '快捷键',
      'settings.zoomIn': '放大页面',
      'settings.zoomOut': '缩小页面',
      'settings.toggleWindow': '显示 / 隐藏',
      'settings.newTab': '新建标签页',
      'settings.closeTab': '关闭标签页',
      'settings.slash': '斜杠命令快捷键',
      'settings.slashAdd': '+ 新添加快捷键',
      'settings.slashCmdPlaceholder': '命令词，如 math',
      'settings.closeAction': '关闭窗口时',
      'settings.closeTray': '最小化到托盘',
      'settings.closeQuit': '退出程序',
      'settings.launch': '启动',
      'settings.launchAtLogin': '开机时自动启动（静默到托盘）',
      'settings.language': '语言',
      'settings.langAuto': '跟随系统',
      'settings.hotkeyCapture': '按下快捷键…',
      'settings.hotkeyTitle': '点击后按下新快捷键，Esc 取消',
      'settings.delete': '删除',
      // 样式页（style-settings）
      'style.title': '样式',
      'style.fonts': '字体',
      'style.bodyFont': '正文字体',
      'style.uiFont': '界面字体',
      'style.codeFont': '代码字体',
      'style.mathFont': '公式字体',
      'style.layout': '版式',
      'style.lineHeight': '行间距',
      'style.paragraphSpacing': '段落间距 (px)',
      'style.dividerWidth': '分割线粗细 (px)',
      'style.align': '文字对齐',
      'style.alignJustify': '两端对齐',
      'style.alignLeft': '靠左',
      'style.alignRight': '靠右',
      'style.alignCenter': '居中',
      'style.zoom': '页面缩放',
      'style.zoomOutTitle': '缩小 1%',
      'style.zoomInTitle': '放大 1%',
      'style.misc': '其他',
      'style.hideHelp': '屏蔽右下角帮助按钮',
      'style.fontToggleTitle': '选择字体',
      'style.fontEmpty': '无匹配字体',
      'style.defaultPrefix': '默认：',
      // 标题栏（titlebar，均为 tooltip 或标签内动态文案）
      'titlebar.sidebar': '展开/收起侧边栏',
      'titlebar.newTab': '新建标签页 (Ctrl+T)',
      'titlebar.share': '分享',
      'titlebar.favorite': '收藏',
      'titlebar.more': '更多',
      'titlebar.minimize': '最小化',
      'titlebar.maximize': '最大化',
      'titlebar.close': '关闭',
      'titlebar.closeTab': '关闭 (Ctrl+W)',
      'titlebar.loading': '加载中…',
      // 托盘菜单（tray-menu）
      'tray.open': '打开',
      'tray.style': '样式',
      'tray.settings': '设置',
      'tray.quit': '退出',
    },
    en: {
      'common.close': 'Close',
      'common.saved': 'Saved',
      'settings.title': 'Settings',
      'settings.hotkeys': 'Hotkeys',
      'settings.zoomIn': 'Zoom in',
      'settings.zoomOut': 'Zoom out',
      'settings.toggleWindow': 'Show / Hide',
      'settings.newTab': 'New tab',
      'settings.closeTab': 'Close tab',
      'settings.slash': 'Slash command hotkeys',
      'settings.slashAdd': '+ Add New Hotkey',
      'settings.slashCmdPlaceholder': 'Command, e.g. math',
      'settings.closeAction': 'On window close',
      'settings.closeTray': 'Minimize to tray',
      'settings.closeQuit': 'Quit',
      'settings.launch': 'Startup',
      'settings.launchAtLogin': 'Launch at login (start hidden to tray)',
      'settings.language': 'Language',
      'settings.langAuto': 'System',
      'settings.hotkeyCapture': 'Press hotkey…',
      'settings.hotkeyTitle': 'Click, then press the new hotkey; Esc cancels',
      'settings.delete': 'Delete',
      'style.title': 'Style',
      'style.fonts': 'Fonts',
      'style.bodyFont': 'Body font',
      'style.uiFont': 'UI font',
      'style.codeFont': 'Code font',
      'style.mathFont': 'Math font',
      'style.layout': 'Layout',
      'style.lineHeight': 'Line height',
      'style.paragraphSpacing': 'Paragraph spacing (px)',
      'style.dividerWidth': 'Divider width (px)',
      'style.align': 'Text align',
      'style.alignJustify': 'Justify',
      'style.alignLeft': 'Left',
      'style.alignRight': 'Right',
      'style.alignCenter': 'Center',
      'style.zoom': 'Page zoom',
      'style.zoomOutTitle': 'Zoom out 1%',
      'style.zoomInTitle': 'Zoom in 1%',
      'style.misc': 'Misc',
      'style.hideHelp': 'Hide help button (bottom-right)',
      'style.fontToggleTitle': 'Choose font',
      'style.fontEmpty': 'No matching fonts',
      'style.defaultPrefix': 'Default: ',
      'titlebar.sidebar': 'Toggle sidebar',
      'titlebar.newTab': 'New tab (Ctrl+T)',
      'titlebar.share': 'Share',
      'titlebar.favorite': 'Favorite',
      'titlebar.more': 'More',
      'titlebar.minimize': 'Minimize',
      'titlebar.maximize': 'Maximize',
      'titlebar.close': 'Close',
      'titlebar.closeTab': 'Close (Ctrl+W)',
      'titlebar.loading': 'Loading…',
      'tray.open': 'Open',
      'tray.style': 'Style',
      'tray.settings': 'Settings',
      'tray.quit': 'Quit',
    },
  };

  // pref: 'auto' | 'zh-CN' | 'en'（未知值按 auto 处理）；
  // auto 时系统语言 zh* → 中文，其余（含非中英文系统）一律英文
  function resolveLanguage(pref, locale) {
    if (pref === 'zh-CN' || pref === 'en') return pref;
    return String(locale || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  }

  // 取词：未知语言回落英文；未知 key 返回 undefined（调用方自行兜底）
  function t(lang, key) {
    const d = DICTS[lang] || DICTS.en;
    return d[key];
  }

  // 批量替换 root 下标注元素的 textContent / placeholder / title
  function applyLanguage(rootEl, lang) {
    const root = rootEl || document;
    for (const el of root.querySelectorAll('[data-i18n]')) {
      const v = t(lang, el.dataset.i18n);
      if (v !== undefined) el.textContent = v;
    }
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
      const v = t(lang, el.dataset.i18nPlaceholder);
      if (v !== undefined) el.placeholder = v;
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
      const v = t(lang, el.dataset.i18nTitle);
      if (v !== undefined) el.title = v;
    }
  }

  return { DICTS, resolveLanguage, t, applyLanguage };
});
