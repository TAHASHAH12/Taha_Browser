'use strict';

const query = document.getElementById('query');
const tiles = document.getElementById('tiles');

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  if (query.value.trim()) taha.navigate(query.value);
});

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// A stable colour per site, so tiles are recognisable without favicons.
function colorFor(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 48%)`;
}

taha.topSites().then((sites) => {
  tiles.replaceChildren(
    ...sites.map((site) => {
      const host = hostOf(site.url);
      const tile = document.createElement('a');
      tile.className = 'tile';
      tile.href = site.url;
      tile.title = site.url;
      const letter = document.createElement('span');
      letter.className = 'tile-letter';
      letter.textContent = host.charAt(0);
      letter.style.background = colorFor(host);
      const title = document.createElement('span');
      title.className = 'tile-title';
      title.textContent = site.title && site.title !== site.url ? site.title : host;
      tile.append(letter, title);
      return tile;
    }),
  );
});
