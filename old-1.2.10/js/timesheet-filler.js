/**
 * Fill timesheet.odt — port of Android TimesheetFiller (JSZip + content.xml).
 * ODF: mimetype first, STORED (uncompressed).
 */
(function (global) {
  const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const TEMPLATE_URL = 'templates/timesheet.odt';
  const UNICODE_TICK = '✓';
  const DEFAULT_NAME = '';

  const DayType = {
    OFFICE: 'OFFICE',
    OFFSHORE: 'OFFSHORE',
    ANNUAL_LEAVE: 'ANNUAL_LEAVE',
    ROSTER_LEAVE: 'ROSTER_LEAVE',
    TRAINING: 'TRAINING',
    SICK: 'SICK',
  };

  const DAY_TYPES = Object.values(DayType);

  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  function monthDisplayName(month) {
    return MONTH_NAMES[month - 1] || '';
  }

  function displayTitle(year, month) {
    return monthDisplayName(month) + ' ' + year;
  }

  function exportFileName(year, month) {
    return 'Timesheet_' + String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '.odt';
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function upperCol(type) {
    switch (type) {
      case DayType.OFFICE: return 4;
      case DayType.OFFSHORE: return 5;
      case DayType.ANNUAL_LEAVE: return 6;
      case DayType.ROSTER_LEAVE: return 7;
      case DayType.TRAINING: return 8;
      case DayType.SICK: return 9;
      default: return 4;
    }
  }

  function lowerCol(type) {
    switch (type) {
      case DayType.OFFICE: return 4;
      case DayType.OFFSHORE: return 5;
      case DayType.ROSTER_LEAVE: return 6;
      case DayType.ANNUAL_LEAVE: return 7;
      case DayType.TRAINING: return 8;
      case DayType.SICK: return 9;
      default: return 4;
    }
  }

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

  function setCellText(cell, text) {
    if (cell.localName === 'covered-table-cell') return;
    const doc = cell.ownerDocument;
    let paragraphs = childElements(cell, TEXT_NS, 'p');
    let first;
    if (!paragraphs.length) {
      first = doc.createElementNS(TEXT_NS, 'text:p');
      cell.appendChild(first);
    } else {
      first = paragraphs[0];
      for (let i = 1; i < paragraphs.length; i++) cell.removeChild(paragraphs[i]);
    }
    while (first.firstChild) first.removeChild(first.firstChild);
    if (text) first.appendChild(doc.createTextNode(text));
  }

  function clearTypeCell(cell) {
    if (cell.localName === 'covered-table-cell') return;
    setCellText(cell, '');
  }

  function setTick(cell) {
    setCellText(cell, UNICODE_TICK);
  }

  function collectTextNodes(node, out) {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out.push(c);
      else if (c.nodeType === 1) collectTextNodes(c, out);
    }
  }

  function fillHeaderParagraph(officeText, year, month, name) {
    const paragraphs = childElements(officeText, TEXT_NS, 'p');
    if (!paragraphs.length) throw new Error('Timesheet missing header paragraph');
    const header = paragraphs[0];
    const monthName = monthDisplayName(month);
    const monthSet = new Set(MONTH_NAMES);
    const textNodes = [];
    collectTextNodes(header, textNodes);
    let sawMonthLabel = false;
    for (const node of textNodes) {
      const value = node.nodeValue || '';
      if (value.startsWith('Name:')) {
        node.nodeValue = 'Name: ' + name;
      } else if (value.startsWith('Month:')) {
        if (value.length > 'Month:'.length) {
          const after = value.slice('Month:'.length).replace(/^\s+/, '');
          if (!after || monthSet.has(after)) {
            node.nodeValue = 'Month: ';
            sawMonthLabel = true;
          }
        } else {
          sawMonthLabel = true;
        }
      } else if (sawMonthLabel && (!value || monthSet.has(value))) {
        node.nodeValue = monthName;
        sawMonthLabel = false;
      } else if (monthSet.has(value)) {
        node.nodeValue = monthName;
      } else if (value.startsWith('Year:')) {
        node.nodeValue = 'Year: ' + year;
      }
    }
  }

  const Layout = () => global.AsTimesheetLayout;

  /** Fill one template day row from a TimesheetLayout row (upper: desc cell 3; lower: desc cell 2). */
  function fillDayRow(row, r) {
    const cells = logicalCells(row);
    if (cells.length < 10) throw new Error('Day ' + r.day + ' row needs >= 10 logical cells');
    const descCell = r.half === 'UPPER' ? 3 : 2;
    setCellText(cells[1], r.jobNo || '');
    setCellText(cells[descCell], r.description || '');
    r.ticks.forEach(function (pair, i) {
      const cell = cells[Layout().FIRST_TYPE_CELL + i];
      if (pair[1]) setTick(cell);
      else clearTypeCell(cell);
    });
  }

  /** TOTALS row uses the lower-half column order (Office, Offshore, Roster, Annual, Training, Sick). */
  function fillTotalsRow(row, totals) {
    const cells = logicalCells(row);
    if (cells.length < 10) throw new Error('TOTALS row needs >= 10 logical cells');
    Layout().LOWER_COLUMNS.forEach(function (type, i) {
      setCellText(cells[Layout().FIRST_TYPE_CELL + i], String(totals[type] || 0));
    });
  }

  /** Fill Table1 from the shared TimesheetLayout sheet (same model as the in-app Preview). */
  function fillDaysTable(table, sheet) {
    let rows = childElements(table, TABLE_NS, 'table-row');
    if (rows.length < 34) throw new Error('Timesheet table needs >= 34 rows (got ' + rows.length + ')');
    const lastDay = sheet.daysInMonth;
    for (const r of sheet.rows) {
      fillDayRow(r.day <= 16 ? rows[r.day] : rows[r.day + 1], r);
    }
    if (lastDay < 31) {
      for (let day = 31; day >= lastDay + 1; day--) {
        const rowIdx = day <= 16 ? day : day + 1;
        table.removeChild(rows[rowIdx]);
      }
      rows = childElements(table, TABLE_NS, 'table-row');
    }
    fillTotalsRow(rows[rows.length - 1], sheet.totals);
  }

  function serializeXml(doc) {
    const serializer = new XMLSerializer();
    let body = serializer.serializeToString(doc);
    if (!body.startsWith('<?xml')) {
      body = '<?xml version="1.0" encoding="UTF-8"?>' + body;
    } else {
      body = body.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>');
    }
    return body;
  }

  function expandEntriesToDays(entries, year, month) {
    return Layout().expandEntriesToDays(entries, year, month);
  }

  async function loadTemplateBytes() {
    if (global.__asTimesheetTemplateBytes) return global.__asTimesheetTemplateBytes; // node tests
    const res = await fetch(TEMPLATE_URL);
    if (!res.ok) throw new Error('Could not load timesheet.odt (' + res.status + '). Serve via HTTP.');
    return await res.arrayBuffer();
  }

  /**
   * Write ODT with mimetype first as STORED.
   * JSZip: create fresh zip, add mimetype with compression STORE first.
   */
  async function writeOdtBlob(entries) {
    const out = new JSZip();
    const mime = entries.mimetype || 'application/vnd.oasis.opendocument.text';
    out.file('mimetype', mime, { compression: 'STORE' });
    for (const name of Object.keys(entries)) {
      if (name === 'mimetype') continue;
      out.file(name, entries[name]);
    }
    return out.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.oasis.opendocument.text',
      compression: 'DEFLATE',
    });
  }

  /**
   * @param {{year,month,name,days?:[],entries?:[]}} data
   * @returns {Promise<Blob>}
   */
  async function fillTimesheet(data) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    const year = data.year;
    const month = data.month;
    const name = data.name || DEFAULT_NAME;
    const days = data.days || expandEntriesToDays(data.entries, year, month);
    // Shared grid model (also drives the in-app Preview); throws for days outside the month.
    const sheet = Layout().build({ name, year, month, days });

    const templateBuf = await loadTemplateBytes();
    const zip = await JSZip.loadAsync(templateBuf);
    const entries = {};
    const files = Object.keys(zip.files);
    for (const name of files) {
      const f = zip.files[name];
      if (f.dir) continue;
      entries[name] = await f.async('uint8array');
    }

    const contentStr = new TextDecoder('utf-8').decode(entries['content.xml']);
    const parser = new DOMParser();
    const doc = parser.parseFromString(contentStr, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Failed to parse content.xml');

    const officeText = doc.getElementsByTagNameNS(OFFICE_NS, 'text')[0];
    if (!officeText) throw new Error('Missing office:text');
    fillHeaderParagraph(officeText, year, month, name);

    const tables = doc.getElementsByTagNameNS(TABLE_NS, 'table');
    if (!tables.length) throw new Error('Expected timesheet table');
    fillDaysTable(tables[0], sheet);

    entries['content.xml'] = new TextEncoder().encode(serializeXml(doc));
    return writeOdtBlob(entries);
  }

  global.AsTimesheetFiller = {
    DayType,
    DAY_TYPES,
    UNICODE_TICK,
    DEFAULT_NAME,
    TEMPLATE_URL,
    monthDisplayName,
    displayTitle,
    exportFileName,
    daysInMonth,
    expandEntriesToDays,
    fillTimesheet,
    upperCol,
    lowerCol,
    buildSheet: (data) => Layout().build(data),
  };
})(typeof window !== 'undefined' ? window : globalThis);
