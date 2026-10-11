const { Menu } = require('electron');
const { TahaWindow } = require('./window');
const urls = require('./urls');

// Runs a command on the focused browser window, opening one if none is open.
const run = (fn) => () => {
  const win = TahaWindow.current;
  if (win) fn(win);
  else new TahaWindow();
};

function installMenu() {
  const isMac = process.platform === 'darwin';
  const tabShortcuts = Array.from({ length: 9 }, (_, i) => ({
    label: `Select Tab ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    visible: false,
    acceleratorWorksWhenHidden: true,
    // Like other browsers, the last shortcut jumps to the last tab.
    click: run((win) => win.selectTabIndex(i === 8 ? Infinity : i)),
  }));

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => (TahaWindow.current ? TahaWindow.current.createTab() : new TahaWindow()),
        },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => new TahaWindow() },
        {
          label: 'New Private Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => new TahaWindow({ isPrivate: true }),
        },
        { type: 'separator' },
        { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: run((win) => win.focusAddressBar()) },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => TahaWindow.current?.closeActiveTab() },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: run((win) => win.reopenClosedTab()),
        },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: run((win) => win.openFind()) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: run((win) => win.reload()) },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: run((win) => win.reload(true)) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: run((win) => win.zoom(0.5)) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: run((win) => win.zoom(-0.5)) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: run((win) => win.zoom(0)) },
        { type: 'separator' },
        {
          label: 'Toggle Bookmarks Bar',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: run((win) => win.toggleBookmarksBar()),
        },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: run((win) => win.toggleDevTools()),
        },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: run((win) => win.back()) },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: run((win) => win.forward()) },
        { type: 'separator' },
        {
          label: 'Show History',
          accelerator: isMac ? 'Cmd+Y' : 'Ctrl+H',
          click: run((win) => win.openPage(urls.HISTORY_URL)),
        },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: run((win) => win.toggleBookmark()) },
        {
          label: 'Show Bookmarks',
          accelerator: isMac ? 'Alt+Cmd+B' : 'Ctrl+Shift+O',
          click: run((win) => win.openPage(urls.BOOKMARKS_URL)),
        },
      ],
    },
    {
      label: 'Tab',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: run((win) => win.cycleTab(1)) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: run((win) => win.cycleTab(-1)) },
        ...tabShortcuts,
      ],
    },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installMenu };
