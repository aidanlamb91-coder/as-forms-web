/**
 * "Print summary" PDF — port of Android export/DaysWorkedSummaryPdf.kt (same A4 layout),
 * drawn with the vendored jsPDF (vendor/jspdf, MIT) entirely on the device.
 *
 * Layout (points): title, name, generated date, totals band, then one block per trip —
 * heading "Trip N: 12 Jun – 3 Jul (22 days)" + table (Job no · Description · Start · End · Days).
 * Long descriptions wrap to two lines. Blocks continue onto new pages with the header repeated;
 * every page gets a "Page x of y" footer.
 */
(function (global) {
  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 40;
  const CONTENT_W = PAGE_W - 2 * MARGIN;
  const FOOTER_H = 28;
  const COLS = [70, 245, 75, 75, 50];
  const HEADERS = ['Job no', 'Description', 'Start', 'End', 'Days'];
  const ROW_PAD = 5;
  const LINE_H = 13;
  const BAND = [0xF2, 0xF2, 0xF2];
  const HEADER_FILL = [0xE8, 0xE8, 0xE8];
  const RULE = [0xCC, 0xCC, 0xCC];
  const FONTS = {
    TITLE: { size: 17, bold: true },
    BODY: { size: 10, bold: false },
    BOLD: { size: 11, bold: true },
    MUTED: { size: 9, bold: false, muted: true },
    TRIP: { size: 12, bold: true },
    HEADER: { size: 9.5, bold: true },
    FOOTER: { size: 9, bold: false, muted: true },
  };
  const JSPDF_SRC = 'vendor/jspdf/jspdf.umd.min.js';

  let loadPromise = null;

  /** Lazy-load jsPDF (browser). Returns the jsPDF constructor. */
  function loadJsPdf() {
    if (global.jspdf && global.jspdf.jsPDF) return Promise.resolve(global.jspdf.jsPDF);
    if (!loadPromise) {
      loadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = JSPDF_SRC;
        s.async = true;
        s.onload = () => {
          if (global.jspdf && global.jspdf.jsPDF) resolve(global.jspdf.jsPDF);
          else reject(new Error('PDF library did not load'));
        };
        s.onerror = () => {
          loadPromise = null;
          reject(new Error('Could not load the PDF library (are you offline on a first visit?)'));
        };
        document.head.appendChild(s);
      });
    }
    return loadPromise;
  }

  function applyFont(doc, font) {
    doc.setFont('helvetica', font.bold ? 'bold' : 'normal');
    doc.setFontSize(font.size);
    if (font.muted) doc.setTextColor(0x44, 0x44, 0x44);
    else doc.setTextColor(0, 0, 0);
  }

  function measurerFor(doc) {
    return {
      measure(text, font) {
        applyFont(doc, font);
        return doc.getTextWidth(String(text));
      },
    };
  }

  function painterFor(doc) {
    const m = measurerFor(doc);
    return {
      measure: m.measure,
      text(text, x, baseline, font, alignRight) {
        applyFont(doc, font);
        doc.text(String(text), x, baseline, alignRight ? { align: 'right' } : undefined);
      },
      fillRect(left, top, right, bottom, rgb) {
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.rect(left, top, right - left, bottom - top, 'F');
      },
      hLine(x1, x2, y, rgb, width) {
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(width);
        doc.line(x1, y, x2, y);
      },
    };
  }

  function ellipsize(s, width, m, font) {
    if (m.measure(s, font) <= width) return s;
    let end = s.length;
    while (end > 0 && m.measure(s.substring(0, end) + '…', font) > width) end--;
    return s.substring(0, end).replace(/\s+$/, '') + '…';
  }

  /** Greedy word wrap; when more than maxLines are needed the last one is ellipsized. */
  function wrap(text, width, m, font, maxLines) {
    const t = String(text || '').trim();
    if (!t) return [''];
    const pieces = [];
    for (const w of t.split(/\s+/)) {
      let rest = w;
      while (rest.length > 1 && m.measure(rest, font) > width) {
        let n = rest.length - 1;
        while (n > 1 && m.measure(rest.substring(0, n), font) > width) n--;
        pieces.push(rest.substring(0, n));
        rest = rest.substring(n);
      }
      if (rest) pieces.push(rest);
    }
    const lines = [];
    let cur = '';
    for (const w of pieces) {
      const candidate = cur ? cur + ' ' + w : w;
      if (!cur || m.measure(candidate, font) <= width) cur = candidate;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    kept[kept.length - 1] = ellipsize(kept[kept.length - 1] + '…', width, m, font);
    return kept;
  }

  /**
   * Lays out the summary. newPage(pageIndex) returns the painter for that page (null = count only).
   * Returns the page count.
   */
  function paginate(summary, name, generatedOn, measurer, totalPages, newPage) {
    const S = global.AsDaysWorkedSummary;
    let pageIndex = 0;
    let painter = null;
    let y = MARGIN;
    const bottom = PAGE_H - MARGIN - FOOTER_H;

    function startPage() {
      painter = newPage ? newPage(pageIndex) : null;
      y = MARGIN;
      if (totalPages != null && painter) {
        painter.text('Page ' + (pageIndex + 1) + ' of ' + totalPages, PAGE_W - MARGIN, PAGE_H - MARGIN + 6, FONTS.FOOTER, true);
      }
    }
    function nextPage() {
      pageIndex++;
      startPage();
    }
    function text(s, x, baseline, font, right) {
      if (painter) painter.text(s, x, baseline, font, !!right);
    }

    startPage();
    y += 20;
    text(S.title(summary.period), MARGIN, y, FONTS.TITLE);
    y += 22;
    text('Name: ' + (name || ''), MARGIN, y, FONTS.BODY);
    y += 16;
    text('Generated ' + S.formatStamp(generatedOn) + ' · AS Forms', MARGIN, y, FONTS.MUTED);
    y += 22;
    if (painter) painter.fillRect(MARGIN, y - 14, MARGIN + CONTENT_W, y + 8, BAND);
    text(S.totalsLine(summary), MARGIN + 8, y + 1, FONTS.BOLD);
    y += 30;

    if (summary.isEmpty) {
      text('No offshore days on completed timesheets in this tally year.', MARGIN, y, FONTS.BODY);
      return pageIndex + 1;
    }

    const headerH = LINE_H + 2 * ROW_PAD;
    function drawTableHeader() {
      if (painter) painter.fillRect(MARGIN, y, MARGIN + CONTENT_W, y + headerH, HEADER_FILL);
      let x = MARGIN;
      for (let i = 0; i < COLS.length; i++) {
        const right = i === COLS.length - 1;
        const tx = right ? x + COLS[i] - ROW_PAD : x + ROW_PAD;
        text(HEADERS[i], tx, y + ROW_PAD + LINE_H - 3, FONTS.HEADER, right);
        x += COLS[i];
      }
      y += headerH;
    }
    function descLines(row) {
      return wrap(row ? row.description : '', COLS[1] - 2 * ROW_PAD, measurer, FONTS.BODY, 2);
    }
    function rowHeight(row) {
      return Math.max(1, descLines(row).length) * LINE_H + 2 * ROW_PAD;
    }

    for (const trip of summary.trips) {
      if (y + 22 + headerH + rowHeight(trip.rows[0]) > bottom) nextPage();
      y += 14;
      text(S.tripHeading(trip), MARGIN, y, FONTS.TRIP);
      y += 8;
      drawTableHeader();
      for (const row of trip.rows) {
        const rh = rowHeight(row);
        if (y + rh > bottom) {
          nextPage();
          y += 14;
          text('Trip ' + trip.number + ' (continued)', MARGIN, y, FONTS.TRIP);
          y += 8;
          drawTableHeader();
        }
        const cells = [row.jobNumber, '', S.formatRowDate(row.start), S.formatRowDate(row.end), String(row.days)];
        let x = MARGIN;
        const base = y + ROW_PAD + LINE_H - 3;
        for (let i = 0; i < COLS.length; i++) {
          if (i === 1) {
            descLines(row).forEach((line, li) => text(line, x + ROW_PAD, base + li * LINE_H, FONTS.BODY));
          } else if (i === COLS.length - 1) {
            text(cells[i], x + COLS[i] - ROW_PAD, base, FONTS.BODY, true);
          } else {
            text(ellipsize(cells[i], COLS[i] - 2 * ROW_PAD, measurer, FONTS.BODY), x + ROW_PAD, base, FONTS.BODY);
          }
          x += COLS[i];
        }
        y += rh;
        if (painter) painter.hLine(MARGIN, MARGIN + CONTENT_W, y, RULE, 0.6);
      }
      y += 10;
    }
    return pageIndex + 1;
  }

  /**
   * Build the PDF. Returns { doc, pages, fileName }.
   * @param {Function} JsPDF  jsPDF constructor (pass in for node tests; browser: await loadJsPdf()).
   */
  function buildDoc(JsPDF, summary, name, generatedOn) {
    const S = global.AsDaysWorkedSummary;
    const when = generatedOn || new Date();
    const doc = new JsPDF({ unit: 'pt', format: [PAGE_W, PAGE_H], orientation: 'portrait', compress: true });
    doc.setProperties({ title: S.title(summary.period), author: name || '', creator: 'AS Forms' });
    const measurer = measurerFor(doc);
    const total = paginate(summary, name, when, measurer, null, null);
    const painter = painterFor(doc);
    paginate(summary, name, when, measurer, total, (idx) => {
      if (idx > 0) doc.addPage([PAGE_W, PAGE_H], 'portrait');
      return painter;
    });
    return { doc, pages: total, fileName: S.fileName(summary.period) };
  }

  /** Browser convenience: returns { blob, pages, fileName }. */
  async function buildBlob(summary, name, generatedOn) {
    const JsPDF = await loadJsPdf();
    const r = buildDoc(JsPDF, summary, name, generatedOn);
    return { blob: r.doc.output('blob'), pages: r.pages, fileName: r.fileName };
  }

  global.AsSummaryPdf = {
    PAGE_W,
    PAGE_H,
    loadJsPdf,
    paginate,
    buildDoc,
    buildBlob,
    wrap,
    ellipsize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
