document.addEventListener('DOMContentLoaded', async () => {
  const s = await browser.runtime.sendMessage({ action: 'getSettings' }) || {};
  document.getElementById('savePath').value = s.savePath || 'tor-downloads/';
  document.getElementById('maxConcurrent').value = Math.min(8, Math.max(1, s.maxConcurrentDownloads || 4));
  document.getElementById('delayStarts').value = s.delayBetweenStarts ?? 200;
  document.getElementById('delayScans').value = s.delayBetweenScans ?? 800;
  document.getElementById('maxRetries').value = s.maxRetries ?? 5;
  document.getElementById('retryBase').value = s.retryDelayBase ?? 1500;
  document.getElementById('resumeInterrupted').checked = s.resumeInterrupted !== false;
  document.getElementById('autoNavigateSubdirs').checked = s.autoNavigateSubdirs !== false;
  document.getElementById('maxDepth').value = Math.min(100, Math.max(1, s.maxRecursionDepth || 20));
  document.getElementById('conflictAction').value = s.conflictAction || 'uniquify';
  document.getElementById('showNotifications').checked = s.showNotifications !== false;
  document.getElementById('parallelChunks').value = String(s.parallelChunks ?? 0);
  document.getElementById('parallelChunksMaxSizeMB').value = Math.min(10240, Math.max(1, s.parallelChunksMaxSizeMB ?? 8192));

  document.getElementById('save').addEventListener('click', async () => {
    const current = await browser.runtime.sendMessage({ action: 'getSettings' }) || {};
    const next = {
      ...current,
      savePath: (document.getElementById('savePath').value || 'tor-downloads/').replace(/\/?$/, '/'),
      maxConcurrentDownloads: parseInt(document.getElementById('maxConcurrent').value, 10) || 4,
      delayBetweenStarts: parseInt(document.getElementById('delayStarts').value, 10) || 0,
      delayBetweenScans: parseInt(document.getElementById('delayScans').value, 10) || 800,
      maxRetries: parseInt(document.getElementById('maxRetries').value, 10) || 5,
      retryDelayBase: parseInt(document.getElementById('retryBase').value, 10) || 1500,
      resumeInterrupted: document.getElementById('resumeInterrupted').checked,
      autoNavigateSubdirs: document.getElementById('autoNavigateSubdirs').checked,
      maxRecursionDepth: parseInt(document.getElementById('maxDepth').value, 10) || 20,
      conflictAction: document.getElementById('conflictAction').value || 'uniquify',
      showNotifications: document.getElementById('showNotifications').checked,
      parallelChunks: parseInt(document.getElementById('parallelChunks').value, 10) || 0,
      parallelChunksMaxSizeMB: Math.min(10240, Math.max(1, parseInt(document.getElementById('parallelChunksMaxSizeMB').value, 10) || 8192))
    };
    await browser.runtime.sendMessage({ action: 'saveSettings', settings: next });
    const btn = document.getElementById('save');
    btn.textContent = 'Saved';
    setTimeout(() => { btn.textContent = 'Save'; window.close(); }, 800);
  });

  document.getElementById('cancel').addEventListener('click', () => window.close());
});
