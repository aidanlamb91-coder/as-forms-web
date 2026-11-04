/**
 * 1.1.0-web — Mileage screens (port of Android ui/screens/mileage/* and ProfileScreen).
 *
 *  - "+ New" chooser: Expense claim or Mileage claim.
 *  - Mileage claim screen: job number, journeys, totals, timesheet trip suggestions,
 *    Unlink / Link, Completed, Review & export.
 *  - Add / edit journey: date, project number, From / To postcode with quick chips
 *    (Home, Saved places, Use my location), Calculate road miles (free: postcodes.io + OSRM),
 *    manual miles always allowed, Return trip, purpose chips.
 *  - Nesting on the Expenses list: an indented sub-card under the expense claim with the same
 *    job number (cards are drawn by app.js claimCard, using subCardHtml / soloCard here).
 *  - Profile: Home postcode, CC of engine, mileage rate, saved places; and "Year starts in".
 * The rules (maths, postcodes, linking, routes) are in js/mileage.js; the Word form in js/mileage-docx.js.
 */
(function (global) {
  const A = () => global.AsApp;
  const M = () => global.AsMileage;
  const S = () => global.AsStorage;
  const esc = (s) => A().escapeHtml(s);
  const st = { claimId: null, journeyId: null, suggestions: [] };

  // ——— Views (injected once) ———
  function injectViews() {
    const app = document.getElementById('app');
    const html = `
    <section id="view-mileage" class="view hidden">
      <header class="topbar">
        <button type="button" class="btn ghost back-btn" id="btn-mileage-back">← Back</button>
        <h1 id="mileage-title">Mileage</h1>
        <button type="button" class="btn ghost" id="btn-mileage-link" title="Unlink from the expense claim">Unlink</button>
        <button type="button" class="btn danger ghost" id="btn-mileage-delete" title="Delete">🗑</button>
      </header>
      <form id="form-mileage" class="panel">
        <label>Job number
          <div class="job-prefix"><span class="pfx">P</span><input type="text" id="mileage-job-digits" inputmode="numeric" pattern="[0-9]*" /></div>
        </label>
        <p class="hint" id="mileage-profile-line"></p>
        <p class="hint" id="mileage-link-line"></p>
        <div class="save-row">
          <button type="submit" class="btn primary">Save</button>
          <label class="toggle-control" for="mileage-completed-toggle"><span>Completed</span>
            <input type="checkbox" id="mileage-completed-toggle" /><span class="switch" aria-hidden="true"></span></label>
        </div>
      </form>
      <div id="mileage-suggestions"></div>
      <div class="toolbar">
        <h2>Journeys <span id="journey-count" class="badge">0</span></h2>
        <button type="button" class="btn primary" id="btn-add-journey">+ Journey</button>
      </div>
      <div id="journey-list" class="card-list"></div>
      <p id="journey-empty" class="empty hidden">No journeys yet.</p>
      <div class="panel"><p class="money-row"><span>Total</span><strong id="mileage-total">0 mi · £0.00</strong></p>
        <div class="btn-row"><button type="button" class="btn primary" id="btn-mileage-export">Export</button></div>
      </div>
    </section>
    <section id="view-journey" class="view hidden">
      <header class="topbar">
        <button type="button" class="btn ghost back-btn" id="btn-journey-back">← Back</button>
        <h1 id="journey-title">Journey</h1>
        <button type="button" class="btn danger ghost" id="btn-journey-delete" title="Delete">🗑</button>
      </header>
      <form id="form-journey" class="panel">
        <div class="grid-2">
          <label>Date <input type="date" id="journey-date" required /></label>
          <label>Project number <div class="job-prefix"><span class="pfx">P</span><input type="text" id="journey-project" inputmode="numeric" pattern="[0-9]*" /></div></label>
        </div>
        <label>From postcode <input type="text" id="journey-from" autocapitalize="characters" maxlength="9" required /></label>
        <div class="chip-row" id="journey-from-chips"></div>
        <label>To postcode <input type="text" id="journey-to" autocapitalize="characters" maxlength="9" required /></label>
        <div class="chip-row" id="journey-to-chips"></div>
        <div class="calc-row">
          <button type="button" class="btn secondary" id="btn-journey-calc">Calculate</button>
          <label class="miles-field">Miles (one way) <input type="number" id="journey-miles" inputmode="decimal" min="0" step="0.1" required /></label>
        </div>
        <p class="status" id="journey-calc-status" role="status"></p>
        <label class="check-row"><input type="checkbox" id="journey-return" /> <span>Return trip</span></label>
        <label>Purpose of visit <input type="text" id="journey-purpose" maxlength="120" /></label>
        <div class="chip-row" id="journey-purpose-chips"></div>
        <p class="money-row"><span>Amount</span><strong id="journey-claimed">0 mi · £0.00</strong></p>
        <button type="submit" class="btn primary">Save journey</button>
      </form>
    </section>`;
    app.insertAdjacentHTML('beforeend', html);
    A().registerView('mileage', '#view-mileage');
    A().registerView('journey', '#view-journey');
  }

  const settings = () => S().getSettings();
  const rateNow = () => Number(settings().mileageRatePence) || M().RATE_PENCE;
  /** Rate shown / used: active claims follow Profile; completed claims keep their frozen rate. */
  const rateOf = (m) => (m.completed ? (m.ratePence || M().RATE_PENCE) : rateNow());
  const summary = (m) => M().formatMiles(M().totalMiles(m.journeys)) + ' · ' + M().formatPounds(M().totalAmount(m.journeys, rateOf(m)));

  /** Completing freezes today's rate on the claim (Android: value frozen when completed). */
  function withCompleted(m, done) {
    return { ...m, completed: done, completedAt: done ? Date.now() : null, ratePence: done ? rateNow() : m.ratePence };
  }

  // ——— List cards ———
  function subCardHtml(m) {
    return '<div class="mileage-sub" data-mileage-id="' + esc(m.id) + '"><span class="mi-ico" aria-hidden="true">🚗</span>' +
      '<span class="mi-text">Mileage · ' + (m.journeys || []).length + ' journey' + ((m.journeys || []).length === 1 ? '' : 's') + '</span>' +
      '<span class="mi-amt">' + esc(summary(m)) + '</span></div>';
  }

  /** A mileage claim with no matching expense claim (or unlinked): its own card. */
  function soloCard(m) {
    const el = document.createElement('div');
    el.className = 'card job-card mileage-card';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.innerHTML = '<p class="title">🚗 ' + esc(m.jobNo || 'No job') + ' · Mileage</p>' +
      '<p class="meta">' + esc(A().ukDate(m.dateFrom)) + ' → ' + esc(A().ukDate(m.dateTo)) + ' · ' + (m.journeys || []).length + ' journey(s)</p>' +
      '<p class="money">' + esc(summary(m)) + '</p>';
    el.addEventListener('click', () => openClaim(m.id));
    const setDone = async (done) => {
      const x = await S().getMileage(m.id);
      if (!x) return;
      await S().putMileage(withCompleted(x, done));
      A().toast(done ? 'Marked complete' : 'Reopened');
      await A().refreshClaimList();
    };
    return A().wrapSwipeRow(el, {
      onDelete: async () => {
        const snap = await S().getMileage(m.id);
        await S().deleteMileage(m.id);
        await A().refreshClaimList();
        A().toastUndo('Mileage deleted', async () => { if (snap) await S().putMileage(snap); await A().refreshClaimList(); });
      },
      onComplete: !m.completed ? () => setDone(true) : null,
      onReopen: m.completed ? () => setDone(false) : null,
    });
  }

  // ——— "+ New" chooser ———
  function newChooser(createExpense) {
    const sh = A().openSheet(
      '<div class="sheet" role="dialog" aria-label="New claim"><h2>New</h2>' +
      '<button type="button" class="settings-banner" data-new="expense"><span class="sb-text"><span class="sb-title">Expense claim</span></span></button>' +
      '<button type="button" class="settings-banner" data-new="mileage"><span class="sb-text"><span class="sb-title">Mileage claim</span></span></button>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button></div></div>');
    sh.el.querySelector('[data-new="expense"]').onclick = () => { sh.close(); createExpense(); };
    sh.el.querySelector('[data-new="mileage"]').onclick = () => { sh.close(); createClaim(''); };
  }

  async function createClaim(jobNo) {
    const m = await S().putMileage({ id: S().uid(), jobNo: jobNo || '', ratePence: rateNow(), journeys: [], unlinked: false });
    A().toast('Mileage claim created');
    await openClaim(m.id);
  }

  // ——— Mileage claim screen ———
  async function linkedExpense(m) {
    if (m.unlinked || !M().jobKey(m.jobNo)) return null;
    const claims = (await S().listClaims()).filter((c) => !!c.completed === !!m.completed);
    return claims.find((c) => M().sameJob(c.jobNo, m.jobNo)) || null;
  }
  /** Mileage claims that belong with an expense claim (same list, same job, not unlinked). */
  async function linkedTo(claim) {
    const all = await S().listMileage();
    const claims = (await S().listClaims()).filter((c) => !!c.completed === !!claim.completed);
    const groups = M().groupJobs(claims, all.filter((m) => !!m.completed === !!claim.completed));
    const g = groups.find((x) => x.expense && x.expense.id === claim.id);
    return g ? g.mileage : [];
  }

  async function openClaim(id) {
    const m = await S().getMileage(id);
    if (!m) { A().toast('Mileage claim not found'); return A().showExpenses(); }
    st.claimId = id;
    const s = settings();
    const $ = A().$;
    $('#mileage-title').textContent = (m.jobNo || 'Mileage') + ' · Mileage';
    $('#mileage-job-digits').value = A().digitsOnly(m.jobNo);
    $('#mileage-completed-toggle').checked = !!m.completed;
    $('#mileage-profile-line').textContent = (s.displayName || 'No name') + ' · ' +
      (global.AsMileageDocx.formatCc(s.ccEngine) || 'CC not set') + ' · ' + M().formatRate(rateOf(m)) + ' per mile';
    const linked = await linkedExpense(m);
    $('#mileage-link-line').textContent = m.unlinked ? 'Unlinked — exports on its own.' : linked ? 'With expense claim ' + linked.jobNo + '.' : '';
    $('#btn-mileage-link').textContent = m.unlinked ? 'Link' : 'Unlink';
    $('#btn-mileage-link').classList.toggle('hidden', !m.unlinked && !linked);
    renderJourneys(m);
    await renderSuggestions(m, linked);
    A().setNav('expenses');
    A().showView('mileage');
  }

  function renderJourneys(m) {
    const $ = A().$;
    const list = $('#journey-list');
    list.innerHTML = '';
    const js = M().sortedJourneys(m);
    $('#journey-count').textContent = String(js.length);
    $('#journey-empty').classList.toggle('hidden', js.length > 0);
    $('#mileage-total').textContent = summary(m);
    js.forEach((j) => {
      const el = document.createElement('div');
      el.className = 'card line-card';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const miles = M().journeyMiles(j);
      el.innerHTML = '<p class="title">' + esc(j.fromPostcode) + ' → ' + esc(j.toPostcode) + (j.returnTrip ? ' ↺' : '') + '</p>' +
        '<p class="meta">' + esc(A().ukDate(j.date)) + (j.purpose ? ' · ' + esc(j.purpose) : '') + '</p>' +
        '<p class="money">' + esc(M().formatMiles(miles) + ' · ' + M().formatPounds(M().amount(miles, rateOf(m)))) + '</p>';
      el.addEventListener('click', () => openJourney(j.id));
      list.appendChild(A().wrapSwipeRow(el, {
        onDelete: async () => {
          const x = await S().getMileage(st.claimId);
          const snap = (x.journeys || []).find((y) => y.id === j.id);
          x.journeys = (x.journeys || []).filter((y) => y.id !== j.id);
          await S().putMileage(x);
          await openClaim(x.id);
          A().toastUndo('Journey deleted', async () => {
            const y = await S().getMileage(st.claimId);
            if (y && snap) { y.journeys.push(snap); await S().putMileage(y); await openClaim(y.id); }
          });
        },
      }));
    });
  }

  /** "Trip P5503 starts 1 Sep · Add travel to port?" banners from Timesheets (dismissible). */
  async function renderSuggestions(m, linked) {
    const box = A().$('#mileage-suggestions');
    box.innerHTML = '';
    if (m.completed) return;
    const trips = M().tripsFrom(await S().listTimesheets());
    let period = null;
    if (linked) period = { from: linked.dateFrom, to: linked.dateTo };
    else if ((m.journeys || []).length) {
      const d = M().claimDates(m);
      const shift = (iso, n) => { const [y, mo, da] = iso.split('-').map(Number); const t = new Date(y, mo - 1, da + n); return global.AsBackupFormat.millisToIso(t.getTime()); };
      period = { from: shift(d.dateFrom, -7), to: shift(d.dateTo, 7) };
    }
    const list = M().suggest(m.id, m.jobNo, trips, period, (m.journeys || []).map((j) => j.date), m.dismissed || []);
    st.suggestions = list;
    list.forEach((sg) => {
      const el = document.createElement('div');
      el.className = 'suggest-banner';
      const [y, mo, d] = sg.date.split('-').map(Number);
      const day = d + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1];
      el.innerHTML = '<span>Trip ' + esc(sg.jobNumber) + (sg.isStart ? ' starts ' : ' ends ') + esc(day) + ' · ' +
        (sg.isStart ? 'Add travel to port?' : 'Add travel home?') + '</span>' +
        '<button type="button" class="btn primary small" data-add>Add</button><button type="button" class="btn ghost small" data-dismiss>Dismiss</button>';
      el.querySelector('[data-add]').onclick = () => addJourney(sg);
      el.querySelector('[data-dismiss]').onclick = async () => {
        const x = await S().getMileage(m.id);
        x.dismissed = (x.dismissed || []).concat(sg.key);
        await S().putMileage(x);
        el.remove();
      };
      box.appendChild(el);
      void y;
    });
  }

  async function saveClaim(ev) {
    ev.preventDefault();
    const raw = A().$('#mileage-job-digits').value.trim();
    const job = raw ? A().normalizeJob(raw) : '';
    if (job && !A().isValidJob(job)) { A().toast('Job number must be P + digits'); return; }
    const m = await S().getMileage(st.claimId);
    m.jobNo = job;
    // Journeys that still had the old job number follow the claim
    (m.journeys || []).forEach((j) => { if (!j.projectNumber || j.projectNumber === m._prevJob) j.projectNumber = job; });
    await S().putMileage(m);
    A().toast('Saved');
    await openClaim(m.id);
  }

  // ——— Journey editor ———
  async function addJourney(suggestion) {
    const m = await S().getMileage(st.claimId);
    const s = settings();
    const j = { id: S().uid(), date: M().todayIso(), projectNumber: m.jobNo || '', fromPostcode: '', toPostcode: '', fromLabel: '', toLabel: '', purpose: '', oneWayMiles: 0, returnTrip: false, sortOrder: (m.journeys || []).length, _new: true };
    if (suggestion) {
      const port = M().mostUsedPlace(s.savedPlaces || [], (m.journeys || []).flatMap((x) => [x.fromPostcode, x.toPostcode]), s.homePostcode);
      j.date = suggestion.date;
      j.purpose = 'Travel to vessel';
      const home = M().normalizePostcode(s.homePostcode || '');
      const portPc = port ? M().normalizePostcode(port.postcode) : '';
      j.fromPostcode = suggestion.isStart ? home : portPc;
      j.toPostcode = suggestion.isStart ? portPc : home;
      j.fromLabel = suggestion.isStart ? 'Home' : (port ? port.name : '');
      j.toLabel = suggestion.isStart ? (port ? port.name : '') : 'Home';
    } else if (s.homePostcode) {
      j.fromPostcode = M().normalizePostcode(s.homePostcode);
      j.fromLabel = 'Home';
    }
    st.draft = j;
    showJourney(j, m);
  }

  async function openJourney(id) {
    const m = await S().getMileage(st.claimId);
    const j = (m.journeys || []).find((x) => x.id === id);
    if (!j) return;
    st.draft = { ...j };
    showJourney(st.draft, m);
  }

  function showJourney(j, m) {
    const $ = A().$;
    st.journeyId = j.id;
    $('#journey-title').textContent = j._new ? 'Add journey' : 'Edit journey';
    $('#btn-journey-delete').classList.toggle('hidden', !!j._new);
    $('#journey-date').value = j.date || '';
    $('#journey-project').value = A().digitsOnly(j.projectNumber || m.jobNo);
    $('#journey-from').value = j.fromPostcode || '';
    $('#journey-to').value = j.toPostcode || '';
    $('#journey-miles').value = j.oneWayMiles ? String(j.oneWayMiles) : '';
    $('#journey-return').checked = !!j.returnTrip;
    $('#journey-purpose').value = j.purpose || '';
    $('#journey-calc-status').textContent = '';
    buildChips('from');
    buildChips('to');
    const pc = $('#journey-purpose-chips');
    pc.innerHTML = M().PURPOSE_CHIPS.map((p) => '<button type="button" class="chip" data-p="' + esc(p) + '">' + esc(p) + '</button>').join('');
    pc.onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) { $('#journey-purpose').value = b.dataset.p; } };
    updateClaimed(m);
    A().showView('journey');
  }

  function buildChips(which) {
    const s = settings();
    const box = A().$('#journey-' + which + '-chips');
    const chips = [];
    if (s.homePostcode) chips.push({ label: 'Home', pc: M().normalizePostcode(s.homePostcode) });
    (s.savedPlaces || []).forEach((p) => chips.push({ label: p.name || p.postcode, pc: M().normalizePostcode(p.postcode) }));
    box.innerHTML = chips.map((c) => '<button type="button" class="chip" data-pc="' + esc(c.pc) + '" data-label="' + esc(c.label) + '">' + esc(c.label) + '</button>').join('') +
      '<button type="button" class="chip" data-loc>📍 Use my location</button>';
    box.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const input = A().$('#journey-' + which);
      if (b.hasAttribute('data-loc')) {
        b.disabled = true;
        b.textContent = '📍 Finding…';
        const out = await locationPostcode();
        b.disabled = false;
        b.textContent = '📍 Use my location';
        if (out.postcode) { input.value = out.postcode; st.draft[which + 'Label'] = 'Current location'; A().toast('Approximate — check it'); } else A().toast(out.message);
        return;
      }
      input.value = b.dataset.pc;
      st.draft[which + 'Label'] = b.dataset.label;
    };
  }

  /** Browser location → nearest postcode (postcodes.io). Needs HTTPS + the user's permission. */
  function locationPostcode() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ message: 'Location unavailable' });
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const pc = await M().reversePostcode(pos.coords.latitude, pos.coords.longitude);
          resolve(pc ? { postcode: pc } : { message: 'No postcode found near here.' });
        } catch (_) {
          resolve({ message: "Couldn't look up the postcode — type it instead." });
        }
      }, (err) => resolve({ message: err && err.code === 1 ? 'Location off' : 'Location unavailable' }),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
    });
  }

  function updateClaimed(m) {
    const $ = A().$;
    const miles = M().claimedMiles(Number($('#journey-miles').value) || 0, $('#journey-return').checked);
    $('#journey-claimed').textContent = M().formatMiles(miles) + ' · ' + M().formatPounds(M().amount(miles, rateOf(m || { completed: false })));
  }

  async function calculate() {
    const $ = A().$;
    const status = $('#journey-calc-status');
    status.classList.remove('error');
    status.textContent = 'Calculating…';
    const r = await M().roadMiles($('#journey-from').value, $('#journey-to').value);
    if (r.ok) {
      $('#journey-miles').value = String(r.miles);
      status.textContent = '';
      updateClaimed(await S().getMileage(st.claimId));
    } else {
      status.classList.add('error');
      status.textContent = r.message;
      $('#journey-miles').focus();
    }
  }

  async function saveJourney(ev) {
    ev.preventDefault();
    const $ = A().$;
    const from = M().normalizePostcode($('#journey-from').value);
    const to = M().normalizePostcode($('#journey-to').value);
    if (!M().isValidPostcode(from)) { A().toast('From: not a UK postcode'); return; }
    if (!M().isValidPostcode(to)) { A().toast('To: not a UK postcode'); return; }
    const miles = M().round1(Number($('#journey-miles').value));
    if (!(miles > 0)) { A().toast('Enter the miles'); return; }
    const projRaw = $('#journey-project').value.trim();
    const proj = projRaw ? A().normalizeJob(projRaw) : '';
    const m = await S().getMileage(st.claimId);
    const j = { ...st.draft };
    delete j._new;
    Object.assign(j, {
      date: $('#journey-date').value, projectNumber: proj || m.jobNo || '',
      fromPostcode: from, toPostcode: to, oneWayMiles: miles, returnTrip: $('#journey-return').checked,
      purpose: $('#journey-purpose').value.trim(),
    });
    const i = (m.journeys || []).findIndex((x) => x.id === j.id);
    if (i >= 0) m.journeys[i] = j; else (m.journeys = m.journeys || []).push(j);
    await S().putMileage(m);
    A().toast('Journey saved');
    await openClaim(m.id);
  }

  // ——— Claim screen (expense) → mileage section ———
  async function renderClaimMileage(claim) {
    const $ = A().$;
    const list = $('#claim-mileage');
    if (!list) return;
    const ms = await linkedTo(claim);
    $('#claim-mileage-count').textContent = String(ms.length);
    list.innerHTML = '';
    ms.forEach((m) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'card';
      el.innerHTML = subCardHtml(m);
      el.onclick = () => openClaim(m.id);
      list.appendChild(el);
    });
    $('#btn-claim-add-mileage').classList.toggle('hidden', ms.length > 0 || !claim.jobNo);
  }

  // ——— Profile + Year starts in ———
  function fillProfile() {
    const s = settings();
    const $ = A().$;
    $('#settings-home-postcode').value = s.homePostcode || '';
    $('#settings-cc').value = s.ccEngine || '';
    $('#settings-rate').value = s.mileageRatePence || M().RATE_PENCE;
    $('#profile-error').textContent = '';
    renderPlaces();
  }
  /** Saves the mileage fields; false (and a message) when the Home postcode isn't a UK postcode. */
  function saveProfileFields() {
    const $ = A().$;
    const raw = $('#settings-home-postcode').value.trim();
    if (raw && !M().isValidPostcode(raw)) { $('#profile-error').textContent = 'Not a UK postcode'; return false; }
    $('#profile-error').textContent = '';
    S().saveSettings({
      homePostcode: raw ? M().normalizePostcode(raw) : '',
      ccEngine: $('#settings-cc').value.trim(),
      mileageRatePence: Math.max(1, Math.round(Number($('#settings-rate').value) || M().RATE_PENCE)),
    });
    $('#settings-home-postcode').value = raw ? M().normalizePostcode(raw) : '';
    return true;
  }
  function renderPlaces() {
    const box = A().$('#saved-places');
    const places = settings().savedPlaces || [];
    box.innerHTML = places.length ? '' : '<p class="empty small">No locations yet.</p>';
    places.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'card line-card';
      el.setAttribute('role', 'button');
      el.innerHTML = '<p class="title">' + esc(p.name) + '</p><p class="meta">' + esc(p.postcode) + '</p>';
      el.onclick = () => editPlace(p);
      box.appendChild(A().wrapSwipeRow(el, {
        onDelete: async () => {
          S().saveSettings({ savedPlaces: (settings().savedPlaces || []).filter((x) => x.id !== p.id) });
          S().notifyChanged('prefs');
          renderPlaces();
        },
      }));
    });
  }
  function editPlace(p) {
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Favourite location"><h2>' + (p ? 'Edit location' : 'Add location') + '</h2>' +
      '<label>Name (e.g. Office) <input type="text" id="place-name" maxlength="40" value="' + esc(p ? p.name : '') + '" /></label>' +
      '<label>Postcode <input type="text" id="place-pc" maxlength="9" autocapitalize="characters" value="' + esc(p ? p.postcode : '') + '" /></label>' +
      '<p class="hint" id="place-err"></p>' +
      '<div class="actions"><button type="button" class="btn primary" id="place-save">Save</button>' +
      (p ? '<button type="button" class="btn danger ghost" id="place-delete">Delete</button>' : '') + '<button type="button" class="btn ghost" data-close>Cancel</button></div></div>');
    // 1.2.1-web Favourite locations: delete from the edit window too (swipe still works)
    const delBtn = sh.el.querySelector('#place-delete');
    if (delBtn) delBtn.onclick = () => {
      S().saveSettings({ savedPlaces: (settings().savedPlaces || []).filter((x) => x.id !== p.id) });
      S().notifyChanged('prefs');
      sh.close();
      renderPlaces();
    };
    sh.el.querySelector('#place-save').onclick = () => {
      const name = sh.el.querySelector('#place-name').value.trim();
      const pc = sh.el.querySelector('#place-pc').value;
      if (!M().isValidPostcode(pc)) { sh.el.querySelector('#place-err').textContent = 'Not a UK postcode'; return; }
      const places = (settings().savedPlaces || []).slice();
      const row = { id: p ? p.id : 'p' + Date.now().toString(36), name: name || M().normalizePostcode(pc), postcode: M().normalizePostcode(pc) };
      const i = places.findIndex((x) => p && x.id === p.id);
      if (i >= 0) places[i] = row; else places.push(row);
      S().saveSettings({ savedPlaces: places });
      S().notifyChanged('prefs');
      sh.close();
      renderPlaces();
    };
  }
  function yearStartSheet() {
    const cur = global.AsYearPeriods.startMonth();
    const opts = Array.from({ length: 12 }, (_, i) => i + 1).map((m) =>
      '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + global.AsYearPeriods.monthName(m) + ' (' + global.AsYearPeriods.monthsLabel(m) + ')</option>').join('');
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Year starts in"><h2>Year starts in</h2>' +
      '<label>Month <select id="year-start-month">' + opts + '</select></label>' +
      '<p class="hint">Groups Days worked and Completed totals.</p>' +
      '<div class="actions"><button type="button" class="btn primary" id="year-start-save">Save</button><button type="button" class="btn ghost" data-close>Cancel</button></div></div>');
    const sel = sh.el.querySelector('#year-start-month');
    sh.el.querySelector('#year-start-save').onclick = () => {
      S().saveSettings({ yearStartMonth: Number(sel.value) });
      S().notifyChanged('prefs');
      sh.close();
      refreshYearSub();
      A().toast('Saved');
    };
  }
  function refreshYearSub() {
    const el = document.getElementById('sb-year-start-sub');
    if (el) el.textContent = global.AsYearPeriods.monthName(global.AsYearPeriods.startMonth()) + '';
  }

  // ——— Wiring ———
  function wire() {
    injectViews();
    const $ = A().$;
    $('#btn-mileage-back').onclick = () => A().showExpenses();
    $('#btn-journey-back').onclick = () => openClaim(st.claimId);
    $('#form-mileage').addEventListener('submit', saveClaim);
    $('#form-journey').addEventListener('submit', saveJourney);
    $('#btn-add-journey').onclick = () => addJourney(null);
    $('#btn-journey-calc').onclick = calculate;
    $('#journey-miles').addEventListener('input', async () => updateClaimed(await S().getMileage(st.claimId)));
    $('#journey-return').addEventListener('change', async () => updateClaimed(await S().getMileage(st.claimId)));
    $('#journey-from').addEventListener('blur', (e) => { if (e.target.value) e.target.value = M().normalizePostcode(e.target.value); });
    $('#journey-to').addEventListener('blur', (e) => { if (e.target.value) e.target.value = M().normalizePostcode(e.target.value); });
    $('#btn-journey-delete').onclick = async () => {
      if (!confirm('Delete this journey?')) return;
      const m = await S().getMileage(st.claimId);
      m.journeys = (m.journeys || []).filter((j) => j.id !== st.journeyId);
      await S().putMileage(m);
      await openClaim(m.id);
    };
    $('#btn-mileage-delete').onclick = async () => {
      if (!confirm('Delete this mileage claim? Includes all journeys.')) return;
      await S().deleteMileage(st.claimId);
      A().toast('Mileage deleted');
      await A().showExpenses();
    };
    $('#btn-mileage-link').onclick = async () => {
      const m = await S().getMileage(st.claimId);
      m.unlinked = !m.unlinked;
      await S().putMileage(m);
      A().toast(m.unlinked ? 'Unlinked' : 'Linked');
      await openClaim(m.id);
    };
    $('#mileage-completed-toggle').addEventListener('change', async (e) => {
      const m = await S().getMileage(st.claimId);
      await S().putMileage(withCompleted(m, e.target.checked));
      A().toast(e.target.checked ? 'Marked complete' : 'Reopened');
      await openClaim(m.id);
    });
    $('#btn-mileage-export').onclick = async () => {
      const m = await S().getMileage(st.claimId);
      const exp = await linkedExpense(m);
      if (global.AsUi110) global.AsUi110.openJobExport(exp ? exp.id : null, exp ? null : m.id);
    };
    $('#btn-claim-add-mileage').onclick = async () => {
      const c = await S().getClaim(A().state.claimId);
      if (c) await createClaim(c.jobNo);
    };
    $('#btn-add-place').onclick = () => editPlace(null);
    $('#btn-goto-year-start').onclick = yearStartSheet;
    refreshYearSub();
  }
  A().onBoot(wire);

  global.AsMileageUi = {
    newChooser, createClaim, openClaim, subCardHtml, soloCard, withCompleted, linkedTo, renderClaimMileage,
    fillProfile, saveProfileFields, rateOf, summary,
  };
})(window);
