'use strict';

const list = document.getElementById('list');
const filter = document.getElementById('filter');
let entries = [];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function dayLabel(time) {
  const day = new Date(time);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return 'Today';
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return day.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function row(entry) {
  const el = document.createElement('div');
  el.className = 'row';

  const time = document.createElement('span');
  time.className = 'row-time';
  time.textContent = new Date(entry.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const link = document.createElement('a');
  link.className = 'row-link';
  link.href = entry.url;
  link.title = entry.url;
  const title = document.createElement('span');
  title.className = 'row-title';
  title.textContent = entry.title || entry.url;
  const host = document.createElement('span');
  host.className = 'row-host';
  host.textContent = hostOf(entry.url);
  link.append(title, host);

  const remove = document.createElement('button');
  remove.className = 'row-remove';
  remove.title = 'Remove from history';
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    taha.removeHistory(entry.url, entry.time);
    entries = entries.filter((e) => e !== entry);
    render();
  });

  el.append(time, link, remove);
  return el;
}

function render() {
  const q = filter.value.trim().toLowerCase();
  const visible = q
    ? entries.filter((e) => e.url.toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q))
    : entries;

  list.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = q ? 'No matching pages.' : 'Pages you visit will appear here.';
    list.append(empty);
    return;
  }

  let label = null;
  let rows = null;
  for (const entry of visible) {
    const next = dayLabel(entry.time);
    if (next !== label) {
      label = next;
      const heading = document.createElement('h2');
      heading.textContent = label;
      rows = document.createElement('div');
      rows.className = 'rows';
      list.append(heading, rows);
    }
    rows.append(row(entry));
  }
}

filter.addEventListener('input', render);
document.getElementById('clear').addEventListener('click', () => {
  if (!confirm('Clear all browsing history?')) return;
  taha.clearHistory();
  entries = [];
  render();
});

taha.history().then((items) => {
  entries = items;
  render();
});
