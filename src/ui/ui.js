'use strict';

const $ = (id) => document.getElementById(id);
const svg = (body) => `<svg viewBox="0 0 16 16">${body}</svg>`;
const ICON = {
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  reload: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3"/>'),
  globe: svg('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.2 2 2.2 10 0 12M8 2c-2.2 2-2.2 10 0 12"/>'),
  lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  search: svg('<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>'),
  warning: svg('<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3v.2"/>'),
};

const chromeEl = $('chrome');
const tabsEl = $('tabs');
const address = $('address');
const siteIcon = $('site-icon');
const star = $('star');
const reloadBtn = $('reload');
const bookmarksBar = $('bookmarks-bar');
const findbar = $('findbar');
const findInput = $('find-input');
const findCount = $('find-count');
const suggestionsEl = $('suggestions');

let state = null;
let activeTab = null;
let shown = { id: null, url: null }; // what the address bar currently reflects
let dirty = false; // the user has typed over the page's URL
const tabEls = new Map();
let dragId = null;

// ---- tabs ----------------------------------------------------------------

function createTabEl(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.draggable = true;
  el.innerHTML = `<span class="tab-icon"></span><span class="tab-title"></span><button class="tab-close" title="Close tab">${ICON.close}</button>`;

  el.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.target.closest('.tab-close')) browser.selectTab(id);
  });
  el.addEventListener('auxclick', (e) => {
    if (e.button === 1) browser.closeTab(id);
  });
  el.querySelector('.tab-close').addEventListener('click', () => browser.closeTab(id));

  el.addEventListener('dragstart', (e) => {
    dragId = id;
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragover', (e) => {
    if (dragId === null || dragId === id) return;
    e.preventDefault();
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const index = state.tabs.findIndex((t) => t.id === id);
    if (dragId !== null && index >= 0) browser.moveTab(dragId, index);
  });
  el.addEventListener('dragend', () => {
    dragId = null;
  });
  return el;
}

function setIcon(holder, { loading, favicon }) {
  const key = loading ? 'loading' : favicon || 'default';
  if (holder.dataset.key === key) return;
  holder.dataset.key = key;
  if (loading) {
    holder.innerHTML = '<div class="spinner"></div>';
  } else if (favicon) {
    const img = document.createElement('img');
    img.onerror = () => {
      holder.innerHTML = ICON.globe;
    };
    img.src = favicon;
    holder.replaceChildren(img);
  } else {
    holder.innerHTML = ICON.globe;
  }
}

function renderTabs() {
  const live = new Set();
  state.tabs.forEach((tab, index) => {
    let el = tabEls.get(tab.id);
    if (!el) {
      el = createTabEl(tab.id);
      tabEls.set(tab.id, el);
    }
    live.add(tab.id);
    el.classList.toggle('active', tab.id === state.activeId);
    el.title = tab.title;
    el.querySelector('.tab-title').textContent = (tab.audible ? '🔊 ' : '') + tab.title;
    setIcon(el.querySelector('.tab-icon'), tab);
    if (tabsEl.children[index] !== el) tabsEl.insertBefore(el, tabsEl.children[index] || null);
  });
  for (const [id, el] of tabEls) {
    if (!live.has(id)) {
      el.remove();
      tabEls.delete(id);
    }
  }
}

// ---- toolbar -------------------------------------------------------------

function renderToolbar() {
  const tab = activeTab;
  $('back').disabled = !tab || !tab.canGoBack;
  $('forward').disabled = !tab || !tab.canGoForward;

  const mode = tab && tab.loading ? 'stop' : 'reload';
  if (reloadBtn.dataset.mode !== mode) {
    reloadBtn.dataset.mode = mode;
    reloadBtn.title = mode === 'stop' ? 'Stop' : 'Reload';
    reloadBtn.innerHTML = mode === 'stop' ? ICON.close : ICON.reload;
  }

  const url = tab ? tab.url : '';
  if (tab && (tab.id !== shown.id || tab.url !== shown.url)) {
    const switched = tab.id !== shown.id;
    if (switched) {
      closeFind();
      closeSuggestions();
    }
    // Don't overwrite what the user is in the middle of typing.
    if (switched || !(dirty && document.activeElement === address)) {
      address.value = url;
      dirty = false;
    }
    shown = { id: tab.id, url: tab.url };
  }

  const icon = url.startsWith('https://') ? 'lock' : url.startsWith('http://') ? 'warning' : 'search';
  if (siteIcon.dataset.icon !== icon) {
    siteIcon.dataset.icon = icon;
    siteIcon.innerHTML = ICON[icon];
    siteIcon.classList.toggle('insecure', icon === 'warning');
    siteIcon.title = icon === 'lock' ? 'Connection is secure' : icon === 'warning' ? 'Connection is not secure' : '';
  }

  star.hidden = !url;
  star.classList.toggle('on', Boolean(tab && tab.bookmarked));
  star.title = tab && tab.bookmarked ? 'Remove bookmark' : 'Bookmark this page';

  $('private-badge').hidden = !state.isPrivate;
  $('downloads').hidden = state.downloads.count === 0;
  $('downloads').querySelector('.dot').hidden = state.downloads.active === 0;
}

let bookmarksKey = '';
function renderBookmarks() {
  bookmarksBar.hidden = !state.showBookmarksBar || state.bookmarks.length === 0;
  const key = JSON.stringify(state.bookmarks);
  if (key === bookmarksKey) return;
  bookmarksKey = key;
  bookmarksBar.replaceChildren(
    ...state.bookmarks.map((bookmark) => {
      const el = document.createElement('button');
      el.className = 'bookmark';
      el.title = `${bookmark.title}\n${bookmark.url}`;
      if (bookmark.favicon) {
        const img = document.createElement('img');
        img.onerror = () => img.remove();
        img.src = bookmark.favicon;
        el.append(img);
      } else {
        el.innerHTML = ICON.globe;
      }
      const label = document.createElement('span');
      label.textContent = bookmark.title;
      el.append(label);
      el.addEventListener('click', (e) => browser.openBookmark(bookmark.id, e.metaKey || e.ctrlKey));
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) browser.openBookmark(bookmark.id, true);
      });
      el.addEventListener('contextmenu', (e) => browser.showBookmarkMenu(bookmark.id, e.clientX, e.clientY));
      return el;
    }),
  );
}

function render() {
  activeTab = state.tabs.find((t) => t.id === state.activeId) || null;
  document.body.classList.toggle('mac', state.platform === 'darwin' && !state.fullscreen);
  document.body.classList.toggle('private', state.isPrivate);
  renderTabs();
  renderToolbar();
  renderBookmarks();
}

// ---- address bar ---------------------------------------------------------

let suggestions = [];
let selected = -1;
let typed = '';
let suggestSeq = 0;

function go(text) {
  closeSuggestions();
  dirty = false;
  shown.url = null; // refresh from the page once it starts loading
  address.blur();
  browser.navigate(text);
}

function closeSuggestions() {
  suggestSeq++;
  if (suggestionsEl.hidden) return;
  suggestionsEl.hidden = true;
  suggestions = [];
  selected = -1;
  browser.setOverlay(false);
}

function showSuggestions(items) {
  if (items.length === 0) return closeSuggestions();
  suggestions = items;
  selected = -1;
  suggestionsEl.replaceChildren(
    ...items.map((item, index) => {
      const el = document.createElement('div');
      el.className = 'suggestion';
      const title = document.createElement('span');
      title.className = 'suggestion-title';
      title.textContent = item.title || item.url;
      const url = document.createElement('span');
      url.className = 'suggestion-url';
      url.textContent = item.url.replace(/^https?:\/\//, '');
      el.append(title, url);
      // mousedown, so the address bar keeps focus until we navigate.
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        go(suggestions[index].url);
      });
      return el;
    }),
  );
  const box = $('omnibox').getBoundingClientRect();
  suggestionsEl.style.left = `${box.left}px`;
  suggestionsEl.style.top = `${box.bottom + 4}px`;
  suggestionsEl.style.width = `${box.width}px`;
  suggestionsEl.hidden = false;
  // The dropdown hangs below the toolbar; ask for room over the page.
  browser.setOverlay(true);
}

function select(index) {
  selected = index;
  [...suggestionsEl.children].forEach((el, i) => el.classList.toggle('selected', i === index));
  address.value = index >= 0 ? suggestions[index].url : typed;
}

address.addEventListener('input', async () => {
  dirty = true;
  typed = address.value;
  const seq = ++suggestSeq;
  if (!typed.trim()) return closeSuggestions();
  const items = await browser.suggest(typed);
  if (seq === suggestSeq && document.activeElement === address) showSuggestions(items);
});

address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    go(address.value);
  } else if (e.key === 'Escape') {
    if (!suggestionsEl.hidden) {
      closeSuggestions();
    } else {
      address.value = activeTab ? activeTab.url : '';
      dirty = false;
      address.select();
    }
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
    e.preventDefault();
    const count = suggestions.length + 1; // one extra slot: back to what was typed
    const step = e.key === 'ArrowDown' ? 1 : -1;
    select(((selected + 1 + step + count) % count) - 1);
  }
});

address.addEventListener('focus', () => address.select());
address.addEventListener('mouseup', (e) => {
  // Keep the select-all from the focus that this click caused.
  if (address.selectionStart === 0 && address.selectionEnd === address.value.length) e.preventDefault();
});
address.addEventListener('blur', () => {
  closeSuggestions();
  if (dirty) {
    address.value = activeTab ? activeTab.url : '';
    dirty = false;
  }
});

// ---- find in page --------------------------------------------------------

function openFind() {
  findbar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) browser.find(findInput.value, true, true);
}

function closeFind() {
  if (findbar.hidden) return;
  findbar.hidden = true;
  findCount.textContent = '';
  browser.stopFind();
}

findInput.addEventListener('input', () => {
  if (!findInput.value) findCount.textContent = '';
  browser.find(findInput.value, true, true);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && findInput.value) browser.find(findInput.value, !e.shiftKey, false);
  else if (e.key === 'Escape') closeFind();
});
$('find-next').addEventListener('click', () => findInput.value && browser.find(findInput.value, true, false));
$('find-prev').addEventListener('click', () => findInput.value && browser.find(findInput.value, false, false));
$('find-close').addEventListener('click', closeFind);

// ---- buttons -------------------------------------------------------------

const below = (el) => {
  const rect = el.getBoundingClientRect();
  return [rect.left, rect.bottom + 4];
};

$('new-tab').addEventListener('click', () => browser.newTab());
$('back').addEventListener('click', () => browser.back());
$('forward').addEventListener('click', () => browser.forward());
reloadBtn.addEventListener('click', () => (reloadBtn.dataset.mode === 'stop' ? browser.stop() : browser.reload()));
star.addEventListener('click', () => browser.toggleBookmark());
$('menu').addEventListener('click', (e) => browser.showAppMenu(...below(e.currentTarget)));
$('downloads').addEventListener('click', (e) => browser.showDownloads(...below(e.currentTarget)));

// Nothing dropped on the toolbar should load into it.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
window.addEventListener('contextmenu', (e) => {
  if (e.target !== address && e.target !== findInput) e.preventDefault();
});

// ---- wiring --------------------------------------------------------------

browser.onState((next) => {
  state = next;
  render();
});
browser.onFocusAddress(() => {
  address.focus();
  address.select();
});
browser.onFindOpen(openFind);
browser.onFindResult(({ active, total }) => {
  if (!findbar.hidden) findCount.textContent = total ? `${active}/${total}` : 'No results';
});

// The page view sits directly below the toolbar, however tall it currently is.
new ResizeObserver(() => browser.setChromeHeight(chromeEl.offsetHeight)).observe(chromeEl);
browser.ready();
