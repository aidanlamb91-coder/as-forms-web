/**
 * Receipt / bank statement previews (port of Android 1.0.0 AttachmentViewer / AttachmentImages /
 * util/AttachmentKinds): small thumbnails on expense lines, a full-screen viewer with pinch /
 * double-tap zoom, and Open / Download / Share. Photos are downscaled once and cached; PDFs show
 * page 1 via the vendored pdf.js (first 10 pages in the viewer). A file that is no longer in this
 * browser shows a red "Missing" thumbnail and a friendly message.
 */
(function (global) {
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
  const HEIC_EXT = ['heic', 'heif'];
  const THUMB_PX = 160;
  const VIEWER_PDF_PAGES = 10;
  const thumbCache = new Map(); // receipt id → Promise<{kind, url}>

  function extOf(name) {
    const n = String(name || '');
    const base = n.slice(n.lastIndexOf('/') + 1);
    const i = base.lastIndexOf('.');
    return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
  }

  /** 'IMAGE' | 'PDF' | 'HEIC' | 'OTHER' */
  function kindOf(mime, name) {
    const m = String(mime || '').toLowerCase().trim();
    const ext = extOf(name);
    if (m === 'application/pdf' || ext === 'pdf') return 'PDF';
    if (m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence' || HEIC_EXT.includes(ext)) return 'HEIC';
    if (m.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'IMAGE';
    return 'OTHER';
  }

  function mimeFor(mime, name) {
    const m = String(mime || '').trim();
    if (m && m !== 'application/octet-stream' && m.includes('/')) return m;
    const map = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif' };
    return map[extOf(name)] || 'application/octet-stream';
  }

  // ——— pdf.js (vendored; shared with OCR) ———
  let pdfLoad = null;
  function loadPdfJs() {
    if (global.pdfjsLib) {
      if (!global.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;
      }
      return Promise.resolve(global.pdfjsLib);
    }
    if (!pdfLoad) {
      pdfLoad = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/pdfjs/pdf.min.js';
        s.async = true;
        s.onload = () => {
          if (!global.pdfjsLib) return reject(new Error('pdf.js missing'));
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;
          resolve(global.pdfjsLib);
        };
        s.onerror = () => { pdfLoad = null; reject(new Error('Could not load PDF viewer')); };
        document.head.appendChild(s);
      });
    }
    return pdfLoad;
  }

  async function openPdf(blob) {
    const lib = await loadPdfJs();
    const data = new Uint8Array(await blob.arrayBuffer());
    return lib.getDocument({ data }).promise;
  }

  async function renderPdfPage(pdf, pageNo, targetWidth) {
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const vpt = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vpt.width));
    canvas.height = Math.max(1, Math.round(vpt.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vpt }).promise;
    return canvas;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image could not be decoded'));
      img.src = url;
    });
  }

  async function imageThumb(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url); // browsers honour EXIF orientation for <img>
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const k = Math.min(1, THUMB_PX / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.8);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Thumbnail for a stored attachment row ({id, blob, name, type}). Resolves to
   * { kind, url|null } — url null means "show a file icon".
   */
  function thumbFor(row) {
    if (!row || !row.blob) return Promise.resolve({ kind: 'MISSING', url: null });
    const key = row.id || null;
    if (key && thumbCache.has(key)) return thumbCache.get(key);
    const kind = kindOf(row.type, row.name);
    const p = (async () => {
      try {
        if (kind === 'IMAGE' || kind === 'HEIC') return { kind, url: await imageThumb(row.blob) };
        if (kind === 'PDF') {
          const pdf = await openPdf(row.blob);
          const canvas = await renderPdfPage(pdf, 1, THUMB_PX);
          const url = canvas.toDataURL('image/jpeg', 0.8);
          try { pdf.destroy(); } catch (_) { /* ignore */ }
          return { kind, url };
        }
      } catch (e) {
        console.warn('thumbnail', e);
      }
      return { kind, url: null };
    })();
    if (key) thumbCache.set(key, p);
    return p;
  }

  function forget(id) { thumbCache.delete(id); }

  const ICONS = {
    PDF: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM7.5 14v4h1.2v-1.3h.7a1.35 1.35 0 1 0 0-2.7H7.5zm1.2 1h.7a.35.35 0 1 1 0 .7h-.7V15zm2.6-1v4h1.4a2 2 0 0 0 0-4h-1.4zm1.2 1h.2a1 1 0 0 1 0 2h-.2v-2zm2.8-1v4h1.2v-1.5h1.3v-1h-1.3V15h1.5v-1h-2.7z"/></svg>',
    FILE: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5z"/></svg>',
    MISSING: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 5v7h2V7h-2zm0 9v2h2v-2h-2z"/></svg>',
  };

  /**
   * Build a thumbnail button element and fill it asynchronously.
   * @param {object} o  { getRow: () => Promise<row|null>, label: 'Receipt'|'Statement', onOpen(row) }
   */
  function thumbButton(o) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'att-thumb loading';
    btn.setAttribute('aria-label', o.label + ' preview');
    btn.innerHTML = '<span class="att-thumb-label">' + o.label + '</span>';
    let rowRef = null;
    (async () => {
      let row = null;
      try { row = await o.getRow(); } catch (_) { row = null; }
      rowRef = row;
      btn.classList.remove('loading');
      if (!row || !row.blob) {
        btn.classList.add('missing');
        btn.setAttribute('aria-label', o.label + ' missing');
        btn.insertAdjacentHTML('afterbegin', '<span class="att-icon">' + ICONS.MISSING + '</span>');
        btn.querySelector('.att-thumb-label').textContent = 'Missing';
        return;
      }
      const t = await thumbFor(row);
      if (t.url) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = t.url;
        btn.insertBefore(img, btn.firstChild);
      } else {
        btn.insertAdjacentHTML('afterbegin', '<span class="att-icon">' + (t.kind === 'PDF' ? ICONS.PDF : ICONS.FILE) + '</span>');
      }
      if (t.kind === 'PDF') btn.classList.add('is-pdf');
    })();
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (o.onOpen) o.onOpen(rowRef);
    });
    return btn;
  }

  function canShareFile(file) {
    try { return !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch (_) { return false; }
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Open a blob in a new browser tab (PDF / image viewers; on iPhone the tab has its own Share button). */
  function openBlobInTab(blob, type) {
    const typed = type && blob.type !== type ? new Blob([blob], { type }) : blob;
    const url = URL.createObjectURL(typed);
    const w = global.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return !!w;
  }

  function showMissing(label) {
    const root = document.getElementById('modal-root');
    root.className = 'modal-backdrop';
    root.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h2>' + label + ' missing</h2>' +
      '<p>This ' + label.toLowerCase() + ' is no longer in this browser (it may have been cleared, or a backup was restored without it). Open the line and attach it again.</p>' +
      '<div class="actions"><button type="button" class="btn primary" data-close>OK</button></div></div>';
    const close = () => { root.className = 'hidden'; root.innerHTML = ''; };
    root.querySelector('[data-close]').onclick = close;
    root.onclick = (e) => { if (e.target === root) close(); };
  }

  let viewerState = null;

  function closeViewer() {
    if (!viewerState) return;
    const v = viewerState;
    viewerState = null;
    if (v.zoom) v.zoom.destroy();
    v.urls.forEach((u) => URL.revokeObjectURL(u));
    v.el.remove();
    document.documentElement.classList.remove('viewer-open');
    document.removeEventListener('keydown', v.onKey);
  }

  /**
   * Full-screen viewer.
   * @param {{blob:Blob, name:string, type:string}} row
   * @param {string} title  e.g. "Receipt — line 2"
   */
  async function openViewer(row, title, label) {
    label = label || 'Receipt';
    if (!row || !row.blob) { showMissing(label); return; }
    closeViewer();
    const kind = kindOf(row.type, row.name);
    const mime = mimeFor(row.type, row.name);
    const name = row.name || (label.toLowerCase() + (kind === 'PDF' ? '.pdf' : '.jpg'));
    const el = document.createElement('div');
    el.className = 'viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title || label);
    el.innerHTML =
      '<div class="viewer-top">' +
      '<button type="button" class="viewer-btn" data-act="close" aria-label="Close">✕</button>' +
      '<div class="viewer-title"></div>' +
      '<button type="button" class="viewer-btn" data-act="zoomout" aria-label="Zoom out">−</button>' +
      '<button type="button" class="viewer-btn" data-act="zoomin" aria-label="Zoom in">+</button>' +
      '</div>' +
      '<div class="viewer-stage"><div class="viewer-content"></div></div>' +
      '<p class="viewer-note hidden"></p>' +
      '<div class="viewer-actions">' +
      '<button type="button" class="btn secondary" data-act="open">Open</button>' +
      '<button type="button" class="btn secondary" data-act="download">Download</button>' +
      '<button type="button" class="btn secondary hidden" data-act="share">Share…</button>' +
      '</div>';
    el.querySelector('.viewer-title').textContent = title || label;
    document.body.appendChild(el);
    document.documentElement.classList.add('viewer-open');
    const stage = el.querySelector('.viewer-stage');
    const content = el.querySelector('.viewer-content');
    const note = el.querySelector('.viewer-note');
    const state = { el, urls: [], zoom: null, onKey: null };
    viewerState = state;
    state.onKey = (e) => { if (e.key === 'Escape') closeViewer(); };
    document.addEventListener('keydown', state.onKey);

    let file = null;
    try { file = new File([row.blob], name, { type: mime }); } catch (_) { file = null; }
    if (canShareFile(file)) el.querySelector('[data-act="share"]').classList.remove('hidden');

    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.getAttribute('data-act');
      if (act === 'close') closeViewer();
      else if (act === 'zoomin' && state.zoom) state.zoom.zoomBy(1.5);
      else if (act === 'zoomout' && state.zoom) state.zoom.zoomBy(1 / 1.5);
      else if (act === 'open') {
        if (!openBlobInTab(row.blob, mime)) downloadBlob(row.blob, name);
      } else if (act === 'download') downloadBlob(row.blob, name);
      else if (act === 'share' && file) {
        try { await navigator.share({ files: [file], title: name }); } catch (_) { /* cancelled */ }
      }
    });

    try {
      if (kind === 'PDF') {
        content.classList.add('pdf-pages');
        content.innerHTML = '<p class="viewer-loading">Loading PDF…</p>';
        const pdf = await openPdf(row.blob);
        if (viewerState !== state) return;
        content.innerHTML = '';
        const n = Math.min(pdf.numPages, VIEWER_PDF_PAGES);
        const width = Math.min(1400, Math.max(800, Math.round((stage.clientWidth || 400) * (global.devicePixelRatio || 1) * 1.5)));
        for (let i = 1; i <= n; i++) {
          const canvas = await renderPdfPage(pdf, i, width);
          if (viewerState !== state) return;
          canvas.className = 'pdf-page';
          canvas.style.width = '800px';
          canvas.style.height = Math.round(800 * canvas.height / canvas.width) + 'px';
          content.appendChild(canvas);
          if (i === 1) state.zoom = global.AsZoomView.attach(stage, content, { fit: 'width', maxScale: 6 });
        }
        if (pdf.numPages > VIEWER_PDF_PAGES) {
          note.textContent = 'Showing the first ' + VIEWER_PDF_PAGES + ' of ' + pdf.numPages + ' pages — use Open for the rest.';
          note.classList.remove('hidden');
        }
        if (state.zoom) state.zoom.refresh();
      } else if (kind === 'IMAGE' || kind === 'HEIC') {
        const url = URL.createObjectURL(row.blob);
        state.urls.push(url);
        const img = await loadImage(url);
        if (viewerState !== state) return;
        img.className = 'viewer-img';
        img.alt = title || label;
        img.draggable = false;
        content.appendChild(img);
        state.zoom = global.AsZoomView.attach(stage, content, { fit: 'contain', maxScale: 8 });
      } else {
        throw new Error('no preview');
      }
    } catch (e) {
      console.warn('viewer', e);
      if (viewerState !== state) return;
      content.innerHTML = '';
      note.textContent = kind === 'HEIC'
        ? 'This browser cannot show HEIC photos. Use Open or Download to view it.'
        : 'No preview for this file type. Use Open or Download to view it.';
      note.classList.remove('hidden');
    }
  }

  global.AsAttachments = {
    kindOf,
    mimeFor,
    thumbFor,
    thumbButton,
    forget,
    openViewer,
    closeViewer,
    showMissing,
    downloadBlob,
    openBlobInTab,
    canShareFile,
    loadPdfJs,
    isViewerOpen: () => !!viewerState,
  };
})(window);
