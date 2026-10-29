/**
 * 1.2.6-web Payslips — a port of Android pay/Payslip.kt + PayslipJson.kt (Android 1.2.6).
 * One parsed payslip (Andrews Hydrographics format) and the parser that reads it from PDF text.
 * Only pay figures are kept: names, NI numbers, bank details, addresses and references are never
 * read or stored. A payslip is kept in Android's JSON shape:
 *   { date:"YYYY-MM-DD", period, code, earnings:[{label,amount,ytd,rate?,days?}], deductions:[…],
 *     total, net, taxableYtd?, ersPension? }
 * PDF → text is in js/pay-pdf.js (pdf.js, lines rebuilt by position like PdfBox sortByPosition).
 */
(function (global) {
  const keyOf = (label) => String(label).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const isRefund = (label) => { const k = keyOf(label); return k.startsWith('reimburs') || k.includes('refund'); };
  const sumAmt = (l) => l.reduce((a, x) => a + x.amount, 0);
  const find = (list, key) => list.find((l) => keyOf(l.label) === key);
  const amt = (list, key) => { const f = find(list, key); return f ? f.amount : 0; };

  const CATEGORY = {
    BASIC: { label: 'Basic', earning: true }, OFFSHORE: { label: 'Offshore', earning: true }, BONUS: { label: 'Bonus', earning: true },
    HOLIDAY: { label: 'Holiday pay', earning: true }, REFUND: { label: 'Refund (not in gross)', earning: true },
    PENSION: { label: 'Pension sacrifice', earning: true }, UK_TAX: { label: 'UK tax', earning: false },
    FOREIGN_TAX: { label: 'Foreign tax', earning: false }, NI: { label: 'National Insurance', earning: false },
    STUDENT_LOAN: { label: 'Student loan', earning: false }, OTHER_DEDUCTION: { label: 'Other deduction', earning: false },
  };

  const foreignWords = ['norw', 'mozam', 'foreign', 'overseas', 'abroad', 'international', 'uplift'];
  const dayWords = ['rate', 'day', 'allowance', 'standby', 'travel', 'overtime', 'field', 'shift', 'rota', 'trip', 'sea', 'vessel', 'project'];
  const L = {
    isSalSac: (k) => k.startsWith('salsac') || k.includes('salarysacrifice'),
    isForeignEarning: (k) => !k.includes('tax') && foreignWords.some((w) => k.includes(w)),
    isOffshore: (k) => k.includes('offshore') && !k.includes('bonus') && !k.includes('pens') && !L.isSalSac(k),
    isDayPay: (k) => L.isOffshore(k) || L.isForeignEarning(k) || k.startsWith('salaryadjust') || dayWords.some((w) => k.includes(w)),
    isBasic: (k) => k.startsWith('basic') || k === 'salary' || k.startsWith('monthlysalary') || k.startsWith('wage'),
    isUkTax: (k) => k === 'tax' || k === 'paye' || k === 'incometax' || k === 'payetax',
    isEmployerPaid: (k) => k.startsWith('grossup') || k.includes('paidbyer') || k.includes('paidbyeer') || k.includes('paidbyemployer'),
    isTax: (k) => k.includes('tax') && !L.isEmployerPaid(k) && !k.startsWith('reimburs') && !k.includes('refund') && !k.includes('taxable'),
    isNi: (k) => k.startsWith('nationalins') || k === 'ni' || k === 'ee ni' || k === 'eeni',
    isLoan: (k) => k.startsWith('studentloan') || k.startsWith('postgradloan') || k.startsWith('pgloan'),
    isDeduction: (k) => (!L.isEmployerPaid(k) && L.isTax(k)) || L.isNi(k) || L.isLoan(k) || k.includes('axa') || k.includes('ppp') || k.includes('union'),
    isEarning: (k) => L.isBasic(k) || L.isEmployerPaid(k) || L.isSalSac(k) || k.startsWith('holiday') || L.isDayPay(k) || k.includes('earnings') ||
      k.includes('bonus') || k.startsWith('salaryadjust') || k.startsWith('reimburs') || k.includes('refund'),
  };

  /** Every line read from the payslip with the category Insights put it in: [{line, category, guessed}]. */
  function mappedLines(p) {
    const all = p.earnings.map((l) => [l, true]).concat(p.deductions.map((l) => [l, false]));
    return all.map(([l, side]) => {
      const k = keyOf(l.label);
      const earn = !L.isDeduction(k) && (L.isEarning(k) || side);
      const m = (category, guessed) => ({ line: l, category, guessed: !!guessed });
      if (earn) {
        if (L.isSalSac(k)) return m('PENSION');
        if (isRefund(l.label)) return m('REFUND');
        if (k.startsWith('holiday')) return m('HOLIDAY');
        if (k.includes('bonus')) return m('BONUS');
        if (L.isBasic(k) || L.isEmployerPaid(k)) return m('BASIC');
        if (L.isDayPay(k)) return m('OFFSHORE');
        if (l.days != null || l.rate != null) return m('OFFSHORE', true);
        return m('BASIC', true);
      }
      if (L.isUkTax(k)) return m('UK_TAX');
      if (L.isTax(k)) return m('FOREIGN_TAX');
      if (L.isNi(k)) return m('NI');
      if (L.isLoan(k)) return m('STUDENT_LOAN');
      return m('OTHER_DEDUCTION');
    });
  }

  const gbp = (v) => '£' + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** Android Payslip.equalised(): the four guards and the equalised figures. */
  function equalised(p) {
    const mapped = mappedLines(p);
    const sum = (c) => mapped.filter((x) => x.category === c).reduce((a, x) => a + x.line.amount, 0);
    const days = mapped.filter((x) => x.category === 'OFFSHORE').reduce((a, x) => a + (x.line.days || 0), 0);
    const warnings = [];
    const flagLabels = new Set();
    mapped.filter((x) => x.guessed && x.line.amount !== 0).forEach((x) => {
      warnings.push("Unrecognised line '" + x.line.label + "' " + gbp(x.line.amount) + ' (counted as ' + CATEGORY[x.category].label + ')');
      flagLabels.add(x.line.label);
    });
    const earnSum = mapped.filter((x) => CATEGORY[x.category].earning).reduce((a, x) => a + x.line.amount, 0);
    let unread = 0;
    if (Math.abs(earnSum - p.total) >= 0.015) {
      unread = p.total - earnSum;
      warnings.push("Totals don't add up by " + gbp(unread) + ': earnings lines vs TOTAL (a line couldn\'t be read)');
      flagLabels.add('TOTAL');
    }
    let otherDed = sum('OTHER_DEDUCTION');
    const dedGap = p.total - mapped.filter((x) => !CATEGORY[x.category].earning).reduce((a, x) => a + x.line.amount, 0) - p.net;
    if (Math.abs(dedGap) >= 0.015) {
      otherDed += dedGap;
      warnings.push("Totals don't add up by " + gbp(dedGap) + ': deductions vs TOTAL − NET PAY (a line couldn\'t be read)');
      flagLabels.add('NET PAY');
    }
    const e = {
      basic: sum('BASIC'), offshore: sum('OFFSHORE'), bonus: sum('BONUS'), holiday: sum('HOLIDAY'),
      ukTax: sum('UK_TAX'), foreignTax: sum('FOREIGN_TAX'), ni: sum('NI'), studentLoan: sum('STUDENT_LOAN'),
      pension: -sum('PENSION'), takeHome: p.net, offshoreDays: days, refunds: sum('REFUND'),
      otherDeductions: otherDed, unread, warnings, flagLabels,
    };
    e.gross = e.basic + e.offshore + e.bonus + e.holiday + e.unread;
    e.tax = e.ukTax + e.foreignTax;
    const negativeDeductions = -mapped.filter((x) => !CATEGORY[x.category].earning && x.line.amount < 0).reduce((a, x) => a + x.line.amount, 0);
    if (e.gross + e.refunds + negativeDeductions + 0.5 < p.net) {
      e.warnings = warnings.concat('Net pay is ' + gbp(p.net - e.gross) + ' higher than gross');
      e.flagLabels = new Set([...flagLabels, 'NET PAY']);
    }
    return e;
  }

  // ——— parser ———
  const money = /^-?[\d,]+\.\d{2}$/;
  const dateRx = /Date:\s*(\d{2})\/(\d{2})\/(\d{4})/;
  const periodRx = /Period:\s*(\d{1,2})/;
  const codeRx = /Tax Code:\s*(\S+)/;
  const taxableRx = /Total taxable pay to date:\s*(-?[\d,]+\.\d{2})/;
  const totalRx = /TOTAL\s+(-?[\d,]+\.\d{2})/;
  const netRx = /NET PAY\s+(-?[\d,]+\.\d{2})/;
  const ersPensionRx = /Ers Pension TP:\s*(-?[\d,]+\.\d{2})/;
  const num = (s) => Number(String(s).replace(/,/g, ''));

  function parseRow(line) {
    const t = line.split(/\s+/);
    let i = t.length;
    const nums = [];
    let days = null;
    while (i > 0) {
      const tok = t[i - 1];
      if (money.test(tok)) nums.unshift(tok);
      else if (tok.toLowerCase() === 'days' && i >= 2 && money.test(t[i - 2]) && nums.length === 2) { days = num(t[i - 2]); i--; }
      else break;
      i--;
    }
    if (nums.length < 2 || i === 0) return null;
    const label = t.slice(0, i).join(' ');
    if (/\d/.test(label) && !/\p{L}/u.test(keyOf(label))) return null;
    const row = { label, amount: num(nums[nums.length - 2]), ytd: num(nums[nums.length - 1]) };
    if (nums.length >= 3) row.rate = num(nums[nums.length - 3]);
    if (days != null) row.days = days;
    return row;
  }

  /** PDF text → payslip, or null when it isn't one (no valid date, period, TOTAL or NET PAY). */
  function parse(text) {
    const dm = dateRx.exec(text);
    if (!dm) return null;
    const dt = new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]));
    if (dt.getDate() !== Number(dm[1]) || dt.getMonth() !== Number(dm[2]) - 1) return null;
    const pm = periodRx.exec(text); if (!pm) return null;
    const tm = totalRx.exec(text); if (!tm) return null;
    const nm = netRx.exec(text); if (!nm) return null;
    const earnings = [], deductions = [];
    let afterTotal = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (totalRx.test(line)) { afterTotal = true; continue; }
      if (!line || line.startsWith('Ers ') || line.includes(':')) continue;
      const r = parseRow(line);
      if (r) (afterTotal ? deductions : earnings).push(r);
    }
    const p = { date: dm[3] + '-' + dm[2] + '-' + dm[1], period: Number(pm[1]), code: (codeRx.exec(text) || [, ''])[1],
      earnings, deductions, total: num(tm[1]), net: num(nm[1]) };
    const tx = taxableRx.exec(text); if (tx) p.taxableYtd = num(tx[1]);
    const ep = ersPensionRx.exec(text); if (ep) p.ersPension = num(ep[1]);
    return p;
  }

  /** Android PayslipJson.fromJson: bad rows dropped. */
  function normalizeList(a) {
    if (!Array.isArray(a)) return [];
    const lines = (x) => (Array.isArray(x) ? x : []).filter((l) => l && typeof l.label === 'string' && isFinite(l.amount)).map((l) => {
      const o = { label: l.label, amount: Number(l.amount), ytd: Number(l.ytd) || 0 };
      if (l.rate != null && isFinite(l.rate)) o.rate = Number(l.rate);
      if (l.days != null && isFinite(l.days)) o.days = Number(l.days);
      return o;
    });
    return a.filter((o) => o && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && isFinite(o.period) && isFinite(o.total) && isFinite(o.net)).map((o) => {
      const p = { date: o.date, period: Number(o.period), code: typeof o.code === 'string' ? o.code : '',
        earnings: lines(o.earnings), deductions: lines(o.deductions), total: Number(o.total), net: Number(o.net) };
      if (o.taxableYtd != null && isFinite(o.taxableYtd)) p.taxableYtd = Number(o.taxableYtd);
      if (o.ersPension != null && isFinite(o.ersPension)) p.ersPension = Number(o.ersPension);
      return p;
    });
  }

  const accessors = {
    employeePension: (p) => -accessors.pensionSacrifice(p),
    basic: (p) => amt(p.earnings, 'basicpay'),
    bonus: (p) => amt(p.earnings, 'offshorebonus'),
    holiday: (p) => amt(p.earnings, 'holidaypay'),
    pensionSacrifice: (p) => sumAmt(p.earnings.filter((l) => keyOf(l.label).startsWith('salsac'))),
    refunds: (p) => sumAmt(p.earnings.filter((l) => isRefund(l.label))),
    ukTax: (p) => amt(p.deductions, 'tax'),
    ni: (p) => amt(p.deductions, 'nationalinsurance'),
    studentLoan: (p) => amt(p.deductions, 'studentloans'),
    checksOut: (p) => Math.abs(sumAmt(p.earnings) - p.total) < 0.015,
  };

  global.AsPayslip = { keyOf, isRefund, CATEGORY, Labels: L, mappedLines, equalised, parse, parseRow, normalizeList, gbp, ...accessors };
})(typeof window !== 'undefined' ? window : globalThis);
