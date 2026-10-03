/**
 * "Days worked summary" data — exact port of Android util/DaysWorkedSummary.kt (0.3.8).
 *
 * Grouping rule:
 * - A trip is a run of consecutive Offshore days with no gap in dates. Runs carry across
 *   month ends (separate monthly timesheets join up).
 * - Within a trip, each project (job number) gets its own row with its own start/end. The same
 *   job continuing across a month end stays one row. A different job in between (A, B, A) starts
 *   a new row each time the job changes.
 * - Trips are chronological and numbered from 1.
 * Description = first non-blank timesheet entry description seen for that row.
 *
 * Dates are plain {y, m, d} objects (no time zones); arithmetic uses UTC day numbers.
 */
(function (global) {
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_MS = 86400000;

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function toDayNum(y, m, d) {
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  }

  function fromDayNum(n) {
    const dt = new Date(n * DAY_MS);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  function periodStartingMarch(marchYear) {
    const endY = marchYear + 1;
    const end = { y: endY, m: 2, d: daysInMonth(endY, 2) };
    return {
      startMarchYear: marchYear,
      startInclusive: { y: marchYear, m: 3, d: 1 },
      endInclusive: end,
      label: 'Mar ' + marchYear + ' – Feb ' + endY,
    };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /** Same job number (case-insensitive); blank job falls back to description. */
  function jobKey(info) {
    return info.job ? 'J:' + info.job.toUpperCase() : 'D:' + info.description.toLowerCase();
  }

  function makeRow(job, description, startN, endN) {
    return {
      jobNumber: job,
      description: description,
      startN: startN,
      endN: endN,
      get start() { return fromDayNum(this.startN); },
      get end() { return fromDayNum(this.endN); },
      get days() { return this.endN - this.startN + 1; },
    };
  }

  /**
   * @param {Array<{year:number, month:number, entries:Array<{startDay,endDay,dayType,jobNumber?,jobNo?,description?}>}>} sources
   *        completed timesheets
   * @param {number} startMarchYear
   */
  function build(sources, startMarchYear) {
    const period = periodStartingMarch(startMarchYear);
    const pStart = toDayNum(period.startInclusive.y, 3, 1);
    const pEnd = toDayNum(period.endInclusive.y, 2, period.endInclusive.d);
    // Expand every Offshore entry into dates; first entry wins if a day repeats.
    const days = new Map();
    const sorted = (sources || []).slice().sort((a, b) => (a.year - b.year) || (a.month - b.month));
    for (const ts of sorted) {
      const last = daysInMonth(ts.year, ts.month);
      const entries = (ts.entries || []).slice().sort((a, b) => (Number(a.startDay) || 0) - (Number(b.startDay) || 0));
      for (const e of entries) {
        if (e.dayType !== 'OFFSHORE') continue;
        const start = clamp(Number(e.startDay) || 1, 1, last);
        const end = clamp(Number(e.endDay) || start, start, last);
        for (let d = start; d <= end; d++) {
          const n = toDayNum(ts.year, ts.month, d);
          if (n < pStart || n > pEnd) continue;
          if (!days.has(n)) {
            days.set(n, {
              job: String(e.jobNumber || e.jobNo || '').trim(),
              description: String(e.description || '').trim(),
            });
          }
        }
      }
    }
    const dayNums = Array.from(days.keys()).sort((a, b) => a - b);

    const trips = [];
    let tripStart = null;
    let prev = null;
    let rows = [];
    let rowKey = null;
    let row = null;

    function closeRow() {
      if (row) rows.push(row);
      row = null;
      rowKey = null;
    }
    function closeTrip() {
      closeRow();
      if (tripStart == null || prev == null) return;
      const startN = tripStart;
      const endN = prev;
      trips.push({
        number: trips.length + 1,
        startN,
        endN,
        get start() { return fromDayNum(this.startN); },
        get end() { return fromDayNum(this.endN); },
        get days() { return this.endN - this.startN + 1; },
        rows: rows.slice(),
      });
      rows = [];
      tripStart = null;
    }

    for (const n of dayNums) {
      const info = days.get(n);
      if (prev == null || n !== prev + 1) {
        // Gap in dates (or first day) → new trip
        closeTrip();
        tripStart = n;
      }
      const key = jobKey(info);
      if (row == null || key !== rowKey) {
        closeRow();
        row = makeRow(info.job, info.description, n, n);
        rowKey = key;
      } else {
        row.endN = n;
        if (!row.description) row.description = info.description;
      }
      prev = n;
    }
    closeTrip();

    return {
      period,
      trips,
      get offshoreDays() { return trips.reduce((s, t) => s + t.days, 0); },
      get tripCount() { return trips.length; },
      get isEmpty() { return trips.length === 0; },
    };
  }

  function title(period) {
    return 'Days worked summary — ' + period.label;
  }

  function fmtShort(dt) {
    return dt.d + ' ' + MONTH_SHORT[dt.m - 1];
  }

  function fmtLong(dt) {
    return dt.d + ' ' + MONTH_SHORT[dt.m - 1] + ' ' + dt.y;
  }

  /** e.g. "Trip 1: 12 Jun – 3 Jul (22 days)" */
  function tripHeading(trip) {
    const n = trip.days;
    return 'Trip ' + trip.number + ': ' + fmtShort(trip.start) + ' – ' + fmtShort(trip.end) +
      ' (' + n + ' day' + (n === 1 ? '' : 's') + ')';
  }

  function formatRowDate(dt) {
    return fmtLong(dt);
  }

  /** Date stamp from a JS Date (local calendar date). */
  function formatStamp(date) {
    const dt = date instanceof Date
      ? { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() }
      : date;
    return fmtLong(dt);
  }

  function totalsLine(summary) {
    return 'Total offshore days: ' + summary.offshoreDays + ' · Trips: ' + summary.tripCount;
  }

  /** e.g. "Days-worked-summary_2025-26.pdf" */
  function fileName(period) {
    const endYY = (period.startMarchYear + 1) % 100;
    return 'Days-worked-summary_' + period.startMarchYear + '-' + String(endYY).padStart(2, '0') + '.pdf';
  }

  global.AsDaysWorkedSummary = {
    build,
    title,
    tripHeading,
    formatRowDate,
    formatStamp,
    totalsLine,
    fileName,
    periodStartingMarch,
    toDayNum,
    fromDayNum,
  };
})(typeof window !== 'undefined' ? window : globalThis);
