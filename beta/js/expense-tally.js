/**
 * Expenses → Completed grouping by Mar–Feb tally year — port of Android util/ExpenseTally.kt.
 * - Claims are placed in the tally year of their period start (Date From).
 * - Category £ totals use each line's own date (undated lines fall back to the claim's
 *   Date From) and the line's £ Total (web: Net + VAT when Total is blank, same as export).
 */
(function (global) {
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const CAT_KEYS = ['TRAVEL', 'FOOD', 'EQUIPMENT', 'TRAINING', 'MISC'];

  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function tallyYearOfDate(dt) {
    return dt.m >= 3 ? dt.y : dt.y - 1;
  }

  function periodStartingMarch(y) {
    if (global.AsOffshoreDays) return global.AsOffshoreDays.periodStartingMarch(y);
    return { startMarchYear: y, label: 'Mar ' + y + ' – Feb ' + (y + 1) };
  }

  function emptyTotals() {
    const t = {};
    CAT_KEYS.forEach((k) => { t[k] = 0; });
    return t;
  }

  function totalsOf(lines) {
    const t = emptyTotals();
    for (const l of lines || []) t[l.category] = (t[l.category] || 0) + (Number(l.total) || 0);
    return t;
  }

  function sumTotals(t) {
    return CAT_KEYS.reduce((s, k) => s + (t[k] || 0), 0);
  }

  /**
   * @param {Array} claims
   * @param {(claim) => {y,m,d}|null} claimStart
   * @param {Array<{claimId, claimLabel, date:{y,m,d}, category, total}>} lines
   * @param {Date} [asOf]
   * @returns {Array<{period, items, totals, total, isCurrent}>}
   */
  function groupByTallyYear(claims, claimStart, lines, asOf) {
    const now = asOf || new Date();
    const currentYear = tallyYearOfDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
    const claimsByYear = {};
    for (const c of claims || []) {
      const dt = claimStart(c) || { y: now.getFullYear(), m: now.getMonth() + 1, d: 1 };
      const y = tallyYearOfDate(dt);
      (claimsByYear[y] = claimsByYear[y] || []).push(c);
    }
    const linesByYear = {};
    for (const l of lines || []) {
      const y = tallyYearOfDate(l.date);
      (linesByYear[y] = linesByYear[y] || []).push(l);
    }
    const years = Array.from(new Set([
      ...Object.keys(claimsByYear).map(Number),
      ...Object.keys(linesByYear).map(Number),
      currentYear,
    ])).sort((a, b) => b - a);
    const out = years.map((y) => {
      const totals = totalsOf(linesByYear[y] || []);
      return {
        period: periodStartingMarch(y),
        items: claimsByYear[y] || [],
        totals,
        total: sumTotals(totals),
        isCurrent: y === currentYear,
      };
    });
    return out.filter((g) => g.isCurrent).concat(out.filter((g) => !g.isCurrent));
  }

  /** Month → claim amounts for one category in one tally year. */
  function breakdown(lines, startMarchYear, category) {
    const inYear = (lines || []).filter((l) => l.category === category && tallyYearOfDate(l.date) === startMarchYear);
    const byMonth = new Map();
    for (const l of inYear) {
      const key = l.date.y * 100 + l.date.m;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(l);
    }
    return Array.from(byMonth.keys()).sort((a, b) => a - b).map((key) => {
      const ls = byMonth.get(key);
      const y = Math.floor(key / 100);
      const m = key % 100;
      const byClaim = new Map();
      for (const l of ls) {
        if (!byClaim.has(l.claimId)) byClaim.set(l.claimId, { label: l.claimLabel, amount: 0 });
        byClaim.get(l.claimId).amount += Number(l.total) || 0;
      }
      return {
        label: MONTH_LONG[m - 1] + ' ' + y,
        amount: ls.reduce((s, l) => s + (Number(l.total) || 0), 0),
        rows: Array.from(byClaim.values()),
      };
    });
  }

  function groupThousands(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** "£123.45", or whole pounds with separators from £1,000 ("£1,235") to fit tiles. */
  function formatTile(amount) {
    const a = Number(amount) || 0;
    if (Math.abs(a) >= 1000) {
      const r = Math.round(a);
      return (r < 0 ? '-£' : '£') + groupThousands(String(Math.abs(r)));
    }
    return '£' + a.toFixed(2);
  }

  function formatMoney(amount) {
    const a = Number(amount) || 0;
    const fixed = Math.abs(a).toFixed(2);
    const parts = fixed.split('.');
    return (a < 0 ? '-£' : '£') + groupThousands(parts[0]) + '.' + parts[1];
  }

  global.AsExpenseTally = {
    CAT_KEYS,
    parseIso,
    tallyYearOfDate,
    groupByTallyYear,
    totalsOf,
    sumTotals,
    breakdown,
    formatTile,
    formatMoney,
  };
})(typeof window !== 'undefined' ? window : globalThis);
