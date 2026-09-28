/**
 * Browser-only receipt OCR for AS Forms web beta.
 * Lazy-loads Tesseract.js + pdf.js from pinned jsDelivr CDN (no paid APIs;
 * receipt bytes never leave the device for OCR).
 */
(function (global) {
  const TESSERACT_VER = '5.1.1';
  const PDFJS_VER = '3.11.174';
  const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@' + TESSERACT_VER + '/dist/tesseract.min.js';
  const PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/pdf.min.js';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/pdf.worker.min.js';
  const MAX_PDF_PAGES = 2;
  const MIN_PDF_TEXT_CHARS = 40;

  let loadPromise = null;
  let workerPromise = null;
  let activeWorker = null;
  let cancelFlag = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-as-ocr="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.asOcr = src;
      s.onload = () => {
        s.dataset.loaded = '1';
        resolve();
      };
      s.onerror = () => reject(new Error('Failed to load script: ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensureLibs(onProgress) {
    if (global.Tesseract && global.pdfjsLib) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        if (onProgress) onProgress('Loading reader…');
        const jobs = [];
        if (!global.Tesseract) jobs.push(loadScript(TESSERACT_SRC));
        if (!global.pdfjsLib) jobs.push(loadScript(PDFJS_SRC));
        await Promise.all(jobs);
        if (global.pdfjsLib) {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        }
      })().catch((e) => {
        loadPromise = null;
        throw e;
      });
    }
    await loadPromise;
  }

  async function getWorker(onProgress) {
    await ensureLibs(onProgress);
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      if (onProgress) onProgress('Preparing on-device reader (first time may take a moment)…');
      const worker = await global.Tesseract.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@' + TESSERACT_VER + '/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm.js',
        langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0',
        logger: (m) => {
          if (!onProgress || !m) return;
          if (m.status === 'recognizing text' && m.progress != null) {
            onProgress('Reading receipt… ' + Math.round(m.progress * 100) + '%');
          } else if (m.status === 'loading language traineddata') {
            onProgress('Downloading language data (once)…');
          } else if (m.status === 'initializing api' || m.status === 'loading tesseract core') {
            onProgress('Starting on-device reader…');
          }
        },
      });
      activeWorker = worker;
      return worker;
    })().catch((e) => {
      workerPromise = null;
      activeWorker = null;
      throw e;
    });
    return workerPromise;
  }

  function cancel() {
    cancelFlag = true;
    // Best-effort: terminate worker so recognize aborts
    if (activeWorker) {
      try {
        activeWorker.terminate();
      } catch (_) { /* ignore */ }
      activeWorker = null;
      workerPromise = null;
    }
  }

  function resetCancel() {
    cancelFlag = false;
  }

  function throwIfCancelled() {
    if (cancelFlag) {
      const err = new Error('Cancelled');
      err.cancelled = true;
      throw err;
    }
  }

  function isPdf(blob, name) {
    const t = (blob && blob.type) || '';
    const n = name || '';
    return t === 'application/pdf' || /\.pdf$/i.test(n);
  }

  function isImage(blob, name) {
    const t = (blob && blob.type) || '';
    const n = name || '';
    if (t.startsWith('image/')) return true;
    return /\.(jpe?g|png|webp|gif|bmp)$/i.test(n);
  }

  function isHeic(blob, name) {
    const t = (blob && blob.type) || '';
    const n = name || '';
    return /heic|heif/i.test(t) || /\.(heic|heif)$/i.test(n);
  }

  /** Light grayscale + contrast boost via canvas (cheap preprocess). */
  async function preprocessImageBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not open image'));
        el.src = url;
      });
      const maxW = 1600;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const id = ctx.getImageData(0, 0, w, h);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          // mild contrast
          g = (g - 128) * 1.25 + 128;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          d[i] = d[i + 1] = d[i + 2] = g;
        }
        ctx.putImageData(id, 0, 0);
      } catch (_) {
        // tainted / huge — use raw draw
      }
      const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return out || blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function ocrImageSource(source, onProgress) {
    throwIfCancelled();
    const worker = await getWorker(onProgress);
    throwIfCancelled();
    if (onProgress) onProgress('Reading receipt…');
    const result = await worker.recognize(source);
    throwIfCancelled();
    return (result && result.data && result.data.text) || '';
  }

  async function extractPdfTextLayer(pdf) {
    let text = '';
    const n = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= n; i++) {
      throwIfCancelled();
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items || []).map((it) => it.str || '').join(' ');
      text += pageText + '\n';
    }
    return text.trim();
  }

  async function renderPdfPageToCanvas(page, scale) {
    const viewport = page.getViewport({ scale: scale || 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  async function ocrPdf(blob, onProgress) {
    await ensureLibs(onProgress);
    throwIfCancelled();
    if (onProgress) onProgress('Opening PDF…');
    const data = new Uint8Array(await blob.arrayBuffer());
    const pdf = await global.pdfjsLib.getDocument({ data }).promise;
    throwIfCancelled();

    const layerText = await extractPdfTextLayer(pdf);
    if (layerText.replace(/\s/g, '').length >= MIN_PDF_TEXT_CHARS) {
      if (onProgress) onProgress('Found text in PDF…');
      return layerText;
    }

    // Scanned PDF — render first pages and OCR
    let combined = '';
    const n = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= n; i++) {
      throwIfCancelled();
      if (onProgress) onProgress('Reading PDF page ' + i + ' of ' + n + '…');
      const page = await pdf.getPage(i);
      const canvas = await renderPdfPageToCanvas(page, 2);
      const text = await ocrImageSource(canvas, onProgress);
      combined += text + '\n';
    }
    return combined.trim();
  }

  /**
   * @param {Blob|File} blob
   * @param {{ name?: string, onProgress?: function(string):void }} opts
   * @returns {Promise<{ text: string, parsed: object, source: string }>}
   */
  async function readReceipt(blob, opts) {
    opts = opts || {};
    const name = opts.name || (blob && blob.name) || '';
    const onProgress = opts.onProgress || null;
    resetCancel();

    if (!blob) {
      throw new Error('No file');
    }

    if (isHeic(blob, name)) {
      // Most browsers cannot decode HEIC in canvas without a decoder lib.
      const err = new Error(
        'This phone photo format (HEIC) is not readable here. Please re-save or share as JPG/PNG, or attach a PDF.'
      );
      err.code = 'HEIC';
      throw err;
    }

    let text = '';
    let source = 'unknown';

    if (isPdf(blob, name)) {
      source = 'pdf';
      text = await ocrPdf(blob, onProgress);
    } else if (isImage(blob, name) || (blob.type || '').startsWith('image/')) {
      source = 'image';
      if (onProgress) onProgress('Preparing image…');
      let imgBlob = blob;
      try {
        imgBlob = await preprocessImageBlob(blob);
      } catch (_) {
        imgBlob = blob;
      }
      throwIfCancelled();
      text = await ocrImageSource(imgBlob, onProgress);
    } else {
      const err = new Error('Please attach a JPG, PNG, WebP image or a PDF receipt.');
      err.code = 'UNSUPPORTED';
      throw err;
    }

    throwIfCancelled();
    const parse = global.AsReceiptParse;
    const parsed = parse
      ? parse.parseReceiptText(text)
      : { date: null, description: null, total: null, net: null, vat: null, jobNo: null, rawLength: (text || '').length };

    return { text, parsed, source };
  }

  global.AsReceiptOcr = {
    readReceipt,
    cancel,
    ensureLibs,
    isPdf,
    isImage,
    isHeic,
    MAX_PDF_PAGES,
    CDN: { TESSERACT_SRC, PDFJS_SRC, TESSERACT_VER, PDFJS_VER },
  };
})(typeof window !== 'undefined' ? window : globalThis);
