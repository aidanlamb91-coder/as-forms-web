/**
 * 1.1.0-web — Fills the Andrews Survey "Mileage Expenses Claim" Word form
 * (templates/mileage-claim.docx = AS-ADM-FRM-0020 Rev A6). Port of Android MileageDocxFiller.kt.
 *
 * How it works (same as the expense form in docx-filler.js): open the .docx (it is a zip),
 * edit word/document.xml, zip it again.
 *
 * Template layout:
 *  - Table 0 (header): row 0 "Please Send to:" | address; row 1 "Name:" | name | "CC OF Engine:" | cc.
 *  - Table 1 (journeys): header row, 16 journey rows (Date, Project Number, From, To, Purpose,
 *    Miles, Amount), then the "Total:" row.
 * More than 16 journeys: both tables are copied onto extra sheets with a page break before each.
 * Earlier sheets' bottom row says "Sheet total:"; the last sheet's "Total:" is the grand total.
 */
(function (global) {
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const TEMPLATE_URL = 'templates/mileage-claim.docx';
  const M = () => global.AsMileage;
  const D = () => global.AsDocxFiller;

  const sheetCount = (n) => Math.max(1, Math.ceil(n / M().ROWS_PER_SHEET));
  /** "1598" → "1598 cc"; anything else printed as typed. */
  function formatCc(cc) {
    const t = String(cc || '').trim();
    return t && /^\d+$/.test(t) ? t + ' cc' : t;
  }
  /** "2026-09-01" → "01/09/26" (the form's date column). */
  function rowDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1].slice(2) : '';
  }

  function children(parent, local) {
    const out = [];
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const raw = c.localName || c.tagName || '';
      if ((raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw) === local) out.push(c);
    }
    return out;
  }
  function nextElement(n) {
    let x = n.nextSibling;
    while (x && x.nodeType !== 1) x = x.nextSibling;
    return x;
  }
  function addPageBreak(doc, p) {
    const r = doc.createElementNS(W_NS, 'w:r');
    const br = doc.createElementNS(W_NS, 'w:br');
    br.setAttributeNS(W_NS, 'w:type', 'page');
    r.appendChild(br);
    p.appendChild(r);
  }

  function fillHeader(table, claim) {
    const rows = children(table, 'tr');
    const send = children(rows[0], 'tc');
    if (send.length >= 2) D().setCellText(send[1], claim.sendTo || '');
    const nameRow = children(rows[1], 'tc');
    if (nameRow.length < 4) throw new Error('Name row needs Name | value | CC OF Engine | value');
    D().setCellText(nameRow[1], claim.name || '');
    D().setCellText(nameRow[3], formatCc(claim.ccEngine));
  }

  function fillLines(table, claim, rows, isLast, grandMiles, grandAmount) {
    const mm = M();
    const N = mm.ROWS_PER_SHEET;
    const trs = children(table, 'tr');
    if (trs.length < N + 2) throw new Error('Journey table needs header + ' + N + ' rows + total');
    if (claim.ratePence !== mm.RATE_PENCE) {
      const head = children(trs[0], 'tc');
      if (head.length >= 7) D().setCellText(head[6], 'Amount Claimed at ' + mm.formatRate(claim.ratePence) + ' per mile');
    }
    for (let i = 0; i < N; i++) {
      const cells = children(trs[i + 1], 'tc');
      const r = rows[i];
      const vals = r
        ? [rowDate(r.date), r.projectNumber || '', r.fromPostcode || '', r.toPostcode || '', r.purpose || '',
          mm.formatMilesPlain(r.miles), mm.formatPounds(mm.amount(r.miles, claim.ratePence))]
        : ['', '', '', '', '', '', ''];
      for (let c = 0; c < 7 && c < cells.length; c++) D().setCellText(cells[c], vals[c]);
    }
    const total = children(trs[N + 1], 'tc');
    const n = total.length;
    const sheetMiles = mm.round1(rows.reduce((s, r) => s + r.miles, 0));
    const sheetAmount = rows.reduce((s, r) => s + mm.amount(r.miles, claim.ratePence), 0);
    if (!isLast) D().setCellText(total[n - 3], 'Sheet total:');
    const blank = !claim.rows.length;
    D().setCellText(total[n - 2], blank ? '' : mm.formatMilesPlain(isLast ? grandMiles : sheetMiles));
    D().setCellText(total[n - 1], blank ? '' : mm.formatPounds(isLast ? grandAmount : sheetAmount));
  }

  /**
   * claim = { sendTo, name, ccEngine, ratePence, rows:[{date ISO, projectNumber, fromPostcode,
   * toPostcode, purpose, miles (claimed)}] }. templateBuf optional (fetched when missing).
   * Returns a Blob (browser) or Uint8Array (when opts.type = 'uint8array').
   */
  async function fill(claim, templateBuf, opts) {
    const mm = M();
    if (!templateBuf) {
      const res = await fetch(TEMPLATE_URL);
      if (!res.ok) throw new Error('Could not load mileage template (' + res.status + ')');
      templateBuf = await res.arrayBuffer();
    }
    const zip = await JSZip.loadAsync(templateBuf);
    const doc = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0] || doc.getElementsByTagName('w:body')[0];
    const tables = children(body, 'tbl');
    if (tables.length < 2) throw new Error('Mileage template needs 2 tables');
    const [headerTpl, linesTpl] = tables;
    const headerCopy = headerTpl.cloneNode(true);
    const linesCopy = linesTpl.cloneNode(true);
    const N = mm.ROWS_PER_SHEET;
    const sheets = [];
    for (let i = 0; i < claim.rows.length; i += N) sheets.push(claim.rows.slice(i, i + N));
    if (!sheets.length) sheets.push([]);
    const grandMiles = mm.round1(claim.rows.reduce((s, r) => s + r.miles, 0));
    const grandAmount = claim.rows.reduce((s, r) => s + mm.amount(r.miles, claim.ratePence), 0);

    fillHeader(headerTpl, claim);
    fillLines(linesTpl, claim, sheets[0], sheets.length === 1, grandMiles, grandAmount);
    if (sheets.length > 1) {
      const sectPr = children(body, 'sectPr').pop() || null;
      let after = nextElement(linesTpl);
      if (!after || (after.localName || '').replace(/^w:/, '') !== 'p') {
        after = doc.createElementNS(W_NS, 'w:p');
        body.insertBefore(after, sectPr);
      }
      addPageBreak(doc, after);
      for (let i = 1; i < sheets.length; i++) {
        const h = headerCopy.cloneNode(true);
        const l = linesCopy.cloneNode(true);
        body.insertBefore(h, sectPr);
        body.insertBefore(doc.createElementNS(W_NS, 'w:p'), sectPr);
        body.insertBefore(l, sectPr);
        fillHeader(h, claim);
        fillLines(l, claim, sheets[i], i === sheets.length - 1, grandMiles, grandAmount);
        const tail = doc.createElementNS(W_NS, 'w:p');
        body.insertBefore(tail, sectPr);
        if (i < sheets.length - 1) addPageBreak(doc, tail);
      }
    }
    let xml = new XMLSerializer().serializeToString(doc);
    xml = xml.startsWith('<?xml') ? xml.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + xml;
    zip.file('word/document.xml', xml);
    return zip.generateAsync({
      type: (opts && opts.type) || 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  /** Read a filled form back as text (tests + preview checks). */
  async function extract(docxBuf) {
    const N = M().ROWS_PER_SHEET;
    const zip = await JSZip.loadAsync(docxBuf);
    const doc = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0] || doc.getElementsByTagName('w:body')[0];
    const tables = children(body, 'tbl');
    const text = (c) => D().cellText(c).trim();
    const h0 = children(tables[0], 'tr');
    const rows = [], totals = [];
    tables.filter((_, i) => i % 2 === 1).forEach((t) => {
      const trs = children(t, 'tr');
      for (let i = 1; i <= N; i++) {
        const v = children(trs[i], 'tc').slice(0, 7).map(text);
        if (v.some((x) => x)) rows.push(v);
      }
      const tc = children(trs[N + 1], 'tc').map(text);
      totals.push([tc[tc.length - 3], tc[tc.length - 2], tc[tc.length - 1]]);
    });
    let pb = 0;
    let brs = doc.getElementsByTagNameNS(W_NS, 'br');
    for (let i = 0; i < brs.length; i++) if (brs[i].getAttributeNS(W_NS, 'type') === 'page' || brs[i].getAttribute('w:type') === 'page') pb++;
    return {
      sendTo: text(children(h0[0], 'tc')[1]),
      name: text(children(h0[1], 'tc')[1]),
      cc: text(children(h0[1], 'tc')[3]),
      rows, totals, sheetCount: totals.length, pageBreaks: pb,
    };
  }

  /** Form input from a stored web mileage claim + settings. */
  function claimToForm(claim, settings) {
    const mm = M();
    return {
      sendTo: settings.expenseTo || 'invoice@andrewssurvey.com',
      name: settings.displayName || '',
      ccEngine: settings.ccEngine || '',
      ratePence: claim.completed ? (claim.ratePence || mm.RATE_PENCE) : (Number(settings.mileageRatePence) || claim.ratePence || mm.RATE_PENCE),
      rows: mm.sortedJourneys(claim).map((j) => ({
        date: j.date,
        projectNumber: j.projectNumber || claim.jobNo || '',
        fromPostcode: j.fromPostcode || '',
        toPostcode: j.toPostcode || '',
        purpose: j.purpose || '',
        miles: mm.journeyMiles(j),
      })),
    };
  }

  global.AsMileageDocx = { fill, extract, sheetCount, formatCc, rowDate, claimToForm, TEMPLATE_URL };
})(typeof window !== 'undefined' ? window : globalThis);
