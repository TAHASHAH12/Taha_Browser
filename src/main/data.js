const crypto = require('crypto');
const { EventEmitter } = require('events');
const JsonStore = require('./store');

const HISTORY_LIMIT = 5000;

// Emits 'change' whenever something the browser UI displays has changed.
const events = new EventEmitter();
const changed = () => events.emit('change');

const settingsStore = new JsonStore('settings', { searchEngine: 'google', showBookmarksBar: true });
const bookmarkStore = new JsonStore('bookmarks', []);
const historyStore = new JsonStore('history', []); // oldest first

const settings = {
  get: (key) => settingsStore.data[key],
  set(key, value) {
    settingsStore.data[key] = value;
    settingsStore.save();
    changed();
  },
};

const bookmarks = {
  list: () => bookmarkStore.data,
  get: (id) => bookmarkStore.data.find((b) => b.id === id),
  has: (url) => bookmarkStore.data.some((b) => b.url === url),
  toggle({ url, title, favicon }) {
    const index = bookmarkStore.data.findIndex((b) => b.url === url);
    if (index >= 0) bookmarkStore.data.splice(index, 1);
    else bookmarkStore.data.push({ id: crypto.randomUUID(), url, title: title || url, favicon: favicon || null });
    bookmarkStore.save();
    changed();
  },
  remove(id) {
    bookmarkStore.data = bookmarkStore.data.filter((b) => b.id !== id);
    bookmarkStore.save();
    changed();
  },
};

const history = {
  list: () => historyStore.data.slice().reverse(),
  addVisit(url, title) {
    const items = historyStore.data;
    const last = items[items.length - 1];
    if (last && last.url === url) last.time = Date.now();
    else items.push({ url, title: title || url, time: Date.now() });
    if (items.length > HISTORY_LIMIT) items.splice(0, items.length - HISTORY_LIMIT);
    historyStore.save();
  },
  // Titles arrive after the visit is recorded; attach to the latest visit.
  setTitle(url, title) {
    const items = historyStore.data;
    for (let i = items.length - 1; i >= 0 && i >= items.length - 50; i--) {
      if (items[i].url === url) {
        items[i].title = title;
        historyStore.save();
        return;
      }
    }
  },
  remove(url, time) {
    historyStore.data = historyStore.data.filter((h) => !(h.url === url && h.time === time));
    historyStore.save();
  },
  clear() {
    historyStore.data = [];
    historyStore.save();
  },
  topSites(limit) {
    const sites = new Map();
    for (const { url, title, time } of historyStore.data) {
      const site = sites.get(url) || { url, title, count: 0, time };
      site.count += 1;
      site.title = title;
      site.time = time;
      sites.set(url, site);
    }
    return [...sites.values()]
      .sort((a, b) => b.count - a.count || b.time - a.time)
      .slice(0, limit)
      .map(({ url, title }) => ({ url, title }));
  },
};

// Address bar suggestions from bookmarks and (unless private) history.
function suggest(query, { includeHistory = true, limit = 6 } = {}) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = new Map();
  const consider = (url, title, bonus) => {
    if (matches.has(url)) return;
    const bare = url.replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
    let score = 0;
    if (bare.startsWith(q)) score = 3;
    else if (bare.includes(q)) score = 2;
    else if ((title || '').toLowerCase().includes(q)) score = 1;
    if (score) matches.set(url, { url, title, score: score + bonus });
  };
  for (const b of bookmarkStore.data) consider(b.url, b.title, 0.5);
  if (includeHistory) {
    const items = historyStore.data;
    for (let i = items.length - 1; i >= 0; i--) consider(items[i].url, items[i].title, 0);
  }
  return [...matches.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ url, title }) => ({ url, title }));
}

// Downloads live only for the current run of the app.
const downloadList = [];
const downloads = {
  list: () => downloadList,
  add(entry) {
    downloadList.unshift(entry);
    changed();
  },
  clear() {
    for (let i = downloadList.length - 1; i >= 0; i--) {
      if (downloadList[i].state !== 'progressing') downloadList.splice(i, 1);
    }
    changed();
  },
  changed,
};

function flush() {
  settingsStore.flush();
  bookmarkStore.flush();
  historyStore.flush();
}

module.exports = { events, settings, bookmarks, history, downloads, suggest, flush };
