/* AS Forms web 1.2.9-web: shared display formatting (DESIGN.md "Formatting"). Pure functions, no DOM.
 * Human dates ("Mon 28 Sep", "Mon 28 Sep – Fri 2 Oct"), plurals ("4 lines"), trimmed pounds in summaries
 * ("£26,800"), capped growth percentages ("+n/a" when there was ~nothing to grow from). */
(function (global) {
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** 'YYYY-MM-DD' (or Date) → Date at local noon, or null. */
  function toDate(x) {
    if (x instanceof Date) return isNaN(x) ? null : x;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
  }
  /** "Mon 28 Sep" (+ " 2026" when withYear). */
  function day(x, withYear) {
    const d = toDate(x); if (!d) return '';
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : '');
  }
  /** "Mon 28 Sep – Fri 2 Oct"; one day → "Mon 28 Sep"; different years → years on both. */
  function range(a, b) {
    const da = toDate(a), db = toDate(b);
    if (!da) return db ? day(db) : '';
    if (!db || da.getTime() === db.getTime()) return day(da);
    const yrs = da.getFullYear() !== db.getFullYear();
    return day(da, yrs) + ' – ' + day(db, yrs);
  }
  /** "October 2026" for (2026, 10). */
  const month = (y, m) => MONTH[Number(m) - 1] + ' ' + y;
  /** "1 line", "4 lines". */
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  /** "£26,800" (whole pounds, summaries and tiles); "−£12" for negatives. */
  const gbp0 = (x) => (x < 0 ? '−' : '') + '£' + Math.round(Math.abs(Number(x) || 0)).toLocaleString('en-GB');
  /** "£57.50" (line items keep pence). */
  const gbp = (x) => (x < 0 ? '−' : '') + '£' + Math.abs(Number(x) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** Money in another currency: "NOK 1,250" (no symbol guessing). */
  const ccy = (code, x) => { const n = Number(x) || 0; const whole = Math.abs(n - Math.round(n)) < 0.005; return String(code || '').toUpperCase() + ' ' + n.toLocaleString('en-GB', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  /** Growth as a percentage of what went in. "+n/a" when contributions are ~0; capped at ±999% ("+999%+"). */
  function growth(gain, base) {
    const b = Number(base) || 0, g = Number(gain) || 0;
    if (Math.abs(b) < 1) return '+n/a';
    const p = g / b * 100;
    if (!isFinite(p)) return '+n/a';
    const sign = p >= 0 ? '+' : '−';
    const a = Math.abs(p);
    if (a > 999) return sign + '999%+';
    return sign + (a >= 10 ? Math.round(a) : Math.round(a * 10) / 10) + '%';
  }
  /** Parse a typed foreign amount: "1 250,00", "1.250,00", "1,250.00", "1250" → 1250. NaN if none. */
  function parseAmount(t) {
    let x = String(t || '').replace(/[^0-9.,]/g, '');
    if (!x) return NaN;
    const lc = x.lastIndexOf(','), ld = x.lastIndexOf('.');
    const dec = Math.max(lc, ld);
    if (dec >= 0 && x.length - dec - 1 === 2) x = x.slice(0, dec).replace(/[.,]/g, '') + '.' + x.slice(dec + 1);
    else x = x.replace(/[.,]/g, '');
    return Number(x);
  }
  /** "NOK 1 250,00" → "NOK 1,250"; text it can't read is returned trimmed as typed. */
  function foreign(text) {
    const t = String(text || '').trim();
    const m = /([A-Za-z]{3})/.exec(t);
    const n = parseAmount(t.replace(/[A-Za-z]{3}/, ''));
    if (!m || !isFinite(n)) return t;
    return ccy(m[1], n);
  }
  const api = { foreign, parseAmount, day, range, month, plural, gbp0, gbp, ccy, growth, toDate, MONTH, MON };
  global.AsFmt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
