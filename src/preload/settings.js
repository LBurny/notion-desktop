const { contextBridge, ipcRenderer } = require('electron');

// 样式窗与设置窗共用的桥接层
contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.sendSync('get-style-settings'),
  update: (settings) => ipcRenderer.invoke('style-settings-update', settings),
  close: () => ipcRenderer.send('settings-close'),
  getTheme: () => ipcRenderer.sendSync('get-theme'),
  onTheme: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
});
