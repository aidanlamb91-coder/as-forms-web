/**
 * AS Forms web MVP — single-page expense claims (local only).
 */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    view: 'home',
    claims: [],
    claimId: null,
    lineId: null,
    pendingReceipt: null, // { blob, name, type } or null; clearing flag
    clearReceipt: false,
  };

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function showView(name) {
    state.view = name;
    $$('.view').forEach((v) => v.classList.add('hidden'));
    const map = {
      home: '#view-home',
      settings: '#view-settings',
      claim: '#view-claim',
      line: '#view-line',
    };
    $(map[name]).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function money(n) {
    if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
    return '£' + Number(n).toFixed(2);
  }

  function lineTotal(line) {
    if (line.total != null && line.total !== '') return Number(line.total) || 0;
    return (Number(line.net) || 0) + (Number(line.vat) || 0);
  }

  function claimTotal(claim) {
    return (claim.lines || []).reduce((s, l) => s + lineTotal(l), 0);
  }

  function isValidJob(j) {
    return /^P[0-9]+$/.test(String(j || '').trim());
  }

  async function refreshHome() {
    state.claims = await AsStorage.listClaims();
    const list = $('#claim-list');
    const empty = $('#claim-empty');
    list.innerHTML = '';
    if (!state.claims.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    for (const c of state.claims) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      btn.innerHTML =
        '<p class="title">' + escapeHtml(c.jobNo || 'No job') + '</p>' +
        '<p class="meta">' + escapeHtml(c.name || '') + ' · ' +
        escapeHtml(c.dateFrom || '?') + ' → ' + escapeHtml(c.dateTo || '?') +
        ' · ' + (c.lines || []).length + ' line(s)</p>' +
        '<p class="money">' + money(claimTotal(c)) + '</p>';
      btn.addEventListener('click', () => openClaim(c.id));
      list.appendChild(btn);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function openClaim(id) {
    state.claimId = id;
    state.lineId = null;
    const claim = await AsStorage.getClaim(id);
    if (!claim) {
      toast('Claim not found');
      return showHome();
    }
    $('#claim-title').textContent = claim.jobNo || 'Claim';
    $('#claim-job').value = claim.jobNo || '';
    $('#claim-name').value = claim.name || AsStorage.getSettings().displayName;
    $('#claim-from').value = claim.dateFrom || '';
    $('#claim-to').value = claim.dateTo || '';
    $('#export-status').textContent = '';
    renderLines(claim);
    showView('claim');
  }

  function renderLines(claim) {
    const lines = claim.lines || [];
    $('#line-count').textContent = String(lines.length);
    const list = $('#line-list');
    const empty = $('#line-empty');
    list.innerHTML = '';
    if (!lines.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    lines.forEach((line) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      const receiptNote = line.receiptId ? ' · receipt' : '';
      btn.innerHTML =
        '<p class="title">' + escapeHtml(line.description || 'Line') + '</p>' +
        '<p class="meta">' + escapeHtml(line.date || '') + ' · ' +
        escapeHtml(line.jobNo || '') + receiptNote + '</p>' +
        '<p class="money">' + money(lineTotal(line)) + '</p>';
      btn.addEventListener('click', () => openLine(line.id));
      list.appendChild(btn);
    });
  }

  async function showHome() {
    state.claimId = null;
    state.lineId = null;
    await refreshHome();
    showView('home');
  }

  async function createClaim() {
    const settings = AsStorage.getSettings();
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    const claim = {
      id: AsStorage.uid('claim'),
      jobNo: 'P',
      name: settings.displayName,
      sendTo: settings.sendTo,
      dateFrom: iso,
      dateTo: iso,
      lines: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await AsStorage.putClaim(claim);
    toast('Claim created');
    await openClaim(claim.id);
  }

  async function saveClaimForm(ev) {
    ev.preventDefault();
    const job = $('#claim-job').value.trim();
    if (!isValidJob(job)) {
      toast('Job number must be P + digits');
      return;
    }
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return;
    claim.jobNo = job;
    claim.name = $('#claim-name').value.trim() || AsStorage.getSettings().displayName;
    claim.dateFrom = $('#claim-from').value;
    claim.dateTo = $('#claim-to').value;
    claim.sendTo = claim.sendTo || AsStorage.getSettings().sendTo;
    await AsStorage.putClaim(claim);
    $('#claim-title').textContent = claim.jobNo;
    toast('Claim saved');
  }

  async function deleteClaim() {
    if (!state.claimId) return;
    if (!confirm('Delete this claim and its receipts from this browser?')) return;
    await AsStorage.deleteClaim(state.claimId);
    toast('Claim deleted');
    await showHome();
  }

  async function addLine() {
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return;
    if ((claim.lines || []).length >= AsDocxFiller.MAX_LINES) {
      toast('Max ' + AsDocxFiller.MAX_LINES + ' lines (Word form limit)');
      return;
    }
    const line = {
      id: AsStorage.uid('line'),
      date: claim.dateFrom || new Date().toISOString().slice(0, 10),
      jobNo: claim.jobNo && isValidJob(claim.jobNo) ? claim.jobNo : '',
      description: '',
      foreignCurrency: '',
      net: null,
      vat: null,
      total: null,
      receiptId: null,
      receiptMeta: null,
    };
    claim.lines = claim.lines || [];
    claim.lines.push(line);
    await AsStorage.putClaim(claim);
    await openLine(line.id);
  }

  async function openLine(lineId) {
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return;
    const line = (claim.lines || []).find((l) => l.id === lineId);
    if (!line) {
      toast('Line not found');
      return openClaim(state.claimId);
    }
    state.lineId = lineId;
    state.pendingReceipt = null;
    state.clearReceipt = false;
    $('#line-title').textContent = line.description || 'Line item';
    $('#line-date').value = line.date || '';
    $('#line-job').value = line.jobNo || '';
    $('#line-desc').value = line.description || '';
    $('#line-fx').value = line.foreignCurrency || '';
    $('#line-net').value = line.net != null ? line.net : '';
    $('#line-vat').value = line.vat != null ? line.vat : '';
    $('#line-total').value = line.total != null ? line.total : '';
    $('#line-receipt').value = '';
    await renderReceiptPreview(line);
    showView('line');
  }

  async function renderReceiptPreview(line) {
    const box = $('#receipt-preview');
    box.innerHTML = '';
    box.classList.add('hidden');
    $('#btn-clear-receipt').classList.add('hidden');

    let blob = null;
    let meta = null;
    if (state.pendingReceipt) {
      blob = state.pendingReceipt.blob;
      meta = state.pendingReceipt;
    } else if (!state.clearReceipt && line.receiptId) {
      const rcpt = await AsStorage.getReceipt(line.receiptId);
      if (rcpt) {
        blob = rcpt.blob;
        meta = { name: rcpt.name, type: rcpt.type };
      }
    }
    if (!blob) return;

    box.classList.remove('hidden');
    $('#btn-clear-receipt').classList.remove('hidden');
    if ((meta.type || '').startsWith('image/')) {
      const img = document.createElement('img');
      img.alt = 'Receipt preview';
      img.src = URL.createObjectURL(blob);
      box.appendChild(img);
    } else {
      const chip = document.createElement('div');
      chip.className = 'pdf-chip';
      chip.textContent = '📎 ' + (meta.name || 'receipt.pdf');
      box.appendChild(chip);
    }
  }

  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function saveLineForm(ev) {
    ev.preventDefault();
    const job = $('#line-job').value.trim();
    if (job && !isValidJob(job)) {
      toast('Job number must be P + digits');
      return;
    }
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return;
    const idx = (claim.lines || []).findIndex((l) => l.id === state.lineId);
    if (idx < 0) return;
    const line = claim.lines[idx];

    line.date = $('#line-date').value;
    line.jobNo = job;
    line.description = $('#line-desc').value.trim();
    line.foreignCurrency = $('#line-fx').value.trim();
    line.net = numOrNull($('#line-net').value);
    line.vat = numOrNull($('#line-vat').value);
    line.total = numOrNull($('#line-total').value);

    if (state.clearReceipt && line.receiptId) {
      await AsStorage.deleteReceipt(line.receiptId);
      line.receiptId = null;
      line.receiptMeta = null;
    }
    if (state.pendingReceipt) {
      if (line.receiptId) await AsStorage.deleteReceipt(line.receiptId);
      const meta = await AsStorage.putReceipt(state.pendingReceipt.blob, {
        name: state.pendingReceipt.name,
        type: state.pendingReceipt.type,
      });
      line.receiptId = meta.id;
      line.receiptMeta = meta;
    }

    claim.lines[idx] = line;
    await AsStorage.putClaim(claim);
    state.pendingReceipt = null;
    state.clearReceipt = false;
    toast('Line saved');
    await openClaim(claim.id);
  }

  async function deleteLine() {
    if (!state.lineId) return;
    if (!confirm('Delete this line item?')) return;
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return;
    const line = (claim.lines || []).find((l) => l.id === state.lineId);
    if (line && line.receiptId) await AsStorage.deleteReceipt(line.receiptId);
    claim.lines = (claim.lines || []).filter((l) => l.id !== state.lineId);
    await AsStorage.putClaim(claim);
    toast('Line deleted');
    await openClaim(claim.id);
  }

  function openSettings() {
    const s = AsStorage.getSettings();
    $('#settings-name').value = s.displayName;
    $('#settings-send-to').value = s.sendTo;
    showView('settings');
  }

  function saveSettings(ev) {
    ev.preventDefault();
    AsStorage.saveSettings({
      displayName: $('#settings-name').value.trim() || 'Aidan Lamb',
      sendTo: $('#settings-send-to').value.trim() || 'invoice@andrewssurvey.com',
    });
    toast('Settings saved');
    showHome();
  }

  async function doExportZip() {
    const status = $('#export-status');
    status.classList.remove('error');
    status.textContent = 'Building zip…';
    try {
      const claim = await AsStorage.getClaim(state.claimId);
      const name = await AsExport.exportClaimZip(claim);
      status.textContent = 'Downloaded ' + name;
      toast('Zip downloaded');
    } catch (e) {
      console.error(e);
      status.classList.add('error');
      status.textContent = e.message || String(e);
    }
  }

  async function doExportDocx() {
    const status = $('#export-status');
    status.classList.remove('error');
    status.textContent = 'Filling Word form…';
    try {
      const claim = await AsStorage.getClaim(state.claimId);
      // Persist current header fields before export
      claim.jobNo = $('#claim-job').value.trim() || claim.jobNo;
      claim.name = $('#claim-name').value.trim() || claim.name;
      claim.dateFrom = $('#claim-from').value || claim.dateFrom;
      claim.dateTo = $('#claim-to').value || claim.dateTo;
      claim.sendTo = claim.sendTo || AsStorage.getSettings().sendTo;
      await AsStorage.putClaim(claim);
      const name = await AsExport.exportFilledDocx(claim);
      status.textContent = 'Downloaded ' + name;
      toast('Word form downloaded');
    } catch (e) {
      console.error(e);
      status.classList.add('error');
      status.textContent = e.message || String(e);
    }
  }

  function wire() {
    $('#btn-new-claim').addEventListener('click', createClaim);
    $('#btn-settings').addEventListener('click', openSettings);
    $('#form-settings').addEventListener('submit', saveSettings);
    $('#form-claim').addEventListener('submit', saveClaimForm);
    $('#btn-delete-claim').addEventListener('click', deleteClaim);
    $('#btn-add-line').addEventListener('click', addLine);
    $('#form-line').addEventListener('submit', saveLineForm);
    $('#btn-delete-line').addEventListener('click', deleteLine);
    $('#btn-line-back').addEventListener('click', () => openClaim(state.claimId));
    $('#btn-export-zip').addEventListener('click', doExportZip);
    $('#btn-export-docx').addEventListener('click', doExportDocx);

    $$('[data-back]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const to = btn.getAttribute('data-back');
        if (to === 'home') showHome();
      });
    });

    $('#line-receipt').addEventListener('change', async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      state.pendingReceipt = { blob: file, name: file.name, type: file.type };
      state.clearReceipt = false;
      const claim = await AsStorage.getClaim(state.claimId);
      const line = (claim.lines || []).find((l) => l.id === state.lineId) || {};
      await renderReceiptPreview(line);
    });

    $('#btn-clear-receipt').addEventListener('click', async () => {
      state.pendingReceipt = null;
      state.clearReceipt = true;
      $('#line-receipt').value = '';
      const claim = await AsStorage.getClaim(state.claimId);
      const line = (claim.lines || []).find((l) => l.id === state.lineId) || {};
      await renderReceiptPreview(line);
    });

    // Auto total = net + vat when total empty and net/vat change
    function maybeFillTotal() {
      const net = numOrNull($('#line-net').value);
      const vat = numOrNull($('#line-vat').value);
      const totEl = $('#line-total');
      if (totEl.dataset.touched === '1') return;
      if (net == null && vat == null) return;
      totEl.value = ((net || 0) + (vat || 0)).toFixed(2);
    }
    $('#line-net').addEventListener('input', maybeFillTotal);
    $('#line-vat').addEventListener('input', maybeFillTotal);
    $('#line-total').addEventListener('input', () => {
      $('#line-total').dataset.touched = '1';
    });
  }

  async function boot() {
    wire();
    // Ensure settings defaults exist
    AsStorage.saveSettings(AsStorage.getSettings());
    await showHome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
