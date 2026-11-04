/**
 * 1.2.6-web Settings → Pay and the timesheet pay-estimate strip (port of Android PayEstimateUi.kt).
 * Data: js/pay-store.js. Maths: js/pay-calc.js, js/payslip.js, js/insights.js, js/pension.js.
 * Estimates only: never a payslip. Synthetic examples only in tests and screenshots.
 */
(function (global) {
  const A = () => global.AsApp;
  const P = () => global.AsPayStore;
  const C = () => global.AsPayCalc;
  const esc = (s) => A().escapeHtml(s == null ? '' : String(s));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ——— formatting ———
  const gbp = (x) => (x < 0 ? '−' : '') + '£' + Math.abs(Number(x) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gbp0 = (x) => (x < 0 ? '−' : '') + '£' + Math.round(Math.abs(Number(x) || 0)).toLocaleString('en-GB');
  const short = (x) => (Math.abs(x - Math.round(x)) < 0.005 ? gbp0(x) : gbp(x));
  const num = (x) => { const v = Number(x) || 0; return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); };
  const dShow = (iso) => (iso ? Number(iso.slice(8, 10)) + ' ' + MON[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4) : '');
  const dFmt = (iso) => (iso ? Number(iso.slice(8, 10)) + '/' + Number(iso.slice(5, 7)) + '/' + iso.slice(0, 4) : '');
  function parseDate(s) {
    const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s || '');
    if (!m) return null;
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if (d.getUTCDate() !== +m[1] || d.getUTCMonth() !== +m[2] - 1) return null;
    return d.toISOString().slice(0, 10);
  }
  const parseMoney = (s) => { const v = Number(String(s || '').trim().replace(/^£/, '').replace(/,/g, '')); return String(s || '').trim() !== '' && isFinite(v) && v >= 0 ? v : null; };
  const today = () => C().todayIso();
  const firstOfMonth = () => today().slice(0, 8) + '01';

  // ——— small dialog (Android PayDialog) ———
  /** fields: [{label, value, numeric}]; onSave(values) → true when valid. */
  function dialog(title, fields, onSave, opts) {
    opts = opts || {};
    const html = `<div class="sheet pay-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grip"></div><h2>${esc(title)}</h2>
      ${opts.note ? `<p class="hint">${esc(opts.note)}</p>` : ''}
      ${fields.map((f, i) => `<label>${esc(f.label)}<input type="text" data-f="${i}" value="${esc(f.value == null ? '' : f.value)}" ${f.numeric !== false ? 'inputmode="decimal"' : ''} autocomplete="off" /></label>`).join('')}
      <p class="pay-err hidden" role="alert">${esc(opts.error || 'Please check the values (dates as d/m/yyyy).')}</p>
      <div class="pay-dialog-actions">${opts.onDelete ? '<button type="button" class="btn ghost danger" data-act="delete">Delete</button>' : '<span></span>'}
        <span><button type="button" class="btn ghost" data-close>Cancel</button> <button type="button" class="btn primary" data-act="save">Save</button></span></div></div>`;
    const sh = A().openSheet(html);
    const el = sh.el;
    const first = el.querySelector('input'); if (first) setTimeout(() => first.focus(), 50);
    el.querySelector('[data-act="save"]').onclick = async () => {
      const vals = Array.from(el.querySelectorAll('[data-f]')).map((i) => i.value);
      let ok = false;
      try { ok = await onSave(vals); } catch (e) { console.error(e); }
      if (ok) sh.close(); else el.querySelector('.pay-err').classList.remove('hidden');
    };
    el.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => el.querySelector('.pay-err').classList.add('hidden')));
    el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.querySelector('[data-act="save"]').click(); }));
    const del = el.querySelector('[data-act="delete"]');
    if (del) del.onclick = async () => { await opts.onDelete(); sh.close(); };
    return sh;
  }
  function info(title, text) {
    A().openSheet(`<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="sheet-actions"><button type="button" class="btn primary" data-close>OK</button></div></div>`);
  }
  function confirmSheet(title, text, okLabel) {
    return new Promise((resolve) => {
      const sh = A().openSheet(`<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div><h2>${esc(title)}</h2><p>${esc(text)}</p>
        <div class="pay-dialog-actions"><span></span><span><button type="button" class="btn ghost" data-close>Cancel</button> <button type="button" class="btn primary danger-fill" data-ok>${esc(okLabel || 'OK')}</button></span></div></div>`, () => resolve(false));
      sh.el.querySelector('[data-ok]').onclick = () => { resolve(true); sh.el.remove(); };
    });
  }

  const PENSION_BAND_INFO = 'Pension is worked out on qualifying earnings: only the part of your monthly pay between £520 and £4,189.17 counts. ' +
    'Your % is taken from that part (pay above £4,189.17 adds nothing), rounded down to the penny like payroll. ' +
    'It is a salary sacrifice, so it comes off your pay before tax, NI and student loan.';
  const HEALTH = /AXA|PPP|BUPA|health|medical|vitality/i;

  // ——— Settings → Pay view ———
  const open = new Set(); // expanded bars / pot years (kept while the page is open)
  function injectViews() {
    if (document.getElementById('view-set-pay')) return;
    const app = document.getElementById('app');
    const sec = document.createElement('div');
    sec.innerHTML = `
    <section id="view-set-pay" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-pay-back">← Back</button><h1>Pay</h1></header>
      <p class="hint">Used for the pay estimate on timesheets and for Insights. Estimates only, not a payslip. Kept on this device (not under the personal-details lock).</p>
      <div id="pay-settings-body"></div>
    </section>`;
    app.appendChild(sec.firstElementChild);
    A().registerView('set-pay', '#view-set-pay');
    const banners = document.querySelector('#view-settings .settings-banners');
    const after = document.getElementById('btn-goto-other-forms');
    if (banners && !document.getElementById('btn-goto-pay')) {
      const b = document.createElement('div');
      b.innerHTML = `<button type="button" class="settings-banner" id="btn-goto-pay"><span class="sb-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><g fill="currentColor"><path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1 2v8h16V8H4zm8 1.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM6 10h2v4H6v-4zm10 0h2v4h-2v-4z"/></g></svg></span><span class="sb-text"><span class="sb-title">Pay</span><span class="sb-sub" id="sb-pay-sub">Rates for the pay estimate</span></span><span class="sb-chev" aria-hidden="true">›</span></button>`;
      if (after && after.parentNode === banners) after.after(b.firstElementChild); else banners.prepend(b.firstElementChild);
    }
  }

  const row = (attrs, label, value, sub, infoBtn) => `<button type="button" class="pay-row" ${attrs}><span class="pr-main"><span class="pr-label">${label}${infoBtn ? ` <span class="pay-info" role="button" tabindex="0" data-info="${infoBtn}" aria-label="What is this?">?</span>` : ''}</span>${sub ? `<span class="pr-sub">${esc(sub)}</span>` : ''}</span><span class="pr-val">${esc(value)}</span></button>`;
  const addRow = (attrs, text) => `<button type="button" class="pay-add" ${attrs}>${esc(text)}</button>`;
  const expander = (id, label, value, inner) => {
    const o = open.has(id);
    return `<button type="button" class="pay-row pay-exp" data-exp="${id}" aria-expanded="${o}"><span class="pr-main"><span class="pr-label">${o ? '▾' : '▸'} ${esc(label)}</span></span><span class="pr-val">${esc(value)}</span></button>
      ${o ? `<div class="pay-exp-body" data-testid="pay-${id}">${inner}</div>` : ''}`;
  };

  function taxHistory(s, slips) {
    const out = [];
    for (const p of slips) if (p.code && (!out.length || out[out.length - 1].value !== p.code)) out.push({ from: p.date, value: p.code, source: 'Payslip' });
    return out.concat(s.taxCodes.map((t) => ({ from: t.from, value: t.code, source: 'Manual' }))).sort((a, b) => (a.from < b.from ? 1 : -1));
  }
  function healthHistory(s, slips) {
    const out = [];
    for (const p of slips) {
      const l = p.deductions.filter((d) => HEALTH.test(d.label));
      if (!l.length) continue;
      const v = gbp(Math.abs(l.reduce((a, d) => a + d.amount, 0)));
      if (!out.length || out[out.length - 1].value !== v) out.push({ from: p.date, value: v, source: 'Payslip' });
    }
    return out.concat(s.healthcare.map((h) => ({ from: h.from, value: gbp(h.monthly), source: 'Manual' }))).sort((a, b) => (a.from < b.from ? 1 : -1));
  }

  async function showPay() {
    injectViews();
    await P().load();
    renderPay();
    A().showView('set-pay');
  }

  function renderPay() {
    const body = document.getElementById('pay-settings-body');
    if (!body) return;
    const s = P().settings();
    const slips = global.AsInsights.dedupe(P().payslips());
    const curPct = C().currentPensionPct(s);
    const pctSub = s.pensionRates.length ? [num(s.pensionPct) + '%'].concat(s.pensionRates.slice().sort((a, b) => (a.from < b.from ? -1 : 1)).map((r) => num(r.pct) + '% from ' + dShow(r.from))).join(' → ') : null;
    const taxH = taxHistory(s, slips);
    const healthH = healthHistory(s, slips);
    const pots = P().pots(s);
    const latest = pots.reduce((b, x) => (!b || x.date > b.date ? x : b), null);
    const years = Array.from(new Set(pots.map((p) => p.date.slice(0, 4)))).sort().reverse();
    if (latest && !open.has('potyear-init')) { open.add('potyear-init'); open.add('potyear-' + latest.date.slice(0, 4)); }
    const chained = global.AsPension.chain(s.statements.map(global.AsPension.normalizeStatement).filter(Boolean));
    const perf = global.AsPension.years(chained, pots);
    body.innerHTML = `
      <h2 class="pay-sec">Rates</h2>
      <div class="pay-card">
        ${row('data-edit="dayRate"', 'Day rate', short(s.dayRate))}
        ${row('data-edit="salary"', 'Base salary', short(s.annualSalary) + ' / yr')}
        ${row('data-edit="pension"', 'Pension (sal. sac.)', num(curPct) + '%', pctSub, 'band')}
        ${row('data-edit="loan"', 'Student loan', C().loanLabel(s.loanPlan))}
        ${expander('taxcode', 'Tax code', C().currentTaxCode(s), taxH.map((h, i) => row(`data-tax="${i}"`, dShow(h.from), h.value, h.source)).join('') + addRow('data-add="tax"', '+ Add tax code'))}
        ${expander('healthcare', 'Private healthcare', healthH.length ? healthH[0].value + ' / mo' : 'None', healthH.map((h, i) => row(`data-health="${i}"`, dShow(h.from), h.value + ' / mo', h.source)).join('') + addRow('data-add="health"', '+ Add healthcare amount'))}
      </div>
      <h2 class="pay-sec">Pension</h2>
      <div class="pay-card">
        ${expander('pots', 'Pot values', latest ? gbp(latest.value) : 'None', years.map((y) => {
          const list = pots.filter((p) => p.date.startsWith(y)).sort((a, b) => (a.date < b.date ? 1 : -1));
          const o = open.has('potyear-' + y);
          return `<button type="button" class="pay-year" data-exp="potyear-${y}" aria-expanded="${o}">${o ? '▾' : '▸'} ${y} (${list.length})</button>` +
            (o ? list.map((pv) => row(`data-pot="${pv.date}"`, dShow(pv.date), gbp(pv.value), [pv.source, pv === latest ? 'Latest · Total pension starts here' : null].filter(Boolean).join(' · '))).join('') : '');
        }).join('') + addRow('data-add="pot"', '+ Add pot value'))}
        ${expander('statements', 'Annual statements', String(chained.length), chained.slice().reverse().map((st) =>
          row(`data-stmt="${st.end}"`, dShow(st.start) + ' – ' + dShow(st.end), gbp(st.closing),
            [global.AsPension.addsUp(st) ? 'Adds up' : "Doesn't add up", st.adjusted ? 'Opening adjusted to previous closing' : null, st.chargePct != null ? 'charges ' + st.chargePct.toFixed(2) + '%' : null].filter(Boolean).join(' · '))).join('') +
          (perf.length ? `<p class="pay-sub-h">Yearly performance (tax year)</p>` + perf.slice().reverse().map((y) => {
            const mark = y.growthSplit || y.chargesSplit ? ' *' : '';
            return `<div class="pay-row static"><span class="pr-main"><span class="pr-label">${y.taxYear}/${String((y.taxYear + 1) % 100).padStart(2, '0')}</span><span class="pr-sub">Paid in ${gbp(y.paidIn)} · growth ${gbp(y.growth)}${y.growthSplit ? '*' : ''} · charges ${gbp(y.charges)}${y.chargesSplit ? '*' : ''}</span></span><span class="pr-val">${y.net < 0 ? '−' : '+'}${gbp(Math.abs(y.net))}${mark}</span></div>`;
          }).join('') + '<p class="hint pay-foot">* split across tax years by days (or at a pot value near 6 April)</p>' : '') +
          addRow('data-add="statement"', '+ Import statement PDF'))}
      </div>
      <h2 class="pay-sec">Fixed deductions</h2>
      <div class="pay-card">
        ${s.fixed.map((d, i) => row(`data-fixed="${i}"`, esc(d.name), gbp(d.monthly) + ' / mo', d.from ? 'from ' + dShow(d.from) : null)).join('')}
        ${addRow('data-add="fixed"', '+ Add deduction')}
      </div>
      <h2 class="pay-sec">Pay rises</h2>
      ${s.rises.length ? `<div class="pay-card">${s.rises.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => row(`data-rise="${r.date}"`, dShow(r.date), 'Salary ' + short(r.salary) + ' · ' + short(r.dayRate) + '/day')).join('')}</div>` : ''}
      <button type="button" class="btn secondary pay-wide" data-add="rise">+ Add pay rise</button>
      <p class="hint">A new salary counts for the whole month of its date; a new day rate counts from the date onwards.</p>
      <h2 class="pay-sec">Optional</h2>
      <div class="pay-card">
        ${row('data-edit="ytd"', 'Start from payslip YTD', s.ytd ? 'P' + s.ytd.period + ' ' + s.ytd.year + '/' + String((s.ytd.year + 1) % 100).padStart(2, '0') + ' ›' : 'Off ›', 'Use figures from your latest payslip')}
      </div>
      <input type="file" id="pay-statement-file" accept="application/pdf,.pdf" class="hidden" />`;
    wireBody(body, s, slips, taxH, healthH, pots);
    const sub = document.getElementById('sb-pay-sub');
    if (sub) sub.textContent = C().configured(s) ? short(s.annualSalary) + ' / yr · ' + short(s.dayRate) + ' / day' : 'Rates for the pay estimate';
  }

  async function save(n) { await P().saveSettings(n); renderPay(); }
  const savePots = (s, list) => {
    const m = new Map(); for (const p of list) m.set(p.date, p);
    return save({ ...s, potValues: Array.from(m.values()).sort((a, b) => (a.date < b.date ? -1 : 1)), pensionValue: null, pensionValueDate: null });
  };

  function wireBody(body, s, slips, taxH, healthH, pots) {
    body.querySelectorAll('[data-exp]').forEach((b) => { b.onclick = (e) => {
      if (e.target.closest('[data-info]')) return;
      const id = b.getAttribute('data-exp'); if (open.has(id)) open.delete(id); else open.add(id); renderPay();
    }; });
    body.querySelectorAll('[data-info]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); info('Qualifying earnings', PENSION_BAND_INFO); }; });
    const on = (sel, f) => body.querySelectorAll(sel).forEach((b) => { b.onclick = (e) => { if (e.target.closest('[data-info]')) return; f(b); }; });
    on('[data-edit="dayRate"]', () => dialog('Day rate', [{ label: '£ per day', value: num(s.dayRate) }], (v) => { const x = parseMoney(v[0]); if (x == null) return false; save({ ...s, dayRate: x }); return true; }));
    on('[data-edit="salary"]', () => dialog('Base salary', [{ label: '£ per year', value: num(s.annualSalary) }], (v) => { const x = parseMoney(v[0]); if (x == null) return false; save({ ...s, annualSalary: x }); return true; }));
    on('[data-edit="pension"]', () => dialog('Pension % (from date)', [{ label: '% of pay in the £520–£4,189.17 band', value: num(C().currentPensionPct(s)) }, { label: 'From (d/m/yyyy, blank = always)', value: '', numeric: false }], (v) => {
      const p = parseMoney(v[0]); const blank = !v[1].trim(); const from = blank ? null : parseDate(v[1]);
      if (p == null || p > 100 || (!blank && !from)) return false;
      if (!from) save({ ...s, pensionPct: p, pensionRates: [] });
      else save({ ...s, pensionRates: s.pensionRates.filter((r) => r.from !== from).concat({ from, pct: p }) });
      return true;
    }));
    on('[data-edit="loan"]', () => {
      const sh = A().openSheet(`<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div><h2>Student loan</h2>
        ${C().LOAN_PLANS.map(([k, l]) => `<label class="pay-radio"><input type="radio" name="loan" value="${k}" ${k === s.loanPlan ? 'checked' : ''}/> ${esc(l)}</label>`).join('')}
        <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Close</button></div></div>`);
      sh.el.querySelectorAll('input[name="loan"]').forEach((r) => { r.onchange = () => { save({ ...s, loanPlan: r.value }); sh.close(); }; });
    });
    const taxDlg = (from, code, onDelete, done) => dialog('Tax code (from date)', [{ label: 'Tax code', value: code, numeric: false }, { label: 'From (d/m/yyyy)', value: dFmt(from), numeric: false }], (v) => {
      const c = v[0].trim().toUpperCase(); const d = parseDate(v[1]);
      if (!C().parseCode(c) || !d) return false; done(d, c); return true;
    }, { onDelete });
    on('[data-tax]', (b) => {
      const h = taxH[+b.getAttribute('data-tax')]; if (!h || h.source !== 'Manual') return;
      taxDlg(h.from, h.value, () => save({ ...s, taxCodes: s.taxCodes.filter((t) => t.from !== h.from) }),
        (d, c) => save({ ...s, taxCodes: s.taxCodes.filter((t) => t.from !== h.from && t.from !== d).concat({ from: d, code: c }) }));
    });
    on('[data-add="tax"]', () => taxDlg(firstOfMonth(), C().currentTaxCode(s), null, (d, c) => save({ ...s, taxCodes: s.taxCodes.filter((t) => t.from !== d).concat({ from: d, code: c }) })));
    const healthDlg = (cur, onDelete, done) => dialog('Private healthcare (from date)', [{ label: '£ per month', value: cur ? num(cur.monthly) : '' }, { label: 'From (d/m/yyyy)', value: dFmt(cur ? cur.from : firstOfMonth()), numeric: false }], (v) => {
      const x = parseMoney(v[0]); const d = parseDate(v[1]); if (x == null || !d) return false; done({ from: d, monthly: x }); return true;
    }, { onDelete });
    on('[data-health]', (b) => {
      const h = healthH[+b.getAttribute('data-health')]; if (!h || h.source !== 'Manual') return;
      const cur = s.healthcare.find((x) => x.from === h.from); if (!cur) return;
      healthDlg(cur, () => save({ ...s, healthcare: s.healthcare.filter((x) => x !== cur) }), (n) => save({ ...s, healthcare: s.healthcare.filter((x) => x !== cur && x.from !== n.from).concat(n) }));
    });
    on('[data-add="health"]', () => healthDlg(null, null, (n) => save({ ...s, healthcare: s.healthcare.filter((x) => x.from !== n.from).concat(n) })));
    const potDlg = (pv, onDelete, done) => dialog(pv ? 'Edit pot value' : 'Add pot value', [{ label: '£ pot value', value: pv ? num(pv.value) : '' }, { label: 'As of (d/m/yyyy)', value: dFmt(pv ? pv.date : today()), numeric: false }], (v) => {
      const x = parseMoney(v[0]); const d = parseDate(v[1]); if (x == null || !d || d > today()) return false;
      done({ date: d, value: x, source: pv && pv.value === x && pv.date === d ? pv.source : 'Manual' }); return true;
    }, { onDelete });
    on('[data-pot]', (b) => {
      const pv = pots.find((p) => p.date === b.getAttribute('data-pot')); if (!pv) return;
      potDlg(pv, () => savePots(s, pots.filter((p) => p !== pv)), (n) => savePots(s, pots.filter((p) => p !== pv && p.date !== n.date).concat(n)));
    });
    on('[data-add="pot"]', () => potDlg(null, null, (n) => savePots(s, pots.filter((p) => p.date !== n.date).concat(n))));
    on('[data-stmt]', async (b) => {
      const end = b.getAttribute('data-stmt');
      const sh = A().openSheet(`<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div><h2>Statement ending ${esc(dShow(end))}</h2>
        <div class="sheet-actions"><button type="button" class="btn secondary" data-view>Open PDF</button><button type="button" class="btn ghost danger" data-del>Delete statement…</button><button type="button" class="btn ghost" data-close>Close</button></div></div>`);
      sh.el.querySelector('[data-view]').onclick = async () => { const blob = await P().getPdf('statement', end); if (blob) openPdf(blob); else A().toast('No PDF saved for this statement'); };
      sh.el.querySelector('[data-del]').onclick = async () => {
        sh.close();
        if (!(await confirmSheet('Delete statement?', 'Removes the statement figures and its PDF. Its pot value stays (delete it under Pot values).', 'Delete'))) return;
        await P().deletePdf('statement', end);
        await save({ ...s, statements: s.statements.filter((x) => x.end !== end) });
      };
    });
    on('[data-add="statement"]', () => document.getElementById('pay-statement-file').click());
    const f = document.getElementById('pay-statement-file');
    if (f) f.onchange = async () => { const file = f.files && f.files[0]; f.value = ''; if (file && global.AsInsightsUi) await global.AsInsightsUi.importStatement(file); };
    const fixedDlg = (d, onDelete, done) => dialog('Fixed deduction (after tax)', [{ label: 'Name', value: d ? d.name : '', numeric: false }, { label: '£ per month', value: d ? num(d.monthly) : '' }, { label: 'From (d/m/yyyy, optional)', value: d && d.from ? dFmt(d.from) : '', numeric: false }], (v) => {
      const amt = parseMoney(v[1]); const from = v[2].trim() ? parseDate(v[2]) : null;
      if (!v[0].trim() || amt == null || (v[2].trim() && !from)) return false;
      done(from ? { name: v[0].trim(), monthly: amt, from } : { name: v[0].trim(), monthly: amt }); return true;
    }, { onDelete });
    on('[data-fixed]', (b) => { const i = +b.getAttribute('data-fixed'); fixedDlg(s.fixed[i], () => save({ ...s, fixed: s.fixed.filter((_, j) => j !== i) }), (n) => save({ ...s, fixed: s.fixed.map((o, j) => (j === i ? n : o)) })); });
    on('[data-add="fixed"]', () => fixedDlg(null, null, (n) => save({ ...s, fixed: s.fixed.concat(n) })));
    const riseDlg = (r, onDelete, done) => dialog('Pay rise', [{ label: 'Effective date (d/m/yyyy)', value: r ? dFmt(r.date) : '', numeric: false }, { label: 'New salary £ / yr', value: r ? num(r.salary) : '' }, { label: 'New day rate £', value: r ? num(r.dayRate) : '' }], (v) => {
      const date = parseDate(v[0]); const sal = parseMoney(v[1]); const rate = parseMoney(v[2]);
      if (!date || sal == null || rate == null) return false; done({ date, salary: sal, dayRate: rate }); return true;
    }, { onDelete });
    on('[data-rise]', (b) => { const r = s.rises.find((x) => x.date === b.getAttribute('data-rise')); if (r) riseDlg(r, () => save({ ...s, rises: s.rises.filter((x) => x !== r) }), (n) => save({ ...s, rises: s.rises.filter((x) => x !== r).concat(n) })); });
    on('[data-add="rise"]', () => riseDlg(null, null, (n) => save({ ...s, rises: s.rises.concat(n) })));
    on('[data-edit="ytd"]', () => {
      const o = s.ytd;
      dialog('Start from payslip YTD', [
        { label: 'Tax year starting (e.g. 2026)', value: String(o ? o.year : C().taxYearStart(today().slice(0, 7))) },
        { label: 'Period on payslip (1–12)', value: o ? String(o.period) : '' },
        { label: 'Total taxable pay to date £', value: o ? num(o.taxable) : '' },
        { label: 'Tax to date £ (UK + foreign)', value: o ? num(o.tax) : '' },
      ], (v) => {
        const y = parseInt(v[0], 10), p = parseInt(v[1], 10), t = parseMoney(v[2]);
        const tax = Number(v[3].trim().replace(/^£/, '').replace(/,/g, ''));
        if (!isFinite(y) || !(p >= 1 && p <= 12) || t == null || !v[3].trim() || !isFinite(tax)) return false;
        save({ ...s, ytd: { year: y, period: p, taxable: t, tax } }); return true;
      }, { onDelete: o ? () => save({ ...s, ytd: null }) : null });
    });
  }

  function openPdf(blob) {
    const url = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
    const w = window.open(url, '_blank', 'noopener');
    if (!w) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ——— Timesheet pay strip + breakdown (Android PayEstimateStrip / PayBreakdownSheet / PayslipSheet) ———
  const lineHtml = (l, v, bold) => `<div class="pb-line${bold ? ' bold' : ''}"><span>${esc(l)}</span><span>${esc(v)}</span></div>`;
  const secH = (t) => `<h3 class="pb-sec">${esc(t)}</h3>`;
  const tag = '<span class="est-tag">Estimate</span>';

  async function stripData(ts) {
    await P().load();
    const s = P().settings();
    const wm = C().ym(ts.year, ts.month);
    const results = await P().periodResults();
    const r = results.get(wm) || null;
    const payMonth = C().ymPlus(wm, 1);
    const slip = global.AsInsights.payslipFor(global.AsInsights.dedupe(P().payslips()), payMonth);
    return { s, wm, payMonth, r, slip, configured: C().configured(s) };
  }

  async function renderStrip(ts) {
    const host = document.getElementById('pay-strip');
    if (!host || !ts) return;
    const d = await stripData(ts);
    const est = d.configured ? d.r : null;
    host.onclick = null;
    if (!d.slip && !est) {
      host.className = 'pay-strip';
      host.innerHTML = '<span class="ps-empty">Pay estimate: add your rates in <button type="button" class="linklike" id="ps-goto-pay">Settings → Pay</button></span>';
      document.getElementById('ps-goto-pay').onclick = (e) => { e.stopPropagation(); showPay(); };
      return;
    }
    const net = d.slip ? d.slip.net : est.net;
    const gross = d.slip ? global.AsPayslip.equalised(d.slip).gross : est.gross;
    const wmName = MONTH[Number(d.wm.slice(5, 7)) - 1];
    const payMon = MON[Number(d.payMonth.slice(5, 7)) - 1];
    const days = est ? est.seasonDays : 0;
    host.className = 'pay-strip hero clickable';
    const pct = est ? Math.min(100, days / C().SEASON_DOUBLE_AFTER * 100) : 0;
    // 1.2.9-web: the timesheet's one hero figure — month net pay, season-days progress below (DESIGN §5)
    host.innerHTML = `<div class="hero-label">${esc(wmName)} net ${d.slip ? '· payslip' : '(estimate)'} ${d.slip ? '' : tag}</div>
        <div class="hero-value ps-net num">${esc(gbp0(net))}</div>
        <div class="hero-help ps-gross">Gross ${esc(gbp0(gross))} · paid late ${esc(payMon)}</div>
      ${est ? `<div class="hero-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${C().SEASON_DOUBLE_AFTER}" aria-valuenow="${days}" aria-label="Season days"><div class="ps-bar"><i style="width:${pct}%"></i></div><div class="hero-progress-text">Season ${days} of ${C().SEASON_DOUBLE_AFTER} days <span class="ps-tap">Tap for breakdown ›</span></div></div>` : '<div class="ps-tap hero-help">Tap for the payslip</div>'}`;
    host.setAttribute('role', 'button'); host.tabIndex = 0;
    host.onclick = () => (d.slip ? payslipSheet(d.slip, est) : breakdownSheet(est));
    host.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); host.click(); } };
  }

  function breakdownSheet(r) {
    if (!r) return;
    const i = r.input;
    const normal = i.dayLines.filter((l) => !l.doubleRate), dbl = i.dayLines.filter((l) => l.doubleRate);
    const days = r.seasonDays;
    A().openSheet(`<div class="sheet pay-breakdown" role="dialog" aria-modal="true" data-testid="pay-breakdown"><div class="sheet-grip"></div><h2>Pay estimate</h2>
      ${secH('Pay')}${lineHtml('Basic salary', gbp(i.basic))}
      ${normal.length ? normal.map((l) => lineHtml('Offshore days ' + l.days + ' × ' + short(l.rate), gbp(l.amount))).join('') : lineHtml('Offshore days 0', gbp(0))}
      ${dbl.length ? dbl.map((l) => lineHtml('Double-rate days ' + l.days + ' × ' + short(l.payRate), gbp(l.amount))).join('') : lineHtml('Double-rate days 0', gbp(0))}
      <hr/>${lineHtml('Gross', gbp(r.gross), true)}
      ${secH('Deductions')}${lineHtml('Pension (sal. sac. ' + num(i.pensionPct) + '% of pay £520–£4,189.17)', gbp(r.pension))}
      ${lineHtml(r.tax < 0 ? 'Tax refund' : 'Tax', gbp(Math.abs(r.tax)))}${lineHtml('NI', gbp(r.ni))}
      ${i.loanPlan !== 'NONE' ? lineHtml('Student loan ' + C().loanLabel(i.loanPlan), gbp(r.studentLoan)) : ''}
      ${i.fixed.map((f) => lineHtml(f[0], gbp(f[1]))).join('')}
      <hr/><div class="pb-net"><span>Net</span><span>${esc(gbp(r.net))}</span></div>
      ${secH('Tax year to date')}${lineHtml('Taxable gross', gbp(r.taxableYtd))}${lineHtml('Tax', gbp(r.taxYtd))}
      ${secH('Season (from 1 Mar)')}<div class="pb-line"><span>${days} / ${C().SEASON_DOUBLE_AFTER} days</span><small>double rate after ${C().SEASON_DOUBLE_AFTER}</small></div>
      <div class="ps-bar"><i style="width:${Math.min(100, days / C().SEASON_DOUBLE_AFTER * 100)}%"></i></div>
      <p class="pb-foot">ⓘ Estimate, not a payslip</p>
      <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Close</button></div></div>`);
  }

  function payslipSheet(p, r, extra) {
    const e = global.AsPayslip.equalised(p);
    const sh = A().openSheet(`<div class="sheet pay-breakdown" role="dialog" aria-modal="true" data-testid="pay-breakdown"><div class="sheet-grip"></div><h2>Payslip · paid ${esc(dShow(p.date))}</h2>
      <p class="hint">Shown in Insights under ${esc(MONTH[Number(p.date.slice(5, 7)) - 1])} (pay month) · period ${p.period}${p.code ? ' · tax code ' + esc(p.code) : ''}</p>
      ${secH('Pay')}${lineHtml('Basic salary', gbp(e.basic))}
      ${e.offshore ? lineHtml('Offshore (incl. foreign earnings & salary adj.)', gbp(e.offshore)) : ''}
      ${e.bonus ? lineHtml('Bonus', gbp(e.bonus)) : ''}${e.holiday ? lineHtml('Holiday pay', gbp(e.holiday)) : ''}
      ${e.unread ? lineHtml('Not read from PDF', gbp(e.unread)) : ''}${e.offshoreDays > 0 ? lineHtml('Offshore days', num(e.offshoreDays)) : ''}
      <hr/>${lineHtml('Gross', gbp(e.gross), true)}${e.refunds ? lineHtml('Refunds (not in gross)', gbp(e.refunds)) : ''}
      ${secH('Deductions')}${lineHtml('Pension (sal. sac.)', gbp(Math.abs(e.pension)))}
      ${e.ukTax < 0 ? lineHtml('UK tax refund', gbp(-e.ukTax)) : lineHtml('UK tax', gbp(e.ukTax))}
      ${e.foreignTax ? lineHtml('Foreign tax', gbp(e.foreignTax)) : ''}${lineHtml('NI', gbp(e.ni))}
      ${e.studentLoan ? lineHtml('Student loan', gbp(e.studentLoan)) : ''}${Math.abs(e.otherDeductions) >= 0.005 ? lineHtml('Other deductions', gbp(e.otherDeductions)) : ''}
      <hr/><div class="pb-net"><span>Net</span><span>${esc(gbp(p.net))}</span></div>
      ${e.warnings.map((w) => `<p class="pay-warn" data-testid="payslip-warning">⚠ ${esc(w)}</p>`).join('')}
      ${r ? `<p class="hint">Estimate was ${esc(gbp(r.net))} net</p>` : ''}
      ${extra || ''}
      <p class="pb-foot" data-testid="payslip-source">From your uploaded payslip</p>
      <div class="sheet-actions"><button type="button" class="btn secondary" data-pdf>Open payslip PDF</button><button type="button" class="btn ghost" data-close>Close</button></div></div>`);
    sh.el.querySelector('[data-pdf]').onclick = async () => { const b = await P().getPdf('payslip', p.date); if (b) openPdf(b); else A().toast('No PDF saved for this payslip'); };
    return sh;
  }

  function injectStrip() {
    const view = document.getElementById('view-ts-edit');
    if (!view || document.getElementById('pay-strip')) return;
    const d = document.createElement('div');
    d.id = 'pay-strip'; d.className = 'pay-strip'; d.setAttribute('data-testid', 'pay-strip');
    // 1.2.9-web: hero at the top of the timesheet (was a sticky strip over Export & send)
    const after = document.getElementById('ts-route-header');
    if (after && after.parentNode === view) after.insertAdjacentElement('afterend', d); else view.appendChild(d);
  }

  function wire() {
    injectViews();
    injectStrip();
    const b = document.getElementById('btn-goto-pay'); if (b) b.onclick = showPay;
    const back = document.getElementById('btn-pay-back'); if (back) back.onclick = () => A().showSettings();
    P().load().then(() => {
      const s = P().settings(); const sub = document.getElementById('sb-pay-sub');
      if (sub && C().configured(s)) sub.textContent = short(s.annualSalary) + ' / yr · ' + short(s.dayRate) + ' / day';
    }).catch((e) => console.error(e));
    P().onChange(() => { if (!document.getElementById('view-set-pay').classList.contains('hidden')) renderPay(); });
  }
  A().onBoot(wire);

  global.AsPayUi = { showPay, renderPay, renderStrip, breakdownSheet, payslipSheet, dialog, info, confirmSheet, openPdf,
    gbp, gbp0, short, num, dShow, dFmt, parseDate, parseMoney, MON, MONTH };
})(window);
