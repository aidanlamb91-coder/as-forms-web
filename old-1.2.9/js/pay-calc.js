/**
 * 1.2.6-web Pay estimate — a port of Android pay/PayEstimate.kt + PaySettingsJson.kt (Android 1.2.6).
 *
 * In plain English: the timesheet for work month M shows the payslip paid at the end of month M+1 =
 * basic salary for M+1 + the offshore days worked in M, after salary-sacrifice pension, Scottish PAYE
 * (cumulative), Class 1 NI, student loan and fixed deductions. Season = 1 Mar – end Feb by date worked;
 * days over 150 in a season are paid at 2x.
 *
 * Pay settings are kept in exactly Android's JSON shape (dates as "YYYY-MM-DD"), so the same object
 * goes into the backup zip ("prefs.pay") and either app can restore the other's backup.
 * Bank and NI numbers are never part of this.
 */
(function (global) {
  const INF = Infinity;
  const LOAN_PLANS = [
    ['NONE', 'None'], ['PLAN_1', 'Plan 1'], ['PLAN_2', 'Plan 2'], ['PLAN_4', 'Plan 4'], ['PLAN_5', 'Plan 5'], ['POSTGRAD', 'Postgraduate'],
  ];
  const loanLabel = (p) => (LOAN_PLANS.find((x) => x[0] === p) || LOAN_PLANS[0])[1];
  const loanRate = (p) => (p === 'POSTGRAD' ? 0.06 : 0.09);

  /** UPDATE EACH APRIL (same as Android PayTables). Scottish bands = annual widths ABOVE the personal allowance. */
  const YEARS = {
    2025: {
      bands: [[2827, .19], [12094, .20], [16171, .21], [31338, .42], [62710, .45], [INF, .48]],
      niPrimaryMonthly: 1048, niUpperMonthly: 4189, niMainRate: .08, niUpperRate: .02,
      loanAnnual: { PLAN_1: 26065, PLAN_2: 28470, PLAN_4: 32745, PLAN_5: 25000, POSTGRAD: 21000 },
    },
    2026: {
      bands: [[3967, .19], [12989, .20], [14136, .21], [31338, .42], [62710, .45], [INF, .48]],
      niPrimaryMonthly: 1048, niUpperMonthly: 4189, niMainRate: .08, niUpperRate: .02,
      loanAnnual: { PLAN_1: 26900, PLAN_2: 29385, PLAN_4: 33795, PLAN_5: 25000, POSTGRAD: 21000 },
    },
  };
  function forYear(y) {
    if (YEARS[y]) return YEARS[y];
    const ks = Object.keys(YEARS).map(Number).sort((a, b) => a - b);
    const le = ks.filter((k) => k <= y);
    return YEARS[le.length ? le[le.length - 1] : ks[0]];
  }

  // ——— money rounding (as Kotlin BigDecimal.valueOf(x).setScale(2, …)) ———
  function round2(x) {
    const s = Math.sign(x) || 1;
    return (s * Math.round(Number((Math.abs(x) * 100).toPrecision(15)))) / 100 || 0;
  }
  function down2(x) { // RoundingMode.DOWN
    const s = Math.sign(x) || 1;
    return (s * Math.floor(Number((Math.abs(x) * 100).toPrecision(15)))) / 100 || 0;
  }

  // ——— dates: ISO strings "YYYY-MM-DD"; months "YYYY-MM" ———
  const pad = (n) => String(n).padStart(2, '0');
  const ym = (y, m) => { const i = y * 12 + (m - 1); return Math.floor(i / 12) + '-' + pad((i % 12) + 1); };
  const ymParts = (s) => [Number(s.slice(0, 4)), Number(s.slice(5, 7))];
  const ymPlus = (s, n) => { const [y, m] = ymParts(s); return ym(y, m + n); };
  const daysIn = (s) => { const [y, m] = ymParts(s); return new Date(y, m, 0).getDate(); };
  const endOf = (s) => s + '-' + pad(daysIn(s));
  const ymOf = (d) => d.slice(0, 7);
  const isoDate = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const todayIso = () => { const n = new Date(); return isoDate(n.getFullYear(), n.getMonth() + 1, n.getDate()); };

  function taxYearStart(payMonth) { const [y, m] = ymParts(payMonth); return m >= 4 ? y : y - 1; }
  function period(payMonth) { const m = ymParts(payMonth)[1]; return ((m + 8) % 12) + 1; }
  function seasonStart(d) { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return isoDate(m >= 3 ? y : y - 1, 3, 1); }

  // ——— tax codes ———
  const DEFAULT_CODE = 'S1257L';
  /** {kind:'cum', number, nonCumulative} | {kind:'flat', bandIndex} | {kind:'nt'} | null */
  function parseCode(raw) {
    let s = String(raw || '').trim().toUpperCase().replace(/ /g, '');
    const emergency = ['W1', 'M1', 'X'].find((e) => s.endsWith(e) && s.length > e.length);
    if (emergency) s = s.slice(0, -emergency.length);
    if (s.startsWith('S') || s.startsWith('C')) s = s.slice(1);
    let p = null;
    if (s === 'NT') p = { kind: 'nt' };
    else if (s === 'BR') p = { kind: 'flat', bandIndex: 1 };
    else if (s === '0T') p = { kind: 'cum', number: 0, nonCumulative: false };
    else if (/^D[0-3]$/.test(s)) p = { kind: 'flat', bandIndex: 2 + Number(s[1]) };
    else if (/^K\d+$/.test(s)) p = { kind: 'cum', number: -Number(s.slice(1)), nonCumulative: false };
    else if (/^\d+[LMNT]$/.test(s)) p = { kind: 'cum', number: Number(s.slice(0, -1)), nonCumulative: false };
    if (emergency && p && p.kind === 'cum') p.nonCumulative = true;
    return p;
  }

  function taxToDate(tys, code, per, taxableYtd) {
    const bands = forYear(tys).bands;
    if (code.kind === 'nt') return 0;
    if (code.kind === 'flat') return round2(Math.floor(Math.max(0, taxableYtd)) * bands[Math.min(code.bandIndex, bands.length - 1)][1]);
    const sign = code.number < 0 ? -1 : 1;
    const freePay = sign * Math.ceil(Number(((Math.abs(code.number) * 10 + 9) * per / 12 * 100).toPrecision(15))) / 100;
    const taxablePounds = Math.floor(Math.max(0, taxableYtd - freePay));
    let tax = 0, lo = 0;
    for (const [width, rate] of bands) {
      const hi = width === INF ? INF : lo + Math.ceil(Number((width * per / 12).toPrecision(15)));
      tax += Math.max(0, Math.min(taxablePounds, hi) - lo) * rate;
      lo = hi;
      if (taxablePounds <= lo) break;
    }
    return round2(tax);
  }

  function ni(tys, niable) {
    const t = forYear(tys);
    return round2(Math.max(0, Math.min(niable, t.niUpperMonthly) - t.niPrimaryMonthly) * t.niMainRate +
      Math.max(0, niable - t.niUpperMonthly) * t.niUpperRate);
  }

  function studentLoan(tys, plan, niable) {
    const annual = forYear(tys).loanAnnual[plan];
    if (annual == null) return 0;
    return Math.floor(Number((Math.max(0, niable - annual / 12) * loanRate(plan)).toPrecision(12)));
  }

  function deductions(tys, per, taxCode, niable, prevTaxableYtd, prevTaxYtd, plan) {
    const code = parseCode(taxCode) || parseCode(DEFAULT_CODE);
    let tax = code.kind === 'cum' && code.nonCumulative
      ? taxToDate(tys, code, 1, niable)
      : round2(taxToDate(tys, code, per, prevTaxableYtd + niable) - prevTaxYtd);
    if (code.kind === 'cum' && code.number < 0) tax = Math.min(tax, round2(niable * 0.5));
    return { tax, ni: ni(tys, niable), studentLoan: studentLoan(tys, plan, niable) };
  }

  // ——— qualifying-earnings pension band ———
  const PensionBand = {
    LOWER: 520, UPPER: 4189.17, EMPLOYER_EXTRA_PCT: 7.5,
    band(gross) { return Math.min(Math.max(gross, this.LOWER), this.UPPER) - this.LOWER; },
    contribution(gross, pct) { return down2(this.band(gross) * pct / 100); },
    cap(pct) { return this.contribution(this.UPPER, pct); },
    employer(gross, emp) { return emp <= 0 ? 0 : round2(emp + this.contribution(gross, this.EMPLOYER_EXTRA_PCT)); },
  };

  // ——— settings ———
  function defaults() {
    return { dayRate: 0, annualSalary: 0, pensionPct: 7.5, pensionRates: [], loanPlan: 'NONE', taxCodes: [], fixed: [], rises: [],
      ytd: null, pensionValue: null, pensionValueDate: null, insightsOrder: [], potValues: [], statements: [], healthcare: [], forecasts: [] };
  }
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (v != null && v !== '' && isFinite(Number(v)) ? Number(v) : d));
  const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const arr = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);

  /** Android PaySettingsJson.fromJson: anything missing or bad → defaults (bad rows dropped). */
  function normalize(o) {
    const d = defaults();
    if (!o || typeof o !== 'object') return d;
    const loan = LOAN_PLANS.some((p) => p[0] === o.loanPlan) ? o.loanPlan : 'NONE';
    const ytd = o.ytd && typeof o.ytd === 'object' && isFinite(o.ytd.year) && isFinite(o.ytd.period)
      ? { year: Number(o.ytd.year), period: Number(o.ytd.period), taxable: num(o.ytd.taxable, 0), tax: num(o.ytd.tax, 0) } : null;
    return {
      dayRate: num(o.dayRate, d.dayRate), annualSalary: num(o.annualSalary, d.annualSalary), pensionPct: num(o.pensionPct, d.pensionPct),
      pensionRates: arr(o.pensionRates).filter((r) => isIso(r.from)).map((r) => ({ from: r.from, pct: num(r.pct, 0) })),
      loanPlan: loan,
      taxCodes: arr(o.taxCodes).filter((r) => isIso(r.from) && typeof r.code === 'string').map((r) => ({ from: r.from, code: r.code })),
      fixed: arr(o.fixed).filter((r) => typeof r.name === 'string').map((r) => (isIso(r.from) ? { name: r.name, monthly: num(r.monthly, 0), from: r.from } : { name: r.name, monthly: num(r.monthly, 0) })),
      rises: arr(o.rises).filter((r) => isIso(r.date)).map((r) => ({ date: r.date, salary: num(r.salary, 0), dayRate: num(r.dayRate, 0) })),
      ytd,
      pensionValue: o.pensionValue != null && isFinite(o.pensionValue) ? Number(o.pensionValue) : null,
      pensionValueDate: isIso(o.pensionValueDate) ? o.pensionValueDate : null,
      insightsOrder: Array.isArray(o.insightsOrder) ? o.insightsOrder.filter((x) => typeof x === 'string') : [],
      potValues: arr(o.potValues).filter((r) => isIso(r.date) && isFinite(r.value)).map((r) => ({ date: r.date, value: Number(r.value), source: r.source || 'Manual' })),
      statements: arr(o.statements).filter((r) => isIso(r.start) && isIso(r.end)),
      healthcare: arr(o.healthcare).filter((r) => isIso(r.from)).map((r) => ({ from: r.from, monthly: num(r.monthly, 0) })),
      forecasts: arr(o.forecasts),
    };
  }
  /** Android PaySettingsJson.toJson (optional parts left out when empty, as Android does). */
  function toJson(s0) {
    const s = normalize(s0);
    const o = { dayRate: s.dayRate, annualSalary: s.annualSalary, pensionPct: s.pensionPct, pensionRates: s.pensionRates, loanPlan: s.loanPlan,
      taxCodes: s.taxCodes, fixed: s.fixed, rises: s.rises };
    if (s.pensionValue != null && s.pensionValueDate) { o.pensionValue = s.pensionValue; o.pensionValueDate = s.pensionValueDate; }
    if (s.potValues.length) o.potValues = s.potValues;
    if (s.statements.length) o.statements = s.statements;
    if (s.healthcare.length) o.healthcare = s.healthcare;
    if (s.forecasts.length) o.forecasts = s.forecasts;
    if (s.insightsOrder.length) o.insightsOrder = s.insightsOrder;
    if (s.ytd) o.ytd = s.ytd;
    return o;
  }

  const latestBy = (list, key, pred) => list.filter(pred || (() => true)).reduce((b, x) => (!b || x[key] > b[key] ? x : b), null);
  function pensionPctFor(s, payMonth) { const r = latestBy(s.pensionRates, 'from', (x) => x.from <= endOf(payMonth)); return r ? r.pct : s.pensionPct; }
  function currentPensionPct(s) { const r = latestBy(s.pensionRates, 'from'); return r ? r.pct : s.pensionPct; }
  function currentTaxCode(s) { const r = latestBy(s.taxCodes, 'from'); return r ? r.code : DEFAULT_CODE; }
  function pensionStart(s) {
    const p = latestBy(s.potValues, 'date');
    if (p) return { value: p.value, date: p.date };
    return s.pensionValue != null && s.pensionValueDate ? { value: s.pensionValue, date: s.pensionValueDate } : null;
  }
  function salaryFor(s, payMonth) { const r = latestBy(s.rises, 'date', (x) => x.date <= endOf(payMonth)); return r ? r.salary : s.annualSalary; }
  function dayRateOn(s, d) { const r = latestBy(s.rises, 'date', (x) => x.date <= d); return r ? r.dayRate : s.dayRate; }
  /** "Configured" = rates entered (Android: dayRate > 0 || annualSalary > 0). */
  function configured(s) { return s.dayRate > 0 || s.annualSalary > 0; }

  const SEASON_DOUBLE_AFTER = 150;

  function computePeriod(input, prevTaxableYtd, prevTaxYtd, seasonDays) {
    const gross = round2(input.basic + input.dayLines.reduce((a, l) => a + l.amount, 0));
    const pension = PensionBand.contribution(gross, input.pensionPct);
    const taxable = round2(gross - pension);
    const d = deductions(input.taxYearStart, input.period, input.taxCode, taxable, prevTaxableYtd, prevTaxYtd, input.loanPlan);
    const fixedTotal = round2(input.fixed.reduce((a, f) => a + f[1], 0));
    let taxableYtd = round2(prevTaxableYtd + taxable);
    let taxYtd = round2(prevTaxYtd + d.tax);
    if (input.override) { taxableYtd = input.override.taxable; taxYtd = input.override.tax; }
    return { input, gross, pension, taxable, tax: d.tax, ni: d.ni, studentLoan: d.studentLoan, fixedTotal,
      net: round2(taxable - d.tax - d.ni - d.studentLoan - fixedTotal), taxableYtd, taxYtd, seasonDays };
  }

  function dayLine(days, rate, doubleRate) {
    const payRate = doubleRate ? rate * 2 : rate;
    return { days, rate, doubleRate, payRate, amount: round2(days * payRate) };
  }

  /** offshoreDates: sorted-or-not array/Set of ISO dates; months: ascending "YYYY-MM". Returns [{input, seasonDays}]. */
  function buildInputs(s, offshoreDates, months) {
    const sorted = Array.from(new Set(offshoreDates)).sort();
    const seasonIndex = new Map();
    let season = null, n = 0;
    for (const d of sorted) {
      const st = seasonStart(d);
      if (st !== season) { season = st; n = 0; }
      seasonIndex.set(d, ++n);
    }
    return months.map((wm) => {
      const payMonth = ymPlus(wm, 1);
      const payEnd = endOf(payMonth);
      const lines = new Map();
      const [y, m] = ymParts(wm);
      for (let day = 1; day <= daysIn(wm); day++) {
        const d = isoDate(y, m, day);
        const idx = seasonIndex.get(d);
        if (idx == null) continue;
        const key = dayRateOn(s, d) + '|' + (idx > SEASON_DOUBLE_AFTER);
        lines.set(key, (lines.get(key) || 0) + 1);
      }
      const inForce = latestBy(s.taxCodes, 'from', (x) => x.from <= payEnd);
      const earliest = s.taxCodes.reduce((b, x) => (!b || x.from < b.from ? x : b), null);
      const code = inForce ? inForce.code : earliest ? earliest.code : DEFAULT_CODE;
      const byName = new Map();
      for (const f of s.fixed.filter((f) => !f.from || f.from <= payEnd)) {
        const cur = byName.get(f.name);
        if (!cur || (f.from || '') > (cur.from || '')) byName.set(f.name, f);
      }
      const fixed = Array.from(byName.values()).map((f) => [f.name, f.monthly]).filter((x) => x[1] !== 0);
      const tys = taxYearStart(payMonth), per = period(payMonth);
      const ov = s.ytd && s.ytd.year === tys && s.ytd.period === per ? s.ytd : null;
      const seasonFrom = seasonStart(endOf(wm));
      const wmEnd = endOf(wm);
      const seasonDays = sorted.filter((d) => d >= seasonFrom && d <= wmEnd).length;
      return {
        input: {
          workMonth: wm, payMonth, taxYearStart: tys, period: per,
          basic: round2(salaryFor(s, payMonth) / 12),
          dayLines: Array.from(lines.entries()).map(([k, c]) => { const [r, dbl] = k.split('|'); return dayLine(c, Number(r), dbl === 'true'); }),
          pensionPct: pensionPctFor(s, payMonth), taxCode: code, loanPlan: s.loanPlan, fixed, override: ov,
        },
        seasonDays,
      };
    });
  }

  /** Rebuilds per-period pay from history and caches it (Android PayEngine). Keyed by work month "YYYY-MM". */
  class PayEngine {
    constructor() { this.cache = new Map(); this.lastRecomputed = 0; }
    update(s0, offshoreDates, workMonths) {
      const s = normalize(s0);
      this.lastRecomputed = 0;
      const wms = Array.from(new Set(workMonths)).sort();
      if (!wms.length) { this.cache.clear(); return new Map(); }
      const firstPay = ymPlus(wms[0], 1);
      let wm = taxYearStart(firstPay) + '-03';
      const months = [];
      while (wm <= wms[wms.length - 1]) { months.push(wm); wm = ymPlus(wm, 1); }
      const out = new Map();
      let prev = null, dirty = false;
      for (const { input, seasonDays } of buildInputs(s, offshoreDates, months)) {
        if (input.period === 1) { prev = null; dirty = false; }
        const cached = this.cache.get(input.workMonth);
        let r;
        if (!dirty && cached && JSON.stringify(cached.input) === JSON.stringify(input) && cached.seasonDays === seasonDays) r = cached;
        else {
          dirty = true; this.lastRecomputed++;
          r = computePeriod(input, prev ? prev.taxableYtd : 0, prev ? prev.taxYtd : 0, seasonDays);
        }
        out.set(input.workMonth, r);
        prev = r;
      }
      this.cache = new Map(out);
      return out;
    }
  }

  /** Every offshore date (ISO) and every work month across all timesheets (Android TimesheetRepository). */
  function fromTimesheets(timesheets) {
    const dates = new Set(), months = new Set();
    for (const ts of timesheets || []) {
      const wm = ym(ts.year, ts.month);
      months.add(wm);
      const last = daysIn(wm);
      for (const e of ts.entries || []) {
        if (e.dayType !== 'OFFSHORE') continue;
        for (let d = Number(e.startDay); d <= Number(e.endDay); d++) if (d >= 1 && d <= last) dates.add(isoDate(ts.year, ts.month, d));
      }
    }
    return { dates: Array.from(dates), months: Array.from(months) };
  }

  global.AsPayCalc = {
    YEARS, forYear, LOAN_PLANS, loanLabel, loanRate, DEFAULT_CODE, SEASON_DOUBLE_AFTER,
    round2, down2, ym, ymPlus, ymParts, endOf, daysIn, ymOf, isoDate, todayIso,
    taxYearStart, period, seasonStart, parseCode, taxToDate, ni, studentLoan, deductions, PensionBand,
    defaults, normalize, toJson, pensionPctFor, currentPensionPct, currentTaxCode, pensionStart, salaryFor, dayRateOn, configured,
    computePeriod, buildInputs, PayEngine, fromTimesheets, dayLine,
  };
})(typeof window !== 'undefined' ? window : globalThis);
