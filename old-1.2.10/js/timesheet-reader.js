/**
 * Parse filled timesheet .odt / .docx — port of Android TimesheetReader.
 */
(function (global) {
  const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const LEGACY_TICK = '\uF0FC';
  const TICK_CHARS = new Set(['✓', '✔', LEGACY_TICK, '\u2713', '\u2714']);

  const MONTH_NAMES = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  const DayType = () => global.AsTimesheetFiller.DayType;
  const upperCol = (t) => global.AsTimesheetFiller.upperCol(t);
  const lowerCol = (t) => global.AsTimesheetFiller.lowerCol(t);
  const DAY_TYPES = () => global.AsTimesheetFiller.DAY_TYPES;

  function childElements(parent, ns, localName) {
    const out = [];
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.localName === localName &&
          (c.namespaceURI == null || c.namespaceURI === ns)) {
        out.push(c);
      }
    }
    return out;
  }

  function logicalCells(row) {
    const result = [];
    for (let c = row.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        const local = c.localName;
        if ((local === 'table-cell' || local === 'covered-table-cell') &&
            (c.namespaceURI == null || c.namespaceURI === TABLE_NS)) {
          result.push(c);
        }
      }
    }
    return result;
  }

  function cellText(cell) {
    if (cell.localName === 'covered-table-cell') return '';
    return cell.textContent || '';
  }

  function cellHasTick(cell) {
    const text = cellText(cell);
    for (const ch of text) if (TICK_CHARS.has(ch)) return true;
    return false;
  }

  function parseOrdinalDay(label) {
    const m = /^(\d+)(st|nd|rd|th)$/i.exec(String(label || '').trim());
    return m ? parseInt(m[1], 10) : null;
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function parseHeader(headerText) {
    const monthMatch = /Month:\s*(January|February|March|April|May|June|July|August|September|October|November|December)/i.exec(headerText);
    if (!monthMatch) throw new Error('Could not read Month from timesheet header');
    const yearMatch = /Year:\s*(\d{4})/.exec(headerText);
    if (!yearMatch) throw new Error('Could not read Year from timesheet header');
    const nameMatch = /Name:\s*(.+?)(?=Month:|$)/i.exec(headerText);
    const month = MONTH_NAMES[monthMatch[1].toLowerCase()];
    if (!month) throw new Error('Unknown month');
    return {
      year: parseInt(yearMatch[1], 10),
      month,
      name: nameMatch ? nameMatch[1].trim() : '',
    };
  }

  function dayFillOrNull(day, job, desc, type) {
    if (!type && !job && !desc) return null;
    if (!type) return null;
    return { dayOfMonth: day, jobNo: job, description: desc, dayType: type };
  }

  function collapseToRanges(days) {
    if (!days.length) return [];
    const sorted = days.slice().sort((a, b) => a.dayOfMonth - b.dayOfMonth);
    const out = [];
    let runStart = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      const contiguous =
        cur.dayOfMonth === prev.dayOfMonth + 1 &&
        cur.jobNo === prev.jobNo &&
        cur.description === prev.description &&
        cur.dayType === prev.dayType;
      if (contiguous) {
        prev = cur;
      } else {
        out.push({
          startDay: runStart.dayOfMonth,
          endDay: prev.dayOfMonth,
          jobNo: runStart.jobNo,
          description: runStart.description,
          dayType: runStart.dayType,
        });
        runStart = cur;
        prev = cur;
      }
    }
    out.push({
      startDay: runStart.dayOfMonth,
      endDay: prev.dayOfMonth,
      jobNo: runStart.jobNo,
      description: runStart.description,
      dayType: runStart.dayType,
    });
    return out;
  }

  function extractOdtUpperDay(row, day) {
    const cells = logicalCells(row);
    if (cells.length < 10) return null;
    const job = cellText(cells[1]).trim();
    const desc = cellText(cells[3]).trim();
    const type = DAY_TYPES().find((t) => cellHasTick(cells[upperCol(t)])) || null;
    return dayFillOrNull(day, job, desc, type);
  }

  function extractOdtLowerDay(row, day) {
    const cells = logicalCells(row);
    if (cells.length < 10) return null;
    const job = cellText(cells[1]).trim();
    const desc = cellText(cells[2]).trim();
    const type = DAY_TYPES().find((t) => cellHasTick(cells[lowerCol(t)])) || null;
    return dayFillOrNull(day, job, desc, type);
  }

  function docxCellText(cell) {
    let s = '';
    function walk(node) {
      if (node.nodeType === 3) {
        s += node.nodeValue || '';
      } else if (node.nodeType === 1) {
        if (node.localName === 'sym' && (node.namespaceURI == null || node.namespaceURI === W_NS)) {
          const ch = node.getAttributeNS(W_NS, 'char') ||
            node.getAttribute('w:char') || node.getAttribute('char') || '';
          if (/^F0FC$/i.test(ch) || /^F0FE$/i.test(ch)) s += LEGACY_TICK;
        } else {
          for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
        }
      }
    }
    walk(cell);
    return s;
  }

  function docxCellHasTick(cell) {
    const text = docxCellText(cell);
    for (const ch of text) if (TICK_CHARS.has(ch)) return true;
    return false;
  }

  function detectDocxDayType(cells, cols) {
    const DT = DayType();
    const checks = [
      [DT.OFFICE, cols.office],
      [DT.OFFSHORE, cols.offshore],
      [DT.ANNUAL_LEAVE, cols.annual],
      [DT.ROSTER_LEAVE, cols.roster],
      [DT.TRAINING, cols.training],
      [DT.SICK, cols.sick],
    ];
    for (const [type, idx] of checks) {
      if (idx < cells.length && docxCellHasTick(cells[idx])) return type;
    }
    return null;
  }

  function extractDocxUpperDay(row, day) {
    const cells = childElements(row, W_NS, 'tc');
    if (cells.length < 9) return null;
    const job = docxCellText(cells[1]).trim();
    const desc = docxCellText(cells[2]).trim();
    const type = detectDocxDayType(cells, {
      office: 3, offshore: 4, annual: 5, roster: 6, training: 7, sick: 8,
    });
    return dayFillOrNull(day, job, desc, type);
  }

  function extractDocxLowerDay(row, day) {
    const cells = childElements(row, W_NS, 'tc');
    if (cells.length < 10) return null;
    const job = docxCellText(cells[2]).trim();
    const desc = docxCellText(cells[3]).trim();
    const type = detectDocxDayType(cells, {
      office: 4, offshore: 5, roster: 6, annual: 7, training: 8, sick: 9,
    });
    return dayFillOrNull(day, job, desc, type);
  }

  function collectDocxText(node) {
    let s = '';
    function walk(n) {
      if (n.nodeType === 3) s += n.nodeValue || '';
      else if (n.nodeType === 1) {
        for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      }
    }
    walk(node);
    return s;
  }

  async function zipEntryNames(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    return Object.keys(zip.files);
  }

  async function readZipEntry(bytes, name) {
    const zip = await JSZip.loadAsync(bytes);
    const f = zip.file(name);
    if (!f) return null;
    return await f.async('uint8array');
  }

  async function parseOdt(bytes) {
    const contentXml = await readZipEntry(bytes, 'content.xml');
    if (!contentXml) throw new Error('ODT missing content.xml');
    const str = new TextDecoder('utf-8').decode(contentXml);
    const doc = new DOMParser().parseFromString(str, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Failed to parse content.xml');

    const officeText = doc.getElementsByTagNameNS(OFFICE_NS, 'text')[0];
    if (!officeText) throw new Error('ODT missing office:text');
    const headerP = childElements(officeText, TEXT_NS, 'p')[0];
    if (!headerP) throw new Error('ODT missing header paragraph');
    const { year, month, name } = parseHeader(headerP.textContent || '');

    const table = doc.getElementsByTagNameNS(TABLE_NS, 'table')[0];
    if (!table) throw new Error('ODT missing timesheet table');
    const rows = childElements(table, TABLE_NS, 'table-row');
    if (rows.length < 18) throw new Error('ODT table too short (' + rows.length + ' rows)');

    const lastDay = daysInMonth(year, month);
    const days = [];
    for (let day = 1; day <= Math.min(16, lastDay); day++) {
      if (day < rows.length) {
        const fill = extractOdtUpperDay(rows[day], day);
        if (fill) days.push(fill);
      }
    }
    for (let i = 17; i < rows.length; i++) {
      const cells = logicalCells(rows[i]);
      const allText = cells.map(cellText).join('');
      if (/TOTALS/i.test(allText)) break;
      if (cells.length >= 10) {
        const dayNum = parseOrdinalDay(cellText(cells[0]));
        if (dayNum != null && dayNum >= 17 && dayNum <= lastDay) {
          const fill = extractOdtLowerDay(rows[i], dayNum);
          if (fill) days.push(fill);
        }
      }
    }
    days.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
    return {
      year, month, name, days,
      entries: collapseToRanges(days),
      sourceFormat: 'ODT',
    };
  }

  async function parseDocx(bytes) {
    const documentXml = await readZipEntry(bytes, 'word/document.xml');
    if (!documentXml) throw new Error('DOCX missing word/document.xml');
    const str = new TextDecoder('utf-8').decode(documentXml);
    const doc = new DOMParser().parseFromString(str, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Failed to parse document.xml');

    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
    if (!body) throw new Error('DOCX missing w:body');
    const { year, month, name } = parseHeader(collectDocxText(body).slice(0, 400));

    const tables = body.getElementsByTagNameNS(W_NS, 'tbl');
    if (!tables.length) throw new Error('DOCX missing timesheet table');
    const rows = childElements(tables[0], W_NS, 'tr');
    if (rows.length < 18) throw new Error('DOCX table too short');

    const lastDay = daysInMonth(year, month);
    const days = [];
    for (let day = 1; day <= Math.min(16, lastDay); day++) {
      if (day < rows.length) {
        const fill = extractDocxUpperDay(rows[day], day);
        if (fill) days.push(fill);
      }
    }
    for (let i = 18; i < rows.length; i++) {
      const cells = childElements(rows[i], W_NS, 'tc');
      const joined = cells.map(docxCellText).join('');
      if (/TOTALS/i.test(joined)) break;
      if (cells.length >= 10) {
        const dayNum = parseOrdinalDay(docxCellText(cells[1]));
        if (dayNum != null && dayNum >= 17 && dayNum <= lastDay) {
          const fill = extractDocxLowerDay(rows[i], dayNum);
          if (fill) days.push(fill);
        }
      }
    }
    days.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
    return {
      year, month, name, days,
      entries: collapseToRanges(days),
      sourceFormat: 'DOCX',
    };
  }

  function isSupportedFileName(name) {
    const lower = String(name || '').toLowerCase();
    return lower.endsWith('.odt') || lower.endsWith('.docx');
  }

  async function parse(bytes, fileNameHint) {
    const hint = String(fileNameHint || '').toLowerCase();
    if (hint.endsWith('.pdf')) throw new Error('PDF timesheets are not supported — use .odt or .docx');
    const names = await zipEntryNames(bytes);
    if (hint.endsWith('.odt') || names.includes('content.xml')) return parseOdt(bytes);
    if (hint.endsWith('.docx') || names.includes('word/document.xml')) return parseDocx(bytes);
    if (names.includes('content.xml')) return parseOdt(bytes);
    throw new Error('Unrecognised timesheet file (expected .odt or .docx)');
  }

  global.AsTimesheetReader = {
    parse,
    parseOdt,
    parseDocx,
    collapseToRanges,
    isSupportedFileName,
  };
})(window);
