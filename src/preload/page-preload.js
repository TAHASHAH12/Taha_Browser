// Loaded into every tab. Only the browser's own taha:// pages get an API; the
// main process checks the sender again before acting on any of these.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'taha:') {
  contextBridge.exposeInMainWorld('taha', {
    navigate: (text) => ipcRenderer.send('page:navigate', text),
    topSites: () => ipcRenderer.invoke('page:top-sites'),
    history: () => ipcRenderer.invoke('page:history'),
    removeHistory: (url, time) => ipcRenderer.send('page:history-remove', url, time),
    clearHistory: () => ipcRenderer.send('page:history-clear'),
    bookmarks: () => ipcRenderer.invoke('page:bookmarks'),
    removeBookmark: (id) => ipcRenderer.send('page:bookmark-remove', id),
  });
}
