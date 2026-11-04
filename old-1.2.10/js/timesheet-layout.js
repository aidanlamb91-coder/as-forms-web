/**
 * The one place that maps timesheet data onto the Andrews Survey grid — port of Android
 * docx/TimesheetLayout.kt (1.0.0). Used by BOTH the .odt export (AsTimesheetFiller) and the
 * in-app Timesheet Preview, so they can never disagree about rows, tick columns or totals.
 *
 * Template facts (timesheet.odt, Table1):
 * - Upper half = days 1–16: Office, Offshore, Annual Leave, Roster Leave, Training, Sick
 * - Lower half = days 17–end: Office, Offshore, Roster Leave, Annual Leave, Training, Sick
 * - TOTALS row (after the last day) uses the lower-half order.
 * - Rows for days past the month length are removed.
 */
(function (global) {
  const TYPES = ['OFFICE', 'OFFSHORE', 'ANNUAL_LEAVE', 'ROSTER_LEAVE', 'TRAINING', 'SICK'];
  const UPPER_COLUMNS = ['OFFICE', 'OFFSHORE', 'ANNUAL_LEAVE', 'ROSTER_LEAVE', 'TRAINING', 'SICK'];
  const LOWER_COLUMNS = ['OFFICE', 'OFFSHORE', 'ROSTER_LEAVE', 'ANNUAL_LEAVE', 'TRAINING', 'SICK'];
  const FIRST_TYPE_CELL = 4;
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const HEADINGS = {
    OFFICE: 'Office',
    OFFSHORE: 'Offshore',
    ANNUAL_LEAVE: 'Annual Leave',
    ROSTER_LEAVE: 'Roster Leave',
    TRAINING: 'Training',
    SICK: 'Sick',
  };
  /** App wording (Holiday = Annual Leave) for the one-line summary. */
  const UI_LABELS = {
    OFFICE: 'Office',
    OFFSHORE: 'Offshore',
    ANNUAL_LEAVE: 'Holiday',
    ROSTER_LEAVE: 'Roster Leave',
    TRAINING: 'Training',
    SICK: 'Sick',
  };

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function heading(type) { return HEADINGS[type] || type; }
  function halfOf(day) { return day <= 16 ? 'UPPER' : 'LOWER'; }
  function columnsFor(half) { return half === 'UPPER' ? UPPER_COLUMNS : LOWER_COLUMNS; }
  function cellIndex(half, type) { return FIRST_TYPE_CELL + columnsFor(half).indexOf(type); }

  /** "1st", "2nd", "3rd", "4th" … "11th" … "21st", "22nd", "23rd", "31st". */
  function ordinal(day) {
    const t = day % 100;
    let suffix = 'th';
    if (t < 11 || t > 13) {
      if (day % 10 === 1) suffix = 'st';
      else if (day % 10 === 2) suffix = 'nd';
      else if (day % 10 === 3) suffix = 'rd';
    }
    return day + suffix;
  }

  /** Entries (date-range blocks) → one fill per day; later entries win on overlap (as export). */
  function expandEntriesToDays(entries, year, month) {
    const last = daysInMonth(year, month);
    const byDay = {};
    for (const e of entries || []) {
      const start = Math.max(1, Math.min(Number(e.startDay) || 1, last));
      const end = Math.max(start, Math.min(Number(e.endDay) || start, last));
      for (let d = start; d <= end; d++) {
        byDay[d] = {
          dayOfMonth: d,
          jobNo: e.jobNumber || e.jobNo || '',
          description: e.description || '',
          dayType: e.dayType || 'OFFICE',
        };
      }
    }
    return Object.keys(byDay).map(Number).sort((a, b) => a - b).map((d) => byDay[d]);
  }

  /**
   * @param {{name?:string, year:number, month:number, days?:Array, entries?:Array}} data
   * @returns {{name, year, month, monthName, rows, totals, daysInMonth, upperRows, lowerRows, totalDaysTicked}}
   */
  function build(data) {
    const year = data.year;
    const month = data.month;
    const lastDay = daysInMonth(year, month);
    const days = data.days || expandEntriesToDays(data.entries, year, month);
    for (const d of days) {
      if (d.dayOfMonth < 1 || d.dayOfMonth > lastDay) {
        throw new Error('Day ' + d.dayOfMonth + ' not in month ' + month + '/' + year);
      }
    }
    const byDay = {};
    for (const d of days) byDay[d.dayOfMonth] = d;
    const totals = {};
    TYPES.forEach((t) => { totals[t] = 0; });
    const rows = [];
    for (let day = 1; day <= lastDay; day++) {
      const fill = byDay[day] || null;
      if (fill) totals[fill.dayType] = (totals[fill.dayType] || 0) + 1;
      const half = halfOf(day);
      const dayType = fill ? fill.dayType : null;
      rows.push({
        day,
        label: ordinal(day),
        half,
        jobNo: fill ? (fill.jobNo || '') : '',
        description: fill ? (fill.description || '') : '',
        dayType,
        ticks: columnsFor(half).map((t) => [t, t === dayType]),
      });
    }
    return {
      name: data.name || '',
      year,
      month,
      monthName: MONTH_NAMES[month - 1] || '',
      rows,
      totals,
      daysInMonth: lastDay,
      upperRows: rows.filter((r) => r.half === 'UPPER'),
      lowerRows: rows.filter((r) => r.half === 'LOWER'),
      totalDaysTicked: TYPES.reduce((s, t) => s + totals[t], 0),
    };
  }

  /** "Offshore 10 · Office 2 · Holiday 1 · Sick 1" (or "No days ticked yet"). */
  function summaryLine(sheet) {
    const order = ['OFFSHORE', 'OFFICE', 'ANNUAL_LEAVE', 'ROSTER_LEAVE', 'TRAINING', 'SICK'];
    const parts = order.filter((t) => (sheet.totals[t] || 0) > 0).map((t) => UI_LABELS[t] + ' ' + sheet.totals[t]);
    return parts.length ? parts.join(' · ') : 'No days ticked yet';
  }

  global.AsTimesheetLayout = {
    TYPES,
    UPPER_COLUMNS,
    LOWER_COLUMNS,
    FIRST_TYPE_CELL,
    UI_LABELS,
    heading,
    halfOf,
    columnsFor,
    cellIndex,
    ordinal,
    daysInMonth,
    expandEntriesToDays,
    build,
    summaryLine,
  };
})(typeof window !== 'undefined' ? window : globalThis);
