/**
 * 1.2.1-web PDF side of Other forms (port of Android ObservationPdf.kt, FormPaper.kt and the PDF
 * parts of FormImporter.kt / FormsSearch.kt). All free libraries, loaded only when needed:
 *  - pdf-lib (vendor/pdf-lib, MIT): fills / reads the Observation Card's own boxes,
 *  - jsPDF (vendor/jspdf, MIT): draws the plain A4 "paper copy" used for PDF export of Word forms,
 *  - pdf.js (vendor/pdfjs, Apache): pulls typed text out of a PDF (search and best-effort import).
 */
(function (global) {
  const R = () => global.AsFormRules;
  const PDFLIB_SRC = 'vendor/pdf-lib/pdf-lib.min.js';
  let pdfLibLoad = null;

  function loadPdfLib() {
    if (global.PDFLib) return Promise.resolve(global.PDFLib);
    if (!pdfLibLoad) {
      pdfLibLoad = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PDFLIB_SRC; s.async = true;
        s.onload = () => (global.PDFLib ? resolve(global.PDFLib) : reject(new Error('PDF library did not load')));
        s.onerror = () => { pdfLibLoad = null; reject(new Error('Could not load the PDF library')); };
        document.head.appendChild(s);
      });
    }
    return pdfLibLoad;
  }

  /** Which PDF box gets which text, and which tick boxes are on (pure logic, unit tested). */
  function plan(spec, values) {
    const text = {}; const ticks = new Set();
    for (const [key, pdfName] of Object.entries(spec.pdfFields || {})) {
      if (R().field(spec, key)) { text[pdfName] = values[key] || ''; continue; }
      const i = key.lastIndexOf('.');
      if (values[key.slice(0, i)] === key.slice(i + 1)) ticks.add(pdfName);
    }
    return { text, ticks };
  }

  /** Fills the Observation Card's own boxes. Returns the new PDF bytes. */
  async function fillObservation(pdf, spec, values) {
    const L = await loadPdfLib();
    const doc = await L.PDFDocument.load(pdf);
    const form = doc.getForm();
    const { text, ticks } = plan(spec, values || {});
    for (const [name, v] of Object.entries(text)) {
      try { form.getTextField(name).setText(v); } catch (_) { /* box not in this revision */ }
    }
    for (const name of Object.values(spec.pdfFields || {})) {
      let box = null;
      try { box = form.getCheckBox(name); } catch (_) { box = null; }
      if (!box) continue;
      if (ticks.has(name)) box.check(); else box.uncheck();
    }
    return doc.save();
  }

  /** Reads a filled Observation Card back (null when it has none of the expected boxes). */
  async function readObservation(pdf, spec) {
    const L = await loadPdfLib();
    const doc = await L.PDFDocument.load(pdf, { ignoreEncryption: true });
    const form = doc.getForm();
    const names = new Set(form.getFields().map((f) => f.getName()));
    if (!Object.values(spec.pdfFields || {}).some((n) => names.has(n))) return null;
    const out = {};
    for (const [key, name] of Object.entries(spec.pdfFields)) {
      if (!names.has(name)) continue;
      const f = form.getField(name);
      if (f instanceof L.PDFCheckBox) { if (f.isChecked()) { const i = key.lastIndexOf('.'); out[key.slice(0, i)] = key.slice(i + 1); } }
      else if (R().field(spec, key) && f.getText) { const v = (f.getText() || '').trim(); if (v) out[key] = v; }
    }
    return { values: out, unsure: new Set() };
  }

  /** Typed text of a PDF, one line per text row (pdf.js). */
  async function pdfText(bytes) {
    const lib = await global.AsAttachments.loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let line = ''; let lastY = null;
      for (const it of tc.items) {
        const y = it.transform ? Math.round(it.transform[5]) : lastY;
        if (lastY != null && y !== lastY && line) { lines.push(line); line = ''; }
        line += it.str;
        if (it.hasEOL) { lines.push(line); line = ''; }
        lastY = y;
      }
      if (line) lines.push(line);
    }
    return lines.join('\n');
  }

  /** Import a PDF: the Observation Card's own boxes, else "Label: answer" lines. Throws "Couldn't import". */
  async function importPdf(spec, bytes) {
    try {
      const own = R().isPdf(spec) ? await readObservation(bytes, spec) : null;
      const found = own || global.AsFormDocx.byLabels(spec, await pdfText(bytes));
      return global.AsFormDocx.result(spec, found);
    } catch (e) {
      const err = new Error("Couldn't import"); err.cause = e; throw err;
    }
  }

  // ——— Paper copy (PDF export of Word forms; same layout as Android FormPaper) ———
  const W = 595, H = 842, M = 40;

  /** Draws every page with jsPDF. JsPDF = constructor (passed in by the node tests). */
  function paper(JsPDF, spec, values, sigPng) {
    const doc = new JsPDF({ unit: 'pt', format: 'a4' });
    let y = M;
    const need = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };
    const wrap = (t, w, size) => { doc.setFontSize(size); return doc.splitTextToSize(String(t || ''), w); };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(spec.title, M, y + 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80);
    const nr = spec.number + ' ' + spec.rev; doc.text(nr, W - M - doc.getTextWidth(nr), y + 12);
    y += 26;
    let sigInfo = null;
    if (sigPng) { const [sw, sh] = global.AsFormDocx.pngSize(sigPng); sigInfo = { sw, sh, data: sigPng }; }
    for (const s of spec.sections) {
      need(40);
      doc.setFillColor(27, 94, 66); doc.rect(M, y, W - 2 * M, 16, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text(s.title, M + 6, y + 12);
      y += 20;
      doc.setFont('helvetica', 'normal'); doc.setTextColor(80);
      if (s.note) { for (const l of wrap(s.note, W - 2 * M - 8, 8.5)) { need(12); doc.text(l, M + 4, y + 9); y += 11; } y += 4; }
      let col = 0, rowH = 0;
      for (const f of s.fields || []) {
        const full = !f.half || f.type === 'longtext' || f.type === 'signature' || (f.type === 'radio' && f.mark !== 'check');
        if (full && col === 1) { y += rowH; col = 0; rowH = 0; }
        const w = full ? W - 2 * M : (W - 2 * M - 8) / 2;
        const x = M + (col === 1 ? w + 8 : 0);
        const lines = f.type === 'longtext' ? wrap(values[f.key] || '', w - 8, 10) : null;
        const h = f.type === 'longtext' ? 16 + 12 * Math.max(2, lines.length) : f.type === 'signature' ? 48 : 26;
        if (col === 0) need(h);
        doc.setDrawColor(170); doc.setLineWidth(0.6); doc.rect(x, y, w, h - 3);
        doc.setFontSize(9); doc.setTextColor(60); doc.text(String(f.label).slice(0, 70), x + 4, y + 9);
        doc.setFontSize(10); doc.setTextColor(20, 20, 110);
        if (f.type === 'signature') {
          if (sigInfo) {
            const bh = h - 16; const bw = Math.min(bh * sigInfo.sw / sigInfo.sh, w - 8);
            try { doc.addImage(sigInfo.data, 'PNG', x + 4, y + 12, bw, bw * sigInfo.sh / sigInfo.sw); } catch (_) { /* bad picture: leave blank */ }
          }
        } else if (f.type === 'radio') {
          const chosen = values[f.key];
          if (f.mark === 'check') {
            const o = (f.options || []).find((o2) => o2.key === chosen);
            doc.text(o ? o.label : '', x + w - 40, y + 20);
          } else {
            let ox = x + 4;
            for (const o of f.options || []) {
              doc.rect(ox, y + 13, 8, 8);
              if (o.key === chosen) { doc.line(ox, y + 13, ox + 8, y + 21); doc.line(ox + 8, y + 13, ox, y + 21); }
              doc.text(o.label, ox + 11, y + 20.5);
              ox += 11 + doc.getTextWidth(o.label) + 12;
            }
          }
        } else if (lines) {
          lines.forEach((l, i) => doc.text(l, x + 4, y + 22 + 12 * i));
        } else {
          let v = R().tidy(f.validate, values[f.key] || '');
          while (v && doc.getTextWidth(v) > w - 8) v = v.slice(0, -2) + '…';
          doc.text(v, x + 4, y + 21);
        }
        if (full) { y += h; col = 0; rowH = 0; } else if (col === 0) { col = 1; rowH = h; } else { y += Math.max(rowH, h); col = 0; rowH = 0; }
      }
      if (col === 1) y += rowH;
      y += 6;
    }
    return new Uint8Array(doc.output('arraybuffer'));
  }

  async function paperPdf(spec, values, sigPng) {
    const JsPDF = await global.AsSummaryPdf.loadJsPdf();
    return paper(JsPDF, spec, values, sigPng);
  }

  global.AsFormPdf = { loadPdfLib, plan, fillObservation, readObservation, pdfText, importPdf, paper, paperPdf };
})(typeof window !== 'undefined' ? window : globalThis);
