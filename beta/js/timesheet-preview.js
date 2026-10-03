/**
 * Read-only Timesheet Preview (port of Android ui/screens/TimesheetPreviewScreen.kt).
 * Draws the Andrews Survey grid from the SAME model the .odt export uses
 * (AsTimesheetLayout.build), so the preview can never disagree with the file.
 * Sheet 1 = days 1–16 (upper columns); Sheet 2 = days 17–end (lower columns) + TOTALS.
 */
(function (global) {
  const W_DAY = 1.72;
  const W_JOB = 2.71;
  const W_DESC = 7.22;
  const W_TYPES = [2.17, 2.18, 1.98, 3.31, 2.47, 2.48];
  const TICK = '\u2714';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function colgroup() {
    const total = W_DAY + W_JOB + W_DESC + W_TYPES.reduce((a, b) => a + b, 0);
    const pct = (w) => (100 * w / total).toFixed(3) + '%';
    return '<colgroup><col style="width:' + pct(W_DAY) + '"><col style="width:' + pct(W_JOB) + '"><col style="width:' + pct(W_DESC) + '">' +
      W_TYPES.map((w) => '<col style="width:' + pct(w) + '">').join('') + '</colgroup>';
  }

  function ordinalHtml(day) {
    const label = global.AsTimesheetLayout.ordinal(day);
    const n = String(day);
    return esc(n) + '<sup>' + esc(label.slice(n.length)) + '</sup>';
  }

  function pageHeader() {
    return '<div class="tsp-head">' +
      '<img class="tsp-logo" src="templates/as-logo.jpg" alt="Andrews Survey">' +
      '<div class="tsp-doc">' +
      '<div><b>Document Title:</b><span>Monthly Timesheet</span></div>' +
      '<div><b>Document Number:</b><span class="grow">N/A</span><b>Rev:</b><span>N/A</span></div>' +
      '</div></div>';
  }

  function pageFooter(n) {
    return '<div class="tsp-foot"><span>This form has been created using template: AS-HSQ-TEM-0004-C1</span><span>Sheet ' + n + ' of 2</span></div>';
  }

  function sheetHtml(s, n) {
    const L = global.AsTimesheetLayout;
    const half = n === 1 ? 'UPPER' : 'LOWER';
    const cols = L.columnsFor(half);
    const rows = n === 1 ? s.upperRows : s.lowerRows;
    let h = '<section class="tsp-sheet" aria-label="Sheet ' + n + ' of 2">' + pageHeader();
    h += '<div class="tsp-meta"><span class="grow">Name: ' + esc(s.name) + '</span><span>Month:&nbsp; ' + esc(s.monthName) + '</span><span>Year: ' + esc(s.year) + '</span></div>';
    h += '<p class="tsp-tick-note">Please tick appropriate box, for each day</p>';
    h += '<table class="tsp-grid">' + colgroup() + '<thead><tr><th class="blank"></th><th>Job No</th><th class="thick">Description</th>' +
      cols.map((t) => '<th>' + esc(L.heading(t)) + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of rows) {
      h += '<tr' + (r.dayType ? ' class="filled"' : '') + '><td class="day">' + ordinalHtml(r.day) + '</td><td class="job">' + esc(r.jobNo) + '</td><td class="desc thick">' + esc(r.description) + '</td>' +
        r.ticks.map(([, on]) => '<td class="tick">' + (on ? TICK : '') + '</td>').join('') + '</tr>';
    }
    if (n === 2) {
      h += '<tr class="totals"><td class="totals-label" colspan="3">TOTALS</td>' +
        L.LOWER_COLUMNS.map((t) => '<td class="tick">' + (s.totals[t] || 0) + '</td>').join('') + '</tr>';
    }
    h += '</tbody></table>' + pageFooter(n) + '</section>';
    return h;
  }

  /** Full preview markup for a sheet model. */
  function render(sheet) {
    return '<div class="tsp-paper">' + sheetHtml(sheet, 1) + sheetHtml(sheet, 2) + '</div>';
  }

  /** Model for a stored timesheet ({year, month, entries}) with the display name. */
  function sheetFor(ts, name) {
    return global.AsTimesheetLayout.build({ name: name || '', year: ts.year, month: ts.month, entries: ts.entries || [] });
  }

  global.AsTimesheetPreview = { render, sheetFor, sheetHtml, DESIGN_WIDTH: 760 };
})(window);
