const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('titlebarApi', {
  minimize: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getTheme: () => ipcRenderer.sendSync('get-theme'),
  onTheme: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
  onMaximized: (cb) => ipcRenderer.on('window-maximized', (_e, flag) => cb(flag)),
  getStyle: () => ipcRenderer.sendSync('get-style-settings'),
  onStyle: (cb) => ipcRenderer.on('style-changed', (_e, s) => cb(s)),
  onUiFont: (cb) => ipcRenderer.on('ui-font-changed', (_e, font) => cb(font)),
});

contextBridge.exposeInMainWorld('tabsApi', {
  onTabs: (cb) => ipcRenderer.on('tabs-changed', (_e, data) => cb(data)),
  activate: (id) => ipcRenderer.send('tabs-activate', id),
  close: (id) => ipcRenderer.send('tabs-close', id),
  newTab: () => ipcRenderer.send('tabs-new'),
  reorder: (ids) => ipcRenderer.send('tabs-reorder', ids),
});

contextBridge.exposeInMainWorld('topbarApi', {
  act: (action) => ipcRenderer.send('topbar-action', action),
  onState: (cb) => ipcRenderer.on('topbar-state', (_e, s) => cb(s)),
});
