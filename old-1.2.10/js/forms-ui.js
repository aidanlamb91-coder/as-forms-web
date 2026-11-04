/**
 * 1.2.1-web Settings → Other forms screens (port of Android ui/screens/forms/*).
 *
 *  - Other forms list: Access code row, Search (titles + contents, offline), FILL IN, a clear
 *    section break, DOWNLOAD (download-only forms, then the policies by group), and ON THIS DEVICE
 *    (Download all with a count, Delete all downloads with the space used). Hold an item to delete
 *    just that download. Every item has its own spinner; downloads queue one at a time.
 *  - Access code: typed once ("Ask your admin for the access code.").
 *  - A fill-in form (Option B): New / History tabs and Import (.docx, typed PDF best effort) with a
 *    summary sheet; imported boxes the app isn't sure about are outlined amber with "Next".
 *  - Edit: cards from the form's spec, autosaved drafts, hidden NI/bank boxes with an eye, the
 *    default signature, Preview, Export as Word or PDF, then Email / Share / Download.
 *    Email only opens the mail app or the share sheet with the file — nothing is ever sent by the app.
 * Logic lives in forms-library.js, forms-rules.js, forms-docx.js, forms-pdf.js, forms-store.js.
 */
(function (global) {
  const A = () => global.AsApp;
  const L = () => global.AsFormsLibrary;
  const S = () => global.AsFormsStore;
  const R = () => global.AsFormRules;
  const esc = (s) => A().escapeHtml(s == null ? '' : String(s));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const st = { query: '', hits: null, busy: new Set(), allProgress: null, used: 0, groupsOpen: { Company: true }, form: null, tab: 0, draftId: null, nextAt: 0, built: null };
  const b64 = (u8) => { let t = ''; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(t); };
  const HSEQ_TO = 'HSEQ@andrewssurvey.com';
  const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };

  const ICON = {
    key: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm5.6-4A6 6 0 1 0 12.6 14H16v3h3v-3h2v-4h-8.4z"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V3zM4 18h16v3H4v-3z"/></svg>',
    tick: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11 21h2v-9.2l3.3 3.3 1.4-1.4L12 8l-5.7 5.7 1.4 1.4 3.3-3.3V21zM4 3h16v3H4V3z"/></svg>',
    bin: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M14 5v4C7 10 4 15 3 20c2.5-3.5 6-5.1 11-5.1V19l7-7-7-7z"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>',
  };

  // ——— Views (injected once) ———
  function injectViews() {
    const html = `
    <section id="view-other-forms" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-of-back">← Back</button><h1>Other forms</h1></header>
      <div class="panel of-panel">
        <button type="button" class="settings-banner of-code-row" id="btn-of-code"><span class="sb-icon" aria-hidden="true">${ICON.key}</span>
          <span class="sb-text"><span class="sb-title">Access code</span><span class="sb-sub" id="of-code-sub">Needed to unlock the forms</span></span><span class="sb-chev" aria-hidden="true">›</span></button>
        <p class="status error hidden" id="of-message" role="status"></p>
        <div id="of-search-wrap" class="hidden"><input type="search" id="of-search" placeholder="Search" autocomplete="off" enterkeyhint="search" /></div>
        <div id="of-list"></div>
      </div>
    </section>
    <section id="view-forms-code" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-code-back">← Back</button><h1>Access code</h1></header>
      <form class="panel" id="form-forms-code" autocomplete="off">
        <p class="hint">Ask your admin for the access code.</p>
        <label>Access code <input type="password" id="forms-code-input" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
        <p class="status error" id="forms-code-error" role="status"></p>
        <button type="submit" class="btn primary" id="btn-forms-code-save">Save</button>
        <button type="button" class="btn ghost hidden" id="btn-forms-code-remove">Remove code</button>
      </form>
    </section>
    <section id="view-form-home" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-fh-back">← Back</button><h1 id="fh-title">Form</h1>
        <span class="spinner hidden" id="fh-busy" aria-label="Working"></span>
        <button type="button" class="icon-btn" id="btn-fh-import" aria-label="Import" title="Import">${ICON.up}</button></header>
      <div class="tabs" role="tablist"><button type="button" role="tab" id="fh-tab-new" class="on">New</button><button type="button" role="tab" id="fh-tab-history">History</button></div>
      <div class="panel" id="fh-new">
        <h2 class="fh-name" id="fh-name"></h2><p class="hint" id="fh-number"></p>
        <button type="button" class="btn primary" id="btn-fh-start">+ Start new</button>
        <button type="button" class="btn secondary" id="btn-fh-import2">Import filled copy</button>
      </div>
      <div id="fh-history" class="hidden"></div>
      <input type="file" id="fh-file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
    </section>
    <section id="view-form-edit" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-fe-back">← Back</button><h1 id="fe-title">Form</h1>
        <button type="button" class="btn danger ghost" id="btn-fe-delete" title="Delete">🗑</button></header>
      <div id="fe-body"></div>
      <div class="form-actions"><button type="button" class="btn secondary" id="btn-fe-preview">Preview</button><button type="button" class="btn primary" id="btn-fe-export">Export</button></div>
    </section>`;
    $('#app').insertAdjacentHTML('beforeend', html);
    A().registerView('other-forms', '#view-other-forms');
    A().registerView('forms-code', '#view-forms-code');
    A().registerView('form-home', '#view-form-home');
    A().registerView('form-edit', '#view-form-edit');
  }

  // ——— Other forms list ———
  async function showList() {
    A().showView('other-forms');
    renderList();
    await S().init();
    await L().loadCached();
    refreshUsed();
    L().refresh(false).then(refreshUsed).catch(() => {});
  }

  function mark(item, s) {
    if (st.busy.has(item.number)) return '<span class="spinner" aria-label="Downloading"></span>';
    return s.downloaded.has(item.number) ? '<span class="of-mark done" aria-label="On this device">' + ICON.tick + '</span>' : '<span class="of-mark" aria-label="Download">' + ICON.down + '</span>';
  }
  function row(item, s, o) {
    const fav = s.favourites.has(item.number);
    return '<div class="of-row" data-no="' + esc(item.number) + '" data-act="' + o.act + '" role="button" tabindex="0">' +
      '<div class="of-text"><p class="of-title">' + esc(item.title) + (o.count ? ' <span class="badge on">' + o.count + '</span>' : '') + '</p>' +
      '<p class="of-sub">' + esc(item.number + ' ' + item.rev) + '</p>' + (o.note ? '<p class="of-note">' + esc(o.note) + '</p>' : '') +
      (o.snippet ? '<p class="of-snip">' + esc(o.snippet) + '</p>' : '') + '</div>' +
      mark(item, s) + (o.star === false ? '' : '<button type="button" class="of-star' + (fav ? ' on' : '') + '" data-star="' + esc(item.number) + '" aria-label="Favourite">' + (fav ? '★' : '☆') + '</button>') +
      // ⋮ = the same actions as holding the row (hold isn't discoverable with a mouse)
      (s.downloaded.has(item.number) && !st.busy.has(item.number) ? '<button type="button" class="of-more" data-more="' + esc(item.number) + '" aria-label="More" title="More">⋮</button>' : '') + '</div>';
  }

  function renderList() {
    if (A().state && document.getElementById('view-other-forms').classList.contains('hidden')) return;
    const s = L().getState();
    $('#of-code-sub').textContent = s.hasCode ? 'Set' : 'Needed to unlock the forms';
    const msg = $('#of-message');
    msg.textContent = s.message || ''; msg.classList.toggle('hidden', !s.message);
    const list = $('#of-list');
    $('#of-search-wrap').classList.toggle('hidden', !s.index);
    if (!s.index) {
      list.innerHTML = '<p class="hint">' + (s.hasCode ? (s.busy ? 'Getting the forms…' : 'Open once with internet to get the forms.') : 'Enter the access code to see the forms.') + '</p>';
      return;
    }
    const fillNos = new Set(L().fillIn(s).map((i) => i.number));
    if (st.query.trim()) {
      const hits = st.hits;
      list.innerHTML = hits == null ? '<p class="hint">Searching…</p>' : !hits.length ? '<p class="hint" id="of-no-match">No matches</p>'
        : hits.map((h) => row(h.item, s, { act: fillNos.has(h.item.number) ? 'form' : 'open', snippet: h.snippet, star: false })).join('');
      return;
    }
    const counts = {};
    for (const d of S().drafts()) counts[d.formNumber] = (counts[d.formNumber] || 0) + 1;
    let h = '<div class="of-break" id="of-break-fill">FILL IN</div>';
    h += L().fillIn(s).map((i) => row(i, s, { act: 'form', count: counts[i.number] })).join('') || '<p class="hint">None yet.</p>';
    h += '<div class="of-break" id="of-break-download">DOWNLOAD</div>';
    const dl = L().downloadForms(s);
    if (dl.length) h += '<p class="of-sublabel">Forms</p>' + dl.map((i) => row(i, s, { act: 'open', note: s.needsUpdating.has(i.number) ? 'Needs updating' : null })).join('');
    h += '<p class="of-sublabel">Policies</p>';
    for (const g of ['Company', 'HR', 'HSEQ', 'IT']) {
      const items = L().policies(s).filter((p) => p.group === g);
      if (!items.length) continue;
      const open = !!st.groupsOpen[g];
      h += '<button type="button" class="of-group" data-group="' + g + '" aria-expanded="' + open + '">' + g + ' <span>' + (open ? '▾' : '▸') + '</span></button>';
      if (open) h += items.map((p) => row(p, s, { act: 'open' })).join('');
    }
    const p = st.allProgress;
    const total = L().totalBytes();
    h += '<div class="of-break" id="of-break-device">ON THIS DEVICE</div>' +
      '<button type="button" class="of-tool" id="btn-of-download-all"' + (p ? ' disabled' : '') + '>' + ICON.down + '<span>Download all</span><span class="of-info" id="of-download-all-info">' +
        (p ? p[0] + ' of ' + p[1] : (s.downloaded.size >= s.index.items.length ? 'All done' : total ? R().sizeText(total) : '')) + '</span></button>' +
      '<button type="button" class="of-tool danger" id="btn-of-delete-all"' + (p || !s.downloaded.size ? ' disabled' : '') + '>' + ICON.bin + '<span>Delete all downloads</span><span class="of-info" id="of-used">' + R().sizeText(st.used) + '</span></button>' +
      '<p class="hint">Hold a downloaded item, or tap ⋮, to delete it.</p>';
    list.innerHTML = h;
  }

  async function refreshUsed() { st.used = await L().downloadedBytes(); renderList(); }

  let searchTimer = null;
  function onSearch() {
    st.query = $('#of-search').value;
    clearTimeout(searchTimer);
    st.hits = null; renderList();
    if (!st.query.trim()) return;
    searchTimer = setTimeout(async () => {
      const q = st.query;
      const hits = await L().find(q);
      if (hits && q === st.query) { st.hits = hits; renderList(); } // a newer search wins
    }, 200);
  }

  function itemByNo(no) { const s = L().getState(); return ((s.index && s.index.items) || []).find((i) => i.number === no) || null; }

  /** Download-only item: fetch (queued, own spinner), then offer Open / Download / Share. */
  async function openOriginal(item) {
    if (st.busy.has(item.number)) return;
    st.busy.add(item.number); renderList();
    try {
      const bytes = await L().original(item);
      fileSheet(item.file.name, bytes, { title: item.title, canOpen: /\.pdf$/i.test(item.file.name) });
    } catch (e) {
      A().toast(L().errorMessage(e));
    } finally {
      st.busy.delete(item.number); renderList(); refreshUsed();
    }
  }

  /** Hold (or right-click) a downloaded item → delete just that download. */
  function askDelete(item) {
    if (!L().getState().downloaded.has(item.number)) return;
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Delete download"><div class="sheet-grip"></div><h2>' + esc(item.title) + '</h2>' +
      '<p class="hint">Delete the copy on this device?</p><div class="sheet-actions"><button type="button" class="btn danger" id="btn-of-del-one">Delete</button><button type="button" class="btn ghost" data-close>Cancel</button></div></div>');
    $('#btn-of-del-one', sh.el).onclick = async () => { sh.close(); await L().deleteDownload(item); A().toast('Deleted'); refreshUsed(); };
  }

  function wireList() {
    $('#btn-of-back').onclick = () => A().showSettings();
    $('#btn-of-code').onclick = showCode;
    $('#of-search').addEventListener('input', onSearch);
    const list = $('#of-list');
    let hold = null; let held = false;
    list.addEventListener('pointerdown', (e) => {
      const r = e.target.closest('.of-row'); if (!r || e.target.closest('.of-star, .of-more')) return;
      held = false; clearTimeout(hold);
      hold = setTimeout(() => { held = true; const it = itemByNo(r.dataset.no); if (it) askDelete(it); }, 600);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'scroll'].forEach((ev) => list.addEventListener(ev, () => clearTimeout(hold), { passive: true }));
    list.addEventListener('contextmenu', (e) => { const r = e.target.closest('.of-row'); if (!r) return; e.preventDefault(); clearTimeout(hold); if (!held) { held = true; const it = itemByNo(r.dataset.no); if (it) askDelete(it); } });
    list.addEventListener('click', async (e) => {
      if (held) { held = false; return; }
      const more = e.target.closest('[data-more]');
      if (more) { const it = itemByNo(more.dataset.more); if (it) askDelete(it); return; }
      const star = e.target.closest('[data-star]');
      if (star) { const it = itemByNo(star.dataset.star); if (it) { await L().toggleFavourite(it); refreshUsed(); } return; }
      const grp = e.target.closest('[data-group]');
      if (grp) { st.groupsOpen[grp.dataset.group] = !st.groupsOpen[grp.dataset.group]; renderList(); return; }
      if (e.target.closest('#btn-of-download-all')) return downloadAll();
      if (e.target.closest('#btn-of-delete-all')) return deleteAll();
      const r = e.target.closest('.of-row'); if (!r) return;
      const it = itemByNo(r.dataset.no); if (!it) return;
      if (r.dataset.act === 'form') openForm(it.number); else openOriginal(it);
    });
    L().onChange(() => { renderList(); if (!$('#view-form-home').classList.contains('hidden')) renderHome(); });
  }

  async function downloadAll() {
    if (st.allProgress) return;
    try {
      await L().downloadAll((done, total) => { st.allProgress = [done, total]; renderList(); });
    } catch (e) { A().toast(L().errorMessage(e)); }
    st.allProgress = null; refreshUsed();
  }
  async function deleteAll() {
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Delete all downloads"><div class="sheet-grip"></div><h2>Delete all downloads?</h2>' +
      '<p class="hint">' + esc(R().sizeText(st.used)) + ' on this device. Your filled forms stay.</p><div class="sheet-actions"><button type="button" class="btn danger" id="btn-of-del-all-yes">Delete all</button><button type="button" class="btn ghost" data-close>Cancel</button></div></div>');
    $('#btn-of-del-all-yes', sh.el).onclick = async () => { sh.close(); await L().deleteAllDownloads(); A().toast('Deleted'); refreshUsed(); };
  }

  // ——— Access code ———
  function showCode() {
    $('#forms-code-input').value = '';
    $('#forms-code-error').textContent = '';
    $('#btn-forms-code-remove').classList.toggle('hidden', !L().getState().hasCode);
    A().showView('forms-code');
  }
  function wireCode() {
    $('#btn-code-back').onclick = showList;
    // the "Wrong code" message goes as soon as you start typing again
    $('#forms-code-input').addEventListener('input', () => { $('#forms-code-error').textContent = ''; });
    $('#form-forms-code').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#btn-forms-code-save');
      btn.disabled = true; btn.textContent = 'Checking…';
      const err = await L().setCode($('#forms-code-input').value);
      btn.disabled = false; btn.textContent = 'Save';
      $('#forms-code-input').value = '';
      if (err) { $('#forms-code-error').textContent = err; return; }
      A().toast('Unlocked');
      await showList();
      refreshUsed();
    });
    $('#btn-forms-code-remove').onclick = async () => { await L().clearCode(); A().toast('Code removed'); showList(); };
  }

  // ——— One fill-in form: New / History + Import ———
  function current() {
    const s = L().getState();
    const item = ((s.index && s.index.items) || []).find((i) => i.number === st.form);
    return { s, item, spec: item ? s.specs[item.number] : null };
  }
  // 1.2.2-web: filled forms are personal details — unlock first when the lock is on
  async function openForm(no) {
    if (global.AsLockUi && !(await global.AsLockUi.need())) return;
    st.form = no; st.tab = 0; A().showView('form-home'); renderHome();
  }
  function setBusy(b) { st.homeBusy = b; $('#fh-busy').classList.toggle('hidden', !b); ['#btn-fh-start', '#btn-fh-import', '#btn-fh-import2'].forEach((x) => { $(x).disabled = b; }); }

  function renderHome() {
    const { item, spec } = current();
    if (!item) return showList();
    const copies = S().draftsFor(item.number);
    $('#fh-title').textContent = (spec && spec.short) || item.title;
    $('#fh-name').textContent = item.title;
    $('#fh-number').textContent = item.number + ' ' + item.rev;
    $('#fh-tab-new').classList.toggle('on', st.tab === 0);
    $('#fh-tab-history').classList.toggle('on', st.tab === 1);
    $('#fh-tab-history').textContent = copies.length ? 'History · ' + copies.length : 'History';
    $('#fh-new').classList.toggle('hidden', st.tab !== 0);
    const hist = $('#fh-history');
    hist.classList.toggle('hidden', st.tab !== 1);
    if (st.tab !== 1) return;
    if (!copies.length) { hist.innerHTML = '<p class="empty">Nothing yet</p>'; return; }
    hist.innerHTML = '<div class="card-list">' + copies.map((d) => {
      const kind = d.exportedAt ? ['Exported', 'tag-ok'] : d.importedFrom ? ['Imported', 'tag-imp'] : ['Draft', 'tag-imp'];
      return '<div class="card fh-row" data-id="' + esc(d.id) + '" role="button" tabindex="0"><div class="fh-row-text"><p class="title">' + esc(R().ukDate(new Date(d.exportedAt || d.updatedAt))) +
        ' <span class="fh-tag ' + kind[1] + '">' + kind[0] + '</span></p><p class="meta fh-line">' + esc(R().historyLine(d)) + '</p></div>' +
        (d.exportedAt ? '<button type="button" class="icon-btn" data-share="' + esc(d.id) + '" aria-label="Share again" title="Share again">' + ICON.share + '</button>'
          : '<button type="button" class="icon-btn" data-del="' + esc(d.id) + '" aria-label="Delete" title="Delete">' + ICON.bin + '</button>') + '</div>';
    }).join('') + '</div><p class="hint" id="fh-hint">' + (copies.some((d) => d.exportedAt) ? 'Tap to open · <span class="inline-ico" aria-label="Share">' + ICON.share + '</span> to share again' : 'Tap to open') + '</p>';
  }

  async function lastJob() {
    try {
      const ts = await global.AsStorage.listTimesheets();
      const all = ts.flatMap((t) => t.entries || []).filter((e) => e.jobNumber);
      return all.length ? all[all.length - 1].jobNumber : '';
    } catch (_) { return ''; }
  }

  async function startNew(values, from, unsure) {
    const { item, spec } = current();
    if (!spec) return;
    const start = values || R().prefill(spec, { name: global.AsStorage.getSettings().displayName || '', hr: S().hr(), lastJob: await lastJob() });
    const d = await S().saveDraft({
      id: S().newId(), formNumber: item.number, version: 1, values: start,
      signatureSlot: R().hasSignature(spec) ? S().sigDefault() : null,
      privateKeys: R().fields(spec).filter((f) => f.noBackup).map((f) => f.key),
      importedFrom: from || null, unsure: unsure || [], updatedAt: Date.now(), exportedAt: null, exportFormat: null, sentTo: null,
    });
    openDraft(d.id);
  }

  async function withReady(fn) {
    if (st.homeBusy) return;
    const { item } = current();
    setBusy(true);
    let err = null;
    try { err = await L().ready(item); } catch (e) { err = L().errorMessage(e); } finally { setBusy(false); }
    if (err) A().toast(err); else await fn();
  }

  async function onImportFile(file) {
    if (!file) return;
    const { item } = current();
    setBusy(true);
    try {
      const err = await L().ready(item);
      if (err) { A().toast(err); return; }
      const spec = L().getState().specs[item.number];
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isPdf = /\.pdf$/i.test(file.name) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
      let r;
      try {
        r = isPdf ? await global.AsFormPdf.importPdf(spec, bytes) : await global.AsFormDocx.importDocx(spec, await L().template(item), bytes);
      } catch (e) { A().toast("Couldn't import"); return; }
      if (!r.filled) { A().toast('Nothing found to import'); return; }
      importSheet(file.name, item, r);
    } finally { setBusy(false); }
  }

  function importSheet(name, item, r) {
    const line = (m, t, cls, id) => '<div class="imp-line ' + cls + '" id="' + id + '"><span>' + m + '</span>' + esc(t) + '</div>';
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Imported"><div class="sheet-grip"></div><h2>Imported</h2>' +
      '<p class="hint" id="import-file">' + esc(name + ' · ' + item.number + ' ' + item.rev) + '</p>' +
      line('✓', r.filled + ' of ' + r.total + ' filled', 'ok', 'import-filled') +
      (r.unsure.length ? line('!', r.unsure.length + ' to check', 'amber', 'import-unsure') : '') +
      (r.signatureSkipped ? line('–', 'Signature not imported', 'plain', 'import-sig') : '') +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-import-review">Review</button><button type="button" class="btn ghost" data-close>Cancel</button></div></div>');
    $('#btn-import-review', sh.el).onclick = () => { sh.close(); startNew(r.values, name, r.unsure); };
  }

  function deleteWithUndo(d) {
    S().deleteDraft(d.id).then(renderHome);
    A().toastUndo('Copy deleted', async () => { await S().saveDraft(d); renderHome(); });
  }

  function wireHome() {
    $('#btn-fh-back').onclick = showList;
    $('#fh-tab-new').onclick = () => { st.tab = 0; renderHome(); };
    $('#fh-tab-history').onclick = () => { st.tab = 1; renderHome(); };
    $('#btn-fh-start').onclick = () => withReady(() => startNew());
    const pick = () => { if (!st.homeBusy) $('#fh-file').click(); };
    $('#btn-fh-import').onclick = pick;
    $('#btn-fh-import2').onclick = pick;
    $('#fh-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onImportFile(f); });
    $('#fh-history').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { const d = S().draft(del.dataset.del); if (d) deleteWithUndo(d); return; }
      const sh = e.target.closest('[data-share]');
      if (sh) { const d = S().draft(sh.dataset.share); if (d) shareAgain(d); return; }
      const r = e.target.closest('.fh-row');
      if (r) withReady(async () => openDraft(r.dataset.id));
    });
  }

  // ——— Edit ———
  async function openDraft(id) {
    if (global.AsLockUi && !(await global.AsLockUi.need())) return; // 1.2.2-web lock
    st.draftId = id; st.nextAt = 0; A().showView('form-edit'); renderEdit();
  }
  function editCtx() {
    const d = S().draft(st.draftId);
    const s = L().getState();
    const item = d && ((s.index && s.index.items) || []).find((i) => i.number === d.formNumber);
    return { d, item, spec: item ? s.specs[item.number] : null };
  }
  function previousPercent(d, spec) {
    const hr = S().hr();
    if (hr.pensionPercent) return hr.pensionPercent;
    const prev = S().draftsFor(spec.number).filter((x) => x.exportedAt && x.id !== d.id).sort((a, b) => b.exportedAt - a.exportedAt)[0];
    return prev ? prev.values['pen.percent'] : null;
  }

  function fieldHtml(f, d, locked) {
    const v = d.values[f.key] || '';
    const dis = locked ? ' disabled' : '';
    const amber = (d.unsure || []).includes(f.key) ? ' unsure' : '';
    const id = 'ff-' + f.key.replace(/[^a-zA-Z0-9_-]/g, '_');
    let inner;
    if (f.type === 'radio') {
      inner = '<span class="field-label">' + esc(f.label) + '</span><div class="chips fe-chips" data-key="' + esc(f.key) + '">' +
        (f.options || []).map((o) => '<button type="button" class="chip' + (v === o.key ? ' on' : '') + '" data-opt="' + esc(o.key) + '"' + dis + '>' + esc(o.label) + '</button>').join('') + '</div>';
    } else if (f.type === 'date') {
      inner = '<label for="' + id + '">' + esc(f.label) + '</label><input type="date" id="' + id + '" data-key="' + esc(f.key) + '" value="' + esc(R().toIso(v)) + '"' + dis + ' />';
    } else if (f.type === 'longtext') {
      inner = '<label for="' + id + '">' + esc(f.label) + '</label><textarea id="' + id + '" data-key="' + esc(f.key) + '" rows="3"' + dis + '>' + esc(v) + '</textarea>';
    } else {
      const masked = f.sensitive && f.noBackup;
      const num = f.type === 'number' ? ' inputmode="decimal"' : '';
      inner = '<label for="' + id + '">' + esc(f.label) + '</label><div class="fe-input' + (masked ? ' has-eye' : '') + '"><input type="text" id="' + id + '" data-key="' + esc(f.key) + '" value="' + esc(v) + '"' + num + dis +
        (masked ? ' class="masked" autocomplete="off"' : '') + ' />' + (masked ? '<button type="button" class="icon-btn eye" data-eye="' + id + '" aria-label="Show">' + ICON.eye + '</button>' : '') + '</div>';
    }
    const err = R().check(f.validate, v);
    return '<div class="fe-field' + (f.half ? ' half' : '') + amber + '" id="box-' + id + '">' + inner +
      '<p class="fe-err" data-err="' + esc(f.key) + '">' + esc(err || '') + '</p>' +
      (f.validate === 'percent' ? '<p class="fe-warn hidden" data-warn="' + esc(f.key) + '"></p>' : '') + '</div>';
  }

  function renderEdit() {
    const { d, item, spec } = editCtx();
    if (!d || !spec) return showList();
    const locked = !!d.exportedAt;
    $('#fe-title').textContent = spec.short || spec.title;
    let h = '';
    if (locked) h += '<div class="fe-banner ok"><span>Exported ' + esc(R().ukDate(new Date(d.exportedAt))) + '</span><button type="button" class="btn ghost small" id="btn-fe-new-copy">Edit as new copy</button></div>';
    const order = R().fields(spec).map((f) => f.key).filter((k) => (d.unsure || []).includes(k));
    if (order.length && !locked) h += '<div class="fe-banner amber" id="import-check-banner"><span id="fe-check-count">' + order.length + ' to check</span><button type="button" class="btn ghost small" id="btn-fe-next">Next</button></div>';
    // one count for the whole form — the same function the import summary uses
    const all = R().countFilled(R().fields(spec), d.values);
    h += '<p class="hint fe-count" id="fe-count">' + all.filled + ' of ' + all.total + ' filled</p>';
    if (spec.note) h += '<p class="hint">' + esc(spec.note) + '</p>';
    spec.sections.forEach((s, si) => {
      const fs = s.fields || [];
      if (fs.length === 1 && fs[0].type === 'signature') { h += sigCard(d, locked); return; }
      const visible = fs.filter((f) => !f.key.endsWith('_other') || d.values[f.key.replace(/_other$/, '')] === 'other');
      const n = R().countFilled(fs, d.values);
      const open = !s.collapsed || fs.some((f) => (d.unsure || []).includes(f.key));
      h += '<details class="panel fe-card"' + (open ? ' open' : '') + '><summary><span>' + esc(s.title) + '</span>' + (n.total ? '<span class="hint" data-sec="' + si + '">' + n.filled + ' of ' + n.total + ' filled</span>' : '') + '</summary>' +
        (s.note ? '<p class="hint">' + esc(s.note) + '</p>' : '') + '<div class="fe-grid">' + visible.map((f) => fieldHtml(f, d, locked)).join('') + '</div></details>';
    });
    $('#fe-body').innerHTML = h;
    $('#btn-fe-export').disabled = false;
    updateWarnings();
  }

  function sigCard(d, locked) {
    const png = S().sigBytes(d.signatureSlot);
    const img = png ? '<img class="sig-img" alt="Signature" src="data:image/png;base64,' + b64(png) + '" />' : '<p class="hint">No signature</p>';
    return '<div class="panel fe-card fe-sig"><div class="fe-sig-head"><strong>Signature</strong>' + (locked ? '' : '<button type="button" class="btn ghost small" id="btn-fe-sig">' + (png ? 'Change' : 'Add') + '</button>') + '</div>' + img + '</div>';
  }

  function updateWarnings() {
    const { d, spec } = editCtx();
    if (!d || !spec) return;
    const prev = previousPercent(d, spec);
    document.querySelectorAll('#fe-body [data-warn]').forEach((p) => {
      const v = d.values[p.dataset.warn] || '';
      const show = !R().check('percent', v) && R().pensionLowered(prev, v);
      p.textContent = show ? '⚠ Lower than ' + prev + '% — may lose company contribution' : '';
      p.classList.toggle('hidden', !show);
    });
  }

  function setValue(key, v) {
    const { d, spec } = editCtx();
    if (!d || d.exportedAt) return;
    const values = Object.assign({}, d.values);
    if (v == null || v === '') delete values[key]; else values[key] = v;
    const unsure = (d.unsure || []).filter((k) => k !== key);
    const next = Object.assign({}, d, { values, unsure, updatedAt: Date.now() });
    S().saveDraft(next); // autosave on every change
    refreshCounts(spec, values);
    const f = R().field(spec, key);
    const err = document.querySelector('#fe-body [data-err="' + CSS.escape(key) + '"]');
    if (err) err.textContent = (f && R().check(f.validate, v || '')) || '';
    if (d.unsure && d.unsure.includes(key)) {
      const box = document.querySelector('#fe-body [data-key="' + CSS.escape(key) + '"]');
      const wrap = box && box.closest('.fe-field'); if (wrap) wrap.classList.remove('unsure');
      const left = unsure.length;
      const c = $('#fe-check-count'); if (c) c.textContent = left + ' to check';
      if (!left) { const b = $('#import-check-banner'); if (b) b.remove(); }
    }
    updateWarnings();
  }

  /** Keeps the "N of M filled" lines up to date while typing. */
  function refreshCounts(spec, values) {
    const all = R().countFilled(R().fields(spec), values);
    const top = $('#fe-count'); if (top) top.textContent = all.filled + ' of ' + all.total + ' filled';
    spec.sections.forEach((s, si) => {
      const el = document.querySelector('#fe-body [data-sec="' + si + '"]'); if (!el) return;
      const n = R().countFilled(s.fields || [], values); el.textContent = n.filled + ' of ' + n.total + ' filled';
    });
  }

  function wireEdit() {
    $('#btn-fe-back').onclick = () => { const { d } = editCtx(); if (d) { st.form = d.formNumber; st.tab = 1; A().showView('form-home'); renderHome(); } else showList(); };
    $('#btn-fe-delete').onclick = async () => {
      const { d } = editCtx(); if (!d) return;
      st.form = d.formNumber; st.tab = 1; A().showView('form-home');
      deleteWithUndo(d);
    };
    const body = $('#fe-body');
    body.addEventListener('input', (e) => {
      const el = e.target; if (!el.dataset || !el.dataset.key) return;
      setValue(el.dataset.key, el.type === 'date' ? R().fromIso(el.value) : el.value);
    });
    body.addEventListener('click', async (e) => {
      const chip = e.target.closest('.fe-chips .chip');
      if (chip && !chip.disabled) {
        const group = chip.closest('.fe-chips'); const key = group.dataset.key;
        const { d } = editCtx();
        const now = d.values[key] === chip.dataset.opt ? null : chip.dataset.opt;
        setValue(key, now);
        group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.opt === now));
        if (key + '_other' && R().field(editCtx().spec, key + '_other')) renderEdit(); // show / hide "Other title"
        return;
      }
      const eye = e.target.closest('[data-eye]');
      if (eye) { const i = document.getElementById(eye.dataset.eye); i.classList.toggle('masked'); return; }
      if (e.target.closest('#btn-fe-new-copy')) { const { d, spec } = editCtx(); const n = await S().newVersion(d, spec); openDraft(n.id); return; }
      if (e.target.closest('#btn-fe-next')) {
        const { d, spec } = editCtx();
        const order = R().fields(spec).map((f) => f.key).filter((k) => (d.unsure || []).includes(k));
        if (!order.length) return;
        const key = order[st.nextAt++ % order.length];
        const el = body.querySelector('[data-key="' + CSS.escape(key) + '"]');
        if (el) { const card = el.closest('details'); if (card) card.open = true; el.closest('.fe-field').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return;
      }
      if (e.target.closest('#btn-fe-sig')) sigPicker();
    });
    $('#btn-fe-preview').onclick = preview;
    // 1.2.2-web: with the name off, ask for it first (kept for this session)
    $('#btn-fe-export').onclick = async () => { if (global.AsLockUi && !(await global.AsLockUi.ensureName())) return; exportSheet(); };
    // Bank & NI typed on a form are forgotten as soon as you leave it
    new MutationObserver(() => { if ($('#view-form-edit').classList.contains('hidden')) S().forgetBank(); })
      .observe($('#view-form-edit'), { attributes: true, attributeFilter: ['class'] });
  }

  function sigPicker() {
    const { d } = editCtx();
    const slots = S().sigSlots();
    const imgs = slots.map((s) => '<button type="button" class="sig-pick" data-slot="' + s + '"><img alt="Signature ' + (s + 1) + '" src="data:image/png;base64,' + b64(S().sigBytes(s)) + '" /></button>').join('');
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Signature"><div class="sheet-grip"></div><h2>Signature</h2>' +
      (slots.length ? imgs : '<p class="hint">Add one in Profile › Signature.</p>') +
      '<div class="sheet-actions"><button type="button" class="btn ghost" id="btn-sig-none">No signature</button><button type="button" class="btn ghost" data-close>Close</button></div></div>');
    sh.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-slot]');
      if (b) { await S().saveDraft(Object.assign({}, d, { signatureSlot: Number(b.dataset.slot), updatedAt: Date.now() })); sh.close(); renderEdit(); }
      if (e.target.closest('#btn-sig-none')) { await S().saveDraft(Object.assign({}, d, { signatureSlot: null, updatedAt: Date.now() })); sh.close(); renderEdit(); }
    });
  }

  /** Preview: the paper copy drawn as HTML (same layout idea as the PDF). */
  function preview() {
    const { d, spec } = editCtx();
    const png = S().sigBytes(d.signatureSlot);
    let h = '<div class="paper"><div class="paper-head"><strong>' + esc(spec.title) + '</strong><span>' + esc(spec.number + ' ' + spec.rev) + '</span></div>';
    for (const s of spec.sections) {
      h += '<div class="paper-band">' + esc(s.title) + '</div>' + (s.note ? '<p class="paper-note">' + esc(s.note) + '</p>' : '') + '<div class="paper-grid">';
      for (const f of s.fields || []) {
        let v;
        if (f.type === 'signature') v = png ? '<img class="sig-img" alt="" src="data:image/png;base64,' + b64(png) + '" />' : '';
        else if (f.type === 'radio') v = (f.options || []).map((o) => (d.values[f.key] === o.key ? '☒ ' : '☐ ') + esc(o.label)).join('&nbsp;&nbsp; ');
        else v = esc(R().tidy(f.validate, d.values[f.key] || '')).replace(/\n/g, '<br>');
        h += '<div class="paper-box' + (f.half ? ' half' : '') + '"><span>' + esc(f.label) + '</span><div>' + v + '</div></div>';
      }
      h += '</div>';
    }
    h += '</div>';
    A().openSheet('<div class="sheet preview-sheet" role="dialog" aria-label="Preview"><div class="sheet-grip"></div><h2>Preview</h2>' + h +
      '<div class="sheet-actions"><button type="button" class="btn ghost" data-close>Close</button></div></div>');
  }

  /** Builds the filled file: Word (company template), PDF (paper copy) or the filled Observation Card. */
  async function buildFile(d, item, spec, format) {
    const sig = S().sigBytes(d.signatureSlot);
    const pdf = R().isPdf(spec) || format === 'PDF';
    const name = R().exportFileName(spec, R().surnameFor(d.values, global.AsStorage.getSettings().displayName), new Date(), pdf ? 'pdf' : 'docx');
    let bytes;
    if (R().isPdf(spec)) bytes = await global.AsFormPdf.fillObservation(await L().original(item), spec, d.values);
    else if (format === 'Word') bytes = await global.AsFormDocx.fill(await L().template(item), spec, d.values, sig);
    else bytes = await global.AsFormPdf.paperPdf(spec, d.values, sig);
    return { name, bytes, mime: pdf ? MIME.pdf : MIME.docx, format: pdf ? 'PDF' : 'Word' };
  }

  function formTo(sendTo) {
    const s = global.AsStorage.getSettings();
    if (sendTo === 'payroll') return s.payrollTo || 'jillian.robertson@andrewssurvey.com';
    if (sendTo === 'hr') return s.hrTo || 'jillian.robertson@andrewssurvey.com';
    return HSEQ_TO;
  }

  function canShare(file) { return global.AsAttachments && global.AsAttachments.canShareFile(file); }

  /** Export sheet (mockup 05): Word / PDF, then Email (mail app / share sheet), Share or Download. */
  function exportSheet() {
    const { d, item, spec } = editCtx();
    const errs = R().fields(spec).filter((f) => R().check(f.validate, d.values[f.key] || ''));
    if (errs.length) { A().toast('Check the boxes in red'); return; }
    const pdfOnly = R().isPdf(spec);
    const to = formTo(spec.sendTo);
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Export"><div class="sheet-grip"></div><h2>Export</h2>' +
      (pdfOnly ? '<p class="hint">PDF</p>' : '<div class="chips" id="exp-format"><button type="button" class="chip on" data-f="Word">Word</button><button type="button" class="chip" data-f="PDF">PDF</button></div>') +
      '<p class="hint">To: ' + esc(to) + '</p><p class="file-chip" id="exp-file">Preparing…</p>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-exp-email" disabled>Email</button>' +
      '<button type="button" class="btn secondary" id="btn-exp-share" disabled>Share…</button>' +
      '<button type="button" class="btn secondary" id="btn-exp-download" disabled>Download</button><button type="button" class="btn ghost" data-close>Close</button></div></div>');
    let format = pdfOnly ? 'PDF' : 'Word';
    let built = null; let token = 0;
    const prep = async () => {
      const my = ++token; built = null;
      ['#btn-exp-email', '#btn-exp-share', '#btn-exp-download'].forEach((x) => { $(x, sh.el).disabled = true; });
      $('#exp-file', sh.el).textContent = 'Preparing…';
      try {
        const b = await buildFile(S().draft(d.id) || d, item, spec, format);
        if (my !== token) return;
        built = b; st.built = b;
        built.file = new File([b.bytes], b.name, { type: b.mime });
        $('#exp-file', sh.el).textContent = '📄 ' + b.name;
        $('#btn-exp-email', sh.el).disabled = false; $('#btn-exp-download', sh.el).disabled = false;
        $('#btn-exp-share', sh.el).disabled = !canShare(built.file);
        $('#btn-exp-share', sh.el).classList.toggle('hidden', !canShare(built.file));
      } catch (e) { console.error(e); $('#exp-file', sh.el).textContent = (e && e.message) || 'Export failed'; }
    };
    prep();
    const fmt = $('#exp-format', sh.el);
    if (fmt) fmt.addEventListener('click', (e) => { const c = e.target.closest('[data-f]'); if (!c) return; format = c.dataset.f; fmt.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c)); prep(); });
    const done = async (sentTo) => {
      const cur = S().draft(d.id) || d;
      await S().saveDraft(Object.assign({}, cur, { exportedAt: Date.now(), exportFormat: built.format, sentTo: sentTo || null }));
      S().forgetBank(d.id); // 1.2.2-web: Bank & NI forgotten after export
      renderEdit();
      const back = R().changedHrDetails(spec, cur.values, S().hr());
      if (Object.keys(back).length) setTimeout(() => saveBackSheet(back), 400);
    };
    const name = global.AsStorage.getSettings().displayName || '';
    $('#btn-exp-email', sh.el).onclick = async () => {
      if (!built) return;
      const subject = spec.title + ' - ' + name;
      const body = 'Please find my ' + spec.title + ' form attached.\n\n' + name;
      if (canShare(built.file)) {
        // share sheet straight from the tap: pick the mail app there (the app never sends anything)
        try { await navigator.share({ files: [built.file], title: subject, text: body }); } catch (e) { if (e && e.name === 'AbortError') return; }
      } else {
        global.AsExport.downloadBlob(new Blob([built.bytes], { type: built.mime }), built.name);
        global.AsExport.openMailto(to, subject, body + '\n\n(Attach ' + built.name + ' from your downloads.)');
      }
      sh.close();
      await done(R().sendToName(spec.sendTo));
    };
    $('#btn-exp-share', sh.el).onclick = async () => {
      if (!built) return;
      try { await navigator.share({ files: [built.file], title: built.name }); } catch (e) { if (e && e.name === 'AbortError') return; }
      sh.close(); await done(null);
    };
    $('#btn-exp-download', sh.el).onclick = async () => {
      if (!built) return;
      global.AsExport.downloadBlob(new Blob([built.bytes], { type: built.mime }), built.name);
      A().toast('Downloaded ' + built.name);
      sh.close(); await done(null);
    };
  }

  function saveBackSheet(changes) {
    const n = Object.keys(changes).length;
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Update Profile"><div class="sheet-grip"></div><h2>Update Profile?</h2>' +
      '<p class="hint">Save ' + n + ' changed detail' + (n === 1 ? '' : 's') + ' to HR details.</p>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-saveback-yes">Save</button><button type="button" class="btn ghost" data-close>Not now</button></div></div>');
    $('#btn-saveback-yes', sh.el).onclick = async () => { await S().setHr(changes); sh.close(); A().toast('Saved'); };
  }

  /** ⤴ on an exported copy: build the same file again, then Share / Download. */
  async function shareAgain(d) {
    const s = L().getState();
    const item = ((s.index && s.index.items) || []).find((i) => i.number === d.formNumber);
    const spec = item && s.specs[item.number];
    if (!spec) return;
    setBusy(true);
    try {
      const b = await buildFile(d, item, spec, d.exportFormat === 'PDF' ? 'PDF' : 'Word');
      fileSheet(b.name, b.bytes, { title: 'Share again', mime: b.mime });
    } catch (e) { A().toast("Couldn't share"); } finally { setBusy(false); }
  }

  /** A ready file: Open (PDF) / Download / Share — each straight from a tap. */
  function fileSheet(name, bytes, o) {
    const mime = (o && o.mime) || (/\.pdf$/i.test(name) ? MIME.pdf : /\.docx$/i.test(name) ? MIME.docx : 'application/octet-stream');
    const blob = new Blob([bytes], { type: mime });
    let file = null; try { file = new File([blob], name, { type: mime }); } catch (_) { file = null; }
    const share = canShare(file);
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="File"><div class="sheet-grip"></div><h2>' + esc((o && o.title) || name) + '</h2>' +
      '<p class="file-chip">📄 ' + esc(name) + '</p><div class="sheet-actions">' +
      (o && o.canOpen ? '<button type="button" class="btn primary" data-act="open">Open</button>' : '') +
      '<button type="button" class="btn ' + (o && o.canOpen ? 'secondary' : 'primary') + '" data-act="download">Download</button>' +
      (share ? '<button type="button" class="btn secondary" data-act="share">Share…</button>' : '') +
      '<button type="button" class="btn ghost" data-close>Close</button></div></div>');
    sh.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'open') { if (!global.AsAttachments.openBlobInTab(blob, mime)) global.AsExport.downloadBlob(blob, name); }
      else if (b.dataset.act === 'download') { global.AsExport.downloadBlob(blob, name); A().toast('Downloaded ' + name); }
      else if (b.dataset.act === 'share') { try { await navigator.share({ files: [file], title: name }); } catch (_) { /* cancelled */ } }
    });
  }

  function wire() {
    injectViews();
    wireList(); wireCode(); wireHome(); wireEdit();
    S().init().then(() => L().loadCached()).catch((e) => console.error(e));
  }
  A().onBoot(wire);

  global.AsFormsUi = { showList, openForm, openDraft, showCode, formTo, buildFile, refreshUsed, _st: st };
})(window);
