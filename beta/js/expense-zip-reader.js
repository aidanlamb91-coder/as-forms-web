/**
 * Parse exported expense claim zips — port of Android ExpenseZipReader.
 * Flat zip: ExpenseClaim_YYYY-MM-DD.docx + numbered receipts (1.jpg, 2.pdf, …).
 * No claim.json required.
 */
(function (global) {
  const MAX_LINES = () => (global.AsDocxFiller && AsDocxFiller.MAX_LINES) || 24;

  const MONTHS = (function () {
    const map = {};
    const short = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const full = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (let i = 0; i < 12; i++) {
      map[short[i]] = i + 1;
      map[full[i]] = i + 1;
    }
    return map;
  })();

  const HEADER_DATE_RE = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})/i;
  const NUMBERED_RECEIPT_RE = /^(\d{1,2})\.([A-Za-z0-9]+)$/;
  const JOB_FROM_NAME_RE = /P\s*([0-9]{3,8})/i;

  function isSupportedFileName(name) {
    return /\.zip$/i.test(String(name || ''));
  }

  /** UK/ISO line & header dates → {y,m,d} or null */
  function parseExpenseDate(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/.exec(t);
    if (m) {
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      return ymd(y, Number(m[2]), Number(m[1]));
    }
    return parseHeaderDate(t);
  }

  function parseHeaderDate(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const iso = parseExpenseDateLooseIso(t);
    if (iso) return iso;
    const m = HEADER_DATE_RE.exec(t);
    if (!m) return null;
    const day = Number(m[1]);
    const mon = MONTHS[m[2].toLowerCase()];
    const year = Number(m[3]);
    if (!mon) return null;
    return ymd(year, mon, day);
  }

  function parseExpenseDateLooseIso(t) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    // try slash forms already handled by parseExpenseDate — avoid recurse
    const s = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/.exec(t);
    if (s) {
      let y = Number(s[3]);
      if (y < 100) y += 2000;
      return ymd(y, Number(s[2]), Number(s[1]));
    }
    return null;
  }

  function ymd(y, m, d) {
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return { y, m, d };
  }

  function toIso(parts) {
    if (!parts) return '';
    return (
      String(parts.y) + '-' +
      String(parts.m).padStart(2, '0') + '-' +
      String(parts.d).padStart(2, '0')
    );
  }

  function guessDateFromDocxName(name) {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(name || '');
    if (!m) return null;
    return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  function parseMoney(raw) {
    if (raw == null) return null;
    let s = String(raw).trim().replace(/£/g, '').replace(/,/g, '').replace(/\s/g, '');
    if (!s || s === '-') return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100) / 100;
  }

  function normalizeJob(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    const m = JOB_FROM_NAME_RE.exec(trimmed);
    if (m) return 'P' + m[1];
    return trimmed;
  }

  function mimeForExt(ext) {
    switch (String(ext || '').toLowerCase()) {
      case 'pdf': return 'application/pdf';
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'webp': return 'image/webp';
      case 'gif': return 'image/gif';
      case 'heic': return 'image/heic';
      default: return null;
    }
  }

  function baseName(path) {
    const s = String(path || '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  /**
   * @param {ArrayBuffer|Uint8Array|Blob} zipBytes
   * @param {string} zipFileName e.g. P5503.zip
   */
  async function parse(zipBytes, zipFileName) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    if (!global.AsDocxFiller || typeof AsDocxFiller.extractSummary !== 'function') {
      throw new Error('AsDocxFiller.extractSummary not available');
    }

    const zip = await JSZip.loadAsync(zipBytes);
    const entries = {};
    const names = Object.keys(zip.files);
    for (const path of names) {
      const f = zip.files[path];
      if (f.dir) continue;
      const base = baseName(path);
      if (!base) continue;
      entries[base] = await f.async('uint8array');
    }
    if (!Object.keys(entries).length) throw new Error('Zip is empty');

    const docxKeys = Object.keys(entries).filter((n) => /\.docx$/i.test(n));
    let docxName = docxKeys.find((n) => {
      const lower = n.toLowerCase();
      return lower.startsWith('expenseclaim') || lower.includes('expense');
    }) || docxKeys[0];
    if (!docxName) throw new Error('No ExpenseClaim .docx found in zip');

    let extracted;
    try {
      extracted = await AsDocxFiller.extractSummary(entries[docxName]);
    } catch (e) {
      throw new Error('Could not read expense Word form: ' + (e.message || e));
    }

    const dateFrom =
      parseHeaderDate(extracted.dateFrom) ||
      guessDateFromDocxName(docxName);
    if (!dateFrom) {
      throw new Error('Could not parse Date From (“' + extracted.dateFrom + '”)');
    }
    const dateTo = parseHeaderDate(extracted.dateTo) || dateFrom;

    const maxLines = MAX_LINES();
    const lines = [];
    (extracted.lines || []).forEach((cells, index) => {
      if (!cells || cells.length < 8) return;
      const num = Number(String(cells[0]).replace(/\D/g, '')) || (index + 1);
      const hasContent = cells.slice(1).some((c) => String(c || '').trim());
      if (!hasContent) return;
      lines.push({
        lineNumber: Math.min(Math.max(num, 1), maxLines),
        date: toIso(parseExpenseDate(cells[1])),
        jobNo: normalizeJob(cells[2]),
        description: String(cells[3] || '').trim(),
        foreignCurrency: String(cells[4] || '').trim(),
        net: parseMoney(cells[5]),
        vat: parseMoney(cells[6]),
        total: parseMoney(cells[7]),
      });
    });
    lines.sort((a, b) => a.lineNumber - b.lineNumber);

    const receipts = [];
    for (const name of Object.keys(entries)) {
      const m = NUMBERED_RECEIPT_RE.exec(name);
      if (!m) continue;
      const lineNum = Number(m[1]);
      if (lineNum < 1 || lineNum > maxLines) continue;
      const bytes = entries[name];
      if (!bytes || !bytes.length) continue;
      receipts.push({
        lineNumber: lineNum,
        fileName: name,
        bytes,
        mime: mimeForExt(m[2]),
      });
    }
    receipts.sort((a, b) => a.lineNumber - b.lineNumber);

    const jobFromZipMatch = JOB_FROM_NAME_RE.exec(zipFileName || '');
    const jobFromZip = jobFromZipMatch ? 'P' + jobFromZipMatch[1] : '';
    const jobFromLines = lines.map((l) => l.jobNo).filter(Boolean);
    let jobNumber = '';
    if (jobFromZip) {
      jobNumber = jobFromZip;
    } else if (jobFromLines.length) {
      const counts = {};
      for (const j of jobFromLines) counts[j] = (counts[j] || 0) + 1;
      jobNumber = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
    }

    return {
      jobNumber,
      dateFrom: toIso(dateFrom),
      dateTo: toIso(dateTo),
      name: extracted.name || '',
      sendTo: extracted.sendTo || '',
      lines,
      receipts,
    };
  }

  global.AsExpenseZipReader = {
    parse,
    isSupportedFileName,
    parseHeaderDate: (t) => toIso(parseHeaderDate(t)),
    parseMoney,
    normalizeJob,
  };
})(typeof window !== 'undefined' ? window : globalThis);
