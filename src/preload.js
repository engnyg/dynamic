const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore, forward) => {
    ipcRenderer.invoke('set-ignore-mouse-events', ignore, forward);
  },
  getSystemMedia: () => ipcRenderer.invoke('get-system-media'),
  getBluetoothStatus: () => ipcRenderer.invoke('get-bluetooth-status'),
  controlSystemMedia: (command) => ipcRenderer.invoke('control-system-media', command),
  getSpotifyVolume: () => ipcRenderer.invoke('get-spotify-volume'),
  setSpotifyVolume: (volume) => ipcRenderer.invoke('set-spotify-volume', volume),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  launchApp: (appName) => ipcRenderer.invoke('launch-app', appName),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setDisplay: (displayId) => ipcRenderer.invoke('set-display', displayId),
  updateWindowPosition: (xPerc, yPx) => ipcRenderer.invoke('update-window-position', xPerc, yPx),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  setAlwaysOnTopLevel: (level) => ipcRenderer.invoke('set-always-on-top-level', level),
  platform: process.platform
});
