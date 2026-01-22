# Tor Mass Recursive Downloader

# Easy Install:
**https://github.com/dontcrossconnor/tor-mass-downloader-with-recursion/releases/tag/v1.0.0**

----------

A **Tor Browser** (Firefox-based) extension for **mass recursive file downloading** with speed tuning, resume, retry, and filters. All logic lives in `tor-recursive2/`; the rest of the repo is untouched.

## Features

- **Recursive scan** – Start from a directory URL; the extension follows subdirectories and adds all file links to a selectable list. You choose which to download and when to start.
- **Resume interrupted downloads** – Uses `browser.downloads.resume()` for downloads that were paused or interrupted (e.g. network drop, browser restart). No full re-download when the browser can resume.
- **Retry failed** – Automatic retries with exponential backoff. **Retry failed** button re-queues failed items without starting from scratch.
- **Speed / concurrency** – 1–8 concurrent downloads; delay between starting new downloads and between directory scans to avoid overloading Tor.
- **Filters** – Include/exclude by extension, min/max size (MB), include/exclude regex on filename. Filters apply before a file is queued.
- **Conflict handling** – Uniquify, overwrite, or prompt when a file with the same name exists.
- **Pause / resume / clear** – Pause downloads, resume, clear queue, or **Reset all** (queue + completed + failed).
- **Options** – Save path, max recursion depth, retry count, retry base delay, scan delay, conflict action, notifications.

## Install in Tor Browser

1. Open Tor Browser.
2. In the address bar: `about:debugging`.
3. **This Firefox** → **Load Temporary Add-on**.
4. Select `manifest.json` from the `tor-recursive2` folder.

Or pack the folder as a .xpi and install it like any unsigned add-on (temporary or permanent, depending on your Tor Browser / Firefox setup).

## Usage

1. **Scan page** – On a directory listing, click **Scan page** to extract file links from the current tab and add them to the **Discovered files** list (no recursion, no auto-download).
2. **Recursive from URL** – Enter a directory URL (or **Use current page**), then **▶ Start recursive scan**. The extension will:
   - Open the start URL and subdirs in background tabs,
   - Extract file and directory links (Apache-style tables, `<pre>`, generic `<a>`),
   - Add found files to the **Discovered files** list and recurse up to **max depth**. **No auto-download.**
3. **Discovered files** – List of found files with checkboxes. Use **Select all**, **Deselect all**, **Clear list**. Click **Start downloads** to queue only the selected files and begin downloading. You control when downloads start.
4. **Pause / Resume** – Pause stops new downloads; resume continues the queue.
5. **Retry failed** – Re-queues failed items and starts again.
6. **Options** – Save path, concurrency, delays, retries, recursion depth, conflict action, etc.

The popup is larger (560×500px) and supports `resize` where the browser allows.

## Options (Options page)

| Option | Description |
|--------|-------------|
| Save path | Subfolder under Downloads, e.g. `tor-downloads/` or `site-name/`. |
| Max concurrent | 1–8 parallel downloads. Higher is faster but can stress Tor. |
| Delay between starts | ms between starting each new download. 0 = fastest; 200–500 is gentler on Tor. |
| Delay between scans | ms before opening each new directory. Reduces load spikes. |
| Max retries | Retries per file with backoff. 0 = no retries. |
| Retry delay base | Base delay (ms) for first retry; later retries increase. |
| Resume interrupted | Use browser’s resume for interrupted/in-progress downloads when possible. |
| Auto-navigate subdirs | Recurse into directory links during a recursive scan. |
| Max recursion depth | Limit how deep to follow directories. |
| Conflict action | `uniquify` / `overwrite` / `prompt` when the file already exists. |
| Desktop notifications | Notify when a batch finishes. |

## Filters (popup; double‑click **Options** to show)

- **Include extensions** – Comma-separated, e.g. `pdf, zip, txt`. Empty = all.
- **Exclude extensions** – e.g. `exe, bat`.
- **Min / max size (MB)** – 0 = no limit.
- **Include / exclude pattern** – Regex on the filename.

Enable the **Enable filters** checkbox for these to apply.

## Resume and “continue without restarting”

- **Resume** (browser-level): When a download is *interrupted* (e.g. `interrupted` or still `in_progress` after a restart), the extension tries `browser.downloads.resume(downloadId)` so the existing partial file is continued instead of re-downloaded from 0. This depends on the server supporting range requests and the browser’s implementation.
- **Retry failed**: Failed items are kept in a `failed` list. **Retry failed** re-queues them and starts new downloads. If the server supports ranges and the browser can resume, a new download to the same path may still resume from the existing partial file when **Resume interrupted** is on and a matching interrupted item exists; otherwise it restarts from the beginning. For maximum “continue without restarting” behavior, keep **Resume interrupted** and **Auto-retry** on and use **Retry failed** after fixing network/server issues.

## File layout

```
tor-recursive2/
├── manifest.json
├── background.js   # Queue, resume, retry, recursion, filters, persistence
├── content.js      # Link extraction (tables, <pre>, generic <a>)
├── popup.html
├── popup.js
├── options.html
├── options.js
├── icon48.png
└── README.md
```

## Compatibility

- **Tor Browser** (Firefox-based), or Firefox 78+.
- Uses WebExtensions `browser.downloads`, `browser.storage`, `browser.tabs`, `browser.runtime`, `browser.notifications`. No `chrome.*` or Chrome-specific APIs.

## Permissions

- `activeTab`, `downloads`, `storage`, `tabs`, `notifications`, `<all_urls>` for loading and scanning pages and for downloads.
