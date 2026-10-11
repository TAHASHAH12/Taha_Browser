'use strict';

const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
// Anyone can link to this page, so only ever retry a plain web address.
const retryable = /^https?:\/\//i.test(url);

let host = url;
try {
  host = new URL(url).hostname || url;
} catch {
  // Not a parseable URL; show it as typed.
}

const message = document.getElementById('message');
const name = document.createElement('strong');
name.textContent = host || 'The page';
message.append(name, ' could not be loaded. Check the address and your connection.');

document.getElementById('code').textContent = `${params.get('desc') || 'ERR_FAILED'} (${params.get('code') || '?'})`;
if (host) document.title = host;

const retry = document.getElementById('retry');
retry.hidden = !retryable;
retry.addEventListener('click', () => {
  if (retryable) location.replace(url);
});
