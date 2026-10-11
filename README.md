# Taha

A web browser built on Chromium, using [Electron](https://www.electronjs.org/) as the embedding layer.

## Run

```sh
npm install
npm start
```

Open a URL directly with `npm start -- https://example.com`.

## Build the app

```sh
npm run pack   # dist/mac-arm64/Taha.app (fast, unpacked)
npm run dist   # installer (.dmg on macOS)
```

The build is not signed with an Apple Developer ID, so it runs on the machine that built it; other Macs
will show a Gatekeeper warning.

electron-builder refuses to write into a path containing an apostrophe (such as `Taha's Browser`).
Either rename the project folder, or send the output elsewhere:

```sh
npx electron-builder --dir -c.directories.output="$HOME/taha-dist"
```

## Features

- Tabs: open, close, reorder by dragging, reopen closed, middle-click to close
- Address bar that takes an address or a search, with suggestions from history and bookmarks
- Back / forward / reload / stop, zoom, find in page, full-screen video
- Bookmarks (star button, bookmarks bar, `taha://bookmarks`)
- History (`taha://history`), with search and per-entry removal
- Downloads, saved to your Downloads folder
- Private windows: separate in-memory session, nothing written to history
- Choice of search engine (Google, DuckDuckGo, Bing) from the ⋮ menu
- Permission prompts for camera/microphone, location, notifications and clipboard
- Light and dark themes following the system
- Developer tools and a right-click menu on pages

## Shortcuts

On Windows and Linux use Ctrl in place of ⌘.

| Action | Shortcut |
| --- | --- |
| New tab / window / private window | ⌘T / ⌘N / ⇧⌘N |
| Close tab / reopen closed tab | ⌘W / ⇧⌘T |
| Focus address bar | ⌘L |
| Next / previous tab | ⌃Tab / ⌃⇧Tab |
| Jump to tab 1–8 / last tab | ⌘1–⌘8 / ⌘9 |
| Back / forward | ⌘[ / ⌘] |
| Reload / force reload | ⌘R / ⇧⌘R |
| Find in page | ⌘F |
| Bookmark this page / toggle bookmarks bar | ⌘D / ⇧⌘B |
| History | ⌘Y |
| Zoom in / out / reset | ⌘+ / ⌘- / ⌘0 |
| Developer tools | ⌥⌘I |

## How it is put together

```
src/main/       main process
  main.js       startup, app lifecycle
  window.js     a browser window: toolbar view + one view per tab, and all IPC
  session.js    taha:// pages, permission prompts, downloads
  data.js       bookmarks, history, settings (JSON files in the profile folder)
  menu.js       application menu and keyboard shortcuts
  urls.js       address-bar input -> URL
src/ui/         the toolbar: tab strip, address bar, bookmarks bar, find bar
src/pages/      taha://newtab, taha://history, taha://bookmarks, taha://error
src/preload/    the narrow bridges between those pages and the main process
```

Each window is a `BaseWindow` holding one `WebContentsView` for the toolbar and one per tab; only the
active tab's view is attached. Web pages run sandboxed with no access to Node or to the browser's own
APIs — the `taha` bridge is exposed only to `taha://` pages, and the main process re-checks the sender
of every message.

Profile data lives in `~/Library/Application Support/Taha` on macOS.

## Not included

Extensions, sync, a password manager, session restore, and pop-ups that need to talk back to the page
that opened them (links that open a new window become ordinary tabs).
