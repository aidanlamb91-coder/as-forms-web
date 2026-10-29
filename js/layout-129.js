/* AS Forms web 1.2.9-web layout pass (DESIGN.md). Presentation only: every control below drives an existing
 * control/flow, so data, storage and behaviour are unchanged.
 *  - FAB (+) for New claim / New timesheet; Import becomes an icon in the heading → Settings → Import
 *  - Timesheet month picker "‹ October 2026 ›" with a tappable title (drives the existing month/year form)
 *  - Receipt / statement drop zones (Camera · Files) instead of a raw "Choose File"
 *  - Settings Danger zone: Disconnect cloud row (Restore + Clear data are wired in app.js / profile-121.js)
 *  - Offline banner */
(function (global) {
  const $ = (s, r) => (r || document).querySelector(s);
  const F = () => global.AsFmt;
  const IMPORT_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V3zM4 18h16v3H4v-3z"/></svg>';

  // ——— FAB + heading import icon ———
  function fabify(btnId, label) {
    const b = document.getElementById(btnId);
    if (!b || b.classList.contains('fab')) return;
    b.className = 'fab';
    b.textContent = '+';
    b.setAttribute('aria-label', label);
    b.title = label;
    const view = b.closest('.view');
    if (view) { view.appendChild(b); view.classList.add('has-fab'); }
  }
  function iconify(btnId, label) {
    const b = document.getElementById(btnId);
    if (!b || b.classList.contains('icon-btn')) return;
    b.className = 'icon-btn';
    b.innerHTML = IMPORT_SVG;
    b.setAttribute('aria-label', label);
    b.title = label;
    const row = b.parentElement;
    if (row) row.className = 'head-actions';
  }

  // ——— Month picker ———
  const MONTHS = () => F().MONTH;
  function tsSelects() { return { m: $('#ts-edit-month'), y: $('#ts-edit-year'), form: $('#form-ts-meta') }; }
  function monthTitle() {
    const { m, y } = tsSelects();
    return m && y && m.value && y.value ? F().month(Number(y.value), Number(m.value)) : '';
  }
  function renderMonthNav() {
    const nav = $('#ts-month-nav');
    const { m } = tsSelects();
    if (!nav || !m) return;
    nav.querySelector('.month-title').textContent = monthTitle();
    const locked = m.disabled;
    nav.querySelectorAll('button').forEach((b) => { b.disabled = locked; });
    nav.querySelector('.month-title').setAttribute('aria-label', monthTitle() + (locked ? ' (completed — switch Completed off to change)' : '. Change month'));
  }
  function setYearOption(sel, year) {
    if (![...sel.options].some((o) => o.value === String(year))) {
      if (global.AsYearPicker) global.AsYearPicker.fillYearSelect(sel, year);
      else { const o = document.createElement('option'); o.value = o.textContent = String(year); sel.appendChild(o); }
    }
    sel.value = String(year);
  }
  async function applyMonth(year, month) {
    const { m, y, form } = tsSelects();
    const prev = [m.value, y.value];
    m.value = String(month);
    setYearOption(y, year);
    renderMonthNav();
    if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
    // A clash (another timesheet has that month) leaves nothing saved: show the stored month again
    setTimeout(async () => {
      const id = global.AsApp && global.AsApp.currentTimesheetId ? global.AsApp.currentTimesheetId() : null;
      const ts = id && global.AsStorage ? await global.AsStorage.getTimesheet(id) : null;
      if (ts && (Number(ts.month) !== month || Number(ts.year) !== year)) { m.value = prev[0]; setYearOption(y, Number(prev[1])); }
      renderMonthNav();
    }, 400);
  }
  function step(by) {
    const { m, y } = tsSelects();
    let month = Number(m.value) + by, year = Number(y.value);
    if (month < 1) { month = 12; year--; }
    if (month > 12) { month = 1; year++; }
    applyMonth(year, month);
  }
  function openMonthSheet() {
    const { m, y } = tsSelects();
    if (m.disabled) return;
    let year = Number(y.value);
    const cur = Number(m.value), curYear = year;
    const root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.innerHTML = '<div class="modal month-sheet" role="dialog" aria-modal="true" aria-labelledby="ms-title">' +
      '<h2 id="ms-title">Choose month</h2>' +
      '<div class="year-step"><button type="button" class="icon-btn" data-y="-1" aria-label="Previous year">‹</button><span class="ms-year num"></span><button type="button" class="icon-btn" data-y="1" aria-label="Next year">›</button></div>' +
      '<div class="month-grid"></div>' +
      '<div class="btn-row" style="margin-top:12px"><button type="button" class="btn ghost" data-cancel>Cancel</button></div></div>';
    const grid = root.querySelector('.month-grid');
    const draw = () => {
      root.querySelector('.ms-year').textContent = String(year);
      grid.innerHTML = '';
      F().MON.forEach((name, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = name;
        b.setAttribute('aria-label', MONTHS()[i] + ' ' + year);
        if (i + 1 === cur && year === curYear) { b.classList.add('on'); b.setAttribute('aria-current', 'true'); }
        b.onclick = () => { close(); applyMonth(year, i + 1); };
        grid.appendChild(b);
      });
    };
    const close = () => { root.remove(); document.removeEventListener('keydown', onKey); $('#ts-month-nav .month-title').focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    root.addEventListener('click', (e) => {
      if (e.target === root || e.target.hasAttribute('data-cancel')) return close();
      const d = e.target.closest('[data-y]');
      if (d) { year += Number(d.getAttribute('data-y')); draw(); }
    });
    document.addEventListener('keydown', onKey);
    draw();
    document.body.appendChild(root);
    const on = grid.querySelector('.on') || grid.querySelector('button');
    if (on) on.focus();
  }
  function installMonthNav() {
    const { m, y, form } = tsSelects();
    if (!form || $('#ts-month-nav')) return;
    const nav = document.createElement('div');
    nav.className = 'month-nav';
    nav.id = 'ts-month-nav';
    nav.innerHTML = '<button type="button" class="icon-btn" data-step="-1" aria-label="Previous month">‹</button>' +
      '<button type="button" class="month-title" aria-haspopup="dialog"></button>' +
      '<button type="button" class="icon-btn" data-step="1" aria-label="Next month">›</button>';
    form.insertBefore(nav, form.firstChild);
    // The raw selects + Save stay in the form (keyboard/older flows and tests) but are visually replaced.
    const grid = form.querySelector('.grid-2');
    if (grid) grid.classList.add('month-raw');
    const save = form.querySelector('button[type=submit]');
    if (save) save.classList.add('month-raw');
    nav.addEventListener('click', (e) => {
      const s = e.target.closest('[data-step]');
      if (s) return step(Number(s.getAttribute('data-step')));
      if (e.target.closest('.month-title')) openMonthSheet();
    });
    [m, y].forEach((sel) => sel.addEventListener('change', renderMonthNav));
    new MutationObserver(renderMonthNav).observe(m, { attributes: true, childList: true, attributeFilter: ['disabled'] });
    new MutationObserver(renderMonthNav).observe(y, { childList: true });
    renderMonthNav();
  }

  // ——— Drop zones ———
  function dropZone(inputId, title) {
    const input = document.getElementById(inputId);
    if (!input || input.closest('.drop-zone')) return;
    const z = document.createElement('div');
    z.className = 'drop-zone';
    z.setAttribute('data-testid', 'drop-' + inputId);
    z.innerHTML = '<p class="dz-title">📎 ' + title + ' <span class="hint">· photo or PDF</span></p>' +
      '<div class="dz-btns"><button type="button" class="btn secondary" data-pick="camera">📷 Camera</button>' +
      '<button type="button" class="btn secondary" data-pick="files">📁 Files</button></div>';
    input.parentNode.insertBefore(z, input);
    z.appendChild(input);
    input.classList.add('dz-input');
    z.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      // Same input, same accept list; Camera only adds the capture hint for this one pick
      if (b.getAttribute('data-pick') === 'camera') input.setAttribute('capture', 'environment');
      else input.removeAttribute('capture');
      input.click();
      setTimeout(() => input.removeAttribute('capture'), 0);
    });
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('drag'); });
    z.addEventListener('dragleave', () => z.classList.remove('drag'));
    z.addEventListener('drop', (e) => {
      e.preventDefault(); z.classList.remove('drag');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      try { input.files = files; input.dispatchEvent(new Event('change', { bubbles: true })); } catch (err) { console.warn(err); }
    });
  }

  // ——— Danger zone: Disconnect cloud ———
  function renderDangerZone() {
    const row = $('#dz-row-disconnect');
    if (!row || !global.AsCloud) return;
    const s = global.AsCloud.status();
    row.classList.toggle('hidden', !s.connected);
    if (s.connected) $('#dz-cloud-label').textContent = 'Stops syncing to ' + s.label + '. Files in the cloud are kept.';
  }
  function installDangerZone() {
    const b = $('#btn-dz-disconnect');
    if (!b) return;
    b.addEventListener('click', () => {
      const s = global.AsCloud && global.AsCloud.status();
      if (!s || !s.connected) return;
      if (!confirm('Disconnect ' + s.label + '? Files in the cloud are kept.')) return;
      global.AsCloud.disconnect();
      if (global.AsSyncUi) global.AsSyncUi.render();
      renderDangerZone();
    });
    if (global.AsCloud && global.AsCloud.onChange) global.AsCloud.onChange(renderDangerZone);
    const settingsBtn = document.querySelector('.bottom-nav [data-nav="settings"]');
    if (settingsBtn) settingsBtn.addEventListener('click', () => setTimeout(renderDangerZone, 0));
    renderDangerZone();
  }

  // ——— Offline banner ———
  function installOffline() {
    if ($('#offline-banner')) return;
    const b = document.createElement('div');
    b.id = 'offline-banner';
    b.className = 'offline-banner hidden';
    b.setAttribute('role', 'status');
    b.textContent = 'Offline — changes are saved on this device';
    const app = $('#app') || document.body;
    app.insertBefore(b, app.firstChild);
    const upd = () => b.classList.toggle('hidden', navigator.onLine !== false);
    global.addEventListener('online', upd);
    global.addEventListener('offline', upd);
    upd();
  }

  function init() {
    fabify('btn-new-claim', 'New claim');
    fabify('btn-new-ts', 'New timesheet');
    iconify('btn-import-claims', 'Import (Settings → Import)');
    iconify('btn-import-ts', 'Import (Settings → Import)');
    installMonthNav();
    dropZone('line-receipt', 'Add receipt');
    dropZone('line-statement', 'Add statement');
    installDangerZone();
    installOffline();
  }
  global.AsLayout129 = { init, applyMonth, renderMonthNav, renderDangerZone, monthTitle };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
