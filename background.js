// Tor Mass Recursive Downloader - Background
// Optimized for speed, resume, retry, recursion, and full control

console.log('[Tor Mass Recursive DL] Background loaded');

// --- State ---
let downloadQueue = [];
let completedDownloads = [];
let failedDownloads = [];
let visitedUrls = new Set();
let discoveredFiles = [];
let discoveredUrls = new Set();
let scanVisitedDirs = new Set();
let rootOrigin = '';
let rootPath = '';
let isDownloading = false;
let isScanning = false;
let pauseRequested = false;
let stopScanRequested = false;
let activeDownloadIds = new Map(); // downloadId -> { url, savePath, retries, resolve, reject }
let downloadIdToItem = new Map();  // downloadId -> queue item (for resume/retry)

// --- Default settings ---
const DEFAULTS = {
  savePath: 'tor-downloads/',
  maxConcurrentDownloads: 4,
  delayBetweenStarts: 200,
  delayBetweenScans: 800,
  retryFailed: true,
  maxRetries: 5,
  retryDelayBase: 1500,
  resumeInterrupted: true,
  autoNavigateSubdirs: true,
  maxRecursionDepth: 20,
  showNotifications: true,
  conflictAction: 'uniquify',
  parallelChunks: 0,
  parallelChunksMaxSizeMB: 8192,
  // Filters
  enableFilters: false,
  fileFilters: {
    extensions: [],
    excludeExtensions: [],
    minSize: 0,
    maxSize: 0,
    includePattern: '',
    excludePattern: ''
  }
};

async function loadSettings() {
  const r = await browser.storage.local.get('settings');
  return { ...DEFAULTS, ...(r.settings || {}) };
}

async function saveSettings(s) {
  await browser.storage.local.set({ settings: s });
}

// --- Filtering ---
function fileMatchesFilters(filename, size, s) {
  if (!s.enableFilters) return true;
  const f = s.fileFilters || {};
  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (Array.isArray(f.extensions) && f.extensions.length > 0) {
    if (!f.extensions.includes(ext)) return false;
  }
  if (Array.isArray(f.excludeExtensions) && f.excludeExtensions.length > 0) {
    if (f.excludeExtensions.includes(ext)) return false;
  }
  if (f.minSize > 0 && (size || 0) < f.minSize) return false;
  if (f.maxSize > 0 && (size || 0) > f.maxSize) return false;
  if (f.includePattern) {
    try {
      if (!new RegExp(f.includePattern, 'i').test(filename)) return false;
    } catch (_) {}
  }
  if (f.excludePattern) {
    try {
      if (new RegExp(f.excludePattern, 'i').test(filename)) return false;
    } catch (_) {}
  }
  return true;
}

// --- Chunked (multi-connection) single-file download ---
async function downloadOneChunked(item, s) {
  const url = item.url;
  const N = Math.max(2, Math.min(8, s.parallelChunks || 0));
  const maxBytes = (s.parallelChunksMaxSizeMB || 8192) * 1024 * 1024;
  let blobUrl = null;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const cl = head.headers.get('Content-Length');
    const ar = head.headers.get('Accept-Ranges');
    if (!cl || (ar && ar.toLowerCase() !== 'bytes')) return false;
    const size = parseInt(cl, 10);
    if (isNaN(size) || size <= 0 || size > maxBytes) return false;
    if (size < 4096) return false;

    const ranges = [];
    for (let i = 0; i < N; i++) {
      const start = Math.floor((i * size) / N);
      const end = (i === N - 1) ? size - 1 : Math.floor(((i + 1) * size) / N) - 1;
      if (start <= end) ranges.push({ start, end });
    }
    const chunks = await Promise.all(ranges.map(r =>
      fetch(url, { headers: { Range: `bytes=${r.start}-${r.end}` } }).then(res => {
        if (!res.ok) throw new Error('Range ' + res.status);
        return res.arrayBuffer();
      })
    ));

    const merged = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      merged.set(new Uint8Array(c), off);
      off += c.byteLength;
    }
    const blob = new Blob([merged]);
    blobUrl = URL.createObjectURL(blob);

    const id = await browser.downloads.download({
      url: blobUrl,
      filename: item.savePath,
      saveAs: false,
      conflictAction: s.conflictAction || 'uniquify'
    });
    const result = await waitForDownload(id);
    return !!result.ok;
  } catch (_) {
    return false;
  } finally {
    if (blobUrl) try { URL.revokeObjectURL(blobUrl); } catch (_) {}
  }
}

// --- Single file download with resume and retry ---
function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state && delta.state.current === 'complete') {
        try { browser.downloads.onChanged.removeListener(onChanged); } catch (_) {}
        activeDownloadIds.delete(downloadId);
        downloadIdToItem.delete(downloadId);
        resolve({ ok: true });
      } else if (delta.state && delta.state.current === 'interrupted') {
        try { browser.downloads.onChanged.removeListener(onChanged); } catch (_) {}
        activeDownloadIds.delete(downloadId);
        const item = downloadIdToItem.get(downloadId);
        downloadIdToItem.delete(downloadId);
        resolve({ ok: false, error: (delta.error && delta.error.current) || 'INTERRUPTED', item });
      } else if (delta.error && delta.error.current) {
        try { browser.downloads.onChanged.removeListener(onChanged); } catch (_) {}
        activeDownloadIds.delete(downloadId);
        const it = downloadIdToItem.get(downloadId);
        downloadIdToItem.delete(downloadId);
        resolve({ ok: false, error: delta.error.current, item: it });
      }
    };
    browser.downloads.onChanged.addListener(onChanged);
  });
}

async function downloadOne(item, retries = 0) {
  const s = await loadSettings();
  const fn = item.savePath.replace(/^.*[\\/]/, '');
  const url = item.url;

  // 1) Try to resume existing interrupted download for same path
  if (s.resumeInterrupted && retries === 0) {
    try {
      const existing = await browser.downloads.search({ limit: 500 });
      const match = existing.find(d => {
        const p = (d.filename || '').replace(/\\/g, '/');
        const sp = (item.savePath || '').replace(/\\/g, '/');
        return p.endsWith(sp) || sp.endsWith(p.split('/').pop());
      });
      if (match && (match.state === 'interrupted' || match.state === 'in_progress') && match.canResume) {
        try {
          await browser.downloads.resume(match.id);
          const r = await waitForDownload(match.id);
          if (r.ok) {
            completedDownloads.push({ ...item, status: 'resumed' });
            notifyProgress();
            return true;
          }
          // fall through to retry as new
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 2) Chunked (parallel range) download when enabled and server supports it
  if (s.parallelChunks >= 2 && (s.parallelChunksMaxSizeMB || 8192) > 0) {
    const ok = await downloadOneChunked(item, s);
    if (ok) {
      completedDownloads.push({ ...item, status: 'success' });
      notifyProgress();
      return true;
    }
  }

  // 3) Start new download (single connection)
  try {
    const id = await browser.downloads.download({
      url,
      filename: item.savePath,
      saveAs: false,
      conflictAction: s.conflictAction || 'uniquify',
      allowHttpErrors: false
    });
    downloadIdToItem.set(id, item);
    const result = await waitForDownload(id);

    if (result.ok) {
      completedDownloads.push({ ...item, status: 'success' });
      notifyProgress();
      return true;
    }

    // Interrupted/failed: retry or record as failed
    if (s.retryFailed && retries < s.maxRetries) {
      const delay = s.retryDelayBase * Math.pow(1.5, retries);
      await new Promise(r => setTimeout(r, delay));
      return downloadOne(item, retries + 1);
    }

    failedDownloads.push({ ...item, error: result.error || 'unknown' });
    persistFailed();
    notifyProgress();
    return false;
  } catch (err) {
    if (s.retryFailed && retries < s.maxRetries) {
      const delay = s.retryDelayBase * Math.pow(1.5, retries);
      await new Promise(r => setTimeout(r, delay));
      return downloadOne(item, retries + 1);
    }
    failedDownloads.push({ ...item, error: (err && err.message) || 'unknown' });
    persistFailed();
    notifyProgress();
    return false;
  }
}

function notifyProgress() {
  browser.runtime.sendMessage({
    action: 'progress',
    queued: downloadQueue.length,
    completed: completedDownloads.length,
    failed: failedDownloads.length,
    isDownloading,
    isPaused: pauseRequested,
    isScanning
  }).catch(() => {});
}

// --- Queue processor (parallel, speed‑tuned) ---
async function processQueue() {
  if (isDownloading || downloadQueue.length === 0 || pauseRequested) return;
  isDownloading = true;
  const s = await loadSettings();
  const concurrency = Math.max(1, Math.min(8, s.maxConcurrentDownloads || 4));
  const delayStart = Math.max(0, s.delayBetweenStarts || 200);

  const workers = [];
  const run = async () => {
    while (downloadQueue.length > 0 && !pauseRequested) {
      const item = downloadQueue.shift();
      if (!item) continue;
      if (!fileMatchesFilters((item.savePath || '').split(/[/\\]/).pop(), item.size, s)) continue;
      await downloadOne(item);
      if (delayStart > 0) await new Promise(r => setTimeout(r, delayStart));
    }
  };

  for (let i = 0; i < concurrency; i++) workers.push(run());
  await Promise.all(workers);
  isDownloading = false;
  notifyProgress();

  if (s.showNotifications && completedDownloads.length + failedDownloads.length > 0) {
    try {
      browser.notifications.create({
        type: 'basic',
        title: 'Tor Mass Recursive DL',
        message: `Done: ${completedDownloads.length} OK, ${failedDownloads.length} failed.`
      });
    } catch (_) {}
  }
  persistFailed();
}

async function persistFailed() {
  if (failedDownloads.length > 0) {
    try {
      await browser.storage.local.set({ lastFailed: failedDownloads.slice(-200) });
    } catch (_) {}
  }
}

// --- Recursive scan (directory‑listing aware) ---
async function scanPageForLinks(pageUrl) {
  let tab;
  try {
    tab = await browser.tabs.create({ url: pageUrl, active: false });
    await new Promise((resolve, reject) => {
      const done = () => {
        try { browser.tabs.onUpdated.removeListener(listener); } catch (_) {}
        resolve();
      };
      const listener = (tid, info) => {
        if (tid === tab.id && info.status === 'complete') done();
      };
      browser.tabs.onUpdated.addListener(listener);
      setTimeout(done, 25000);
    });
    await new Promise(r => setTimeout(r, 400));
    const res = await browser.tabs.sendMessage(tab.id, { action: 'scanPage', baseUrl: pageUrl });
    await browser.tabs.remove(tab.id).catch(() => {});
    return res || { links: [], dirs: [] };
  } catch (e) {
    try { if (tab && tab.id) await browser.tabs.remove(tab.id); } catch (_) {}
    return { links: [], dirs: [], error: (e && e.message) || 'scan error' };
  }
}

async function scanRecursive(url, depth = 0) {
  const s = await loadSettings();
  const maxDepth = Math.max(1, s.maxRecursionDepth || 20);
  if (depth > maxDepth) return;
  const norm = url.replace(/\/*$/, '') + (url.endsWith('/') ? '' : '/');
  if (scanVisitedDirs.has(norm)) return;
  if (stopScanRequested) return;
  scanVisitedDirs.add(norm);

  const { links = [], dirs = [] } = await scanPageForLinks(norm);
  const base = new URL(norm).origin + new URL(norm).pathname.replace(/\/?$/, '/');

  for (const l of links) {
    let u = l.url || l.href;
    if (!u || typeof u !== 'string') continue;
    if (!/^https?:\/\//i.test(u)) u = new URL(u, base).href;
    try {
      const linkUrl = new URL(u);
      if (rootOrigin && linkUrl.origin !== rootOrigin) continue;
      if (rootPath && !(linkUrl.pathname || '/').startsWith(rootPath)) continue;
    } catch (_) { continue; }
    if (discoveredUrls.has(u)) continue;
    discoveredUrls.add(u);
    let path = (new URL(u).pathname || '/').replace(/^\//, '');
    let name = path.split('/').filter(Boolean).pop() || 'index.html';
    if (!name.includes('.') && !/\/$/.test(u)) name = name + '.html';
    const savePath = (s.savePath || 'tor-downloads/').replace(/\/$/, '') + '/' + path;
    discoveredFiles.push({ url: u, savePath, size: l.size, selected: true });
  }

  notifyProgress();
  browser.runtime.sendMessage({ action: 'scanProgress', scanned: discoveredFiles.length }).catch(() => {});

  if (s.autoNavigateSubdirs && depth < maxDepth) {
    const toScan = dirs.length ? dirs : links.filter(l => (l.isDirectory || (l.url || '').endsWith('/')));
    const urls = [];
    for (const d of toScan) {
      let u = (d.url || d.href || d);
      if (typeof u !== 'string') continue;
      if (!/^https?:\/\//i.test(u)) u = new URL(u, base).href;
      u = u.replace(/\/*$/, '') + '/';
      try {
        const linkUrl = new URL(u);
        if (rootOrigin && linkUrl.origin !== rootOrigin) continue;
        const lp = (linkUrl.pathname || '/').replace(/\/+$/, '') + '/';
        if (rootPath && !lp.startsWith(rootPath)) continue;
      } catch (_) { continue; }
      if (!scanVisitedDirs.has(u)) urls.push(u);
    }
    const scanDelay = Math.max(300, s.delayBetweenScans || 800);
    for (const u of urls) {
      if (pauseRequested || stopScanRequested) break;
      await scanRecursive(u, depth + 1);
      await new Promise(r => setTimeout(r, scanDelay));
    }
  }
}

async function runRecursiveScan(startUrl) {
  if (isScanning) return;
  isScanning = true;
  stopScanRequested = false;
  discoveredFiles = [];
  discoveredUrls = new Set();
  scanVisitedDirs = new Set();
  const s = await loadSettings();
  const u = (startUrl || '').trim().replace(/\/*$/, '') + '/';
  if (!u || !/^https?:\/\//i.test(u)) {
    isScanning = false;
    return;
  }
  try {
    const start = new URL(u);
    rootOrigin = start.origin;
    rootPath = (start.pathname || '/').replace(/\/+$/, '') + '/';
    await scanRecursive(u, 0);
  } finally {
    rootOrigin = '';
    rootPath = '';
    browser.runtime.sendMessage({ action: 'scanComplete', discovered: discoveredFiles.length, stopped: stopScanRequested }).catch(() => {});
    stopScanRequested = false;
    isScanning = false;
    notifyProgress();
  }
}

// --- Message handler ---
browser.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  const respond = (v) => { try { sendResponse(v); } catch (_) {} };

  switch (req.action) {
    case 'getSettings':
      loadSettings().then(respond);
      return true;

    case 'saveSettings':
      saveSettings(req.settings || {}).then(() => respond({ ok: true }));
      return true;

    case 'getStatus': {
      const sel = discoveredFiles.filter(d => d.selected).length;
      respond({
        queued: downloadQueue.length,
        completed: completedDownloads.length,
        failed: failedDownloads.length,
        isDownloading,
        isPaused: pauseRequested,
        isScanning,
        scannedCount: discoveredFiles.length,
        discoveredFiles: discoveredFiles.slice(0, 500),
        discoveredTotal: discoveredFiles.length,
        discoveredSelectedCount: sel,
        failedList: failedDownloads.slice(-50)
      });
      return false;
    }

    case 'startDownload':
      (req.urls || []).forEach(o => {
        const u = (o.url || o).toString();
        if (u && !visitedUrls.has(u)) {
          visitedUrls.add(u);
          downloadQueue.push({
            url: u,
            savePath: o.savePath || (o.filename) || ((u.split('/').filter(Boolean).pop()) || 'index.html'),
            size: o.size
          });
        }
      });
      processQueue();
      respond({ ok: true, queued: downloadQueue.length });
      return false;

    case 'startRecursive':
      runRecursiveScan(req.url);
      respond({ ok: true, message: 'Recursive scan started' });
      return true;

    case 'stopScan':
      stopScanRequested = true;
      respond({ ok: true, message: 'Stop requested' });
      return false;

    case 'addDiscovered':
      (req.items || []).forEach(o => {
        const u = (o.url || o).toString();
        if (u && !discoveredUrls.has(u)) {
          discoveredUrls.add(u);
          discoveredFiles.push({ url: u, savePath: o.savePath || (u.split('/').filter(Boolean).pop() || 'file'), size: o.size || 0, selected: true });
        }
      });
      respond({ ok: true, count: discoveredFiles.length });
      return false;

    case 'setFileSelected': {
      const f = discoveredFiles.find(d => d.url === req.url);
      if (f) f.selected = !!req.selected;
      respond({ ok: true });
      return false;
    }

    case 'selectAllDiscovered':
      discoveredFiles.forEach(d => { d.selected = !!req.selected; });
      respond({ ok: true });
      return false;

    case 'clearDiscovered':
      discoveredFiles = [];
      discoveredUrls = new Set();
      respond({ ok: true });
      return false;

    case 'startDownloadFromSelected': {
      let n = 0;
      discoveredFiles.filter(d => d.selected).forEach(d => {
        if (!visitedUrls.has(d.url)) {
          visitedUrls.add(d.url);
          downloadQueue.push({ url: d.url, savePath: d.savePath, size: d.size });
          n++;
        }
      });
      if (n > 0) processQueue();
      respond({ ok: true, queued: n });
      return false;
    }

    case 'pause':
      pauseRequested = true;
      respond({ ok: true });
      return false;

    case 'resume':
      pauseRequested = false;
      processQueue();
      respond({ ok: true });
      return false;

    case 'clearQueue':
      downloadQueue = [];
      respond({ ok: true });
      return false;

    case 'clearCompleted':
      completedDownloads = [];
      failedDownloads = [];
      respond({ ok: true });
      return false;

    case 'retryFailed':
      failedDownloads.forEach(f => {
        downloadQueue.push({ url: f.url, savePath: f.savePath, size: f.size });
      });
      failedDownloads = [];
      processQueue();
      respond({ ok: true, retried: downloadQueue.length });
      return false;

    case 'resetAll':
      downloadQueue = [];
      completedDownloads = [];
      failedDownloads = [];
      visitedUrls.clear();
      discoveredFiles = [];
      discoveredUrls = new Set();
      scanVisitedDirs = new Set();
      pauseRequested = false;
      isDownloading = false;
      respond({ ok: true });
      return false;

    default:
      respond({ ok: false });
      return false;
  }
});

// Optional: on startup, try to resume any interrupted downloads (browser‑managed)
browser.runtime.onStartup.addListener(async () => {
  const s = await loadSettings();
  if (!s.resumeInterrupted) return;
  try {
    const list = await browser.downloads.search({ state: 'interrupted', limit: 100 });
    for (const d of list) {
      if (d.canResume) {
        try { await browser.downloads.resume(d.id); } catch (_) {}
      }
    }
  } catch (_) {}
});
