const NEW_TAB_URL = 'taha://newtab/';
const HISTORY_URL = 'taha://history/';
const BOOKMARKS_URL = 'taha://bookmarks/';
const ERROR_PAGE_PREFIX = 'taha://error/';

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
};

const isWebUrl = (url) => /^https?:\/\//i.test(url);
const isInternalUrl = (url) => url.startsWith('taha://');

function searchUrl(query, engine) {
  const { url } = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
  return url.replace('%s', encodeURIComponent(query));
}

// Turns whatever was typed in the address bar into a URL: an address if it
// looks like one, otherwise a search.
function resolveInput(input, engine) {
  const text = String(input).trim();
  if (!text) return NEW_TAB_URL;
  if (/^(https?|file|taha|about):/i.test(text)) return text;
  if (!/\s/.test(text)) {
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i.test(text)) {
      return `http://${text}`;
    }
    if (/^[^/?#@]+\.([a-z]{2,}|xn--[a-z0-9-]+)(:\d+)?([/?#].*)?$/i.test(text)) {
      return `https://${text}`;
    }
  }
  return searchUrl(text, engine);
}

function errorPageUrl(url, code, description) {
  const params = new URLSearchParams({ url, code: String(code), desc: description });
  return `${ERROR_PAGE_PREFIX}?${params}`;
}

// The URL that failed to load, if `url` is the error page; otherwise null.
function failedUrl(url) {
  if (!url.startsWith(ERROR_PAGE_PREFIX)) return null;
  try {
    return new URL(url).searchParams.get('url') || '';
  } catch {
    return '';
  }
}

// What the address bar shows for a given page URL.
function displayUrl(url) {
  if (url === NEW_TAB_URL) return '';
  return failedUrl(url) ?? url;
}

module.exports = {
  NEW_TAB_URL,
  HISTORY_URL,
  BOOKMARKS_URL,
  ERROR_PAGE_PREFIX,
  SEARCH_ENGINES,
  isWebUrl,
  isInternalUrl,
  resolveInput,
  searchUrl,
  errorPageUrl,
  failedUrl,
  displayUrl,
};
