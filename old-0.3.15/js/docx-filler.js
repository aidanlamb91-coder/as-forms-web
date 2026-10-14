/**
 * Client-side fill of expense-claim.docx (mirrors Android DocxFiller).
 * Uses JSZip + DOMParser. No paid APIs.
 */
(function (global) {
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const MAX_LINES = 24;
  const TEMPLATE_URL = 'templates/expense-claim.docx';

  function ordinalSuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  function parseISODate(iso) {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function formatHeaderDate(iso) {
    const d = parseISODate(iso);
    if (!d) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const day = d.getDate();
    return day + ordinalSuffix(day) + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function formatLineDate(iso) {
    const d = parseISODate(iso);
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return dd + '/' + mm + '/' + yy;
  }

  function formatMoney(value) {
    if (value == null || value === '' || Number.isNaN(Number(value))) return '';
    return Number(value).toFixed(2);
  }

  function formatMoneyWithPound(value) {
    if (value == null || value === '' || Number.isNaN(Number(value))) return '£';
    return '£' + Number(value).toFixed(2);
  }

  function childElements(parent, localName) {
    const out = [];
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      // Browsers: localName is "tr". Some DOM shims set localName to "w:tr".
      const raw = c.localName || c.tagName || '';
      const local = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
      if (local === localName) out.push(c);
    }
    return out;
  }

  function cellText(cell) {
    let texts = cell.getElementsByTagNameNS(W_NS, 't');
    if (!texts.length) texts = cell.getElementsByTagName('w:t');
    let s = '';
    for (let i = 0; i < texts.length; i++) s += texts[i].textContent || '';
    return s;
  }

  function getTables(doc) {
    let tables = doc.getElementsByTagNameNS(W_NS, 'tbl');
    if (!tables.length) tables = doc.getElementsByTagName('w:tbl');
    return tables;
  }

  function setCellText(cell, text) {
    const doc = cell.ownerDocument;
    let paragraphs = childElements(cell, 'p');
    if (!paragraphs.length) {
      const p = doc.createElementNS(W_NS, 'w:p');
      cell.appendChild(p);
      paragraphs = [p];
    }
    const first = paragraphs[0];
    for (let i = 1; i < paragraphs.length; i++) cell.removeChild(paragraphs[i]);

    const existingRuns = childElements(first, 'r');
    let rPrClone = null;
    if (existingRuns.length) {
      const rPrs = childElements(existingRuns[0], 'rPr');
      if (rPrs.length) rPrClone = rPrs[0].cloneNode(true);
    }

    const toRemove = [];
    for (let c = first.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.localName !== 'pPr') toRemove.push(c);
    }
    toRemove.forEach((n) => first.removeChild(n));

    const run = doc.createElementNS(W_NS, 'w:r');
    if (rPrClone) run.appendChild(rPrClone);
    const t = doc.createElementNS(W_NS, 'w:t');
    if (/^\s|\s$|\s{2}/.test(text)) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    }
    t.textContent = text;
    run.appendChild(t);
    first.appendChild(run);
  }

  function fillHeaderTable(table, claim) {
    const rows = childElements(table, 'tr');
    if (rows.length < 3) throw new Error('Header table needs >= 3 rows');
    const sendCells = childElements(rows[0], 'tc');
    setCellText(sendCells[1], claim.sendTo || 'invoice@andrewssurvey.com');
    const nameCells = childElements(rows[1], 'tc');
    setCellText(nameCells[1], claim.name || '');
    const dateCells = childElements(rows[2], 'tc');
    setCellText(dateCells[1], formatHeaderDate(claim.dateFrom));
    setCellText(dateCells[3], formatHeaderDate(claim.dateTo));
  }

  function fillLinesTable(table, claim) {
    const rows = childElements(table, 'tr');
    if (rows.length < MAX_LINES + 2) {
      throw new Error('Lines table too small: ' + rows.length);
    }
    const headerCells = childElements(rows[0], 'tc');
    if (headerCells.length >= 2 && !cellText(headerCells[1]).trim()) {
      setCellText(headerCells[1], 'DATE');
    }

    const lines = claim.lines || [];
    for (let i = 0; i < MAX_LINES; i++) {
      const cells = childElements(rows[i + 1], 'tc');
      setCellText(cells[0], String(i + 1));
      const line = lines[i];
      if (!line) {
        for (let c = 1; c < 8; c++) setCellText(cells[c], '');
      } else {
        setCellText(cells[1], formatLineDate(line.date));
        setCellText(cells[2], line.jobNo || '');
        setCellText(cells[3], line.description || '');
        setCellText(cells[4], line.foreignCurrency || '');
        setCellText(cells[5], formatMoney(line.net));
        setCellText(cells[6], formatMoney(line.vat));
        setCellText(cells[7], formatMoney(line.total));
      }
    }

    let netSum = 0;
    let vatSum = 0;
    let totalSum = 0;
    for (const line of lines) {
      if (line.net != null && line.net !== '') netSum += Number(line.net) || 0;
      if (line.vat != null && line.vat !== '') vatSum += Number(line.vat) || 0;
      if (line.total != null && line.total !== '') totalSum += Number(line.total) || 0;
      else {
        const n = Number(line.net) || 0;
        const v = Number(line.vat) || 0;
        totalSum += n + v;
      }
    }

    const totalsRow = rows[MAX_LINES + 1];
    const tCells = childElements(totalsRow, 'tc');
    setCellText(tCells[1], formatMoneyWithPound(netSum));
    setCellText(tCells[2], vatSum === 0 ? '£' : formatMoneyWithPound(vatSum));
    setCellText(tCells[3], formatMoneyWithPound(totalSum));
  }

  function serializeDocument(doc) {
    const serializer = new XMLSerializer();
    let body = serializer.serializeToString(doc);
    // Ensure OOXML-friendly declaration
    if (!body.startsWith('<?xml')) {
      body = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
    } else {
      body = body.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    }
    return body;
  }

  async function loadTemplateBytes() {
    const res = await fetch(TEMPLATE_URL);
    if (!res.ok) throw new Error('Could not load template (' + res.status + '). Serve via http.server, not file://.');
    return await res.arrayBuffer();
  }

  /**
   * @param {object} claim { name, sendTo, dateFrom, dateTo, lines:[{date,jobNo,description,foreignCurrency,net,vat,total}] }
   * @returns {Promise<Blob>} filled .docx
   */
  async function fillExpenseClaim(claim) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    if ((claim.lines || []).length > MAX_LINES) {
      throw new Error('At most ' + MAX_LINES + ' line items supported');
    }

    const templateBuf = await loadTemplateBytes();
    const zip = await JSZip.loadAsync(templateBuf);
    const xmlStr = await zip.file('word/document.xml').async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Failed to parse document.xml');
    }

    const tables = getTables(doc);
    if (tables.length < 2) throw new Error('Expected at least 2 tables');
    fillHeaderTable(tables[0], claim);
    fillLinesTable(tables[1], claim);

    zip.file('word/document.xml', serializeDocument(doc));
    return await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  /**
   * Parse a filled expense .docx (Android DocxFiller.extractSummary parity).
   * @param {ArrayBuffer|Uint8Array|Blob} docxBytes
   * @returns {Promise<{sendTo,name,dateFrom,dateTo,lines:string[][],totalNet,totalVat,totalTotal}>}
   */
  async function extractSummary(docxBytes) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    const zip = await JSZip.loadAsync(docxBytes);
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) throw new Error('word/document.xml missing');
    const xmlStr = await xmlFile.async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Failed to parse document.xml');
    }
    const tables = getTables(doc);
    if (tables.length < 2) throw new Error('Expected at least 2 tables');

    const headerRows = childElements(tables[0], 'tr');
    if (headerRows.length < 3) throw new Error('Header table needs >= 3 rows');
    const sendTo = cellText(childElements(headerRows[0], 'tc')[1]).trim();
    const name = cellText(childElements(headerRows[1], 'tc')[1]).trim();
    const dateCells = childElements(headerRows[2], 'tc');
    const dateFrom = cellText(dateCells[1]).trim();
    const dateTo = cellText(dateCells[3]).trim();

    const lineRows = childElements(tables[1], 'tr');
    const extractedLines = [];
    for (let i = 1; i <= MAX_LINES; i++) {
      if (i >= lineRows.length) break;
      const cells = childElements(lineRows[i], 'tc');
      const vals = [];
      for (let c = 0; c < 8; c++) {
        vals.push(cells[c] ? cellText(cells[c]).trim() : '');
      }
      if (vals.slice(1).some((v) => v)) extractedLines.push(vals);
    }

    let totalNet = '', totalVat = '', totalTotal = '';
    if (lineRows.length > MAX_LINES + 1) {
      const totalsCells = childElements(lineRows[MAX_LINES + 1], 'tc');
      totalNet = totalsCells[1] ? cellText(totalsCells[1]).trim() : '';
      totalVat = totalsCells[2] ? cellText(totalsCells[2]).trim() : '';
      totalTotal = totalsCells[3] ? cellText(totalsCells[3]).trim() : '';
    }

    return {
      sendTo,
      name,
      dateFrom,
      dateTo,
      lines: extractedLines,
      totalNet,
      totalVat,
      totalTotal,
    };
  }

  global.AsDocxFiller = {
    fillExpenseClaim,
    extractSummary,
    formatHeaderDate,
    formatLineDate,
    formatMoney,
    MAX_LINES,
    TEMPLATE_URL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
