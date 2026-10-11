'use strict';

const list = document.getElementById('list');
let bookmarks = [];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function render() {
  list.replaceChildren();
  if (bookmarks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No bookmarks yet. Click the star in the address bar to add one.';
    list.append(empty);
    return;
  }

  const rows = document.createElement('div');
  rows.className = 'rows';
  for (const bookmark of bookmarks) {
    const el = document.createElement('div');
    el.className = 'row';

    const link = document.createElement('a');
    link.className = 'row-link';
    link.href = bookmark.url;
    link.title = bookmark.url;
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = bookmark.title || bookmark.url;
    const host = document.createElement('span');
    host.className = 'row-host';
    host.textContent = hostOf(bookmark.url);
    link.append(title, host);

    const remove = document.createElement('button');
    remove.className = 'row-remove';
    remove.title = 'Delete bookmark';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      taha.removeBookmark(bookmark.id);
      bookmarks = bookmarks.filter((b) => b !== bookmark);
      render();
    });

    el.append(link, remove);
    rows.append(el);
  }
  list.append(rows);
}

taha.bookmarks().then((items) => {
  bookmarks = items;
  render();
});
