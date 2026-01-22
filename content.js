// Tor Mass Recursive Downloader - Content script
// Extracts links and dirs from directory listings and normal pages

(function() {
  'use strict';

  function parseSize(text) {
    if (!text || typeof text !== 'string') return 0;
    const t = text.trim().replace(/,/g, '');
    const m = t.match(/^([\d.]+)\s*([KMGTP]?B?)$/i);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    const u = (m[2] || 'B').toUpperCase();
    if (u.startsWith('K')) n *= 1024;
    else if (u.startsWith('M')) n *= 1024 * 1024;
    else if (u.startsWith('G')) n *= 1024 * 1024 * 1024;
    else if (u.startsWith('T')) n *= 1024 * 1024 * 1024 * 1024;
    return Math.round(n);
  }

  function getParentHref(el) {
    let n = el;
    while (n) {
      const a = n.tagName === 'A' ? n : n.querySelector('a[href]');
      if (a && a.href) return a.getAttribute('href') || a.href;
      n = n.parentElement;
    }
    return null;
  }

  function extractFromTable(baseUrl) {
    const links = [];
    const dirs = [];
    const base = (baseUrl || window.location.href).replace(/\/?$/, '/');
    const seen = new Set();

    // Apache-style: <a href="name"> and size/date in same row
    document.querySelectorAll('table tr, pre a, .listing a, a[href]').forEach(row => {
      const a = row.tagName === 'A' ? row : row.querySelector('a[href]');
      if (!a || !a.href) return;
      let href = (a.getAttribute('href') || a.href || '').trim();
      if (!href || href === '#' || /^javascript:/i.test(href) || href === '../' || href === '..' || href === './') return;
      if (!/^https?:\/\//i.test(href)) href = new URL(href, base).href;
      if (seen.has(href)) return;
      seen.add(href);

      const rowEl = row.tagName === 'TR' ? row : a.closest('tr');
      let size = 0;
      let isDir = href.endsWith('/') || /\/$/.test(a.textContent || '');
      if (rowEl) {
        const cells = rowEl.querySelectorAll('td');
        for (const c of cells) {
          const txt = (c.textContent || '').trim();
          if (/^[\d.,]+\s*[KMGTP]?B?$/i.test(txt) && !/^\d{4}-\d{2}-\d{2}/.test(txt)) {
            size = parseSize(txt);
            break;
          }
        }
        const rowText = (rowEl.textContent || '').toUpperCase();
        if (rowText.includes('[DIR]') || rowText.includes('<DIR>') || /\/\s*$/.test(a.textContent || '')) isDir = true;
      }
      if (!size && !/\.\w{2,5}$/.test(href) && (href.endsWith('/') || !(a.textContent || '').match(/\.\w{2,5}$/))) isDir = true;

      const o = { url: href, text: (a.textContent || '').trim(), size, isDirectory: !!isDir };
      if (isDir) dirs.push(o); else links.push(o);
    });

    return { links, dirs };
  }

  function extractGeneric(baseUrl) {
    const links = [];
    const dirs = [];
    const base = (baseUrl || window.location.href).replace(/\/?$/, '/');
    const seen = new Set();

    document.querySelectorAll('a[href]').forEach(a => {
      let href = (a.getAttribute('href') || a.href || '').trim();
      if (!href || href === '#' || /^javascript:/i.test(href) || href === '?' || href === './' || href === '../') return;
      if (!/^https?:\/\//i.test(href)) href = new URL(href, base).href;
      if (seen.has(href)) return;
      seen.add(href);

      const isDir = href.endsWith('/') || (/(^|\/)[^/.]*$/.test(href) && !(a.textContent || '').match(/\.\w{2,5}(\s|$)/));
      const o = { url: href, text: (a.textContent || '').trim(), size: 0, isDirectory: isDir };
      if (isDir) dirs.push(o); else links.push(o);
    });

    return { links, dirs };
  }

  function run(baseUrl) {
    const u = baseUrl || window.location.href;
    const table = extractFromTable(u);
    const generic = extractGeneric(u);
    // Prefer table if it found more file-like links
    const tableFiles = table.links.length;
    const genericFiles = generic.links.length;
    if (tableFiles >= genericFiles && (tableFiles > 0 || table.dirs.length > 0)) {
      return { links: table.links, dirs: table.dirs };
    }
    return { links: generic.links, dirs: generic.dirs };
  }

  browser.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req.action === 'scanPage') {
      try {
        const { links, dirs } = run(req.baseUrl || window.location.href);
        sendResponse({ links, dirs, currentUrl: window.location.href });
      } catch (e) {
        sendResponse({ links: [], dirs: [], error: (e && e.message) || 'scan error' });
      }
    }
  });
})();
