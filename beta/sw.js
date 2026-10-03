/*
 * AS Forms web — service worker (offline app shell + vendored OCR / PDF assets).
 * Bump VERSION on every release: a new sw.js byte-diff makes the browser install it, the page
 * shows "New version available — Reload", and the old shell cache is removed on activate.
 *
 * Root (stable) and /beta/ have separate scopes on the same origin. Cache names carry the
 * scope path so neither ever deletes the other's caches, and the root worker ignores /beta/.
 */
const VERSION = '1.0.1-web';
const SCOPE_URL = new URL(self.registration ? self.registration.scope : './', self.location.href);
const SCOPE_PATH = SCOPE_URL.pathname; // e.g. /as-forms-web/beta/
const PREFIX = 'as-forms:' + SCOPE_PATH + ':';
const SHELL_CACHE = PREFIX + 'shell:' + VERSION;
const VENDOR_CACHE = PREFIX + 'vendor:v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'css/tutorial.css',
  'img/demo-receipt.svg',
  'lib/jszip.min.js',
  'templates/expense-claim.docx',
  'templates/timesheet.odt',
  'templates/as-logo.jpg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'js/email-templates.js',
  'js/expense-category.js',
  'js/offshore-days.js',
  'js/expense-tally.js',
  'js/days-worked-summary.js',
  'js/storage.js',
  'js/docx-filler.js',
  'js/timesheet-layout.js',
  'js/timesheet-filler.js',
  'js/timesheet-reader.js',
  'js/expense-zip-reader.js',
  'js/image-merge.js',
  'js/export.js',
  'js/folder-sync.js',
  'js/receipt-parse.js',
  'js/receipt-ocr.js',
  'js/summary-pdf.js',
  'js/hold-swipe.js',
  'js/zoom-view.js',
  'js/attachments.js',
  'js/timesheet-preview.js',
  'js/pwa.js',
  'js/tutorial.js',
  'js/app.js',
];

// Large, rarely-changing files: cached best-effort (a failure here never blocks the install).
const VENDOR = [
  'vendor/jspdf/jspdf.umd.min.js',
  'vendor/pdfjs/pdf.min.js',
  'vendor/pdfjs/pdf.worker.min.js',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/eng.traineddata.gz',
];

function abs(rel) { return new URL(rel, SCOPE_URL).href; }

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // cache: 'reload' bypasses the HTTP cache so a new version never stores stale files
    await shell.addAll(SHELL.map((u) => new Request(abs(u), { cache: 'reload' })));
    const vendor = await caches.open(VENDOR_CACHE);
    await Promise.all(VENDOR.map(async (u) => {
      try {
        if (await vendor.match(abs(u))) return;
        const res = await fetch(new Request(abs(u), { cache: 'reload' }));
        if (res.ok) await vendor.put(abs(u), res);
      } catch (_) { /* best effort; fetched again on first use */ }
    }));
    // First install takes control straight away; updates wait for the user to tap Reload.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(PREFIX) && k !== SHELL_CACHE && k !== VENDOR_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
});

function inScope(url) {
  if (url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith(SCOPE_PATH)) return false;
  // The stable root app must never serve the beta app's files (and vice versa beta is its own scope).
  if (url.pathname.startsWith(SCOPE_PATH + 'beta/')) return false;
  return true;
}

async function fromOwnCaches(request) {
  const opts = { ignoreSearch: true };
  const shell = await caches.open(SHELL_CACHE);
  const hit = await shell.match(request, opts);
  if (hit) return hit;
  const vendor = await caches.open(VENDOR_CACHE);
  return vendor.match(request, opts);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!inScope(url)) return;

  if (req.mode === 'navigate') {
    // App shell: cached index.html (instant + offline); network only if the cache is missing.
    event.respondWith((async () => {
      const shell = await caches.open(SHELL_CACHE);
      const cached = (await shell.match(abs('index.html'), { ignoreSearch: true })) || (await shell.match(abs('./')));
      if (cached) return cached;
      try { return await fetch(req); } catch (e) {
        return new Response('<h1>Offline</h1><p>Open AS Forms once while online so it can work offline.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await fromOwnCaches(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.ok && url.pathname.startsWith(SCOPE_PATH + 'vendor/')) {
      const copy = res.clone();
      caches.open(VENDOR_CACHE).then((c) => c.put(url.origin + url.pathname, copy)).catch(() => {});
    }
    return res;
  })());
});
