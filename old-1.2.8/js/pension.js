/**
 * 1.2.6-web Pension — a port of Android pay/PensionStatement.kt (Aviva annual statement import,
 * chain check, payment reconciliation, yearly performance), PensionForecast.kt and TaxSavings.kt.
 * Only figures are read from a statement: plan number, names, addresses, scheme and projections
 * are never read or stored. Forecast and tax savings are estimates, not financial advice.
 * Statements use Android's JSON shape: {start, end, opening, paidIn, paidOut, closing, employer?,
 * employee?, growth?, charges?, chargePct?, payments:[{date, amount}], paymentsTotal?, adjusted, printedOpening?}.
 */
(function (global) {
  const C = () => global.AsPayCalc;
  const r2 = (x) => C().round2(x);
  const TOLERANCE = 0.05;
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const dayNum = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;
  const fromNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);
  const addDays = (iso, k) => fromNum(dayNum(iso) + k);
  const iso = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null; };
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const gbp = (x) => '£' + x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MONEY = '£\\s?([\\d,]+\\.\\d{2})';
  const money = (s) => Number(s.replace(/,/g, ''));

  // ——— statement figures ———
  function addsUpBy(s) { return s.growth == null || s.charges == null ? null : r2(s.opening + s.paidIn - s.paidOut + s.growth - s.charges - s.closing); }
  function addsUp(s) { const b = addsUpBy(s); return b != null && Math.abs(b) <= TOLERANCE; }
  function returnPct(s) { const base = s.opening + (s.paidIn - s.paidOut) / 2; return base > 0.005 ? (s.closing - s.opening - s.paidIn + s.paidOut) / base * 100 : null; }

  // ——— Aviva parser ———
  const norm = (t) => String(t).replace(/\u00A0/g, ' ').replace(/\t/g, ' ').replace(/\r/g, '');
  const isAviva = (t) => { const n = norm(t); return n.includes('Aviva') && n.includes('Statement for'); };
  function longDate(s) {
    const m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(s.trim().replace(/\s+/g, ' '));
    if (!m) return null;
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    return mi < 0 ? null : iso(Number(m[3]), mi + 1, Number(m[1]));
  }
  function shortDate(s) { const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s); return m ? iso(2000 + Number(m[3]), Number(m[2]), Number(m[1])) : null; }

  function chargeTable(t) {
    const rows = [];
    for (const m of t.matchAll(/Charges from (\d{2}\/\d{2}\/\d{2}) to (\d{2}\/\d{2}\/\d{2})\s+([\d.]+)/g)) {
      const a = shortDate(m[1]), b = shortDate(m[2]);
      if (a && b) rows.push([daysBetween(a, b) + 1, Number(m[3])]);
    }
    const days = sum(rows, (r) => r[0]);
    return !rows.length || days <= 0 ? null : Math.round(sum(rows, (r) => r[0] * r[1]) / days * 1000) / 1000;
  }
  function payments(t) {
    const at = t.indexOf('Employer Payments');
    if (at < 0) return [[], null];
    const out = [];
    const rowRx = new RegExp('^(\\d{2}/\\d{2}/\\d{2})\\s+[A-Za-z][A-Za-z ]*?\\s+' + MONEY + '$');
    const totRx = new RegExp('^Total\\s+' + MONEY + '$');
    for (const line of t.slice(at).split('\n').slice(1)) {
      const l = line.trim();
      const m = rowRx.exec(l);
      if (m) { const d = shortDate(m[1]); if (d) out.push({ date: d, amount: money(m[2]) }); }
      const tm = totRx.exec(l);
      if (tm) return [out, money(tm[1])];
    }
    return [out, null];
  }

  /** Statement text → {statement|null, warnings}. */
  function parse(raw) {
    const t = norm(raw);
    const warn = [];
    if (!isAviva(t)) return { statement: null, warnings: ['Not an Aviva annual statement'] };
    const period = /Statement for\s+(\d{1,2} [A-Za-z]+ \d{4})\s+to\s+(\d{1,2} [A-Za-z]+ \d{4})/.exec(t);
    const start = period && longDate(period[1]), end = period && longDate(period[2]);
    if (!start || !end) return { statement: null, warnings: ["Couldn't read the statement period"] };
    const row = new RegExp('^\\s*' + MONEY + '\\s+' + MONEY + '\\s+' + MONEY + '\\s+' + MONEY + '\\s*$', 'm').exec(t);
    if (!row) return { statement: null, warnings: ["Couldn't read the summary values (opening, paid in, paid out, closing)"] };
    const [opening, paidIn, paidOut, closing] = row.slice(1, 5).map(money);
    const find = (rx) => { const m = new RegExp(rx).exec(t); return m ? money(m[1]) : null; };
    const employer = find('Your employer has added\\s+' + MONEY);
    const employee = /You have not paid any money/.test(t) ? 0 : find('You have paid\\s+' + MONEY);
    const g = new RegExp('gone (up|down) in value by \\(before charges\\)\\s+' + MONEY).exec(t);
    const growth = g ? money(g[2]) * (g[1] === 'down' ? -1 : 1) : null;
    if (growth == null) warn.push("Couldn't read growth");
    let charges = find('Costs and charges have been deducted from your pension plan\\s+' + MONEY);
    if (charges == null) charges = find('Your plan costs and charges were\\s+' + MONEY);
    if (charges == null) warn.push("Couldn't read charges");
    const pm = /Charges taken during the statement period were\s+([\d.]+)%/.exec(t);
    let pct = pm && isFinite(Number(pm[1])) ? Number(pm[1]) : null;
    if (pct == null) pct = chargeTable(t);
    if (pct == null) warn.push("Couldn't read charge %");
    const [pays, total] = payments(t);
    if (!pays.length) warn.push("Couldn't read the employer payments list");
    if (total != null) {
      if (Math.abs(sum(pays, (p) => p.amount) - total) > 0.015) warn.push("Payments list doesn't add up to its total");
      if (Math.abs(total - paidIn) > 0.015) warn.push('Payments total ' + gbp(total) + ' ≠ paid in ' + gbp(paidIn));
    }
    const s = { start, end, opening, paidIn, paidOut, closing, employer, employee, growth, charges, chargePct: pct,
      payments: pays, paymentsTotal: total, adjusted: false, printedOpening: null };
    const by = addsUpBy(s);
    if (by != null && Math.abs(by) > TOLERANCE) warn.push("Doesn't add up by " + gbp(Math.abs(by)));
    return { statement: s, warnings: warn };
  }

  /** Android PaySettingsJson stmtFrom/stmtJson: normalise a stored statement (nulls kept as null). */
  function normalizeStatement(o) {
    const n = (v) => (v == null || !isFinite(v) ? null : Number(v));
    if (!o || !/^\d{4}-\d{2}-\d{2}$/.test(o.start) || !/^\d{4}-\d{2}-\d{2}$/.test(o.end)) return null;
    if ([o.opening, o.paidIn, o.paidOut, o.closing].some((v) => v == null || !isFinite(v))) return null;
    return { start: o.start, end: o.end, opening: +o.opening, paidIn: +o.paidIn, paidOut: +o.paidOut, closing: +o.closing,
      employer: n(o.employer), employee: n(o.employee), growth: n(o.growth), charges: n(o.charges), chargePct: n(o.chargePct),
      payments: (Array.isArray(o.payments) ? o.payments : []).filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && isFinite(p.amount)).map((p) => ({ date: p.date, amount: +p.amount })),
      paymentsTotal: n(o.paymentsTotal), adjusted: !!o.adjusted, printedOpening: n(o.printedOpening) };
  }
  /** Stored form: Android's putOpt drops nulls. */
  function statementJson(s) { const o = {}; for (const [k, v] of Object.entries(s)) if (v != null) o[k] = v; return o; }

  // ——— chain check ———
  function chainCheck(s, prev) {
    if (!prev || Math.abs(s.opening - prev.closing) <= TOLERANCE) return s;
    const growth = r2(s.closing - prev.closing - s.paidIn + s.paidOut + (s.charges || 0));
    return { ...s, opening: prev.closing, growth, adjusted: true, printedOpening: s.printedOpening != null ? s.printedOpening : s.opening };
  }
  function chain(list) {
    const sorted = list.slice().sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
    return sorted.map((s, i) => (i === 0 ? s : chainCheck(s, sorted[i - 1])));
  }
  function previous(all, s) { return all.filter((x) => x.end < s.start).reduce((b, x) => (!b || x.end > b.end ? x : b), null); }

  // ——— reconciliation ———
  const WINDOW_DAYS = 35;
  /** slips: [[payDate, ersPension]]. */
  function reconcile(s, slips) {
    const avail = slips.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const rows = s.payments.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((p) => {
      let m = null;
      for (const x of avail) if (x[0] <= p.date && daysBetween(x[0], p.date) <= WINDOW_DAYS && (!m || x[0] > m[0])) m = x;
      if (m) avail.splice(avail.indexOf(m), 1);
      const diff = m ? r2(p.amount - m[1]) : null;
      return { payment: p, payslipDate: m ? m[0] : null, payslipErs: m ? m[1] : null, diff, ok: diff != null && Math.abs(diff) < 0.005 };
    });
    const lastPay = s.payments.length ? s.payments.map((p) => p.date).sort().pop() : s.end;
    const from = addDays(s.start, -WINDOW_DAYS);
    const until = lastPay < s.end ? lastPay : s.end;
    const notOnStatement = avail.filter((x) => x[1] > 0.005 && x[0] >= from && x[0] < until);
    const avivaTotal = r2(sum(rows, (r) => r.payment.amount));
    const payslipTotal = r2(sum(rows, (r) => r.payslipErs || 0) + sum(notOnStatement, (x) => x[1]));
    const matched = rows.filter((r) => r.ok).length;
    const noPayslip = rows.filter((r) => r.payslipDate == null).length;
    const warnings = [];
    if (noPayslip > 0) warnings.push(noPayslip + ' payment' + (noPayslip === 1 ? '' : 's') + ' with no payslip');
    const diffs = rows.filter((r) => r.payslipDate != null && !r.ok).length;
    if (diffs > 0) warnings.push(diffs + ' payment' + (diffs === 1 ? ' differs' : 's differ') + ' from the payslip');
    if (notOnStatement.length) warnings.push(notOnStatement.length + ' payslip' + (notOnStatement.length === 1 ? '' : 's') + ' not on statement');
    return { rows, notOnStatement, avivaTotal, payslipTotal, difference: r2(avivaTotal - payslipTotal), matched, unmatched: rows.length - matched, noPayslip, warnings };
  }

  // ——— yearly performance by UK tax year (6 Apr – 5 Apr) ———
  const POT_WINDOW_DAYS = 14;
  const taxYearStart = (d) => { const y = Number(d.slice(0, 4)); return d < y + '-04-06' ? y - 1 : y; };
  function years(statements, pots) {
    const acc = new Map();
    const push = (ty, p) => { if (!acc.has(ty)) acc.set(ty, []); acc.get(ty).push(p); };
    for (const s of chain(statements)) {
      const days = daysBetween(s.start, s.end) + 1;
      const growth = s.growth || 0, charges = s.charges || 0;
      const cuts = [s.start];
      for (let y = taxYearStart(s.start) + 1; (y + '-04-06') <= s.end; y++) cuts.push(y + '-04-06');
      const segs = cuts.map((a, i) => [a, i + 1 < cuts.length ? addDays(cuts[i + 1], -1) : s.end]);
      if (segs.length === 1) {
        push(taxYearStart(s.start), { taxYear: taxYearStart(s.start), paidIn: s.paidIn, growth, charges, growthSplit: false, chargesSplit: false, adjusted: s.adjusted });
        continue;
      }
      let openVal = s.opening, prevExact = false;
      segs.forEach(([a, b], i) => {
        const f = (daysBetween(a, b) + 1) / days;
        const paid = r2(s.payments.length ? sum(s.payments.filter((p) => p.date >= a && p.date <= b), (p) => p.amount) : s.paidIn * f);
        const ch = r2(charges * f);
        const last = i === segs.length - 1;
        const boundary = addDays(b, 1);
        let pot = null;
        if (!last) for (const p of pots) {
          const dd = Math.abs(daysBetween(p.date, boundary));
          if (dd <= POT_WINDOW_DAYS && (!pot || dd < Math.abs(daysBetween(pot.date, boundary)))) pot = p;
        }
        const endVal = last ? s.closing : pot ? pot.value : null;
        const exact = endVal != null && (pot != null || prevExact);
        const gr = exact ? r2(endVal - openVal - paid + ch) : r2(growth * f);
        openVal = pot ? pot.value : openVal + paid + gr - ch;
        prevExact = exact;
        const ty = taxYearStart(a);
        push(ty, { taxYear: ty, paidIn: paid, growth: gr, charges: ch, growthSplit: !exact, chargesSplit: true, adjusted: s.adjusted });
      });
    }
    return Array.from(acc.entries()).map(([ty, parts]) => {
      const p = { taxYear: ty, paidIn: r2(sum(parts, (x) => x.paidIn)), growth: r2(sum(parts, (x) => x.growth)), charges: r2(sum(parts, (x) => x.charges)),
        growthSplit: parts.some((x) => x.growthSplit), chargesSplit: parts.some((x) => x.chargesSplit), adjusted: parts.some((x) => x.adjusted) };
      p.net = r2(p.growth - p.charges);
      return p;
    }).sort((a, b) => a.taxYear - b.taxYear);
  }

  // ——— forecast ———
  const FORECAST_DEFAULTS = { name: 'My forecast', sac: 5, retire: 60, draw: 20000, lump: 25, age: 30, pot: 10000, salary: 35000,
    salGrowth: 3, salFromSlips: false, salFixed: 3, spAge: 67, spAmt: 12500, rate: 5, charge: 0.5, infl: 2.5, bandG: 2.5, real: true };
  function normalizeForecast(o) {
    const d = FORECAST_DEFAULTS, out = {};
    for (const k of Object.keys(d)) {
      const v = o ? o[k] : undefined;
      out[k] = typeof d[k] === 'number' ? (v != null && isFinite(v) ? Number(v) : d[k]) : typeof d[k] === 'boolean' ? (typeof v === 'boolean' ? v : d[k]) : (typeof v === 'string' ? v : d[k]);
    }
    out.retire = Math.trunc(out.retire); out.age = Math.trunc(out.age); out.spAge = Math.trunc(out.spAge);
    return out;
  }
  const LSA = 268275, END_AGE = 100, SCENARIOS = [2, 5, 7];
  function forecast(i) {
    const PB = C().PensionBand;
    const BAND_LO = PB.LOWER * 12, BAND_HI = PB.UPPER * 12;
    const g = i.rate / 100 - i.charge / 100;
    const inf = (a) => Math.pow(1 + i.infl / 100, a - i.age);
    const bg = (a) => Math.pow(1 + i.bandG / 100, a - i.age);
    let p = i.pot, s = i.salary, atRet = 0, lump = 0, runsOut = null;
    const rows = [];
    const retire = Math.max(i.retire, i.age);
    for (let a = i.age; a <= END_AGE; a++) {
      const defl = i.real ? inf(a) : 1;
      if (a < retire) {
        const band = Math.max(0, Math.min(s, BAND_HI * bg(a)) - BAND_LO * bg(a));
        p = p * (1 + g) + band * (i.sac / 100 + PB.EMPLOYER_EXTRA_PCT / 100);
        s *= 1 + i.salGrowth / 100;
        rows.push({ age: a, pot: p / defl, statePension: 0, privateIncome: 0 });
        continue;
      }
      if (a === retire) { atRet = p / defl; const l = Math.min(p * i.lump / 100, LSA); lump = l / defl; p -= l; }
      const sp = a >= i.spAge ? i.spAmt * inf(a) : 0;
      const need = Math.max(0, i.draw * inf(a) - sp);
      const before = p * (1 + g);
      const taken = Math.min(before, need);
      if (runsOut == null && taken < need - 0.5) runsOut = a;
      p = before - taken;
      rows.push({ age: a, pot: p / defl, statePension: sp / defl, privateIncome: taken / defl });
    }
    const lastsTo = runsOut == null ? null : runsOut - 1;
    return { rows, potAtRetirement: atRet, lumpSum: lump, lastsTo, headline: lastsTo == null ? 'Funds last beyond 100' : 'Funds last to age ' + lastsTo };
  }

  const MIN_RISE = -10, MAX_RISE = 25, FULL_YEAR_MONTHS = 10;
  const NOT_BASIC = /adjust|sacrifice|bonus|overtime|uplift|arrear|back ?pay|holiday|rate/i;
  const basicOf = (p) => sum(p.earnings.filter((l) => (/basic/i.test(l.label) || l.label.trim().toLowerCase() === 'salary') && !NOT_BASIC.test(l.label)), (l) => l.amount);
  const median = (l) => { const s = l.slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const r1 = (x) => Math.round(x * 10) / 10;
  function basicRates(slips) {
    const by = new Map(), seen = new Set();
    for (const p of slips) { if (seen.has(p.date)) continue; seen.add(p.date); const y = taxYearStart(p.date); if (!by.has(y)) by.set(y, []); by.get(y).push(p); }
    const out = new Map();
    for (const y of Array.from(by.keys()).sort((a, b) => a - b)) {
      const b = by.get(y).map(basicOf).filter((x) => x > 0);
      if (!b.length) continue;
      const m = median(b);
      const normal = b.filter((x) => Math.abs(x / m - 1) <= 0.15);
      if (normal.length >= FULL_YEAR_MONTHS) out.set(y, median(normal) * 12);
    }
    return out;
  }
  function salaryGrowthDetail(slips) {
    const rates = basicRates(slips);
    const e = Array.from(rates.entries());
    const rises = new Map(), flagged = new Map();
    for (let k = 1; k < e.length; k++) {
      if (e[k][0] !== e[k - 1][0] + 1) continue;
      const v = (e[k][1] / e[k - 1][1] - 1) * 100;
      (v >= MIN_RISE && v <= MAX_RISE ? rises : flagged).set(e[k][0], r1(v));
    }
    return { rates, rises, flagged };
  }
  function salaryGrowth(slips) {
    const r = Array.from(salaryGrowthDetail(slips).rises.values());
    if (!r.length) return null;
    return [r1(sum(r, (x) => x) / r.length), r1(Math.min(...r)), r1(Math.max(...r))];
  }

  // ——— tax savings (Scottish 2026/27 bands; UK-wide NI and personal allowance) ———
  const TS = (() => {
    const PA = 12570, TAPER_FROM = 100000, PA_GONE = 125140, EMPLOYER_NI = 0.138;
    const BANDS = [['Starter', 3967, 0.19], ['Basic', 16956, 0.20], ['Intermediate', 31092, 0.21], ['Higher', 62430, 0.42], ['Advanced', 125140, 0.45], ['Top', Infinity, 0.48]];
    const ZONES = [
      { id: 'NONE', label: 'No tax', short: '0%', taxRate: 0, grossFrom: 0 },
      { id: 'STARTER', label: 'Starter', short: '19%', taxRate: 0.19, grossFrom: PA },
      { id: 'BASIC', label: 'Basic', short: '20%', taxRate: 0.20, grossFrom: PA + 3967 },
      { id: 'INTERMEDIATE', label: 'Intermediate', short: '21%', taxRate: 0.21, grossFrom: PA + 16956 },
      { id: 'HIGHER', label: 'Higher', short: '42%', taxRate: 0.42, grossFrom: PA + 31092 },
      { id: 'ADVANCED', label: 'Advanced', short: '45%', taxRate: 0.45, grossFrom: PA + 62430 },
      { id: 'TAPER', label: 'Advanced + PA taper', short: '67.5%', taxRate: 0.675, grossFrom: TAPER_FROM },
      { id: 'TOP', label: 'Top', short: '48%', taxRate: 0.48, grossFrom: PA_GONE },
    ];
    const ni = () => C().forYear(2026);
    const niLower = () => ni().niPrimaryMonthly * 12, niUpper = () => ni().niUpperMonthly * 12;
    const personalAllowance = (ani) => Math.max(0, PA - Math.max(0, ani - TAPER_FROM) / 2);
    function incomeTax(income) {
      const taxable = Math.max(0, income - personalAllowance(income));
      let lower = 0, tax = 0;
      for (const [, upTo, rate] of BANDS) { tax += Math.max(0, Math.min(taxable, upTo) - lower) * rate; lower = upTo; }
      return tax;
    }
    const employeeNi = (n) => Math.max(0, Math.min(n, niUpper()) - niLower()) * ni().niMainRate + Math.max(0, n - niUpper()) * ni().niUpperRate;
    const contribution = (salary, pct) => C().PensionBand.contribution(salary / 12, pct) * 12;
    const bandAnnual = (salary) => C().PensionBand.band(salary / 12) * 12;
    function at(salary, pct) {
      const c = contribution(salary, pct), inc = salary - c, tax = incomeTax(inc), n = employeeNi(inc);
      return { pct, contribution: c, income: inc, tax, ni: n, takeHome: inc - tax - n, taxAndNi: tax + n };
    }
    function zone(income) { let z = ZONES[0]; for (const x of ZONES) if (income > x.grossFrom || x.id === 'NONE') z = x; return z; }
    const niRate = (income) => (income <= niLower() ? 0 : income <= niUpper() ? ni().niMainRate : ni().niUpperRate);
    const costPerPound = (income) => { const top = income - 0.005; return 1 - zone(top).taxRate - niRate(top); };
    function pctToReach(salary, level) {
      if (salary <= level) return null;
      const band = bandAnnual(salary); if (band <= 0) return null;
      const p = (salary - level) / band * 100;
      return p <= 100 ? Math.ceil(p * 10 - 1e-9) / 10 : null;
    }
    function pctExact(salary, level) { const band = bandAnnual(salary); return salary <= level || band <= 0 ? null : (salary - level) / band * 100; }
    const thresholds = (salary) => [['£125,140', PA_GONE], ['£100k', TAPER_FROM], ['£75,000', PA + 62430], ['£43,662', PA + 31092]]
      .map(([label, income]) => { const pct = pctToReach(salary, income); return pct == null ? null : { label, income, pct }; }).filter(Boolean);
    function sliderMax(salary) {
      const t = thresholds(salary); if (!t.length) return 15;
      const first = Math.min(...t.map((x) => x.pct));
      return Math.min(100, Math.max(15, Math.ceil((first + 3) / 5) * 5));
    }
    function zones(salary, maxPct) {
      const cuts = [0, maxPct].concat(ZONES.slice(1).map((z) => pctExact(salary, z.grossFrom)).filter((p) => p != null && p > 0 && p < maxPct)).sort((a, b) => a - b);
      const out = [];
      for (let k = 1; k < cuts.length; k++) {
        const z = zone(at(salary, (cuts[k - 1] + cuts[k]) / 2).income);
        if (out.length && out[out.length - 1].zone === z) out[out.length - 1].toPct = cuts[k];
        else out.push({ zone: z, fromPct: cuts[k - 1], toPct: cuts[k] });
      }
      return out;
    }
    function summary(salary, pct, employerNiOn) {
      const z = at(salary, 0), p = at(salary, pct), cost = z.takeHome - p.takeHome;
      return { contribution: p.contribution, cost, saved: p.contribution - cost, intoPension: p.contribution * (1 + (employerNiOn ? EMPLOYER_NI : 0)) };
    }
    return { TAX_YEAR: '2026/27', PA, TAPER_FROM, PA_GONE, EMPLOYER_NI, BANDS, ZONES, INTERMEDIATE_FROM: PA + 16956, HIGHER_FROM: PA + 31092, ADVANCED_FROM: PA + 62430,
      niLower, niUpper, personalAllowance, incomeTax, employeeNi, contribution, bandAnnual, at, zone, niRate, costPerPound, pctToReach, thresholds, sliderMax, zones, summary };
  })();

  global.AsPension = {
    TOLERANCE, addsUpBy, addsUp, returnPct, isAviva, parse, normalizeStatement, statementJson, chainCheck, chain, previous,
    WINDOW_DAYS, reconcile, POT_WINDOW_DAYS, taxYearStart, years,
    FORECAST_DEFAULTS, normalizeForecast, LSA, END_AGE, SCENARIOS, forecast, MIN_RISE, MAX_RISE, FULL_YEAR_MONTHS, basicRates, salaryGrowthDetail, salaryGrowth,
    TaxSavings: TS, gbp, daysBetween, addDays,
  };
})(typeof window !== 'undefined' ? window : globalThis);
