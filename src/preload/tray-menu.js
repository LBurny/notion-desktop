const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trayMenuApi', {
  act: (action) => ipcRenderer.send('tray-menu-action', action),
  getTheme: () => ipcRenderer.sendSync('get-theme'),
  onTheme: (cb) => ipcRenderer.on('theme-changed', (_e, theme) => cb(theme)),
});
