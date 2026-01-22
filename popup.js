// Tor Mass Recursive Downloader - Popup

let scanned = { links: [], dirs: [] };
let settings = null;

const $ = id => document.getElementById(id);
const status = () => $('status');
const setStatus = (text, cls) => {
  const s = status();
  s.textContent = text;
  s.className = 'status ' + (cls || 'idle');
};

function urlOk() {
  const u = ($('recursiveUrl').value || '').trim();
  return u.length >= 10 && /^https?:\/\//i.test(u);
}

async function load() {
  settings = await browser.runtime.sendMessage({ action: 'getSettings' }) || {};
  $('concurrent').value = Math.min(8, Math.max(1, settings.maxConcurrentDownloads || 4));
  $('concurrentVal').textContent = $('concurrent').value;
  $('autoRetry').checked = settings.retryFailed !== false;
  const f = settings.fileFilters || {};
  $('incExt').value = (f.extensions || []).join(', ');
  $('excExt').value = (f.excludeExtensions || []).join(', ');
  $('minSz').value = f.minSize ? (f.minSize / 1024 / 1024) : 0;
  $('maxSz').value = f.maxSize ? (f.maxSize / 1024 / 1024) : 0;
  $('incPat').value = f.includePattern || '';
  $('excPat').value = f.excludePattern || '';
  $('enableF').checked = !!settings.enableFilters;
}

function applyFiltersToSettings() {
  const ext = ($('incExt').value || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const exc = ($('excExt').value || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  settings = settings || {};
  settings.fileFilters = {
    extensions: ext,
    excludeExtensions: exc,
    minSize: parseFloat($('minSz').value || 0) * 1024 * 1024,
    maxSize: parseFloat($('maxSz').value || 0) * 1024 * 1024,
    includePattern: ($('incPat').value || '').trim() || '',
    excludePattern: ($('excPat').value || '').trim() || ''
  };
  settings.enableFilters = $('enableF').checked;
  settings.maxConcurrentDownloads = parseInt($('concurrent').value, 10) || 4;
  settings.retryFailed = $('autoRetry').checked;
  browser.runtime.sendMessage({ action: 'saveSettings', settings }).catch(() => {});
}

function refreshProgress() {
  browser.runtime.sendMessage({ action: 'getStatus' }).then(r => {
    if (!r) return;
    $('vQueued').textContent = r.queued || 0;
    $('vDone').textContent = r.completed || 0;
    $('vFailed').textContent = r.failed || 0;
    let st = 'Idle';
    if (r.isScanning) st = 'Scanning…';
    else if (r.isDownloading) st = 'Downloading';
    else if (r.isPaused) st = 'Paused';
    $('vState').textContent = st;
    $('btnPause').disabled = !r.isDownloading;
    $('btnResume').disabled = !r.isPaused;
    $('btnRetry').disabled = !(r.failed > 0);
    if ($('btnStartRecursive')) $('btnStartRecursive').disabled = !!r.isScanning || !urlOk();
    if ($('btnStopScan')) $('btnStopScan').disabled = !r.isScanning;
    const sr = $('scanProgressRow');
    if (sr) {
      if (r.isScanning) {
        sr.style.display = 'block';
        $('vScan').textContent = r.scannedCount != null ? r.scannedCount : 0;
      } else {
        sr.style.display = 'none';
      }
    }
    refreshDiscoveredList(r);
  }).catch(() => {});
}

function formatSize(n) {
  if (n == null || n === 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function refreshDiscoveredList(r) {
  const list = $('discoveredList');
  const sum = $('discoveredSummary');
  const btn = $('btnStartDownloads');
  if (!list || !r) return;
  const arr = r.discoveredFiles || [];
  const total = r.discoveredTotal || 0;
  const sel = r.discoveredSelectedCount || 0;
  if (btn) btn.disabled = sel === 0;
  if (sum) {
    if (total === 0) sum.textContent = 'No files. Use Scan page or Recursive scan.';
    else sum.textContent = (total > 500 ? 'Showing 500 of ' + total + '. ' : '') + sel + ' selected.';
  }
  list.innerHTML = '';
  arr.forEach(item => {
    const name = (item.savePath || item.url || '').split(/[/\\]/).filter(Boolean).pop() || '?';
    const row = document.createElement('div');
    row.className = 'file-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!item.selected;
    cb.dataset.url = item.url;
    cb.addEventListener('change', () => {
      browser.runtime.sendMessage({ action: 'setFileSelected', url: item.url, selected: cb.checked }).catch(() => {});
      refreshProgress();
    });
    const lbl = document.createElement('span');
    lbl.className = 'name';
    lbl.title = item.url || name;
    lbl.textContent = name;
    const sz = document.createElement('span');
    sz.className = 'size';
    sz.textContent = formatSize(item.size);
    row.append(cb, lbl, sz);
    list.appendChild(row);
  });
}

function toItem(link, base) {
  let u = link.url || link.href;
  if (!/^https?:\/\//i.test(u)) u = new URL(u, base).href;
  const path = (new URL(u).pathname || '/').replace(/^\//, '');
  const name = path.split('/').filter(Boolean).pop() || 'index.html';
  const savePath = ((settings && settings.savePath) || 'tor-downloads/').replace(/\/$/, '') + '/' + path;
  return { url: u, savePath, size: link.size || 0 };
}

// --- Scan current page ---
$('btnScan').addEventListener('click', async () => {
  setStatus('Scanning…', 'run');
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const res = await browser.tabs.sendMessage(tab.id, { action: 'scanPage', baseUrl: tab.url });
    scanned = { links: res.links || [], dirs: res.dirs || [] };
    const base = (tab && tab.url) ? tab.url.replace(/\/?$/, '/') : '';
    const items = (scanned.links || []).map(l => toItem(l, base));
    if (items.length) await browser.runtime.sendMessage({ action: 'addDiscovered', items });
    setStatus(`Found ${scanned.links.length} files, ${scanned.dirs.length} dirs; ${items.length} added to list`, items.length ? 'done' : 'idle');
  } catch (e) {
    setStatus('Error: ' + (e.message || 'scan failed'), 'err');
  }
  refreshProgress();
});

// --- Use current page (fill URL for recursive) ---
$('btnUsePage').addEventListener('click', async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      $('recursiveUrl').value = tab.url.replace(/\/*$/, '/');
      $('btnStartRecursive').disabled = !urlOk();
      setStatus('URL loaded from current page', 'idle');
    } else {
      setStatus('No valid page URL', 'err');
    }
  } catch (e) {
    setStatus('Error: ' + (e.message || 'no tab'), 'err');
  }
});

// --- Start recursive scan ---
$('btnStartRecursive').addEventListener('click', async () => {
  const url = ($('recursiveUrl').value || '').trim().replace(/\/*$/, '') + '/';
  if (!url || !/^https?:\/\//i.test(url)) {
    setStatus('Enter a valid URL (or use "Use current page")', 'err');
    return;
  }
  applyFiltersToSettings();
  setStatus('Recursive scan started. Scanning directories…', 'run');
  try {
    await browser.runtime.sendMessage({ action: 'startRecursive', url });
    refreshProgress();
  } catch (e) {
    setStatus('Error: ' + (e.message || 'failed'), 'err');
    refreshProgress();
  }
});

$('recursiveUrl').addEventListener('input', () => {
  if ($('btnStartRecursive')) $('btnStartRecursive').disabled = !urlOk();
});

// --- Stop recursive scan ---
$('btnStopScan').addEventListener('click', async () => {
  setStatus('Stopping scan…', 'run');
  try {
    await browser.runtime.sendMessage({ action: 'stopScan' });
    refreshProgress();
  } catch (e) {
    setStatus('Error: ' + (e.message || 'stop failed'), 'err');
    refreshProgress();
  }
});

// --- Discovered list: Select all, Deselect all, Clear list, Start downloads ---
$('btnSelectAll').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ action: 'selectAllDiscovered', selected: true });
  refreshProgress();
});

$('btnDeselectAll').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ action: 'selectAllDiscovered', selected: false });
  refreshProgress();
});

$('btnClearList').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ action: 'clearDiscovered' });
  setStatus('List cleared', 'idle');
  refreshProgress();
});

$('btnStartDownloads').addEventListener('click', async () => {
  applyFiltersToSettings();
  try {
    const r = await browser.runtime.sendMessage({ action: 'startDownloadFromSelected' });
    setStatus('Downloading ' + (r.queued || 0) + ' files…', 'run');
  } catch (e) {
    setStatus('Error: ' + (e.message || 'failed'), 'err');
  }
  refreshProgress();
});

$('btnPause').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ action: 'pause' });
  setStatus('Paused', 'idle');
  refreshProgress();
});

$('btnResume').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ action: 'resume' });
  setStatus('Resuming…', 'run');
  refreshProgress();
});

$('btnRetry').addEventListener('click', async () => {
  const r = await browser.runtime.sendMessage({ action: 'retryFailed' });
  setStatus('Retrying ' + (r.retried || 0) + ' failed', 'run');
  refreshProgress();
});

$('btnClear').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ action: 'clearQueue' });
  setStatus('Queue cleared', 'idle');
  refreshProgress();
});

$('btnReset').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ action: 'resetAll' });
  scanned = { links: [], dirs: [] };
  setStatus('Reset', 'idle');
  refreshProgress();
});

$('btnOpt').addEventListener('click', () => {
  browser.runtime.openOptionsPage && browser.runtime.openOptionsPage();
});

$('concurrent').addEventListener('input', () => {
  $('concurrentVal').textContent = $('concurrent').value;
  applyFiltersToSettings();
});

['incExt','excExt','minSz','maxSz','incPat','excPat','enableF','autoRetry'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('change', applyFiltersToSettings);
  if (el) el.addEventListener('input', applyFiltersToSettings);
});

// Toggle filters: double‑click Options to show/hide
const filters = $('filters');
let filtersShown = false;
const toggleFilters = () => { filtersShown = !filtersShown; filters.classList.toggle('show', filtersShown); };
const opts = $('btnOpt');
if (opts) opts.addEventListener('dblclick', (e) => { e.preventDefault(); toggleFilters(); });

browser.runtime.onMessage.addListener(msg => {
  if (msg.action === 'progress') refreshProgress();
  if (msg.action === 'scanProgress') {
    setStatus('Scanning… ' + (msg.scanned || 0) + ' files so far', 'run');
    const sr = $('scanProgressRow'), v = $('vScan');
    if (sr) { sr.style.display = 'block'; if (v) v.textContent = msg.scanned || 0; }
    refreshProgress();
  }
  if (msg.action === 'scanComplete') {
    const stopped = !!msg.stopped;
    setStatus((stopped ? 'Scan stopped. ' : 'Scan complete. ') + (msg.discovered || 0) + ' files in list. Select and click Start downloads.', stopped ? 'idle' : 'done');
    const sr = $('scanProgressRow'), v = $('vScan');
    if (sr) { sr.style.display = 'block'; if (v) v.textContent = msg.discovered || 0; }
    refreshProgress();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  load().then(() => refreshProgress());
  const t = setInterval(refreshProgress, 500);
  window.addEventListener('unload', () => clearInterval(t));
});
