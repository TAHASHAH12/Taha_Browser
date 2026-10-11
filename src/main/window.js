const path = require('path');
const { app, BaseWindow, WebContentsView, Menu, clipboard, ipcMain, session, shell } = require('electron');
const data = require('./data');
const urls = require('./urls');
const { setupSession } = require('./session');

const UI_FILE = path.join(__dirname, '../ui/index.html');
const UI_PRELOAD = path.join(__dirname, '../preload/ui-preload.js');
const PAGE_PRELOAD = path.join(__dirname, '../preload/page-preload.js');
const DEFAULT_CHROME_HEIGHT = 85;
const MAX_CLOSED_TABS = 20;

const windows = new Set();
const byUi = new Map(); // toolbar webContents id -> TahaWindow
const byTab = new Map(); // tab webContents id -> TahaWindow
let current = null; // most recently focused window
let nextTabId = 1;
let privateSessions = 0;

function prepareSession(ses) {
  setupSession(ses, {
    parentWindow: (wc) => (wc && TahaWindow.fromWebContents(wc)?.win) || undefined,
    onDownloadStarted(wc) {
      const win = wc && byTab.get(wc.id);
      const tab = win?.tabs.find((t) => t.wc === wc);
      // A tab opened only to start a download never shows a page; close it.
      if (tab && !tab.committed && win.tabs.length > 1) win.closeTab(tab.id);
    },
  });
}

// One browser window: a toolbar view (the "chrome") stacked above the view of
// whichever tab is active.
class TahaWindow {
  static get current() {
    return current;
  }

  static get all() {
    return [...windows];
  }

  static fromWebContents(wc) {
    return byTab.get(wc.id) || byUi.get(wc.id) || null;
  }

  constructor({ isPrivate = false, url } = {}) {
    this.isPrivate = isPrivate;
    this.session = session.defaultSession;
    if (isPrivate) {
      // No "persist:" prefix, so nothing from this session touches the disk.
      this.session = session.fromPartition(`private-${++privateSessions}`);
      prepareSession(this.session);
    }
    this.tabs = [];
    this.activeTab = null;
    this.closedTabs = [];
    this.chromeHeight = DEFAULT_CHROME_HEIGHT;
    this.overlay = false;
    this.htmlFullscreen = false;
    this.closed = false;
    this.statePending = false;

    const isMac = process.platform === 'darwin';
    const anchor = current && !current.closed ? current.win.getBounds() : null;
    this.win = new BaseWindow({
      width: 1280,
      height: 820,
      minWidth: 520,
      minHeight: 360,
      title: 'Taha',
      ...(anchor ? { x: anchor.x + 24, y: anchor.y + 24 } : {}),
      ...(isMac ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 13 } } : {}),
    });

    this.ui = new WebContentsView({
      webPreferences: { preload: UI_PRELOAD, sandbox: true, contextIsolation: true, session: this.session },
    });
    // Transparent, so the toolbar view can extend over the page for dropdowns.
    this.ui.setBackgroundColor('#00000000');
    const uiWc = this.ui.webContents;
    this.uiId = uiWc.id;
    byUi.set(this.uiId, this);
    uiWc.on('will-navigate', (event) => event.preventDefault());
    uiWc.setWindowOpenHandler(() => ({ action: 'deny' }));
    uiWc.loadFile(UI_FILE);
    this.win.contentView.addChildView(this.ui);

    this.win.on('resize', () => this.layout());
    this.win.on('focus', () => {
      current = this;
    });
    this.win.on('enter-full-screen', () => this.sendState());
    this.win.on('leave-full-screen', () => this.sendState());
    this.win.on('closed', () => this.destroy());

    windows.add(this);
    current = this;
    this.layout();
    this.createTab(url);
  }

  destroy() {
    this.closed = true;
    windows.delete(this);
    if (current === this) current = [...windows].pop() || null;
    byUi.delete(this.uiId);
    // Views are not torn down with the window; close their pages explicitly.
    for (const tab of this.tabs) {
      byTab.delete(tab.wcId);
      if (!tab.wc.isDestroyed()) tab.wc.close();
    }
    if (!this.ui.webContents.isDestroyed()) this.ui.webContents.close();
    if (this.isPrivate) this.session.clearStorageData().catch(() => {});
  }

  // ---- layout and state -------------------------------------------------

  layout() {
    if (this.closed) return;
    const [width, height] = this.win.getContentSize();
    this.ui.setVisible(!this.htmlFullscreen);
    this.ui.setBounds({ x: 0, y: 0, width, height: this.overlay ? height : this.chromeHeight });
    const top = this.htmlFullscreen ? 0 : this.chromeHeight;
    this.activeTab?.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  }

  sendState() {
    if (this.statePending) return;
    this.statePending = true;
    setImmediate(() => {
      this.statePending = false;
      if (this.closed || this.ui.webContents.isDestroyed()) return;
      const state = this.serialize();
      const active = state.tabs.find((t) => t.id === state.activeId);
      this.win.setTitle(active ? `${active.title} — Taha` : 'Taha');
      this.ui.webContents.send('state', state);
    });
  }

  serialize() {
    const downloads = data.downloads.list();
    return {
      platform: process.platform,
      isPrivate: this.isPrivate,
      fullscreen: this.win.isFullScreen(),
      activeId: this.activeTab ? this.activeTab.id : null,
      tabs: this.tabs.map((tab) => {
        const { wc } = tab;
        const url = wc.getURL();
        const shown = urls.displayUrl(url);
        return {
          id: tab.id,
          title: wc.getTitle() || shown || 'New Tab',
          url: shown,
          favicon: tab.favicon,
          loading: wc.isLoading(),
          audible: wc.isCurrentlyAudible(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          bookmarked: data.bookmarks.has(url),
        };
      }),
      bookmarks: data.bookmarks.list(),
      showBookmarksBar: data.settings.get('showBookmarksBar'),
      downloads: {
        count: downloads.length,
        active: downloads.filter((d) => d.state === 'progressing').length,
      },
    };
  }

  // ---- tabs -------------------------------------------------------------

  createTab(url = urls.NEW_TAB_URL, { activate = true, index = this.tabs.length } = {}) {
    const view = new WebContentsView({
      webPreferences: { preload: PAGE_PRELOAD, sandbox: true, contextIsolation: true, session: this.session },
    });
    const wc = view.webContents;
    const tab = { id: nextTabId++, view, wc, wcId: wc.id, requestedUrl: url, favicon: null, failedUrl: null, committed: false };
    byTab.set(tab.wcId, this);
    this.tabs.splice(index, 0, tab);
    this.wireTab(tab);
    this.load(tab, url);
    if (activate || !this.activeTab) this.activate(tab);
    else this.sendState();
    return tab;
  }

  load(tab, url) {
    this.syncUserAgent(tab, url);
    // Failures are reported through 'did-fail-load'.
    tab.wc.loadURL(url).catch(() => {});
  }

  // Makes the tab identify as Firefox while on Google's sign-in host and as
  // itself everywhere else. Returns true if the identity had to change.
  syncUserAgent(tab, url) {
    const wanted = urls.isGoogleSignIn(url) ? urls.FIREFOX_USER_AGENT : app.userAgentFallback;
    if (tab.wc.getUserAgent() === wanted) return false;
    tab.wc.setUserAgent(wanted);
    return true;
  }

  wireTab(tab) {
    const { wc } = tab;
    const update = () => this.sendState();
    const record = (url) => {
      if (!this.isPrivate && urls.isWebUrl(url)) data.history.addVisit(url, wc.getTitle());
    };

    wc.on('did-start-loading', update);
    wc.on('did-stop-loading', update);
    wc.on('audio-state-changed', update);
    wc.on('page-title-updated', (_event, title) => {
      if (!this.isPrivate && urls.isWebUrl(wc.getURL())) data.history.setTitle(wc.getURL(), title);
      update();
    });
    wc.on('page-favicon-updated', (_event, favicons) => {
      tab.favicon = favicons.find(urls.isWebUrl) || null;
      update();
    });
    wc.on('did-navigate', (_event, url) => {
      tab.committed = true;
      tab.favicon = null;
      // Reached by a link or redirect with the wrong identity: load it again
      // so the page's scripts see the same browser its requests claimed.
      if (this.syncUserAgent(tab, url)) wc.reload();
      if (urls.failedUrl(url) !== null) this.dropFailedEntry(tab);
      else record(url);
      update();
    });
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) record(url);
      update();
    });
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      const ERR_ABORTED = -3; // stopped by the user, or turned into a download
      if (!isMainFrame || code === ERR_ABORTED || urls.isInternalUrl(url)) return;
      tab.failedUrl = url;
      this.load(tab, urls.errorPageUrl(url, code, description));
    });

    // Web pages may not navigate to, or open, the browser's own pages.
    wc.on('will-navigate', (event, url) => {
      const target = event.url || url;
      if (urls.isInternalUrl(target) && !urls.isInternalUrl(wc.getURL())) event.preventDefault();
    });
    wc.setWindowOpenHandler(({ url, disposition }) => {
      const allowed = urls.isWebUrl(url) || (urls.isInternalUrl(url) && urls.isInternalUrl(wc.getURL()));
      if (allowed) {
        this.createTab(url, {
          activate: disposition !== 'background-tab',
          index: this.tabs.indexOf(tab) + 1,
        });
      }
      return { action: 'deny' };
    });

    wc.on('found-in-page', (_event, result) => {
      if (tab !== this.activeTab || this.closed) return;
      this.ui.webContents.send('find:result', { active: result.activeMatchOrdinal, total: result.matches });
    });
    wc.on('enter-html-full-screen', () => this.setHtmlFullscreen(true));
    wc.on('leave-html-full-screen', () => this.setHtmlFullscreen(false));
    wc.on('context-menu', (_event, params) => this.showPageMenu(tab, params));
  }

  // The error page is loaded on top of the failed navigation's own history
  // entry, and retrying a failure adds the error page again. Remove both, so
  // Back leaves the failure instead of landing on it again.
  dropFailedEntry(tab) {
    const nav = tab.wc.navigationHistory;
    const errorUrl = tab.wc.getURL();
    for (const stale of [tab.failedUrl, errorUrl]) {
      const index = nav.getActiveIndex();
      if (index > 0 && nav.getEntryAtIndex(index - 1)?.url === stale) nav.removeEntryAtIndex(index - 1);
    }
  }

  activate(tab) {
    if (this.activeTab !== tab) {
      if (this.activeTab) this.win.contentView.removeChildView(this.activeTab.view);
      this.activeTab = tab;
      this.win.contentView.addChildView(tab.view, 0); // below the toolbar view
      this.layout();
    }
    if ((tab.wc.getURL() || tab.requestedUrl) === urls.NEW_TAB_URL) this.focusAddressBar();
    else tab.wc.focus();
    this.sendState();
  }

  tab(id) {
    return this.tabs.find((t) => t.id === id);
  }

  selectTab(id) {
    const tab = this.tab(id);
    if (tab) this.activate(tab);
  }

  selectTabIndex(index) {
    const tab = this.tabs[Math.min(index, this.tabs.length - 1)];
    if (tab) this.activate(tab);
  }

  cycleTab(delta) {
    const count = this.tabs.length;
    const index = this.tabs.indexOf(this.activeTab);
    this.activate(this.tabs[(index + delta + count) % count]);
  }

  moveTab(id, index) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0 || !Number.isInteger(index)) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab);
    this.sendState();
  }

  closeTab(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const [tab] = this.tabs.splice(index, 1);
    const url = urls.displayUrl(tab.wc.getURL());
    if (!this.isPrivate && urls.isWebUrl(url)) {
      this.closedTabs.push(url);
      if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift();
    }
    byTab.delete(tab.wcId);
    if (tab === this.activeTab) {
      this.win.contentView.removeChildView(tab.view);
      this.activeTab = null;
      const next = this.tabs[index] || this.tabs[index - 1];
      if (next) this.activate(next);
    }
    tab.wc.close();
    if (this.tabs.length === 0) this.win.close();
    else this.sendState();
  }

  closeActiveTab() {
    if (this.activeTab) this.closeTab(this.activeTab.id);
  }

  reopenClosedTab() {
    const url = this.closedTabs.pop();
    if (url) this.createTab(url);
  }

  // Shows one of the browser's own pages, reusing a blank tab if there is one.
  openPage(url) {
    const tab = this.activeTab;
    if (tab && tab.wc.getURL() === urls.NEW_TAB_URL) {
      this.load(tab, url);
      tab.wc.focus();
    } else {
      this.createTab(url);
    }
  }

  // ---- navigation -------------------------------------------------------

  navigate(text) {
    const tab = this.activeTab;
    if (!tab) return;
    this.load(tab, urls.resolveInput(text, data.settings.get('searchEngine')));
    tab.wc.focus();
  }

  back() {
    const nav = this.activeTab?.wc.navigationHistory;
    if (nav?.canGoBack()) nav.goBack();
  }

  forward() {
    const nav = this.activeTab?.wc.navigationHistory;
    if (nav?.canGoForward()) nav.goForward();
  }

  reload(ignoreCache = false) {
    const tab = this.activeTab;
    if (!tab) return;
    const failed = urls.failedUrl(tab.wc.getURL());
    if (failed) this.load(tab, failed);
    else if (ignoreCache) tab.wc.reloadIgnoringCache();
    else tab.wc.reload();
  }

  stop() {
    this.activeTab?.wc.stop();
  }

  zoom(delta) {
    const wc = this.activeTab?.wc;
    if (!wc) return;
    wc.setZoomLevel(delta === 0 ? 0 : Math.max(-3, Math.min(4, wc.getZoomLevel() + delta)));
  }

  toggleDevTools() {
    const wc = this.activeTab?.wc;
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  setHtmlFullscreen(on) {
    if (this.closed || this.htmlFullscreen === on) return;
    this.htmlFullscreen = on;
    if (on) {
      this.wasFullScreen = this.win.isFullScreen();
      this.win.setFullScreen(true);
    } else if (!this.wasFullScreen) {
      this.win.setFullScreen(false);
    }
    this.layout();
  }

  // ---- toolbar ----------------------------------------------------------

  focusAddressBar() {
    this.ui.webContents.focus();
    this.ui.webContents.send('focus-address');
  }

  openFind() {
    this.ui.webContents.focus();
    this.ui.webContents.send('find:open');
  }

  find(text, forward, isNew) {
    const wc = this.activeTab?.wc;
    if (!wc) return;
    if (text) wc.findInPage(text, { forward, findNext: isNew });
    else wc.stopFindInPage('clearSelection');
  }

  stopFind() {
    this.activeTab?.wc.stopFindInPage('clearSelection');
  }

  toggleBookmark() {
    const tab = this.activeTab;
    if (!tab) return;
    const url = urls.displayUrl(tab.wc.getURL());
    if (url) data.bookmarks.toggle({ url, title: tab.wc.getTitle(), favicon: tab.favicon });
  }

  toggleBookmarksBar() {
    data.settings.set('showBookmarksBar', !data.settings.get('showBookmarksBar'));
  }

  // ---- menus ------------------------------------------------------------

  popup(template, x, y) {
    const at = Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : {};
    Menu.buildFromTemplate(template).popup({ window: this.win, ...at });
  }

  showAppMenu(x, y) {
    const engine = data.settings.get('searchEngine');
    this.popup(
      [
        { label: 'New Tab', click: () => this.createTab() },
        { label: 'New Window', click: () => new TahaWindow() },
        { label: 'New Private Window', click: () => new TahaWindow({ isPrivate: true }) },
        { type: 'separator' },
        { label: 'History', click: () => this.openPage(urls.HISTORY_URL) },
        { label: 'Bookmarks', click: () => this.openPage(urls.BOOKMARKS_URL) },
        { label: 'Downloads Folder', click: () => shell.openPath(app.getPath('downloads')) },
        { type: 'separator' },
        { label: 'Zoom In', click: () => this.zoom(0.5) },
        { label: 'Zoom Out', click: () => this.zoom(-0.5) },
        { label: 'Actual Size', click: () => this.zoom(0) },
        { label: 'Find in Page…', click: () => this.openFind() },
        { type: 'separator' },
        {
          label: 'Search Engine',
          submenu: Object.entries(urls.SEARCH_ENGINES).map(([id, { name }]) => ({
            label: name,
            type: 'radio',
            checked: id === engine,
            click: () => data.settings.set('searchEngine', id),
          })),
        },
        {
          label: 'Show Bookmarks Bar',
          type: 'checkbox',
          checked: data.settings.get('showBookmarksBar'),
          click: () => this.toggleBookmarksBar(),
        },
        { type: 'separator' },
        { label: 'Developer Tools', click: () => this.toggleDevTools() },
      ],
      x,
      y,
    );
  }

  showDownloadsMenu(x, y) {
    const items = data.downloads.list().slice(0, 10).map((d) => {
      let status = d.state;
      if (d.state === 'progressing') status = d.total ? `${Math.round((d.received / d.total) * 100)}%` : 'downloading';
      return { label: `${d.name} — ${status}`, click: () => shell.showItemInFolder(d.path) };
    });
    this.popup(
      [
        ...items,
        { type: 'separator' },
        { label: 'Open Downloads Folder', click: () => shell.openPath(app.getPath('downloads')) },
        { label: 'Clear List', click: () => data.downloads.clear() },
      ],
      x,
      y,
    );
  }

  showBookmarkMenu(id, x, y) {
    const bookmark = data.bookmarks.get(id);
    if (!bookmark) return;
    this.popup(
      [
        { label: 'Open in New Tab', click: () => this.createTab(bookmark.url) },
        { label: 'Copy Link', click: () => clipboard.writeText(bookmark.url) },
        { type: 'separator' },
        { label: 'Delete', click: () => data.bookmarks.remove(id) },
      ],
      x,
      y,
    );
  }

  showPageMenu(tab, params) {
    const { wc } = tab;
    const newTab = (url, background = true) =>
      this.createTab(url, { activate: !background, index: this.tabs.indexOf(tab) + 1 });
    const template = [];
    if (urls.isWebUrl(params.linkURL)) {
      template.push(
        { label: 'Open Link in New Tab', click: () => newTab(params.linkURL) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      );
    }
    if (params.mediaType === 'image' && urls.isWebUrl(params.srcURL)) {
      template.push(
        { label: 'Open Image in New Tab', click: () => newTab(params.srcURL) },
        { label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
        { type: 'separator' },
      );
    }
    if (params.isEditable) {
      template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim();
      const preview = text.length > 30 ? `${text.slice(0, 30)}…` : text;
      template.push(
        { role: 'copy' },
        {
          label: `Search for “${preview}”`,
          click: () => newTab(urls.searchUrl(text, data.settings.get('searchEngine')), false),
        },
        { type: 'separator' },
      );
    }
    if (template.length === 0) {
      template.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => this.reload() },
        { type: 'separator' },
      );
    }
    template.push({
      label: 'Inspect',
      click: () => {
        if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
        wc.inspectElement(params.x, params.y);
      },
    });
    this.popup(template);
  }
}

// ---- messages from the toolbar and from taha:// pages --------------------

function registerIpc() {
  data.events.on('change', () => {
    for (const win of windows) win.sendState();
  });

  // Toolbar messages are only accepted from a window's own toolbar view.
  const ui = (fn) => (event, ...args) => {
    const win = byUi.get(event.sender.id);
    if (win && !win.closed) return fn(win, ...args);
    return undefined;
  };

  ipcMain.on('ui:ready', ui((win) => {
    win.sendState();
    if (win.activeTab && (win.activeTab.wc.getURL() || win.activeTab.requestedUrl) === urls.NEW_TAB_URL) {
      win.focusAddressBar();
    }
  }));
  ipcMain.on('ui:chrome-height', ui((win, height) => {
    if (!Number.isFinite(height) || height <= 0 || height > 400) return;
    win.chromeHeight = Math.round(height);
    win.layout();
  }));
  ipcMain.on('ui:overlay', ui((win, on) => {
    win.overlay = Boolean(on);
    win.layout();
  }));
  ipcMain.handle('ui:suggest', ui((win, text) =>
    typeof text === 'string' ? data.suggest(text, { includeHistory: !win.isPrivate }) : [],
  ));

  ipcMain.on('tab:new', ui((win) => win.createTab()));
  ipcMain.on('tab:close', ui((win, id) => win.closeTab(id)));
  ipcMain.on('tab:select', ui((win, id) => win.selectTab(id)));
  ipcMain.on('tab:move', ui((win, id, index) => win.moveTab(id, index)));

  ipcMain.on('nav:go', ui((win, text) => {
    if (typeof text === 'string') win.navigate(text);
  }));
  ipcMain.on('nav:back', ui((win) => win.back()));
  ipcMain.on('nav:forward', ui((win) => win.forward()));
  ipcMain.on('nav:reload', ui((win) => win.reload()));
  ipcMain.on('nav:stop', ui((win) => win.stop()));

  ipcMain.on('bookmark:toggle', ui((win) => win.toggleBookmark()));
  ipcMain.on('bookmark:open', ui((win, id, inNewTab) => {
    const bookmark = data.bookmarks.get(id);
    if (!bookmark) return;
    if (inNewTab) win.createTab(bookmark.url);
    else win.navigate(bookmark.url);
  }));
  ipcMain.on('bookmark:menu', ui((win, id, x, y) => win.showBookmarkMenu(id, x, y)));
  ipcMain.on('menu:app', ui((win, x, y) => win.showAppMenu(x, y)));
  ipcMain.on('menu:downloads', ui((win, x, y) => win.showDownloadsMenu(x, y)));

  ipcMain.on('find:start', ui((win, text, forward, isNew) => {
    if (typeof text === 'string') win.find(text, forward !== false, Boolean(isNew));
  }));
  ipcMain.on('find:stop', ui((win) => win.stopFind()));

  // Page messages are only accepted from the top frame of a taha:// page.
  const page = (fn, fallback) => (event, ...args) => {
    const frame = event.senderFrame;
    const win = byTab.get(event.sender.id);
    if (!win || win.closed || !frame || frame.parent || !urls.isInternalUrl(frame.url)) return fallback;
    return fn(win, event.sender, ...args);
  };

  ipcMain.on('page:navigate', page((win, wc, text) => {
    const tab = win.tabs.find((t) => t.wc === wc);
    if (tab && typeof text === 'string') win.load(tab, urls.resolveInput(text, data.settings.get('searchEngine')));
  }));
  ipcMain.handle('page:top-sites', page((win) => (win.isPrivate ? [] : data.history.topSites(8)), []));
  ipcMain.handle('page:history', page(() => data.history.list(), []));
  ipcMain.on('page:history-remove', page((_win, _wc, url, time) => data.history.remove(url, time)));
  ipcMain.on('page:history-clear', page(() => data.history.clear()));
  ipcMain.handle('page:bookmarks', page(() => data.bookmarks.list(), []));
  ipcMain.on('page:bookmark-remove', page((_win, _wc, id) => data.bookmarks.remove(id)));
}

module.exports = { TahaWindow, prepareSession, registerIpc };
