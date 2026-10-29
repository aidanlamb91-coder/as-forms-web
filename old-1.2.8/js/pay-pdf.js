/**
 * 1.2.6-web: PDF → text for payslips and pension statements, locally in the browser with the
 * vendored pdf.js (lib/pdfjs, loaded only when a PDF is imported). Lines are rebuilt from text
 * positions (like Android's PdfBox sortByPosition). The text is never logged or stored.
 */
(function (global) {
  let lib = null;
  async function pdfjs() {
    if (lib) return lib;
    const base = new URL('lib/pdfjs/', document.baseURI).href;
    lib = await import(base + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    return lib;
  }

  /** Group text items into lines by baseline (top to bottom), each sorted left to right. */
  function itemsToText(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 8;
      let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, h * 0.4));
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s.trim()).join(' ')).join('\n');
  }

  /** ArrayBuffer/Uint8Array of a PDF → text (all pages). Throws when it can't be opened. */
  async function text(bytes) {
    const pdf = await pdfjs();
    const doc = await pdf.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, disableFontFace: true }).promise;
    try {
      const out = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        out.push(itemsToText((await page.getTextContent()).items));
      }
      return out.join('\n');
    } finally { doc.destroy(); }
  }

  global.AsPayPdf = { text, itemsToText };
})(typeof window !== 'undefined' ? window : globalThis);
