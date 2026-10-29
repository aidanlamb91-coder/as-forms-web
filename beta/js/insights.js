/**
 * 1.2.6-web Insights — a port of Android pay/Insights.kt, InsightsBreakdown.kt and PensionSeries.kt.
 * Tax year = 1 Apr–31 Mar by pay-date month, labelled by its starting year (2026 = 2026/27).
 * Months are PAY months ("YYYY-MM"); the December timesheet is paid in January. A month with a
 * payslip uses only that payslip; otherwise the pay estimate, once its pay day has passed.
 * Dates are ISO strings "YYYY-MM-DD".
 */
(function (global) {
  const C = () => global.AsPayCalc;
  const S = () => global.AsPayslip;
  const PAY_DAY = 25;
  const ymOf = (d) => d.slice(0, 7);
  const ymNum = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const numYm = (n) => Math.floor(n / 12) + '-' + String((n % 12) + 1).padStart(2, '0');
  const plus = (m, k) => numYm(ymNum(m) + k);
  const taxYearOf = (d) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
  const seasonOf = (m) => (Number(m.slice(5, 7)) >= 3 ? Number(m.slice(0, 4)) : Number(m.slice(0, 4)) - 1);
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const uniq = (a) => Array.from(new Set(a));

  function paidBy(m, today) {
    if (!today) return true;
    const d = C().isoDate(Number(m.slice(0, 4)), Number(m.slice(5, 7)), Math.min(PAY_DAY, C().daysIn(m)));
    return d <= today;
  }

  /** EstimatePoint from a PayCalc period result. */
  function estimatePoint(r) {
    const gross = r.gross;
    return { payMonth: r.input.payMonth, gross, takeHome: r.net, tax: r.tax,
      offshoreDays: sum(r.input.dayLines, (l) => l.days), basic: r.input.basic, offshore: sum(r.input.dayLines, (l) => l.amount),
      pension: r.pension, employerPension: C().PensionBand.employer(gross, r.pension) };
  }
  function makeEstimate(o) {
    const e = { basic: 0, pension: 0, ...o };
    if (e.offshore == null) e.offshore = e.gross - e.basic;
    if (e.employerPension == null) e.employerPension = C().PensionBand.employer(e.gross, e.pension);
    return e;
  }

  function employerPensionOrEstimate(p) {
    return p.ersPension != null ? p.ersPension : C().PensionBand.employer(S().equalised(p).gross, S().employeePension(p));
  }

  function dedupe(all) {
    const m = new Map(); for (const p of all) m.set(p.date, p);
    return Array.from(m.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  function payslipFor(all, payMonth) { let r = null; for (const p of all) if (ymOf(p.date) === payMonth) r = p; return r; }

  function pointOf(rm) {
    const p = rm.payslip;
    if (p) return { period: p.period, payDate: p.date, gross: S().equalised(p).gross, takeHome: p.net, estimate: false,
      pension: S().employeePension(p), employerPension: employerPensionOrEstimate(p), employerRead: p.ersPension != null };
    const e = rm.estimate;
    return { period: C().period(rm.payMonth), payDate: C().endOf(rm.payMonth), gross: e.gross, takeHome: e.takeHome, estimate: true,
      pension: e.pension, employerPension: e.employerPension, employerRead: false };
  }

  function resolve(payMonth, all, estimates, today) {
    const p = payslipFor(dedupe(all), payMonth);
    const mk = (payslip, estimate) => { const r = { payMonth, workMonth: plus(payMonth, -1), payslip, estimate }; r.point = pointOf(r); return r; };
    if (p) return mk(p, null);
    let e = null; for (const x of estimates) if (x.payMonth === payMonth) e = x;
    if (!e || !paidBy(payMonth, today)) return null;
    return mk(null, e);
  }

  function taxYears(all, estimates, today) {
    return uniq(all.map((p) => taxYearOf(p.date)).concat((estimates || []).filter((e) => paidBy(e.payMonth, today)).map((e) => taxYearOf(e.payMonth + '-01'))))
      .sort((a, b) => b - a);
  }

  function points(all, estimates, today) {
    const months = uniq(dedupe(all).map((p) => ymOf(p.date)).concat(estimates.map((e) => e.payMonth)));
    return months.map((m) => resolve(m, all, estimates, today)).filter(Boolean).map((r) => r.point)
      .sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0));
  }

  const byMonthGross = (pts) => { const m = new Map(); for (const p of pts) m.set(ymOf(p.payDate), (m.get(ymOf(p.payDate)) || 0) + p.gross); return m; };

  function seasonChange(pts, ref) {
    const start = seasonOf(ref) + '-03';
    const n = ymNum(ref) - ymNum(start) + 1;
    const bm = byMonthGross(pts);
    const win = Array.from({ length: n }, (_, i) => plus(start, i));
    const cur = sum(win, (m) => bm.get(m) || 0);
    const last = win.map((m) => plus(m, -12));
    if (last.some((m) => !bm.has(m))) return [null, n];
    const l = sum(last, (m) => bm.get(m));
    return [l > 0 ? (cur - l) / l * 100 : null, n];
  }

  function yearChange(pts, year) {
    const bm = byMonthGross(pts);
    const months = Array.from(bm.keys()).filter((m) => taxYearOf(m + '-01') === year);
    if (!months.length) return [null, 0];
    const last = months.map((m) => plus(m, -12));
    if (last.some((m) => !bm.has(m))) return [null, months.length];
    const a = sum(months, (m) => bm.get(m)), b = sum(last, (m) => bm.get(m));
    return [b > 0 ? (a - b) / b * 100 : null, months.length];
  }

  const paidIn = (p) => p.employerPension;

  /** start: {value, date} or null. */
  function pensionPoints(pts, year, start) {
    const end = (year + 1) + '-04-05';
    const joinedP = pts.filter((p) => !p.estimate && p.pension > 0.005).map((p) => p.payDate).sort()[0];
    return pts.filter((p) => p.payDate <= end && (start ? p.payDate > start.date
      : (!p.estimate || (joinedP != null && p.payDate >= joinedP.slice(0, 8) + '01'))));
  }
  function totalPension(pts, year, start) {
    return C().round2((start ? start.value : 0) + sum(pensionPoints(pts, year, start), paidIn));
  }

  const yearLabel = (y) => y + '/' + String((y + 1) % 100).padStart(2, '0');
  const bySeries = (a, b) => a.period - b.period;

  function summarise(all, taxYear, estimates, today, pensionStart) {
    estimates = estimates || [];
    const slips = dedupe(all);
    const pts = points(slips, estimates, today);
    let year = taxYear;
    if (year == null) { if (!pts.length) return null; year = Math.max(...pts.map((p) => taxYearOf(p.payDate))); }
    const curPts = pts.filter((p) => taxYearOf(p.payDate) === year);
    if (!curPts.length) return null;
    const cur = slips.filter((p) => taxYearOf(p.date) === year);
    const curMonths = new Set(curPts.map((p) => ymOf(p.payDate)));
    const seen = new Set();
    const est = estimates.filter((e) => taxYearOf(e.payMonth + '-01') === year && curMonths.has(e.payMonth) &&
      curPts.some((p) => p.estimate && ymOf(p.payDate) === e.payMonth)).filter((e) => !seen.has(e.payMonth) && seen.add(e.payMonth));
    const eq = cur.map((p) => S().equalised(p));
    const cap = today ? ymOf(today) : null;
    const refs = curPts.map((p) => ymOf(p.payDate)).filter((m) => cap == null || m <= cap).sort();
    const ref = refs[refs.length - 1] || null;
    const finished = cap != null && cap > (year + 1) + '-03';
    const [change, n] = finished ? yearChange(pts, year) : ref ? seasonChange(pts, ref) : [null, 0];
    const s = (n === 1 ? '' : 's');
    const label = change == null ? null : finished && n === 12 ? 'vs ' + yearLabel(year - 1)
      : finished ? 'vs same ' + n + ' month' + s + ' of ' + yearLabel(year - 1) : 'vs first ' + n + ' month' + s + ' of last season';
    return {
      taxYear: year, payslips: cur.length, estimatedMonths: est.length,
      grossYtd: sum(curPts, (p) => p.gross), grossChangePct: change, seasonMonths: n, changeLabel: label,
      takeHome: sum(curPts, (p) => p.takeHome),
      tax: sum(eq, (e) => e.tax) + sum(est, (e) => e.tax), ukTax: sum(eq, (e) => e.ukTax), foreignTax: sum(eq, (e) => e.foreignTax),
      estimatedTax: sum(est, (e) => e.tax), bonus: sum(eq, (e) => e.bonus),
      offshoreDays: sum(eq, (e) => e.offshoreDays) + sum(est, (e) => e.offshoreDays),
      breakdown: [
        { label: 'Basic', amount: sum(eq, (e) => e.basic + e.unread) + sum(est, (e) => e.basic) },
        { label: 'Offshore', amount: sum(eq, (e) => e.offshore) + sum(est, (e) => e.offshore) },
        { label: 'Bonus', amount: sum(eq, (e) => e.bonus) },
        { label: 'Holiday', amount: sum(eq, (e) => e.holiday) },
      ].filter((x) => x.amount > 0.005),
      pension: sum(curPts, (p) => p.pension), employerPension: sum(curPts, (p) => p.employerPension),
      totalPension: totalPension(pts, year, pensionStart),
      bonusMonths: uniq(cur.filter((p) => S().equalised(p).bonus > 0.005).map((p) => ymOf(p.date))).sort(),
      months: curPts.slice().sort(bySeries),
      lastYearMonths: pts.filter((p) => taxYearOf(p.payDate) === year - 1).sort(bySeries),
    };
  }

  // ——— InsightsBreakdown ———
  const PENSION_NOTE = 'Adds contributions only. It excludes investment growth or losses, so update the starting value in Settings › Pay to match your pot.';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function breakdown(card, all, estimates, year, today, pensionStart) {
    const r2 = C().round2;
    const slips = dedupe(all);
    const months = uniq(slips.map((p) => ymOf(p.date)).concat(estimates.map((e) => e.payMonth))).sort();
    const resolved = months.map((m) => resolve(m, slips, estimates, today)).filter(Boolean);
    const inYear = resolved.filter((r) => taxYearOf(r.payMonth + '-01') === year);
    const row = (r, value, parts, note) => {
      const e = r.payslip ? S().equalised(r.payslip) : null;
      const p = r.point;
      return { payMonth: r.payMonth, payDate: r.payslip ? r.payslip.date : null, estimate: !r.payslip, value: r2(value(e, r.estimate, p)),
        parts: parts ? parts(e, r.estimate, p) : [], note: note ? note(r) : null };
    };
    const nz = (l) => l.filter((x) => Math.abs(x[1]) > 0.005);
    const tot = (rows) => r2(sum(rows, (x) => x.value));
    const mk = (title, rows, extra) => ({ card, title, total: tot(rows), rows, start: null, notes: [], count: false, ...extra });
    switch (card) {
      case 'gross': return mk('YTD gross', inYear.map((r) => row(r, (e, s, p) => p.gross, (e, est) => (e
        ? nz([['Basic', e.basic + e.unread], ['Offshore', e.offshore], ['Bonus', e.bonus], ['Holiday', e.holiday]])
        : nz([['Basic', est.basic], ['Offshore', est.offshore]])))));
      case 'takehome': return mk('Take home', inYear.map((r) => row(r, (e, s, p) => p.takeHome, (e, s, p) => [['Gross', p.gross]])));
      case 'tax': return mk('Tax', inYear.map((r) => row(r, (e, est) => (e ? e.tax : est.tax),
        (e) => (e ? [['UK', e.ukTax], ['Non UK', e.foreignTax]] : []), (x) => (x.payslip ? null : 'Estimate: not split into UK / Non UK'))));
      case 'bonus': return mk('Bonus', inYear.filter((r) => r.payslip && S().equalised(r.payslip).bonus > 0.005).map((r) => row(r, (e) => e.bonus)),
        { notes: ['Bonus comes from payslips only; the pay estimate has no bonus.'] });
      case 'offshore': {
        const rows = inYear.map((r) => row(r, (e, est) => (e ? e.offshoreDays : est.offshoreDays), null,
          (x) => 'Period ' + C().period(x.payMonth) + ' · days worked in ' + MON[Number(x.workMonth.slice(5, 7)) - 1] + ' ' + x.workMonth.slice(0, 4)));
        return mk('Offshore days', rows, { total: sum(rows, (x) => x.value), count: true });
      }
      case 'employer': return mk('Employer pension', inYear.map((r) => row(r, (e, s, p) => p.employerPension, (e, s, p) => [['incl. your sacrifice', p.pension]],
        (x) => (x.point.employerRead ? 'From payslip (Ers Pension)' : x.point.pension <= 0.005 ? 'No sacrifice: not in the scheme' : 'Estimated: your sacrifice + 7.5% of the band'))));
      case 'pension': {
        const pts = resolved.map((r) => r.point);
        const keep = new Set(pensionPoints(pts, year, pensionStart).map((p) => p.payDate));
        const rows = resolved.filter((r) => keep.has(r.point.payDate)).map((r) => row(r, (e, s, p) => paidIn(p),
          (e, s, p) => [['Your sacrifice', p.pension], ['Employer adds', r2(p.employerPension - p.pension)]]));
        return mk('Total pension', rows, { total: totalPension(pts, year, pensionStart), start: pensionStart || null,
          notes: ['Each month counts the employer payment once; it already includes your salary sacrifice.', PENSION_NOTE] });
      }
      default: return mk(card, [], { total: 0 });
    }
  }

  // ——— PensionSeries ———
  function pensionSeries(pts, pots, today) {
    const r2 = C().round2;
    const joined = pts.filter((p) => !p.estimate && p.pension > 0.005).map((p) => p.payDate).sort()[0];
    const months = pts.slice().sort((a, b) => (a.payDate < b.payDate ? -1 : 1)).filter((p) => p.payDate <= today && paidIn(p) > 0.005 &&
      (!p.estimate || (joined != null && p.payDate >= joined.slice(0, 8) + '01')));
    let tot = 0;
    const cum = months.map((p) => { tot = r2(tot + paidIn(p)); return [p.payDate, tot]; });
    const potsF = pots.filter((p) => p.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const paidInBy = (d) => { let v = 0; for (const [x, s] of cum) if (x <= d) v = s; return v; };
    const potOn = (d) => { let v = null; for (const p of potsF) if (p.date <= d) v = p; return v; };
    let growth = null;
    if (potsF.length) {
      const p = potsF[potsF.length - 1];
      const paid = paidInBy(p.date);
      const g = r2(p.value - paid);
      growth = [g, Math.abs(paid) > 0.005 ? g / paid * 100 : null];
    }
    return { paidIn: cum, pots: potsF, paidInBy, potOn, growth };
  }
  function growthLabel(g) {
    const sign = g[0] < 0 ? '−' : '+';
    const money = sign + '£' + Math.abs(g[0]).toLocaleString('en-GB', { maximumFractionDigits: 0 });
    return g[1] == null ? money : money + ' · ' + sign + Math.abs(g[1]).toFixed(1) + '%';
  }

  global.AsInsights = { PAY_DAY, taxYearOf, seasonOf, paidBy, estimatePoint, makeEstimate, employerPensionOrEstimate, dedupe, payslipFor,
    resolve, taxYears, points, seasonChange, yearChange, paidIn, pensionPoints, totalPension, summarise, yearLabel,
    PENSION_NOTE, breakdown, pensionSeries, growthLabel, plusMonths: plus };
})(typeof window !== 'undefined' ? window : globalThis);
