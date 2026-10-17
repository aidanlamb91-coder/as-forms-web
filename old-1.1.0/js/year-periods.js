/**
 * 1.1.0-web — "Year starts in" (port of Android util/YearPeriods.kt).
 *
 * In plain English: the yearly banners (expense totals, Days worked) used to always run
 * March → February. Now the user can pick the month the year starts in
 * (Settings → Profile → Year starts in). Default is still March.
 *
 * A period starts on the 1st of the start month and ends the day before the next start,
 * so a March year ends on 28 or 29 February.
 * The old field name `startMarchYear` is kept everywhere: it now just means
 * "the calendar year in which this period starts".
 */
(function (global) {
  const DEFAULT_START_MONTH = 3;
  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

  /** Anything that isn't 1–12 becomes March. */
  function normalizeMonth(m) {
    m = Number(m);
    return Number.isInteger(m) && m >= 1 && m <= 12 ? m : DEFAULT_START_MONTH;
  }

  /** The month the user picked (read from settings every time, so a change applies at once). */
  function startMonth() {
    try {
      if (global.__asYearStartOverride) return normalizeMonth(global.__asYearStartOverride);
      const s = global.AsStorage && global.AsStorage.getSettings();
      return normalizeMonth(s && s.yearStartMonth);
    } catch (_) {
      return DEFAULT_START_MONTH;
    }
  }

  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

  /** The 12-month period that starts in calendar year `startYear`. */
  function periodStarting(startYear, month) {
    const m = normalizeMonth(month == null ? startMonth() : month);
    const endMonth = m === 1 ? 12 : m - 1;
    const endYear = m === 1 ? startYear : startYear + 1;
    const end = { y: endYear, m: endMonth, d: daysInMonth(endYear, endMonth) };
    return {
      startMarchYear: startYear, // legacy name: the year the period starts in
      startYear,
      startMonth: m,
      startInclusive: { y: startYear, m, d: 1 },
      endInclusive: end,
      label: SHORT[m - 1] + ' ' + startYear + ' – ' + SHORT[endMonth - 1] + ' ' + endYear,
    };
  }

  /** Which period's start year a calendar month (or {y,m}) falls into. */
  function startYearOf(year, month, start) {
    const m = normalizeMonth(start == null ? startMonth() : start);
    return month >= m ? year : year - 1;
  }

  function periodContaining(date, start) {
    const y = date instanceof Date ? date.getFullYear() : date.y;
    const mo = date instanceof Date ? date.getMonth() + 1 : date.m;
    return periodStarting(startYearOf(y, mo, start), start);
  }

  /** "Mar–Feb", "Jan–Dec", "Apr–Mar" … */
  function monthsLabel(month) {
    const m = normalizeMonth(month == null ? startMonth() : month);
    const e = m === 1 ? 12 : m - 1;
    return SHORT[m - 1] + '–' + SHORT[e - 1];
  }

  global.AsYearPeriods = {
    DEFAULT_START_MONTH, normalizeMonth, startMonth, periodStarting, periodContaining,
    startYearOf, monthsLabel, monthName: (m) => LONG[normalizeMonth(m) - 1],
  };
})(typeof window !== 'undefined' ? window : globalThis);
