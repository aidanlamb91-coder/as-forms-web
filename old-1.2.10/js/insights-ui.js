/**
 * 1.2.6-web Insights tab, payslip / Aviva statement import and the pension forecast
 * (port of Android InsightsScreen.kt, InsightsReorder.kt, PensionUi.kt, TaxSavingsUi.kt).
 * Estimates only, not financial advice. PDFs stay in this browser (IndexedDB) and in backups.
 */
(function (global) {
  const A = () => global.AsApp;
  const P = () => global.AsPayStore;
  const C = () => global.AsPayCalc;
  const I = () => global.AsInsights;
  const N = () => global.AsPension;
  const S = () => global.AsPayslip;
  const U = () => global.AsPayUi;
  const esc = (s) => A().escapeHtml(s == null ? '' : String(s));
  const st = { year: null, reordering: false };
  const CARDS = ['gross', 'takehome', 'tax', 'mix', 'pension', 'employer', 'offshore', 'bonus'];
  const AMBER = '#FFB300', GREEN = '#2E7D32';

  function injectViews() {
    if (document.getElementById('view-insights')) return;
    const app = document.getElementById('app');
    const d = document.createElement('div');
    d.innerHTML = `
    <section id="view-insights" class="view hidden" data-testid="view-insights">
      <div class="ins-year" id="ins-year"></div>
      <div id="ins-body"></div>
      <input type="file" id="ins-payslip-file" accept="application/pdf,.pdf" multiple class="hidden" />
      <input type="file" id="ins-statement-file" accept="application/pdf,.pdf" class="hidden" />
    </section>
    <section id="view-ins-manage" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-ins-manage-back">← Back</button><h1 id="ins-manage-title">Payslips</h1></header>
      <div id="ins-manage-body"></div>
    </section>
    <section id="view-forecast" class="view hidden" data-testid="view-forecast">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-forecast-back">← Back</button><h1>Pension forecast</h1></header>
      <div id="forecast-body"></div>
    </section>`;
    while (d.firstElementChild) app.appendChild(d.firstElementChild);
    A().registerView('insights', '#view-insights');
    A().registerView('ins-manage', '#view-ins-manage');
    A().registerView('forecast', '#view-forecast');
  }

  // ——— data ———
  async function model() {
    await P().load();
    const s = P().settings();
    const slips = I().dedupe(P().payslips());
    const est = await P().estimates();
    const t = C().todayIso();
    const pots = P().pots(s);
    const start = pots.length ? pots.reduce((b, x) => (!b || x.date > b.date ? x : b), null) : null;
    const years = I().taxYears(slips, est, t);
    if (st.year == null || !years.includes(st.year)) st.year = years[0] != null ? years[0] : null;
    const sum = st.year != null ? I().summarise(slips, st.year, est, t, start ? { value: start.value, date: start.date } : null) : null;
    return { s, slips, est, t, pots, start, years, sum };
  }

  function order(s) {
    const o = (s.insightsOrder || []).filter((x) => CARDS.includes(x));
    // 1.2.8-web: a saved order from before the donut gets it beside Tax, where it was asked for
    if (o.length && !o.includes('mix')) { const t = o.indexOf('tax'); o.splice(t < 0 ? o.length : t + 1, 0, 'mix'); }
    return o.concat(CARDS.filter((x) => !o.includes(x)));
  }

  // ——— Insights screen ———
  async function showInsights() {
    injectViews();
    A().showView('insights');
    A().setNav('insights');
    await render();
  }

  async function render() {
    const body = document.getElementById('ins-body'); if (!body) return;
    const m = await model();
    const yearEl = document.getElementById('ins-year');
    yearEl.innerHTML = m.years.length > 1 ? m.years.map((y) => `<button type="button" class="chip${y === st.year ? ' on' : ''}" data-year="${y}">${I().yearLabel(y)}</button>`).join('') : '';
    yearEl.querySelectorAll('[data-year]').forEach((b) => { b.onclick = () => { st.year = Number(b.getAttribute('data-year')); render(); }; });
    const actions = `<div class="ins-actions"><button type="button" class="btn secondary" id="ins-import">Import payslip PDF</button>
      <button type="button" class="btn ghost" id="ins-manage">Manage payslips</button></div>`;
    if (!m.sum) {
      body.innerHTML = `<div class="panel ins-empty"><h2>No pay data yet</h2><p class="hint">Add your rates in Settings → Pay for estimates from your timesheets, or import a payslip PDF.</p>
        <button type="button" class="btn primary" id="ins-goto-pay">Settings → Pay</button></div>${actions}`;
      document.getElementById('ins-goto-pay').onclick = () => U().showPay();
      wireActions(m); return;
    }
    const x = m.sum;
    const ch = x.grossChangePct == null ? '' : `<div class="ins-change ${x.grossChangePct < 0 ? 'down' : 'up'}">${x.grossChangePct < 0 ? '▼' : '▲'} ${Math.abs(x.grossChangePct).toFixed(1)}% ${esc(x.changeLabel || '')}</div>`;
    const warn = needsChecking(m);
    body.innerHTML = `
      <div class="ins-hero" data-testid="ins-hero"><div class="ins-hero-top">YTD gross · ${I().yearLabel(x.taxYear)} ${x.estimatedMonths ? '<span class="est-tag">Estimate</span>' : ''}</div>
        <div class="ins-big">${esc(U().gbp0(x.grossYtd))}</div>${ch}
        <div class="hint">${x.payslips} payslip${x.payslips === 1 ? '' : 's'}${x.estimatedMonths ? ' · ' + x.estimatedMonths + ' estimated month' + (x.estimatedMonths === 1 ? '' : 's') : ''}</div></div>
      ${warn.length ? `<div class="ins-warn" data-testid="ins-needs-checking"><h3>Needs checking</h3>${warn.map((w) => `<button type="button" class="ins-warn-row" data-slip="${w.date}">⚠ <b>Payslip ${esc(U().dShow(w.date))}</b>: ${esc(w.text)}</button>`).join('')}</div>` : ''}
      ${st.reordering ? '<p class="hint ins-reorder-hint">Drag cards to reorder, then tap Done. <button type="button" class="btn ghost" id="ins-reorder-done">Done</button></p>' : ''}
      <div class="ins-cards${st.reordering ? ' reordering' : ''}" id="ins-cards">${order(m.s).map((c) => cardHtml(c, m)).join('')}</div>
      ${actions}
      <p class="hint">Estimates use your Settings → Pay rates and timesheets until a payslip replaces them. Long-press a card title to reorder.</p>`;
    body.querySelectorAll('[data-slip]').forEach((b) => { b.onclick = () => { const p = m.slips.find((q) => q.date === b.getAttribute('data-slip')); if (p) U().payslipSheet(p, null, readLines(p)); }; });
    body.querySelectorAll('[data-card]').forEach((el) => {
      const card = el.getAttribute('data-card');
      el.addEventListener('click', (e) => {
        if (st.reordering) return;
        if (e.target.closest('[data-forecast]')) { openForecast(); return; }
        breakdownSheet(card === 'mix' ? 'gross' : card, m);
      });
      const handle = el.querySelector('.ins-card-title');
      let t = null;
      const startPress = () => { t = setTimeout(() => { t = null; st.reordering = true; render(); }, 550); };
      const cancel = () => { if (t) clearTimeout(t); t = null; };
      handle.addEventListener('pointerdown', startPress); handle.addEventListener('pointerup', cancel); handle.addEventListener('pointerleave', cancel);
      handle.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    if (st.reordering) wireReorder(m);
    const mx = body.querySelector('[data-card="mix"]'); if (mx) wireDonut(mx, x);
    const pc = body.querySelector('[data-card="pension"] .ins-chart'); if (pc) wireScrub(pc);
    wireActions(m);
  }

  // ——— 1.2.8-web Earnings breakdown donut (Android's Donut: 12 o'clock, clockwise, fixed colours) ———
  function donutCard(x) {
    const g = U().gbp0; const d = I().donutSlices(x.breakdown);
    const R = 40, C = 2 * Math.PI * R;
    const arcs = d.slices.map((sl, i) => {
      const len = Math.max(0, (sl.end - sl.start) * C - (d.slices.length > 1 ? 1 : 0));
      return `<circle class="ins-donut-seg" data-seg="${i}" cx="50" cy="50" r="${R}" fill="none" stroke="${sl.colour}" stroke-width="16"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-sl.start * C).toFixed(2)}" transform="rotate(-90 50 50)"
        tabindex="0" role="button" aria-label="${esc(sl.label)} ${esc(g(sl.amount))}, ${sl.pct}%"><title>${esc(sl.label)} ${esc(g(sl.amount))} · ${sl.pct}%</title></circle>`;
    }).join('');
    const ring = d.slices.length ? arcs : `<circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--border)" stroke-width="16"/>`;
    const legend = d.slices.length ? d.slices.map((sl, i) => `<button type="button" class="ins-legend-row" data-seg="${i}"><span class="ins-dot" style="background:${sl.colour}"></span><span class="ins-legend-label">${esc(sl.label)}</span><span class="ins-legend-amt">${esc(g(sl.amount))}</span></button>`).join('')
      : '<p class="hint">No earnings yet</p>';
    return `<div class="ins-card ins-mix" data-card="mix" role="group" aria-label="Earnings breakdown" data-testid="ins-card-mix" data-total="${d.total.toFixed(2)}">
      <div class="ins-card-head"><span class="ins-card-title">Earnings breakdown</span></div>
      <div class="ins-donut-wrap"><svg class="ins-donut" viewBox="0 0 100 100" role="img" aria-label="Gross ${esc(g(d.total))} by earnings type">${ring}</svg>
        <div class="ins-donut-centre" aria-live="polite" data-testid="ins-donut-centre"><b>${esc(g(d.total))}</b><span>Gross</span></div></div>
      <div class="ins-legend">${legend}</div></div>`;
  }

  function wireDonut(card, x) {
    const d = I().donutSlices(x.breakdown); const g = U().gbp0;
    const centre = card.querySelector('.ins-donut-centre'); let on = -1;
    const show = (i) => {
      on = i;
      card.querySelectorAll('[data-seg]').forEach((el) => el.classList.toggle('dim', i >= 0 && Number(el.getAttribute('data-seg')) !== i));
      card.querySelectorAll('.ins-legend-row').forEach((el) => el.classList.toggle('on', Number(el.getAttribute('data-seg')) === i));
      const sl = d.slices[i];
      centre.innerHTML = sl ? `<b>${esc(g(sl.amount))}</b><span>${esc(sl.label)}</span><span>${sl.pct}%</span>` : `<b>${esc(g(d.total))}</b><span>Gross</span>`;
    };
    card.querySelectorAll('[data-seg]').forEach((el) => {
      const i = Number(el.getAttribute('data-seg'));
      el.addEventListener('click', (e) => { e.stopPropagation(); show(on === i ? -1 : i); });
      if (el.tagName.toLowerCase() === 'circle') el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); show(on === i ? -1 : i); } });
      if (el.tagName.toLowerCase() === 'circle') { el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(i); }); el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(-1); }); }
    });
  }

  function needsChecking(m) {
    const out = [];
    for (const p of m.slips.filter((q) => I().taxYearOf(q.date) === st.year)) {
      const e = S().equalised(p);
      for (const w of e.warnings) out.push({ date: p.date, text: w });
    }
    return out;
  }

  function cardHtml(c, m) {
    const x = m.sum; const g = U().gbp0;
    const titles = { gross: 'Gross', takehome: 'Take home', tax: 'Tax', mix: 'Earnings breakdown', pension: 'Total pension', employer: 'Employer pension', offshore: 'Offshore days', bonus: 'Bonus' };
    let value = '', side = '', extra = '', wide = false;
    switch (c) {
      case 'gross': value = g(x.grossYtd); break; // 1.2.8-web: the split moved to the Earnings breakdown donut
      case 'mix': return donutCard(x);
      case 'takehome': value = g(x.takeHome); side = x.grossYtd > 0 ? Math.round(x.takeHome / x.grossYtd * 100) + '% of gross' : ''; break;
      case 'tax': value = g(x.tax); side = 'UK ' + g(x.ukTax) + '<br>Non UK ' + g(x.foreignTax) + (x.estimatedTax ? '<br>Est. ' + g(x.estimatedTax) : ''); break;
      case 'employer': value = g(x.employerPension); side = 'incl. your ' + g(x.pension); break;
      case 'offshore': value = String(Math.round(x.offshoreDays)); side = 'days'; break;
      case 'bonus': value = g(x.bonus); side = x.bonusMonths.length ? 'Paid ' + x.bonusMonths.map((mm) => U().MON[Number(mm.slice(5, 7)) - 1]).join(', ') : 'None yet'; break;
      case 'pension': {
        wide = true; value = g(x.totalPension);
        const pts = I().points(m.slips, m.est, m.t);
        const ser = I().pensionSeries(pts, m.pots, m.t);
        side = '<button type="button" class="linklike" data-forecast>Forecast ›</button>';
        extra = `${ser.growth ? `<div class="ins-growth ${ser.growth[0] < 0 ? 'down' : 'up'}">Growth ${esc(I().growthLabel(ser.growth))}</div>` : ''}${pensionChart(ser, m.t)}<div class="hint">Tap to forecast to age 100</div>`;
        break;
      }
      default: break;
    }
    return `<div class="ins-card${wide ? ' wide' : ''}" data-card="${c}" role="button" tabindex="0" data-testid="ins-card-${c}">
      <div class="ins-card-head"><span class="ins-card-title">${esc(titles[c])}</span><span class="ins-side">${side}</span></div>
      <div class="ins-card-value">${esc(value)}</div>${extra}</div>`;
  }

  // ——— pension chart (paid-in area + amber pot line on top) ———
  function pensionChart(ser, today) {
    if (!ser.paidIn.length && !ser.pots.length) return '<div class="ins-chart-empty hint">No pension contributions yet</div>';
    const W = 320, H = 150, L = 38, R = 8, T = 8, B = 20;
    const pts = ser.paidIn.map(([d, v]) => ({ d, v })), pots = ser.pots.map((p) => ({ d: p.date, v: p.value }));
    const all = pts.concat(pots);
    const t0 = Date.parse(all.reduce((a, p) => (p.d < a ? p.d : a), all[0].d)), t1 = Math.max(Date.parse(today), t0 + 864e5);
    const vmax = Math.max(1, ...all.map((p) => p.v)) * 1.08;
    const X = (d) => L + (Date.parse(d) - t0) / (t1 - t0) * (W - L - R), Y = (v) => T + (1 - v / vmax) * (H - T - B);
    const ticks = [0, 0.5, 1].map((f) => vmax / 1.08 * f);
    const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e3e3e3"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" font-size="9" fill="#5c5c5c">£${Math.round(v / 1000)}k</text>`).join('');
    const line = (a) => a.map((p, i) => (i ? 'L' : 'M') + X(p.d).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
    let area = '';
    if (pts.length) area = `<path d="${line(pts)} L${X(pts[pts.length - 1].d).toFixed(1)} ${Y(0)} L${X(pts[0].d).toFixed(1)} ${Y(0)} Z" fill="url(#insg)"/><path d="${line(pts)}" fill="none" stroke="${GREEN}" stroke-width="2"/>`;
    const potLine = pots.length ? `<path d="${line(pots)}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/><path d="${line(pots)}" fill="none" stroke="${AMBER}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
      pots.map((p) => `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="4" fill="${AMBER}" stroke="#fff" stroke-width="1.5"/>`).join('') : '';
    const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
    const step = Math.max(1, Math.ceil((y1 - y0 + 1) / 5));
    let xl = ''; for (let y = y0 + 1; y <= y1; y += step) { const d = y + '-01-01'; if (Date.parse(d) > t0) xl += `<text x="${X(d)}" y="${H - 5}" text-anchor="middle" font-size="9" fill="#5c5c5c">${y}</text>`; }
    const data = JSON.stringify({ t0, t1, L, R, W, paid: ser.paidIn, pots: ser.pots.map((p) => [p.date, p.value]) });
    return `<div class="ins-chart" data-series='${esc(data)}'><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pension paid in and pot value">
      <defs><linearGradient id="insg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GREEN}" stop-opacity=".35"/><stop offset="1" stop-color="${GREEN}" stop-opacity=".03"/></linearGradient></defs>
      ${grid}${xl}${area}${potLine}<line class="scrub" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#888" stroke-dasharray="3 3" visibility="hidden"/></svg>
      <div class="ins-legend"><span><i style="background:${GREEN}"></i>Paid in</span>${pots.length ? `<span><i style="background:${AMBER}"></i>Pot value</span>` : ''}</div>
      <div class="ins-tip hidden"></div></div>`;
  }
  function wireScrub(el) {
    const d = JSON.parse(el.getAttribute('data-series'));
    const svg = el.querySelector('svg'), tip = el.querySelector('.ins-tip'), ln = svg.querySelector('.scrub');
    const move = (e) => {
      const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * d.W;
      const t = d.t0 + (x - d.L) / (d.W - d.L - d.R) * (d.t1 - d.t0); if (!(t >= d.t0 && t <= d.t1)) return;
      const iso = new Date(t).toISOString().slice(0, 10);
      let paid = 0; for (const [dd, v] of d.paid) if (dd <= iso) paid = v;
      let pot = null; for (const [dd, v] of d.pots) if (dd <= iso) pot = v;
      ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.setAttribute('visibility', 'visible');
      tip.classList.remove('hidden');
      tip.innerHTML = `${U().MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}<br>Paid in ${U().gbp0(paid)}${pot != null ? '<br>Pot ' + U().gbp0(pot) : ''}`;
      tip.style.left = Math.min(r.width - 110, Math.max(0, e.clientX - r.left - 50)) + 'px';
    };
    svg.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse' && !e.buttons && e.pointerType) return; move(e); });
    svg.addEventListener('pointerdown', (e) => { e.stopPropagation(); move(e); });
    svg.addEventListener('click', (e) => e.stopPropagation());
    svg.addEventListener('pointerleave', () => { tip.classList.add('hidden'); ln.setAttribute('visibility', 'hidden'); });
  }

  // ——— reorder (long-press, then drag) ———
  function wireReorder(m) {
    const box = document.getElementById('ins-cards');
    document.getElementById('ins-reorder-done').onclick = async () => {
      const o = Array.from(box.querySelectorAll('[data-card]')).map((e) => e.getAttribute('data-card'));
      st.reordering = false;
      await P().saveSettings({ ...P().settings(), insightsOrder: o });
      render();
    };
    let drag = null;
    box.querySelectorAll('[data-card]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => { drag = el; el.classList.add('dragging'); el.setPointerCapture(e.pointerId); e.preventDefault(); });
      el.addEventListener('pointermove', (e) => {
        if (drag !== el) return;
        const over = document.elementsFromPoint(e.clientX, e.clientY).map((n) => n.closest && n.closest('[data-card]')).find((n) => n && n !== el);
        if (!over) return;
        const r = over.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2 || (e.clientY < r.bottom && e.clientX < r.left + r.width / 2 && r.width < box.clientWidth * 0.8);
        box.insertBefore(el, before ? over : over.nextSibling);
      });
      const end = () => { if (drag === el) { el.classList.remove('dragging'); drag = null; } };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    });
  }

  // ——— breakdown sheet per card ———
  function breakdownSheet(card, m) {
    const b = I().breakdown(card, m.slips, m.est, st.year, m.t, m.start ? { value: m.start.value, date: m.start.date } : null);
    const fmt = (v) => (b.count ? String(Math.round(v)) : U().gbp(v));
    const sh = A().openSheet(`<div class="sheet pay-breakdown" role="dialog" aria-modal="true" data-testid="ins-breakdown"><div class="sheet-grip"></div>
      <h2>${esc(b.title)} · ${I().yearLabel(st.year)}</h2>
      ${b.start ? `<div class="pb-line"><span>Pot value on ${esc(U().dShow(b.start.date))}</span><span>${esc(U().gbp(b.start.value))}</span></div>` : ''}
      ${b.rows.length ? b.rows.map((r) => `<button type="button" class="ins-brow" ${r.payDate ? `data-slip="${r.payDate}"` : ''}>
        <span class="pb-line bold"><span>${esc(U().MONTH[Number(r.payMonth.slice(5, 7)) - 1])} ${r.payMonth.slice(0, 4)} ${r.estimate ? '<span class="est-tag">Estimate</span>' : ''}</span><span>${esc(fmt(r.value))}</span></span>
        ${r.parts.map((p) => `<span class="pb-line sub"><span>${esc(p[0])}</span><span>${esc(U().gbp(p[1]))}</span></span>`).join('')}
        ${r.note ? `<span class="hint">${esc(r.note)}</span>` : ''}</button>`).join('') : '<p class="hint">Nothing this tax year.</p>'}
      <hr/><div class="pb-net"><span>Total</span><span>${esc(fmt(b.total))}</span></div>
      ${b.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join('')}
      <div class="sheet-actions">${card === 'pension' ? '<button type="button" class="btn secondary" data-fc>Forecast ›</button>' : ''}<button type="button" class="btn ghost" data-close>Close</button></div></div>`);
    sh.el.querySelectorAll('[data-slip]').forEach((x) => { x.onclick = () => { const p = m.slips.find((q) => q.date === x.getAttribute('data-slip')); if (p) U().payslipSheet(p, null, readLines(p)); }; });
    const fc = sh.el.querySelector('[data-fc]'); if (fc) fc.onclick = () => { sh.close(); openForecast(); };
  }

  function readLines(p) {
    const mapped = S().mappedLines(p);
    return `<details class="pay-read"><summary>Every line read from the PDF (${mapped.length})</summary>
      ${mapped.map((x) => `<div class="pb-line sub"><span>${esc(x.line.label)}${x.guessed ? ' ⚠' : ''} <small>${esc(S().CATEGORY[x.category].label)}</small></span><span>${esc(U().gbp(x.line.amount))}</span></div>`).join('')}
      <div class="pb-line sub"><span>TOTAL</span><span>${esc(U().gbp(p.total))}</span></div><div class="pb-line sub"><span>NET PAY</span><span>${esc(U().gbp(p.net))}</span></div>
      ${p.taxableYtd != null ? `<div class="pb-line sub"><span>Taxable pay to date</span><span>${esc(U().gbp(p.taxableYtd))}</span></div>` : ''}
      ${p.ersPension != null ? `<div class="pb-line sub"><span>Ers Pension</span><span>${esc(U().gbp(p.ersPension))}</span></div>` : ''}</details>`;
  }

  // ——— Manage payslips ———
  async function showManage() {
    injectViews();
    const m = await model();
    document.getElementById('ins-manage-title').textContent = 'Payslips ' + (st.year != null ? I().yearLabel(st.year) : '');
    const list = m.slips.filter((p) => st.year == null || I().taxYearOf(p.date) === st.year).reverse();
    const body = document.getElementById('ins-manage-body');
    body.innerHTML = `<div class="pay-card">${list.length ? list.map((p) => {
      const e = S().equalised(p);
      return `<button type="button" class="pay-row" data-slip="${p.date}"><span class="pr-main"><span class="pr-label">${esc(U().dShow(p.date))} · P${p.period}</span><span class="pr-sub">Gross ${esc(U().gbp(e.gross))} · net ${esc(U().gbp(p.net))}${e.warnings.length ? ' · ⚠ ' + e.warnings.length + ' to check' : ''}</span></span><span class="pr-val">›</span></button>`;
    }).join('') : '<p class="hint" style="padding:12px">No payslips for this tax year.</p>'}</div>
      <button type="button" class="btn secondary pay-wide" id="ins-manage-import">Import payslip PDF</button>`;
    body.querySelectorAll('[data-slip]').forEach((b) => { b.onclick = () => {
      const p = m.slips.find((q) => q.date === b.getAttribute('data-slip'));
      const sh = U().payslipSheet(p, null, readLines(p) + '<button type="button" class="btn ghost danger" data-del-slip>Delete payslip…</button>');
      sh.el.querySelector('[data-del-slip]').onclick = async () => {
        sh.close();
        if (!(await U().confirmSheet('Delete payslip?', 'Removes the payslip ' + U().dShow(p.date) + ' and its PDF from this device.', 'Delete'))) return;
        await P().removePayslips([p.date]); A().toast('Payslip deleted'); showManage();
      };
    }; });
    document.getElementById('ins-manage-import').onclick = () => document.getElementById('ins-payslip-file').click();
    A().showView('ins-manage');
  }

  function wireActions() {
    const i = document.getElementById('ins-import'); if (i) i.onclick = () => document.getElementById('ins-payslip-file').click();
    const mg = document.getElementById('ins-manage'); if (mg) mg.onclick = showManage;
  }

  // ——— payslip import ———
  async function readPdf(file) {
    const buf = await file.arrayBuffer();
    const text = await global.AsPayPdf.text(buf);
    return { text, blob: new Blob([buf], { type: 'application/pdf' }) };
  }
  function slipChecks(p, all) {
    const out = [];
    const e = S().equalised(p);
    out.push(S().checksOut(p) ? ['ok', 'Earnings add up to TOTAL'] : ['bad', "Earnings don't add up to TOTAL"]);
    const prev = all.filter((q) => q.date < p.date && I().taxYearOf(q.date) === I().taxYearOf(p.date)).pop();
    if (p.period === 1) out.push(['ok', 'Chain: first period of the tax year']);
    else if (!prev) out.push(['warn', 'Chain: no earlier payslip this tax year']);
    else if (prev.period !== p.period - 1) out.push(['warn', 'Chain: previous payslip is period ' + prev.period + ' (missing period ' + (p.period - 1) + ')']);
    else if (p.taxableYtd != null && prev.taxableYtd != null) {
      const add = C().round2(p.taxableYtd - prev.taxableYtd);
      out.push(['ok', 'Chain: follows period ' + prev.period + ' (taxable pay +' + U().gbp(add) + ')']);
    } else out.push(['ok', 'Chain: follows period ' + prev.period]);
    for (const w of e.warnings) out.push(['bad', w]);
    return out;
  }
  async function importPayslipFiles(files) {
    for (const f of Array.from(files || [])) {
      let r;
      try { r = await readPdf(f); } catch (e) { console.error(e); A().toast("Couldn't open " + f.name); continue; }
      const p = S().parse(r.text);
      if (!p) { U().info('Not a payslip', "This doesn't look like a payslip (no date, period, TOTAL and NET PAY found)."); continue; }
      const all = I().dedupe(P().payslips());
      const exists = all.find((q) => q.date === p.date);
      const checks = slipChecks(p, all);
      const allOk = checks.every((c) => c[0] !== 'bad');
      const res = await P().periodResults();
      const est = (await P().estimates()).length ? res.get(C().ymPlus(p.date.slice(0, 7), -1)) : null;
      const cmp = est ? `<p class="pay-sub-h">Payslip vs estimate</p>${[['Gross', S().equalised(p).gross, est.gross], ['Net', p.net, est.net]].map(([l, a, b]) =>
        `<div class="pb-line sub"><span>${l}</span><span>${U().gbp(a)} vs ${U().gbp(b)} (${a - b >= 0 ? '+' : '−'}${U().gbp(Math.abs(a - b))})</span></div>`).join('')}` : '';
      const ok = await new Promise((resolve) => {
        const sh = U().payslipSheet(p, null, `<div class="pay-checks">${checks.map((c) => `<p class="chk ${c[0]}">${c[0] === 'ok' ? '✓' : '⚠'} ${esc(c[1])}</p>`).join('')}</div>${cmp}
          ${exists ? `<p class="hint">A payslip dated ${esc(U().dShow(p.date))} is already saved.</p>` : ''}${readLines(p)}
          <div class="pay-dialog-actions"><span></span><span><button type="button" class="btn ghost" data-skip>${exists ? 'Skip' : 'Cancel'}</button> <button type="button" class="btn primary" data-imp>${!allOk ? 'Import anyway' : exists ? 'Replace' : 'Import'}</button></span></div>`);
        sh.el.querySelector('.sheet-actions').remove();
        sh.el.querySelector('[data-imp]').onclick = () => { resolve(true); sh.el.remove(); };
        sh.el.querySelector('[data-skip]').onclick = () => { resolve(false); sh.el.remove(); };
        const obs = new MutationObserver(() => { if (!sh.el.isConnected) { obs.disconnect(); resolve(false); } });
        obs.observe(document.body, { childList: true });
      });
      if (!ok) continue;
      await P().addPayslips([p]);
      await P().putPdf('payslip', p.date, r.blob);
      A().toast('Payslip ' + U().dShow(p.date) + ' imported');
    }
    if (!document.getElementById('view-ins-manage').classList.contains('hidden')) showManage(); else render();
  }

  // ——— Aviva statement import ———
  async function importStatement(file) {
    let r;
    try { r = await readPdf(file); } catch (e) { console.error(e); A().toast("Couldn't open the PDF"); return; }
    const parsed = N().parse(r.text);
    if (!parsed.statement) { U().info('Aviva statement', "This doesn't look like an Aviva annual statement."); return; }
    const s0 = parsed.statement;
    const s = P().settings();
    const saved = N().chain(s.statements.map(N().normalizeStatement).filter(Boolean));
    const others = saved.filter((x) => x.end !== s0.end);
    const prev = N().previous(others, s0);
    const st1 = N().chainCheck(s0, prev);
    const g = U().gbp, d = U().dShow;
    const checks = [];
    const off = N().addsUpBy(st1);
    checks.push(N().addsUp(st1) ? ['ok', 'Adds up'] : ['bad', "Doesn't add up (off by " + g(Math.abs(off)) + ')']);
    if (!prev) checks.push(['ok', 'Chain: first statement']);
    else if (!st1.adjusted) checks.push(['ok', 'Chain: opening matches the ' + d(prev.end) + ' closing']);
    else checks.push(['bad', 'Chain: printed opening ' + g(st1.printedOpening) + ' ≠ previous closing ' + g(prev.closing) + '. Using ' + g(prev.closing) + '; growth adjusted to ' + (st1.growth < 0 ? '−' : '+') + g(Math.abs(st1.growth))]);
    for (const w of parsed.warnings) checks.push(['bad', w]);
    const slips = I().dedupe(P().payslips()).map((p) => [p.date, I().employerPensionOrEstimate(p)]);
    const rec = N().reconcile(st1, slips);
    const exists = saved.some((x) => x.end === s0.end);
    const allOk = checks.every((c) => c[0] === 'ok');
    const kv = (l, v) => `<div class="pb-line"><span>${esc(l)}</span><span>${esc(v)}</span></div>`;
    const html = `<div class="sheet pay-breakdown" role="dialog" aria-modal="true" data-testid="statement-import"><div class="sheet-grip"></div><h2>Aviva statement</h2>
      <p class="hint">${esc(d(st1.start))} – ${esc(d(st1.end))}</p>
      ${kv('Opening', g(st1.opening))}${kv('Paid in', g(st1.paidIn))}${kv('Paid out', g(st1.paidOut))}${kv('Growth (before charges)', g(st1.growth || 0))}
      ${kv('Charges', g(st1.charges || 0))}${st1.chargePct != null ? kv('Charge rate', st1.chargePct.toFixed(2) + '%') : ''}<hr/>${kv('Closing', g(st1.closing))}
      <div class="pay-checks">${checks.map((c) => `<p class="chk ${c[0]}">${c[0] === 'ok' ? '✓' : '⚠'} ${esc(c[1])}</p>`).join('')}</div>
      ${st1.payments.length ? `<p class="pay-sub-h">Payments vs payslips</p>${rec.rows.map((x) => `<div class="pb-line sub"><span>${esc(d(x.payment.date))} ${esc(g(x.payment.amount))}</span><span class="${x.ok ? 'ok' : 'warn'}">${x.payslipDate == null ? 'No payslip' : x.ok ? '✓ ' + esc(d(x.payslipDate)) : 'Payslip ' + esc(g(x.payslipErs)) + ' (' + (x.diff >= 0 ? '+' : '−') + esc(g(Math.abs(x.diff))) + ')'}</span></div>`).join('')}
        ${rec.notOnStatement.map((x) => `<div class="pb-line sub"><span>Payslip ${esc(d(x[0]))} ${esc(g(x[1]))}</span><span class="warn">Not on statement</span></div>`).join('')}
        <p class="hint">Aviva ${esc(g(rec.avivaTotal))} · Payslips ${esc(g(rec.payslipTotal))} · Diff ${esc(g(rec.difference))} · ${rec.matched} matched, ${rec.unmatched} unmatched</p>` : ''}
      ${exists ? `<p class="hint">A statement ending ${esc(d(s0.end))} is already saved.</p>` : ''}
      <p class="hint">Pot values are tagged Statement. Projections in the PDF are ignored.</p>
      <div class="pay-dialog-actions"><span></span><span><button type="button" class="btn ghost" data-close>${exists ? 'Skip' : 'Cancel'}</button> <button type="button" class="btn primary" data-imp>${!allOk ? 'Import anyway' : exists ? 'Replace' : 'Import'}</button></span></div></div>`;
    const sh = A().openSheet(html);
    sh.el.querySelector('[data-imp]').onclick = async () => {
      sh.close();
      const cur = P().settings();
      const pots = P().pots(cur).filter((p) => p.date !== s0.end).concat({ date: s0.end, value: s0.closing, source: 'Statement' }).sort((a, b) => (a.date < b.date ? -1 : 1));
      const list = N().chain(cur.statements.map(N().normalizeStatement).filter(Boolean).filter((x) => x.end !== s0.end).concat(s0));
      await P().saveSettings({ ...cur, potValues: pots, statements: list.map(N().statementJson), pensionValue: null, pensionValueDate: null });
      await P().putPdf('statement', s0.end, r.blob);
      A().toast('Statement imported');
      if (global.AsPayUi) U().renderPay();
    };
  }

  // ——— Pension forecast ———
  const fc = { v: null, open: { tax: false, adv: false }, employerNi: false };
  function autoForecast() {
    const s = P().settings(); const slips = I().dedupe(P().payslips());
    const pots = P().pots(s); const latest = pots.reduce((b, x) => (!b || x.date > b.date ? x : b), null);
    const sg = N().salaryGrowth(slips);
    const sal = C().salaryFor ? (C().salaryFor(s, C().todayIso().slice(0, 7)) || s.annualSalary) : s.annualSalary;
    // Age: the web doesn't read the locked HR date of birth (known gap); default age is used.
    return N().normalizeForecast({ ...N().FORECAST_DEFAULTS, sac: C().currentPensionPct(s) || N().FORECAST_DEFAULTS.sac,
      pot: latest ? Math.round(latest.value) : N().FORECAST_DEFAULTS.pot, salary: sal > 0 ? Math.round(sal) : N().FORECAST_DEFAULTS.salary,
      salFromSlips: !!sg, salGrowth: sg ? sg[0] : N().FORECAST_DEFAULTS.salFixed });
  }
  async function openForecast() {
    injectViews(); await P().load();
    if (!fc.v) fc.v = autoForecast();
    A().showView('forecast');
    renderForecast();
  }

  function forecastChart(res, v) {
    const W = 340, H = 190, L = 40, R = 8, T = 10, B = 22;
    const rows = res.rows; if (!rows.length) return '';
    const maxPot = Math.max(1, ...rows.map((r) => r.pot)), maxInc = Math.max(v.draw, ...rows.map((r) => r.statePension + r.privateIncome)) * 1.15;
    const a0 = rows[0].age, a1 = rows[rows.length - 1].age;
    const X = (a) => L + (a - a0) / Math.max(1, a1 - a0) * (W - L - R);
    const Yp = (x) => T + (1 - x / (maxPot * 1.08)) * (H - T - B), Yi = (x) => T + (1 - x / maxInc) * (H - T - B);
    const bw = Math.max(1.5, (W - L - R) / rows.length - 1);
    const bars = rows.map((r) => {
      if (!(r.statePension + r.privateIncome)) return '';
      const x = X(r.age) - bw / 2;
      return `<rect x="${x}" y="${Yi(r.statePension)}" width="${bw}" height="${Yi(0) - Yi(r.statePension)}" fill="#66BB6A"/><rect x="${x}" y="${Yi(r.statePension + r.privateIncome)}" width="${bw}" height="${Yi(r.statePension) - Yi(r.statePension + r.privateIncome)}" fill="#42A5F5"/>`;
    }).join('');
    const target = `<line x1="${X(v.retire)}" x2="${W - R}" y1="${Yi(v.draw)}" y2="${Yi(v.draw)}" stroke="#555" stroke-dasharray="5 4"/>`;
    const path = rows.map((r, i) => (i ? 'L' : 'M') + X(r.age).toFixed(1) + ' ' + Yp(r.pot).toFixed(1)).join(' ');
    const ylab = [0, 0.5, 1].map((f) => `<text x="${L - 4}" y="${Yp(maxPot * f) + 3}" text-anchor="end" font-size="9" fill="#5c5c5c">£${Math.round(maxPot * f / 1000)}k</text><line x1="${L}" x2="${W - R}" y1="${Yp(maxPot * f)}" y2="${Yp(maxPot * f)}" stroke="#eee"/>`).join('');
    let xl = ''; for (let a = Math.ceil(a0 / 10) * 10; a <= a1; a += 10) xl += `<text x="${X(a)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#5c5c5c">${a}</text>`;
    return `<svg class="fc-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pension forecast chart">${ylab}${xl}${bars}${target}
      <path d="${path}" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round" opacity=".9"/><path d="${path}" fill="none" stroke="${AMBER}" stroke-width="4.5" stroke-linejoin="round"/></svg>
      <div class="ins-legend"><span><i style="background:${AMBER}"></i>Pot</span><span><i style="background:#42A5F5"></i>Private income</span><span><i style="background:#66BB6A"></i>State pension</span><span><i class="dash"></i>Target</span></div>`;
  }

  function taxChart(salary, pct, maxPct) {
    const TS = N().TaxSavings;
    const W = 340, H = 170, L = 44, R = 8, T = 8, B = 22;
    const n = 60, pts = []; for (let i = 0; i <= n; i++) pts.push(TS.at(salary, maxPct * i / n));
    const maxY = Math.max(...pts.map((p) => Math.max(p.takeHome, p.taxAndNi))) * 1.08;
    const X = (p) => L + p / maxPct * (W - L - R), Y = (v) => T + (1 - v / maxY) * (H - T - B);
    const COL = { NONE: '#F1F5F1', STARTER: '#EAF5EA', BASIC: '#E0F0E0', INTERMEDIATE: '#D3EAD3', HIGHER: '#FDE2E2', ADVANCED: '#F9CFCF', TAPER: '#FFD9A8', TOP: '#E8D5F5' };
    const zones = TS.zones(salary, maxPct).map((z) => `<rect x="${X(z.fromPct)}" y="${T}" width="${X(z.toPct) - X(z.fromPct)}" height="${H - T - B}" fill="${COL[z.zone.id]}"><title>${esc(z.zone.label)} ${esc(z.zone.short)}</title></rect>`).join('');
    const ln = (k) => pts.map((p, i) => (i ? 'L' : 'M') + X(p.pct).toFixed(1) + ' ' + Y(p[k]).toFixed(1)).join(' ');
    const t100 = TS.thresholds(salary).find((t) => t.income === TS.TAPER_FROM);
    const line100 = t100 && t100.pct <= maxPct ? `<line x1="${X(t100.pct)}" x2="${X(t100.pct)}" y1="${T}" y2="${H - B}" stroke="#E65100" stroke-dasharray="4 3"/><text x="${X(t100.pct) + 3}" y="${T + 10}" font-size="9" fill="#E65100">£100k at ${t100.pct}%</text>` : '';
    const cur = TS.at(salary, pct);
    let xl = ''; const step = maxPct > 40 ? 10 : 5; for (let p = 0; p <= maxPct; p += step) xl += `<text x="${X(p)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#5c5c5c">${p}%</text>`;
    const yl = [0, 0.5, 1].map((f) => `<text x="${L - 4}" y="${Y(maxY / 1.08 * f) + 3}" text-anchor="end" font-size="9" fill="#5c5c5c">£${Math.round(maxY / 1.08 * f / 1000)}k</text>`).join('');
    // cost per £1 step chart
    const cH = 90, cT = 8, cB = 20;
    const cy = (v) => cT + (1 - v) * (cH - cT - cB);
    let cp = ''; for (let i = 0; i <= n; i++) { const p = pts[i]; cp += (i ? 'L' : 'M') + X(p.pct).toFixed(1) + ' ' + cy(TS.costPerPound(p.income)).toFixed(1); }
    return `<p class="pay-sub-h">Take-home pay vs pension %</p><svg class="fc-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Take-home pay vs pension percent">${zones}${yl}${xl}
      <path d="${ln('taxAndNi')}" fill="none" stroke="#888" stroke-width="2" stroke-dasharray="5 4"/><path d="${ln('takeHome')}" fill="none" stroke="${AMBER}" stroke-width="3"/>${line100}
      <circle cx="${X(pct)}" cy="${Y(cur.takeHome)}" r="5" fill="${AMBER}" stroke="#333" stroke-width="1.5"/></svg>
      <p class="hint">━ Take-home ╌ Tax + NI · Shading = Scottish tax band</p>
      <p class="pay-sub-h">Cost per £1 contributed</p><svg class="fc-chart" viewBox="0 0 ${W} ${cH}" role="img" aria-label="Cost per pound contributed">
      ${[0, 0.5, 1].map((f) => `<text x="${L - 4}" y="${cy(f) + 3}" text-anchor="end" font-size="9" fill="#5c5c5c">${Math.round(f * 100)}p</text><line x1="${L}" x2="${W - R}" y1="${cy(f)}" y2="${cy(f)}" stroke="#eee"/>`).join('')}
      <path d="${cp}" fill="none" stroke="#1B5E3F" stroke-width="2.5"/><line x1="${X(pct)}" x2="${X(pct)}" y1="${cT}" y2="${cH - cB}" stroke="#1B5E3F" stroke-dasharray="3 3"/></svg>`;
  }

  function slider(key, label, min, max, step, val, fmt) {
    return `<label class="fc-slider">${esc(label)} <b data-out="${key}">${esc(fmt(val))}</b><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}" /></label>`;
  }

  function renderForecast() {
    const body = document.getElementById('forecast-body'); if (!body) return;
    const v = fc.v; const g = U().gbp0;
    const slips = I().dedupe(P().payslips());
    const sgd = N().salaryGrowth(slips);
    const inp = { ...v, salGrowth: v.salFromSlips && sgd ? sgd[0] : v.salFixed };
    const res = N().forecast(inp);
    const TS = N().TaxSavings;
    const max = TS.sliderMax(v.salary);
    const s = P().settings();
    const sum = TS.summary(v.salary, v.sac, fc.employerNi);
    const nextT = TS.thresholds(v.salary).filter((t) => t.pct > v.sac + 1e-9).sort((a, b) => a.pct - b.pct)[0];
    const nextTxt = nextT ? (() => {
      const a = TS.at(v.salary, v.sac), b = TS.at(v.salary, nextT.pct);
      const drop = a.takeHome - b.takeHome, saved = (b.contribution - a.contribution) - drop;
      return `<p>Going up to ${nextT.pct}% (+${g(b.contribution - a.contribution)}) takes your pay to ${esc(nextT.label)}${nextT.income === TS.TAPER_FROM ? ' and gets your personal allowance back' : ''}: take-home drops ${g(drop)}, ${g(saved)} is tax &amp; NI saved.</p>
        <button type="button" class="btn secondary" data-jump="${nextT.pct}">Jump to ${nextT.pct}%</button>`;
    })() : '';
    const money = v.real ? "today's money" : 'future money';
    const scen = (s.forecasts || []).map((f, i) => { const n = N().normalizeForecast(f); return `<div class="pay-row static"><span class="pr-main"><button type="button" class="linklike" data-load="${i}">${esc(n.name)} — ${esc(N().forecast({ ...n, salGrowth: n.salFromSlips && sgd ? sgd[0] : n.salFixed }).headline)}</button></span><button type="button" class="btn ghost danger" data-del="${i}">Delete</button></div>`; }).join('');
    body.innerHTML = `
      <p class="hint">Estimate, not financial advice</p>
      <h2 class="fc-head" data-testid="fc-headline">${esc(res.headline)}</h2>
      <p>Pot at ${v.retire}: <b>${g(res.potAtRetirement)}</b> · Lump sum <b>${g(res.lumpSum)}</b> · ${money}</p>
      ${forecastChart(res, v)}
      <p class="hint">From Pay settings: you ${U().num(C().currentPensionPct(s))}% + employer 7.5% of the £520–£4,189 band (max ${g(C().PensionBand.band(1e9) * 12 * (v.sac + 7.5) / 100)}/yr)</p>
      <div class="panel fc-sliders">
        ${slider('sac', 'Your contribution', 0, max, 0.5, Math.min(v.sac, max), (x) => x + '%')}
        ${slider('retire', 'Withdrawal age', 55, 75, 1, v.retire, (x) => String(x))}
        ${slider('draw', 'Target income', 5000, 60000, 500, v.draw, (x) => g(x) + '/yr')}
        ${slider('lump', 'Tax-free lump sum', 0, 25, 1, v.lump, (x) => x + '% (max £268,275)')}
      </div>
      <button type="button" class="pay-row pay-exp" data-sec="tax" aria-expanded="${fc.open.tax}"><span class="pr-main"><span class="pr-label">${fc.open.tax ? '▾' : '▸'} Tax savings</span></span></button>
      ${fc.open.tax ? `<div class="panel" data-testid="fc-tax">
        <p class="hint">Using the forecast's starting salary ${g(v.salary)}/yr (before growth) and your contribution ${v.sac}% (salary sacrifice).</p>
        <label class="toggle-control fc-toggle"><input type="checkbox" id="fc-employer-ni" ${fc.employerNi ? 'checked' : ''}/> Employer pays its NI saving into my pension (13.8%)</label>
        ${taxChart(v.salary, Math.min(v.sac, max), max)}
        <p>At ${v.sac}% you put in ${g(sum.contribution)} a year. Take-home drops by only ${g(sum.cost)}; the other ${g(sum.saved)} is tax &amp; NI you don't pay. The next £1 costs you about ${Math.round(TS.costPerPound(TS.at(v.salary, v.sac).income) * 100)}p.</p>
        <p>Tax-free amount going into your pension: <b>${g(sum.intoPension)}</b>${fc.employerNi ? ' (incl. employer NI saving)' : ''}</p>
        ${nextTxt}
        <p class="hint">Scottish income tax rates ${TS.TAX_YEAR}; NI and the personal allowance taper (£100k–£125,140) are UK-wide. Check the annual allowance (£60,000) if you contribute a lot.</p></div>` : ''}
      <button type="button" class="pay-row pay-exp" data-sec="adv" aria-expanded="${fc.open.adv}"><span class="pr-main"><span class="pr-label">${fc.open.adv ? '▾' : '▸'} Advanced settings</span></span></button>
      ${fc.open.adv ? `<div class="panel fc-adv">
        <div class="grid-2"><label>State pension £/yr<input type="number" data-n="spAmt" value="${v.spAmt}"/></label><label>State pension age<input type="number" data-n="spAge" value="${v.spAge}"/></label></div>
        <p class="pay-sub-h">Salary growth</p><div class="chip-row"><button type="button" class="chip${v.salFromSlips ? ' on' : ''}" data-sg="1">From my payslips (average)</button><button type="button" class="chip${!v.salFromSlips ? ' on' : ''}" data-sg="0">Fixed % per year</button></div>
        ${v.salFromSlips ? `<p class="hint">${sgd ? `Average ${sgd[0]}%/yr from full tax years of basic pay (range ${sgd[1]}% to ${sgd[2]}%)` : 'Payslip average needs 2 or more full tax years of basic pay.'}</p>` : `<label>Fixed % per year<input type="number" step="0.1" data-n="salFixed" value="${v.salFixed}"/></label>`}
        <p class="pay-sub-h">Investment growth</p><div class="chip-row">${[['Low', 2], ['Mid', 5], ['High', 7]].map(([l, r]) => `<button type="button" class="chip${v.rate === r ? ' on' : ''}" data-rate="${r}">${l} ${r}%</button>`).join('')}</div>
        <div class="grid-2"><label>Charges %<input type="number" step="0.05" data-n="charge" value="${v.charge}"/></label><label>Inflation %<input type="number" step="0.1" data-n="infl" value="${v.infl}"/></label>
        <label>Pension band growth %<input type="number" step="0.1" data-n="bandG" value="${v.bandG}"/></label><label>Investment growth %<input type="number" step="0.1" data-n="rate" value="${v.rate}"/></label>
        <label>Age<input type="number" data-n="age" value="${v.age}"/></label><label>Pot £<input type="number" data-n="pot" value="${v.pot}"/></label><label>Salary £<input type="number" data-n="salary" value="${v.salary}"/></label></div>
        <label class="toggle-control fc-toggle"><input type="checkbox" id="fc-real" ${v.real ? 'checked' : ''}/> Today's money</label>
        <p class="hint">Age isn't read from your locked HR details on the web; set it here.</p>
        <button type="button" class="btn ghost" id="fc-reset">Reset to auto-filled values</button></div>` : ''}
      ${scen ? `<p class="pay-sub-h">Saved scenarios</p><div class="pay-card">${scen}</div>` : ''}
      <button type="button" class="btn primary pay-wide" id="fc-save" data-testid="fc-save">Save scenario</button>
      <div class="fc-bottom-pad"></div>`;
    wireForecast(body);
  }
  function wireForecast(body) {
    const set = (k, val) => { fc.v = N().normalizeForecast({ ...fc.v, [k]: val }); renderForecast(); };
    body.querySelectorAll('input[type="range"]').forEach((r) => {
      r.oninput = () => { const o = body.querySelector(`[data-out="${r.getAttribute('data-k')}"]`); if (o) o.textContent = r.value; };
      r.onchange = () => { const y = window.scrollY; set(r.getAttribute('data-k'), Number(r.value)); window.scrollTo(0, y); };
    });
    body.querySelectorAll('[data-n]').forEach((i) => { i.onchange = () => { if (i.value !== '' && isFinite(i.value)) { const y = window.scrollY; set(i.getAttribute('data-n'), Number(i.value)); window.scrollTo(0, y); } }; });
    body.querySelectorAll('[data-sec]').forEach((b) => { b.onclick = () => { const k = b.getAttribute('data-sec'); fc.open[k] = !fc.open[k]; const y = window.scrollY; renderForecast(); window.scrollTo(0, y); }; });
    body.querySelectorAll('[data-sg]').forEach((b) => { b.onclick = () => set('salFromSlips', b.getAttribute('data-sg') === '1'); });
    body.querySelectorAll('[data-rate]').forEach((b) => { b.onclick = () => set('rate', Number(b.getAttribute('data-rate'))); });
    body.querySelectorAll('[data-jump]').forEach((b) => { b.onclick = () => { const y = window.scrollY; set('sac', Number(b.getAttribute('data-jump'))); window.scrollTo(0, y); }; });
    const en = document.getElementById('fc-employer-ni'); if (en) en.onchange = () => { fc.employerNi = en.checked; const y = window.scrollY; renderForecast(); window.scrollTo(0, y); };
    const re = document.getElementById('fc-real'); if (re) re.onchange = () => set('real', re.checked);
    const rs = document.getElementById('fc-reset'); if (rs) rs.onclick = () => { fc.v = autoForecast(); renderForecast(); };
    body.querySelectorAll('[data-load]').forEach((b) => { b.onclick = () => { fc.v = N().normalizeForecast(P().settings().forecasts[+b.getAttribute('data-load')]); renderForecast(); window.scrollTo(0, 0); }; });
    body.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { const s = P().settings(); await P().saveSettings({ ...s, forecasts: s.forecasts.filter((_, j) => j !== +b.getAttribute('data-del')) }); renderForecast(); }; });
    document.getElementById('fc-save').onclick = () => {
      const s = P().settings();
      U().dialog('Save scenario', [{ label: 'Name', value: 'Scenario ' + ((s.forecasts || []).length + 1), numeric: false }], async (vals) => {
        if (!vals[0].trim()) return false;
        const cur = P().settings();
        await P().saveSettings({ ...cur, forecasts: (cur.forecasts || []).concat({ ...fc.v, name: vals[0].trim() }) });
        A().toast('Scenario saved'); renderForecast(); return true;
      }, { error: 'Please enter a name.' });
    };
  }

  function wire() {
    injectViews();
    document.getElementById('ins-payslip-file').onchange = async (e) => { const f = Array.from(e.target.files || []); e.target.value = ''; await importPayslipFiles(f); };
    document.getElementById('ins-statement-file').onchange = async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) await importStatement(f); };
    document.getElementById('btn-ins-manage-back').onclick = () => showInsights();
    document.getElementById('btn-forecast-back').onclick = () => showInsights();
    P().onChange(() => { const v = document.getElementById('view-insights'); if (v && !v.classList.contains('hidden')) render(); });
  }
  A().onBoot(wire);

  global.AsInsightsUi = { showInsights, render, showManage, importPayslipFiles, importStatement, openForecast, pensionChart, needsChecking };
})(window);
