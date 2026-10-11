// Bridge between the toolbar page (src/ui) and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const send = (channel) => (...args) => ipcRenderer.send(channel, ...args);
const on = (channel) => (callback) => ipcRenderer.on(channel, (_event, payload) => callback(payload));

contextBridge.exposeInMainWorld('browser', {
  ready: send('ui:ready'),
  setChromeHeight: send('ui:chrome-height'),
  setOverlay: send('ui:overlay'),
  suggest: (text) => ipcRenderer.invoke('ui:suggest', text),

  newTab: send('tab:new'),
  closeTab: send('tab:close'),
  selectTab: send('tab:select'),
  moveTab: send('tab:move'),

  navigate: send('nav:go'),
  back: send('nav:back'),
  forward: send('nav:forward'),
  reload: send('nav:reload'),
  stop: send('nav:stop'),

  toggleBookmark: send('bookmark:toggle'),
  openBookmark: send('bookmark:open'),
  showBookmarkMenu: send('bookmark:menu'),
  showAppMenu: send('menu:app'),
  showDownloads: send('menu:downloads'),

  find: send('find:start'),
  stopFind: send('find:stop'),

  onState: on('state'),
  onFocusAddress: on('focus-address'),
  onFindOpen: on('find:open'),
  onFindResult: on('find:result'),
});
