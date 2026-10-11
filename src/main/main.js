const fs = require('fs');
const path = require('path');
const { app, protocol, session } = require('electron');

// Electron's development-time warnings assume every page is the app's own;
// here most pages are other people's websites.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// Must happen before the app is ready: taha:// behaves like a normal web
// origin (relative URLs, CSP 'self', fetch).
protocol.registerSchemesAsPrivileged([
  { scheme: 'taha', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function start() {
  const data = require('./data');
  const urls = require('./urls');
  const { TahaWindow, prepareSession, registerIpc } = require('./window');
  const { installMenu } = require('./menu');

  // Present as plain Chrome; sites often refuse or degrade for unknown agents.
  app.userAgentFallback = app.userAgentFallback
    .replace(/ Electron\/\S+/, '')
    .replace(new RegExp(` (${app.getName()}|taha-browser)/\\S+`, 'i'), '');

  app.on('second-instance', (_event, argv) => {
    const url = argv.slice(1).find(urls.isWebUrl);
    const win = TahaWindow.current;
    if (!win) {
      new TahaWindow({ url });
      return;
    }
    if (url) win.createTab(url);
    if (win.win.isMinimized()) win.win.restore();
    win.win.focus();
  });

  app.on('web-contents-created', (_event, wc) => {
    wc.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.whenReady().then(() => {
    prepareSession(session.defaultSession);
    registerIpc();
    installMenu();

    const devIcon = path.join(__dirname, '../../build/icon.png');
    if (!app.isPackaged && app.dock && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);

    new TahaWindow({ url: process.argv.slice(1).find(urls.isWebUrl) });
    app.on('activate', () => {
      if (TahaWindow.all.length === 0) new TahaWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => data.flush());
}

if (app.requestSingleInstanceLock()) start();
else app.quit();
