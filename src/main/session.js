const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, dialog, net } = require('electron');
const data = require('./data');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const PAGES = new Set(['newtab', 'history', 'bookmarks', 'error']);

// Granted without asking.
const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
// Granted only if the user agrees; everything else is denied.
const ASK = {
  media: 'use your camera and microphone',
  geolocation: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'read your clipboard',
};

// Serves the browser's own pages: taha://newtab/, taha://history/, ...
async function serveInternalPage(request) {
  try {
    const url = new URL(request.url);
    if (!PAGES.has(url.hostname)) throw new Error('unknown page');
    const name = url.pathname === '/' ? `${url.hostname}.html` : path.basename(url.pathname);
    return await net.fetch(pathToFileURL(path.join(PAGES_DIR, name)).toString());
  } catch {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
}

function uniquePath(dir, filename) {
  const { name, ext } = path.parse(path.basename(filename) || 'download');
  let candidate = path.join(dir, name + ext);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${name} (${i})${ext}`);
  return candidate;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// hooks.parentWindow(webContents) -> window to attach dialogs to
// hooks.onDownloadStarted(webContents)
function setupSession(ses, hooks) {
  ses.protocol.handle('taha', serveInternalPage);

  const decisions = new Map(); // "origin|permission" -> boolean, for this run
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true;
    return decisions.get(`${originOf(requestingOrigin)}|${permission}`) === true;
  });
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (AUTO_ALLOW.has(permission)) return callback(true);
    const origin = originOf(details.requestingUrl || wc.getURL());
    if (!ASK[permission] || !origin || origin === 'null') return callback(false);
    const key = `${origin}|${permission}`;
    if (decisions.has(key)) return callback(decisions.get(key));
    const options = {
      type: 'question',
      message: `${origin} wants to ${ASK[permission]}`,
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
    };
    const parent = hooks.parentWindow(wc);
    const { response } = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
    decisions.set(key, response === 0);
    callback(response === 0);
  });

  ses.on('will-download', (_event, item, wc) => {
    const savePath = uniquePath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
    const entry = {
      name: path.basename(savePath),
      path: savePath,
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes(),
    };
    data.downloads.add(entry);
    item.on('updated', () => {
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      data.downloads.changed();
    });
    item.once('done', (_e, state) => {
      entry.state = state; // completed | cancelled | interrupted
      data.downloads.changed();
    });
    hooks.onDownloadStarted(wc);
  });
}

module.exports = { setupSession };
