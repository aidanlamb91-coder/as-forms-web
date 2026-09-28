/**
 * AS Forms web 0.2.14-web — Expenses | Timesheets | Days worked | Settings
 */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const DAY_TYPE_UI = [
    { key: 'OFFICE', label: 'Office' },
    { key: 'OFFSHORE', label: 'Offshore' },
    { key: 'ANNUAL_LEAVE', label: 'Holiday' },
    { key: 'ROSTER_LEAVE', label: 'Roster Leave' },
    { key: 'TRAINING', label: 'Training' },
    { key: 'SICK', label: 'Sick' },
  ];

  const state = {
    tab: 'expenses',
    expenseChip: 'active',
    tsChip: 'active',
    claimId: null,
    lineId: null,
    tsId: null,
    entryId: null,
    pendingReceipt: null,
    clearReceipt: false,
    ocrToken: 0,
    lastOcrParsed: null,
  };

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2400);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function normalizeJob(digitsOrFull) {
    const t = String(digitsOrFull || '').trim();
    const withoutP = t.replace(/^[Pp]/, '');
    const digits = withoutP.replace(/\D/g, '');
    return digits ? 'P' + digits : '';
  }

  function digitsOnly(job) {
    return String(job || '').replace(/^[Pp]/, '').replace(/\D/g, '');
  }

  function isValidJob(j) {
    return /^P[0-9]+$/.test(String(j || '').trim());
  }

  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function showView(name) {
    $$('.view').forEach((v) => v.classList.add('hidden'));
    const map = {
      expenses: '#view-expenses',
      timesheets: '#view-timesheets',
      days: '#view-days',
      settings: '#view-settings',
      emails: '#view-emails',
      templates: '#view-templates',
      backup: '#view-backup',
      claim: '#view-claim',
      line: '#view-line',
      'ts-new': '#view-ts-new',
      'ts-edit': '#view-ts-edit',
      'ts-entry': '#view-ts-entry',
    };
    const el = $(map[name]);
    if (el) el.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function setNav(tab) {
    state.tab = tab;
    $$('.bottom-nav button').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-nav') === tab);
    });
  }

  function updateListHeaders() {
    const s = AsStorage.getSettings();
    $('#expenses-header-sub').textContent = s.displayName + ' → ' + (s.expenseTo || s.sendTo);
    $('#timesheets-header-sub').textContent = s.displayName + ' → ' + s.timesheetTo;
  }

  // ——— Expenses list ———
  async function showExpenses() {
    state.claimId = null;
    state.lineId = null;
    setNav('expenses');
    updateListHeaders();
    await refreshClaimList();
    showView('expenses');
  }

  async function refreshClaimList() {
    const all = await AsStorage.listClaims();
    const filtered = all.filter((c) =>
      state.expenseChip === 'completed' ? c.completed : !c.completed
    );
    const list = $('#claim-list');
    const empty = $('#claim-empty');
    list.innerHTML = '';
    if (!filtered.length) {
      empty.classList.remove('hidden');
      empty.innerHTML = state.expenseChip === 'completed'
        ? 'No completed claims yet.'
        : 'No active claims. Tap <strong>+ New</strong> to start.';
      return;
    }
    empty.classList.add('hidden');

    if (state.expenseChip === 'completed') {
      const byYear = {};
      for (const c of filtered) {
        const y = (c.dateTo || c.dateFrom || '').slice(0, 4) || String(new Date().getFullYear());
        (byYear[y] = byYear[y] || []).push(c);
      }
      Object.keys(byYear).sort((a, b) => Number(b) - Number(a)).forEach((y) => {
        const h = document.createElement('div');
        h.className = 'year-header';
        h.textContent = y;
        list.appendChild(h);
        byYear[y].forEach((c) => list.appendChild(claimCard(c)));
      });
    } else {
      filtered.forEach((c) => list.appendChild(claimCard(c)));
    }
  }

  function claimCard(c) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    btn.innerHTML =
      '<p class="title">' + escapeHtml(c.jobNo || 'No job') + '</p>' +
      '<p class="meta">' + escapeHtml(c.dateFrom || '?') + ' → ' + escapeHtml(c.dateTo || '?') +
      ' · ' + (c.lines || []).length + ' line(s)</p>' +
      '<p class="money">' + money(claimTotal(c)) + '</p>';
    btn.addEventListener('click', () => openClaim(c.id));
    return btn;
  }

  async function createClaim() {
    const settings = AsStorage.getSettings();
    const iso = new Date().toISOString().slice(0, 10);
    const claim = {
      id: AsStorage.uid('claim'),
      jobNo: '',
      name: settings.displayName,
      sendTo: settings.expenseTo,
      dateFrom: iso,
      dateTo: iso,
      completed: false,
      lines: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await AsStorage.putClaim(claim);
    toast('Claim created');
    await openClaim(claim.id);
  }

  async function openClaim(id) {
    state.claimId = id;
    state.lineId = null;
    const claim = await AsStorage.getClaim(id);
    if (!claim) {
      toast('Claim not found');
      return showExpenses();
    }
    const s = AsStorage.getSettings();
    $('#claim-title').textContent = claim.jobNo || 'Claim';
    $('#claim-route-header').textContent = (s.displayName) + ' → ' + (s.expenseTo || s.sendTo);
    $('#claim-job-digits').value = digitsOnly(claim.jobNo);
    $('#claim-from').value = claim.dateFrom || '';
    $('#claim-to').value = claim.dateTo || '';
    $('#export-status').textContent = '';
    $('#btn-complete-claim').classList.toggle('hidden', !!claim.completed);
    $('#btn-reopen-claim').classList.toggle('hidden', !claim.completed);
    renderLines(claim);
    setNav('expenses');
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
        '<p class="meta">' + escapeHtml(line.date || '') + receiptNote + '</p>' +
        '<p class="money">' + money(lineTotal(line)) + '</p>';
      btn.addEventListener('click', () => openLine(line.id));
      list.appendChild(btn);
    });
  }

  async function saveClaimForm(ev) {
    ev.preventDefault();
    const job = normalizeJob($('#claim-job-digits').value);
    if (!isValidJob(job)) {
      toast('Job number must be P + digits');
      return;
    }
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return;
    const s = AsStorage.getSettings();
    claim.jobNo = job;
    claim.name = s.displayName;
    claim.sendTo = s.expenseTo;
    claim.dateFrom = $('#claim-from').value;
    claim.dateTo = $('#claim-to').value;
    // Android updateClaimJobNumber: every line JOB NO follows claim
    (claim.lines || []).forEach((line) => { line.jobNo = job; });
    await AsStorage.putClaim(claim);
    $('#claim-title').textContent = claim.jobNo;
    toast('Claim saved');
  }

  async function deleteClaim() {
    if (!state.claimId) return;
    if (!confirm('Delete this claim and its receipts from this browser?')) return;
    await AsStorage.deleteClaim(state.claimId);
    toast('Claim deleted');
    await showExpenses();
  }

  async function setClaimCompleted(completed) {
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return;
    claim.completed = completed;
    claim.completedAt = completed ? Date.now() : null;
    await AsStorage.putClaim(claim);
    toast(completed ? 'Marked complete' : 'Reopened');
    await openClaim(claim.id);
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
      jobNo: claim.jobNo || '',
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


  // ——— Receipt OCR (beta, on-device) ———
  function hideOcrUi() {
    const st = $('#ocr-status');
    const sg = $('#ocr-suggest');
    if (st) {
      st.classList.add('hidden');
      st.classList.remove('ocr-error');
    }
    if (sg) sg.classList.add('hidden');
    const alone = $('#btn-ocr-rescan-alone');
    if (alone) alone.classList.add('hidden');
    state.lastOcrParsed = null;
  }

  function showOcrStatus(msg, isError) {
    const st = $('#ocr-status');
    const sg = $('#ocr-suggest');
    if (sg) sg.classList.add('hidden');
    if (!st) return;
    st.classList.remove('hidden');
    st.classList.toggle('ocr-error', !!isError);
    $('#ocr-status-text').textContent = msg;
    const cancel = $('#btn-ocr-cancel');
    if (cancel) cancel.classList.toggle('hidden', !!isError);
  }

  function fillOcrSuggest(parsed) {
    state.lastOcrParsed = parsed;
    const sg = $('#ocr-suggest');
    if (!sg) return;
    $('#ocr-date').value = parsed.date || '';
    $('#ocr-desc').value = parsed.description || '';
    $('#ocr-net').value = parsed.net != null ? parsed.net : '';
    $('#ocr-vat').value = parsed.vat != null ? parsed.vat : '';
    $('#ocr-total').value = parsed.total != null ? parsed.total : '';
    const bits = [];
    if (parsed.date) bits.push('date');
    if (parsed.description) bits.push('merchant');
    if (parsed.total != null) bits.push('total');
    if (parsed.net != null) bits.push('net');
    if (parsed.vat != null) bits.push('VAT');
    // Job is claim-level only — ignore OCR job suggestions
    $('#ocr-suggest-note').textContent = bits.length
      ? ('Found: ' + bits.join(', ') + '. Edit if needed, then tap Use these.')
      : 'Nothing useful found — you can still type the line yourself.';
    sg.classList.remove('hidden');
    const alone = $('#btn-ocr-rescan-alone');
    if (alone) alone.classList.add('hidden');
  }

  function applyOcrSuggestions() {
    const date = $('#ocr-date').value;
    const desc = $('#ocr-desc').value.trim();
    const net = numOrNull($('#ocr-net').value);
    const vat = numOrNull($('#ocr-vat').value);
    const total = numOrNull($('#ocr-total').value);

    if (date) $('#line-date').value = date;
    if (desc) $('#line-desc').value = desc;
    if (net != null) {
      $('#line-net').value = net;
    }
    if (vat != null) {
      $('#line-vat').value = vat;
    }
    if (total != null) {
      $('#line-total').value = total;
      $('#line-total').dataset.touched = '1';
    } else if (net != null || vat != null) {
      // leave total auto-fill path
      const totEl = $('#line-total');
      if (totEl.dataset.touched !== '1') {
        totEl.value = ((net || 0) + (vat || 0)).toFixed(2);
      }
    }
    // Job stays claim-level — never apply OCR job onto a line
    hideOcrUi();
    toast('Suggestions applied — save the line when ready');
  }

  async function runReceiptOcr(blob, name) {
    if (!blob || !globalThis.AsReceiptOcr) return;
    const token = ++state.ocrToken;
    showOcrStatus('Reading receipt…', false);
    try {
      const result = await AsReceiptOcr.readReceipt(blob, {
        name: name || '',
        onProgress: (msg) => {
          if (token !== state.ocrToken) return;
          showOcrStatus(msg || 'Reading receipt…', false);
        },
      });
      if (token !== state.ocrToken) return;
      $('#ocr-status').classList.add('hidden');
      const parsed = result.parsed || {};
      if (AsReceiptParse && AsReceiptParse.hasUsefulSuggestions(parsed)) {
        fillOcrSuggest(parsed);
      } else {
        showOcrStatus('Could not read useful details from this receipt. You can fill the fields yourself — the attachment is still fine.', true);
        const alone = $('#btn-ocr-rescan-alone');
        if (alone) alone.classList.remove('hidden');
      }
    } catch (e) {
      if (token !== state.ocrToken) return;
      if (e && e.cancelled) {
        showOcrStatus('Reading cancelled. Attachment is still kept.', true);
        const alone = $('#btn-ocr-rescan-alone');
        if (alone) alone.classList.remove('hidden');
        return;
      }
      console.warn('OCR', e);
      showOcrStatus((e && e.message) || 'Could not read this receipt. You can still type the details.', true);
      const alone = $('#btn-ocr-rescan-alone');
      if (alone) alone.classList.remove('hidden');
    }
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
    state.ocrToken++;
    hideOcrUi();
    if (globalThis.AsReceiptOcr) try { AsReceiptOcr.cancel(); } catch (_) {}
    $('#line-title').textContent = line.description || 'Line item';
    $('#line-date').value = line.date || '';
    const claimJobHint = $('#line-claim-job-hint');
    if (claimJobHint) {
      claimJobHint.textContent = claim.jobNo
        ? ('Uses claim job ' + claim.jobNo + ' on every line (same as Android).')
        : 'Set the claim job number first — it applies to every line.';
    }
    $('#line-desc').value = line.description || '';
    $('#line-fx').value = line.foreignCurrency || '';
    $('#line-net').value = line.net != null ? line.net : '';
    $('#line-vat').value = line.vat != null ? line.vat : '';
    $('#line-total').value = line.total != null ? line.total : '';
    $('#line-total').dataset.touched = line.total != null ? '1' : '';
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

  async function saveLineForm(ev) {
    ev.preventDefault();
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return;
    const idx = (claim.lines || []).findIndex((l) => l.id === state.lineId);
    if (idx < 0) return;
    const line = claim.lines[idx];
    line.date = $('#line-date').value;
    // Job is claim-level only — mirror claim.jobNo onto every line
    line.jobNo = claim.jobNo || '';
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
    (claim.lines || []).forEach((l) => { l.jobNo = claim.jobNo || ''; });
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

  async function doExportZip() {
    const status = $('#export-status');
    status.classList.remove('error');
    status.textContent = 'Building zip…';
    try {
      const claim = await AsStorage.getClaim(state.claimId);
      if (!claim) return;
      const s = AsStorage.getSettings();
      const job = normalizeJob($('#claim-job-digits').value) || claim.jobNo;
      if (!isValidJob(job)) {
        status.classList.add('error');
        status.textContent = 'Set a valid job number (P + digits) before exporting';
        toast('Job number must be P + digits');
        return;
      }
      claim.jobNo = job;
      claim.dateFrom = $('#claim-from').value || claim.dateFrom;
      claim.dateTo = $('#claim-to').value || claim.dateTo;
      claim.name = s.displayName;
      claim.sendTo = s.expenseTo;
      (claim.lines || []).forEach((l) => { l.jobNo = job; });
      await AsStorage.putClaim(claim);
      const name = await AsExport.exportClaimZip(claim);
      status.textContent = 'Downloaded ' + name + ' (Word form + numbered receipts)';
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
      const s = AsStorage.getSettings();
      const job = normalizeJob($('#claim-job-digits').value) || claim.jobNo;
      if (!isValidJob(job)) {
        status.classList.add('error');
        status.textContent = 'Set a valid job number (P + digits) before exporting';
        toast('Job number must be P + digits');
        return;
      }
      claim.jobNo = job;
      claim.dateFrom = $('#claim-from').value || claim.dateFrom;
      claim.dateTo = $('#claim-to').value || claim.dateTo;
      claim.name = s.displayName;
      claim.sendTo = s.expenseTo;
      (claim.lines || []).forEach((l) => { l.jobNo = job; });
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

  async function prepareClaimForSend() {
    const claim = await AsStorage.getClaim(state.claimId);
    if (!claim) return null;
    const s = AsStorage.getSettings();
    const job = normalizeJob($('#claim-job-digits').value) || claim.jobNo;
    if (!isValidJob(job)) {
      toast('Job number must be P + digits');
      const status = $('#export-status');
      if (status) {
        status.classList.add('error');
        status.textContent = 'Set a valid job number (P + digits) before sending';
      }
      return null;
    }
    claim.jobNo = job;
    claim.dateFrom = $('#claim-from').value || claim.dateFrom;
    claim.dateTo = $('#claim-to').value || claim.dateTo;
    claim.name = s.displayName;
    claim.sendTo = s.expenseTo;
    (claim.lines || []).forEach((l) => { l.jobNo = job; });
    await AsStorage.putClaim(claim);
    return claim;
  }

  async function sendToInvoice() {
    const claim = await prepareClaimForSend();
    if (!claim) return;
    const status = $('#export-status');
    if (status) {
      status.classList.remove('error');
      status.textContent = 'Building zip for send…';
    }
    try {
      const blob = await AsExport.buildClaimZipBlob(claim);
      const filename = AsExport.safeName(claim.jobNo || 'claim') + '.zip';
      const email = AsExport.buildExpenseEmail(claim, filename);

      // Auto-start download so the zip is in Downloads before they open mail.
      AsExport.downloadBlob(blob, filename);
      if (status) status.textContent = 'Prepared ' + filename + ' — download first, then Open mail app and attach';

      showEmailPreview({
        title: 'Send to Invoice',
        to: email.to,
        subject: email.subject,
        body: email.body,
        filename: filename,
        attachmentNote:
          'Browsers cannot auto-attach files to mailto. Download the zip first, then open your mail app and attach it yourself.',
        onDownload: () => {
          AsExport.downloadBlob(blob, filename);
          toast('Downloaded ' + filename);
        },
        onMailto: () => AsExport.openMailto(email.to, email.subject, email.body),
      });
    } catch (e) {
      console.error(e);
      if (status) {
        status.classList.add('error');
        status.textContent = e.message || String(e);
      }
      toast(e.message || 'Could not build zip');
    }
  }

  function safeJobZip(claim) {
    return AsExport.safeName(claim.jobNo || 'claim') + '.zip';
  }

  // ——— Timesheets ———
  function fillMonthYearSelects(monthSel, yearSel, selectedMonth, selectedYear) {
    const months = AsTimesheetFiller
      ? ['January','February','March','April','May','June','July','August','September','October','November','December']
      : [];
    monthSel.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = months[m - 1] || String(m);
      if (m === selectedMonth) opt.selected = true;
      monthSel.appendChild(opt);
    }
    const cy = new Date().getFullYear();
    yearSel.innerHTML = '';
    for (let y = cy - 2; y <= cy + 2; y++) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      if (y === selectedYear) opt.selected = true;
      yearSel.appendChild(opt);
    }
  }

  async function showTimesheets() {
    state.tsId = null;
    state.entryId = null;
    setNav('timesheets');
    updateListHeaders();
    await refreshTsList();
    showView('timesheets');
  }

  async function refreshTsList() {
    const all = await AsStorage.listTimesheets();
    const filtered = all.filter((t) =>
      state.tsChip === 'completed' ? t.completed : !t.completed
    );
    const list = $('#ts-list');
    const empty = $('#ts-empty');
    list.innerHTML = '';
    if (!filtered.length) {
      empty.classList.remove('hidden');
      empty.innerHTML = state.tsChip === 'completed'
        ? 'No completed timesheets yet.'
        : 'No active timesheets. Tap <strong>+ New</strong> and pick a month.';
      return;
    }
    empty.classList.add('hidden');
    if (state.tsChip === 'completed') {
      const byYear = {};
      for (const t of filtered) {
        const y = String(t.year);
        (byYear[y] = byYear[y] || []).push(t);
      }
      Object.keys(byYear).sort((a, b) => Number(b) - Number(a)).forEach((y) => {
        const h = document.createElement('div');
        h.className = 'year-header';
        h.textContent = y;
        list.appendChild(h);
        byYear[y].forEach((t) => list.appendChild(tsCard(t)));
      });
    } else {
      filtered.forEach((t) => list.appendChild(tsCard(t)));
    }
  }

  function tsCard(t) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    const title = AsTimesheetFiller.displayTitle(t.year, t.month);
    btn.innerHTML =
      '<p class="title">' + escapeHtml(title) + '</p>' +
      '<p class="meta">' + (t.entries || []).length + ' entr' +
      ((t.entries || []).length === 1 ? 'y' : 'ies') +
      (t.completed ? ' · completed' : '') + '</p>';
    btn.addEventListener('click', () => openTimesheet(t.id));
    return btn;
  }

  function openNewTimesheet() {
    const now = new Date();
    fillMonthYearSelects($('#ts-new-month'), $('#ts-new-year'), now.getMonth() + 1, now.getFullYear());
    showView('ts-new');
  }

  async function createTimesheet(ev) {
    ev.preventDefault();
    const month = Number($('#ts-new-month').value);
    const year = Number($('#ts-new-year').value);
    const existing = await AsStorage.findTimesheetByYearMonth(year, month);
    if (existing) {
      toast('Timesheet for that month already exists');
      return openTimesheet(existing.id);
    }
    const ts = {
      id: AsStorage.uid('ts'),
      year,
      month,
      completed: false,
      entries: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await AsStorage.putTimesheet(ts);
    toast('Timesheet created');
    await openTimesheet(ts.id);
  }

  async function openTimesheet(id) {
    state.tsId = id;
    state.entryId = null;
    const ts = await AsStorage.getTimesheet(id);
    if (!ts) {
      toast('Timesheet not found');
      return showTimesheets();
    }
    const s = AsStorage.getSettings();
    $('#ts-title').textContent = AsTimesheetFiller.displayTitle(ts.year, ts.month);
    $('#ts-route-header').textContent = s.displayName + ' → ' + s.timesheetTo;
    fillMonthYearSelects($('#ts-edit-month'), $('#ts-edit-year'), ts.month, ts.year);
    $('#ts-edit-month').disabled = !!ts.completed;
    $('#ts-edit-year').disabled = !!ts.completed;
    $('#btn-complete-ts').classList.toggle('hidden', !!ts.completed);
    $('#btn-reopen-ts').classList.toggle('hidden', !ts.completed);
    $('#btn-add-entry').disabled = !!ts.completed;
    $('#ts-export-status').textContent = '';
    renderEntries(ts);
    setNav('timesheets');
    showView('ts-edit');
  }

  function renderEntries(ts) {
    const entries = (ts.entries || []).slice().sort((a, b) => a.startDay - b.startDay);
    $('#ts-entry-count').textContent = String(entries.length);
    const list = $('#ts-entry-list');
    const empty = $('#ts-entry-empty');
    list.innerHTML = '';
    if (!entries.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    entries.forEach((e) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      const typeLabel = (DAY_TYPE_UI.find((d) => d.key === e.dayType) || {}).label || e.dayType;
      const range = e.startDay === e.endDay
        ? 'Day ' + e.startDay
        : 'Days ' + e.startDay + '–' + e.endDay;
      btn.innerHTML =
        '<p class="title">' + escapeHtml(range) + ' · ' + escapeHtml(typeLabel) + '</p>' +
        '<p class="meta">' + escapeHtml(e.jobNumber || '') +
        (e.description ? ' · ' + escapeHtml(e.description) : '') + '</p>';
      btn.addEventListener('click', () => {
        if (ts.completed) {
          toast('Reopen to edit');
          return;
        }
        openEntry(e.id);
      });
      list.appendChild(btn);
    });
  }

  async function saveTsMeta(ev) {
    ev.preventDefault();
    const ts = await AsStorage.getTimesheet(state.tsId);
    if (!ts || ts.completed) return;
    const month = Number($('#ts-edit-month').value);
    const year = Number($('#ts-edit-year').value);
    const clash = await AsStorage.findTimesheetByYearMonth(year, month, ts.id);
    if (clash) {
      toast('Another timesheet already uses that month');
      return;
    }
    const last = AsTimesheetFiller.daysInMonth(year, month);
    let clamped = false;
    for (const e of ts.entries || []) {
      if (e.startDay > last) { e.startDay = last; clamped = true; }
      if (e.endDay > last) { e.endDay = last; clamped = true; }
      if (e.endDay < e.startDay) e.endDay = e.startDay;
    }
    ts.year = year;
    ts.month = month;
    await AsStorage.putTimesheet(ts);
    if (clamped) toast('Some entry days were clamped to month length');
    else toast('Saved');
    await openTimesheet(ts.id);
  }

  async function deleteTimesheet() {
    if (!state.tsId) return;
    if (!confirm('Delete this timesheet?')) return;
    await AsStorage.deleteTimesheet(state.tsId);
    toast('Deleted');
    await showTimesheets();
  }

  async function setTsCompleted(completed) {
    const ts = await AsStorage.getTimesheet(state.tsId);
    if (!ts) return;
    ts.completed = completed;
    ts.completedAt = completed ? Date.now() : null;
    await AsStorage.putTimesheet(ts);
    toast(completed ? 'Marked complete' : 'Reopened');
    await openTimesheet(ts.id);
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
  }

  async function addEntry() {
    const ts = await AsStorage.getTimesheet(state.tsId);
    if (!ts || ts.completed) return;
    const entry = {
      id: AsStorage.uid('tse'),
      startDay: 1,
      endDay: 1,
      jobNumber: '',
      description: '',
      dayType: 'OFFICE',
    };
    ts.entries = ts.entries || [];
    ts.entries.push(entry);
    await AsStorage.putTimesheet(ts);
    await openEntry(entry.id);
  }

  function buildDayTypeRadios(selected) {
    const box = $('#entry-day-types');
    box.innerHTML = '';
    DAY_TYPE_UI.forEach((d) => {
      const lab = document.createElement('label');
      lab.className = 'radio';
      lab.innerHTML =
        '<input type="radio" name="dayType" value="' + d.key + '"' +
        (d.key === selected ? ' checked' : '') + ' /> ' + escapeHtml(d.label);
      box.appendChild(lab);
    });
  }

  async function openEntry(entryId) {
    const ts = await AsStorage.getTimesheet(state.tsId);
    if (!ts) return;
    const entry = (ts.entries || []).find((e) => e.id === entryId);
    if (!entry) {
      toast('Entry not found');
      return openTimesheet(state.tsId);
    }
    state.entryId = entryId;
    const last = AsTimesheetFiller.daysInMonth(ts.year, ts.month);
    $('#entry-title').textContent = 'Entry';
    $('#entry-start').value = entry.startDay;
    $('#entry-start').max = last;
    $('#entry-end').value = entry.endDay;
    $('#entry-end').max = last;
    $('#entry-job-digits').value = digitsOnly(entry.jobNumber);
    $('#entry-desc').value = entry.description || '';
    buildDayTypeRadios(entry.dayType || 'OFFICE');
    showView('ts-entry');
  }

  async function saveEntryForm(ev) {
    ev.preventDefault();
    const ts = await AsStorage.getTimesheet(state.tsId);
    if (!ts || ts.completed) return;
    const idx = (ts.entries || []).findIndex((e) => e.id === state.entryId);
    if (idx < 0) return;
    const last = AsTimesheetFiller.daysInMonth(ts.year, ts.month);
    let start = Math.max(1, Math.min(Number($('#entry-start').value) || 1, last));
    let end = Math.max(1, Math.min(Number($('#entry-end').value) || 1, last));
    if (end < start) {
      toast('End day must be ≥ start day');
      return;
    }
    const jobRaw = $('#entry-job-digits').value.trim();
    const job = jobRaw ? normalizeJob(jobRaw) : '';
    if (job && !isValidJob(job)) {
      toast('Job must be P + digits');
      return;
    }
    const dayTypeEl = $('input[name="dayType"]:checked');
    const dayType = dayTypeEl ? dayTypeEl.value : 'OFFICE';

    for (const other of ts.entries || []) {
      if (other.id === state.entryId) continue;
      if (rangesOverlap(start, end, other.startDay, other.endDay)) {
        toast('Overlaps existing entry (' + other.startDay + '–' + other.endDay + ')');
        return;
      }
    }

    const entry = ts.entries[idx];
    entry.startDay = start;
    entry.endDay = end;
    entry.jobNumber = job;
    entry.description = $('#entry-desc').value.trim();
    entry.dayType = dayType;
    await AsStorage.putTimesheet(ts);
    toast('Entry saved');
    await openTimesheet(ts.id);
  }

  async function deleteEntry() {
    if (!state.entryId) return;
    if (!confirm('Delete this entry?')) return;
    const ts = await AsStorage.getTimesheet(state.tsId);
    if (!ts) return;
    ts.entries = (ts.entries || []).filter((e) => e.id !== state.entryId);
    await AsStorage.putTimesheet(ts);
    toast('Entry deleted');
    await openTimesheet(ts.id);
  }

  async function doExportOdt() {
    const status = $('#ts-export-status');
    status.classList.remove('error');
    status.textContent = 'Filling timesheet.odt…';
    try {
      const ts = await AsStorage.getTimesheet(state.tsId);
      const name = await AsExport.exportTimesheetOdt(ts);
      status.textContent = 'Downloaded ' + name;
      toast('ODT downloaded');
    } catch (e) {
      console.error(e);
      status.classList.add('error');
      status.textContent = e.message || String(e);
    }
  }

  async function sendToTimesheets() {
    const ts = await AsStorage.getTimesheet(state.tsId);
    if (!ts) return;
    const status = $('#ts-export-status');
    if (status) {
      status.classList.remove('error');
      status.textContent = 'Building timesheet.odt for send…';
    }
    try {
      const blob = await AsExport.buildTimesheetOdtBlob(ts);
      const filename = AsTimesheetFiller.exportFileName(ts.year, ts.month);
      const email = AsExport.buildTimesheetEmail(ts, filename);

      AsExport.downloadBlob(blob, filename);
      if (status) status.textContent = 'Prepared ' + filename + ' — download first, then Open mail app and attach';

      showEmailPreview({
        title: 'Send to Timesheets',
        to: email.to,
        subject: email.subject,
        body: email.body,
        filename: filename,
        attachmentNote:
          'Browsers cannot auto-attach files to mailto. Download the .odt first, then open your mail app and attach it yourself.',
        onDownload: () => {
          AsExport.downloadBlob(blob, filename);
          toast('Downloaded ' + filename);
        },
        onMailto: () => AsExport.openMailto(email.to, email.subject, email.body),
      });
    } catch (e) {
      console.error(e);
      if (status) {
        status.classList.add('error');
        status.textContent = e.message || String(e);
      }
      toast(e.message || 'Could not build timesheet');
    }
  }

  async function importTimesheets(files) {
    if (!files || !files.length) return;
    let imported = 0;
    let skipped = 0;
    let replaced = 0;
    let replaceAll = null; // true/false/null

    for (const file of files) {
      if (!AsTimesheetReader.isSupportedFileName(file.name)) {
        if (/\.pdf$/i.test(file.name)) toast('Skipped PDF: ' + file.name);
        continue;
      }
      try {
        const buf = await file.arrayBuffer();
        const parsed = await AsTimesheetReader.parse(buf, file.name);
        const existing = await AsStorage.findTimesheetByYearMonth(parsed.year, parsed.month);
        if (existing) {
          let action = replaceAll;
          if (action === null) {
            const choice = promptConflict(parsed.year, parsed.month);
            if (choice === 'skip-all') { replaceAll = false; action = false; }
            else if (choice === 'replace-all') { replaceAll = true; action = true; }
            else if (choice === 'skip') action = false;
            else if (choice === 'replace') action = true;
            else { skipped++; continue; }
          }
          if (!action) { skipped++; continue; }
          await AsStorage.deleteTimesheet(existing.id);
          replaced++;
        }
        const entries = (parsed.entries || []).map((e) => ({
          id: AsStorage.uid('tse'),
          startDay: e.startDay,
          endDay: e.endDay,
          jobNumber: e.jobNo || '',
          description: e.description || '',
          dayType: e.dayType || 'OFFICE',
        }));
        await AsStorage.putTimesheet({
          id: AsStorage.uid('ts'),
          year: parsed.year,
          month: parsed.month,
          completed: true,
          completedAt: Date.now(),
          entries,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        imported++;
      } catch (e) {
        console.error(e);
        toast('Import failed: ' + (e.message || file.name));
      }
    }
    toast('Imported ' + imported + (replaced ? ', replaced ' + replaced : '') + (skipped ? ', skipped ' + skipped : ''));
    state.tsChip = 'completed';
    $$('[data-ts-chip]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-ts-chip') === 'completed'));
    await showTimesheets();
  }

  function promptConflict(year, month) {
    const label = AsTimesheetFiller.displayTitle(year, month);
    const msg =
      label + ' already exists.\n\n' +
      'OK = Replace\nCancel = Skip\n\n' +
      '(Use prompt: type replace-all / skip-all for batch)';
    // Simple confirm + optional batch via prompt
    const batch = window.prompt(
      label + ' already exists.\nType: skip | replace | skip-all | replace-all',
      'replace'
    );
    if (!batch) return 'skip';
    const v = batch.trim().toLowerCase();
    if (v === 'skip' || v === 'replace' || v === 'skip-all' || v === 'replace-all') return v;
    return 'skip';
  }

  // ——— Days worked ———
  let daysBreakdownTimesheets = [];

  function daysTallyTiles(counts, startMarchYear) {
    const tiles = [
      ['Holiday', 'holiday', counts.holiday],
      ['Sick', 'sick', counts.sick],
      ['Office', 'office', counts.office],
      ['Training', 'training', counts.training],
    ];
    return (
      '<div class="tally-tiles" role="list">' +
      tiles
        .map(function (row) {
          return (
            '<button type="button" class="tally-tile tally-tap" role="listitem" ' +
            'data-day-type="' + row[1] + '" data-period-year="' + startMarchYear + '" ' +
            'aria-label="' + row[0] + ': ' + row[2] + '. Show breakdown">' +
            '<span class="n" aria-hidden="true">' + row[2] + '</span>' +
            '<span class="lbl" aria-hidden="true">' + row[0] + '</span>' +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function daysPeriodBanner(pt, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    const year = pt.period.startMarchYear;
    el.className = 'days-banner' + (opts.past ? ' past-period' : '');
    el.setAttribute('role', 'region');
    el.setAttribute(
      'aria-label',
      (opts.past ? 'Past period ' : 'Current period ') + pt.period.label
    );
    el.dataset.periodYear = String(year);
    el.innerHTML =
      '<p class="period">' +
      escapeHtml(pt.period.label) +
      '</p>' +
      '<p class="label">Offshore days</p>' +
      '<button type="button" class="big tally-tap" data-day-type="offshore" data-period-year="' +
      year +
      '" aria-label="Offshore days: ' +
      pt.counts.offshore +
      '. Show breakdown">' +
      pt.counts.offshore +
      '</button>' +
      daysTallyTiles(pt.counts, year);
    return el;
  }

  function showDaysBreakdown(startMarchYear, countKey) {
    const period = AsOffshoreDays.periodStartingMarch(startMarchYear);
    const label = AsOffshoreDays.labelForType(countKey);
    const grouped = AsOffshoreDays.breakdownGrouped(
      daysBreakdownTimesheets,
      startMarchYear,
      countKey
    );
    const root = $('#modal-root');
    let bodyHtml;
    if (grouped.empty) {
      bodyHtml = '<p class="empty" style="margin:8px 0">No days of this type in this period.</p>';
    } else {
      bodyHtml = grouped.months
        .map(function (m) {
          const lines = m.lines
            .map(function (line) {
              return '<li>' + escapeHtml(line) + '</li>';
            })
            .join('');
          return (
            '<div class="breakdown-month">' +
            '<h3>' +
            escapeHtml(m.label) +
            '</h3>' +
            '<ul>' +
            lines +
            '</ul>' +
            '</div>'
          );
        })
        .join('');
    }
    root.className = 'modal-backdrop';
    root.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="days-breakdown-title">' +
      '<h2 id="days-breakdown-title">' +
      escapeHtml(label + ' — ' + period.label) +
      '</h2>' +
      '<div class="breakdown-body">' +
      bodyHtml +
      '</div>' +
      '<div class="actions">' +
      '<button type="button" class="btn ghost" id="modal-close">Close</button>' +
      '</div></div>';
    const close = () => {
      root.className = 'hidden';
      root.innerHTML = '';
    };
    $('#modal-close', root).onclick = close;
    root.onclick = (e) => {
      if (e.target === root) close();
    };
  }

  function wireDaysBannerClicks(root) {
    root.querySelectorAll('.tally-tap').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const year = Number(btn.getAttribute('data-period-year'));
        const type = btn.getAttribute('data-day-type');
        if (!year || !type) return;
        showDaysBreakdown(year, type);
      });
    });
  }

  async function showDays() {
    setNav('days');
    const all = await AsStorage.listTimesheets();
    const completed = all.filter((t) => t.completed);
    daysBreakdownTimesheets = completed;
    const totals = AsOffshoreDays.tallyFromTimesheets(completed);
    const box = $('#days-content');
    box.innerHTML = '';
    if (!totals.length) {
      box.innerHTML = '<p class="empty">No completed timesheets yet.</p>';
      showView('days');
      return;
    }
    const current = daysPeriodBanner(totals[0]);
    box.appendChild(current);
    wireDaysBannerClicks(current);

    if (totals.length > 1) {
      const past = document.createElement('div');
      past.innerHTML = '<h2 style="font-size:1rem;margin:8px 0">Past periods</h2>';
      totals.slice(1).forEach((pt) => {
        const banner = daysPeriodBanner(pt, { past: true });
        past.appendChild(banner);
        wireDaysBannerClicks(banner);
      });
      box.appendChild(past);
    }
    showView('days');
  }

  // ——— Settings ———
  function showSettings() {
    setNav('settings');
    const s = AsStorage.getSettings();
    $('#settings-name').value = s.displayName;
    $('#about-version').innerHTML = 'AS Forms <strong>' + AsStorage.APP_VERSION + '</strong>';
    showView('settings');
  }

  function showEmails() {
    const s = AsStorage.getSettings();
    $('#settings-expense-to').value = s.expenseTo;
    $('#settings-timesheet-to').value = s.timesheetTo;
    showView('emails');
  }

  function showTemplates() {
    const s = AsStorage.getSettings();
    $('#tpl-expense-subject').value = s.expenseSubject;
    $('#tpl-expense-body').value = s.expenseBody;
    $('#tpl-timesheet-subject').value = s.timesheetSubject;
    $('#tpl-timesheet-body').value = s.timesheetBody;
    $('#tpl-help').textContent = AsEmailTemplates.PLACEHOLDER_HELP;
    showView('templates');
  }

  function showBackup() {
    $('#backup-status').textContent = '';
    showView('backup');
  }

  // ——— Email preview modal ———
  function showEmailPreview(opts) {
    const root = $('#modal-root');
    const downloadClass = 'btn accent';
    const mailtoClass = 'btn secondary';
    const isOdt = (opts.filename || '').toLowerCase().endsWith('.odt');
    root.className = 'modal-backdrop';
    root.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<h2>' + escapeHtml(opts.title) + '</h2>' +
      '<div class="field"><div class="k">To</div><div class="v">' + escapeHtml(opts.to) + '</div></div>' +
      '<div class="field"><div class="k">Subject</div><div class="v">' + escapeHtml(opts.subject) + '</div></div>' +
      '<div class="field"><div class="k">Body</div><div class="v">' + escapeHtml(opts.body) + '</div></div>' +
      '<div class="field"><div class="k">Attachment</div><div class="v">' + escapeHtml(opts.filename || '') +
      '<br><span style="color:#5c5c5c;font-size:.85em">' + escapeHtml(opts.attachmentNote || '') + '</span></div></div>' +
      '<div class="actions">' +
      '<button type="button" class="' + downloadClass + '" id="modal-download">Download ' +
        (isOdt ? 'odt' : 'zip') +
      '</button>' +
      '<button type="button" class="' + mailtoClass + '" id="modal-mailto">Open mail app (attach ' +
        (isOdt ? 'file' : 'zip') +
      ' yourself)</button>' +
      '<button type="button" class="btn ghost" id="modal-close">Close</button>' +
      '</div></div>';

    const mailtoBtn = $('#modal-mailto', root);
    const close = () => {
      root.className = 'hidden';
      root.innerHTML = '';
    };
    $('#modal-close', root).onclick = close;
    $('#modal-download', root).onclick = () => {
      if (opts.onDownload) opts.onDownload();
    };
    mailtoBtn.onclick = () => {
      if (opts.onMailto) opts.onMailto();
      // Keep modal open so they can still download if needed
    };
    root.onclick = (e) => {
      if (e.target === root) close();
    };
  }

  function wire() {
    $$('.bottom-nav button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-nav');
        if (tab === 'expenses') showExpenses();
        else if (tab === 'timesheets') showTimesheets();
        else if (tab === 'days') showDays();
        else if (tab === 'settings') showSettings();
      });
    });

    $$('[data-expense-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.expenseChip = btn.getAttribute('data-expense-chip');
        $$('[data-expense-chip]').forEach((b) =>
          b.classList.toggle('on', b === btn)
        );
        refreshClaimList();
      });
    });

    $$('[data-ts-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tsChip = btn.getAttribute('data-ts-chip');
        $$('[data-ts-chip]').forEach((b) =>
          b.classList.toggle('on', b === btn)
        );
        refreshTsList();
      });
    });

    $$('[data-back]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const to = btn.getAttribute('data-back');
        if (to === 'expenses') showExpenses();
        else if (to === 'timesheets') showTimesheets();
        else if (to === 'settings') showSettings();
      });
    });

    $('#btn-new-claim').addEventListener('click', createClaim);
    $('#form-claim').addEventListener('submit', saveClaimForm);
    $('#btn-delete-claim').addEventListener('click', deleteClaim);
    $('#btn-add-line').addEventListener('click', addLine);
    $('#form-line').addEventListener('submit', saveLineForm);
    $('#btn-delete-line').addEventListener('click', deleteLine);
    $('#btn-line-back').addEventListener('click', () => openClaim(state.claimId));
    $('#btn-export-zip').addEventListener('click', doExportZip);
    $('#btn-export-docx').addEventListener('click', doExportDocx);
    $('#btn-send-invoice').addEventListener('click', sendToInvoice);
    $('#btn-complete-claim').addEventListener('click', () => setClaimCompleted(true));
    $('#btn-reopen-claim').addEventListener('click', () => setClaimCompleted(false));

    $('#line-receipt').addEventListener('change', async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      state.pendingReceipt = { blob: file, name: file.name, type: file.type };
      state.clearReceipt = false;
      hideOcrUi();
      const claim = await AsStorage.getClaim(state.claimId);
      const line = (claim.lines || []).find((l) => l.id === state.lineId) || {};
      await renderReceiptPreview(line);
      // Auto-run on-device OCR; never blocks saving the attachment
      runReceiptOcr(file, file.name);
    });
    $('#btn-clear-receipt').addEventListener('click', async () => {
      state.pendingReceipt = null;
      state.clearReceipt = true;
      state.ocrToken++;
      if (globalThis.AsReceiptOcr) try { AsReceiptOcr.cancel(); } catch (_) {}
      hideOcrUi();
      $('#line-receipt').value = '';
      const claim = await AsStorage.getClaim(state.claimId);
      const line = (claim.lines || []).find((l) => l.id === state.lineId) || {};
      await renderReceiptPreview(line);
    });
    $('#btn-ocr-cancel').addEventListener('click', () => {
      state.ocrToken++;
      if (globalThis.AsReceiptOcr) AsReceiptOcr.cancel();
      showOcrStatus('Reading cancelled. Attachment is still kept.', true);
      const alone = $('#btn-ocr-rescan-alone');
      if (alone) alone.classList.remove('hidden');
    });
    $('#btn-ocr-apply').addEventListener('click', (ev) => {
      ev.preventDefault();
      applyOcrSuggestions();
    });
    $('#btn-ocr-dismiss').addEventListener('click', (ev) => {
      ev.preventDefault();
      hideOcrUi();
      const alone = $('#btn-ocr-rescan-alone');
      if (alone && state.pendingReceipt) alone.classList.remove('hidden');
    });
    async function rescanCurrentReceipt() {
      let blob = null;
      let name = '';
      if (state.pendingReceipt) {
        blob = state.pendingReceipt.blob;
        name = state.pendingReceipt.name || '';
      } else if (state.lineId && state.claimId) {
        const claim = await AsStorage.getClaim(state.claimId);
        const line = (claim.lines || []).find((l) => l.id === state.lineId);
        if (line && line.receiptId) {
          const rcpt = await AsStorage.getReceipt(line.receiptId);
          if (rcpt) {
            blob = rcpt.blob;
            name = rcpt.name || '';
          }
        }
      }
      if (!blob) {
        toast('Attach a receipt first');
        return;
      }
      hideOcrUi();
      runReceiptOcr(blob, name);
    }
    $('#btn-ocr-rescan').addEventListener('click', (ev) => {
      ev.preventDefault();
      rescanCurrentReceipt();
    });
    $('#btn-ocr-rescan-alone').addEventListener('click', (ev) => {
      ev.preventDefault();
      rescanCurrentReceipt();
    });
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
    $('#line-total').addEventListener('input', () => { $('#line-total').dataset.touched = '1'; });

    $('#btn-new-ts').addEventListener('click', openNewTimesheet);
    $('#form-ts-new').addEventListener('submit', createTimesheet);
    $('#form-ts-meta').addEventListener('submit', saveTsMeta);
    $('#btn-delete-ts').addEventListener('click', deleteTimesheet);
    $('#btn-add-entry').addEventListener('click', addEntry);
    $('#form-ts-entry').addEventListener('submit', saveEntryForm);
    $('#btn-delete-entry').addEventListener('click', deleteEntry);
    $('#btn-entry-back').addEventListener('click', () => openTimesheet(state.tsId));
    $('#btn-export-odt').addEventListener('click', doExportOdt);
    $('#btn-send-timesheets').addEventListener('click', sendToTimesheets);
    $('#btn-complete-ts').addEventListener('click', () => setTsCompleted(true));
    $('#btn-reopen-ts').addEventListener('click', () => setTsCompleted(false));
    $('#btn-import-ts').addEventListener('click', () => $('#ts-import-files').click());
    $('#ts-import-files').addEventListener('change', async (ev) => {
      const files = Array.from(ev.target.files || []);
      ev.target.value = '';
      await importTimesheets(files);
    });

    $('#form-settings-name').addEventListener('submit', (ev) => {
      ev.preventDefault();
      AsStorage.saveSettings({
        displayName: $('#settings-name').value.trim() || AsEmailTemplates.DEFAULT_NAME,
      });
      toast('Name saved');
      updateListHeaders();
    });
    $('#btn-goto-emails').addEventListener('click', showEmails);
    $('#btn-goto-templates').addEventListener('click', showTemplates);
    $('#btn-goto-backup').addEventListener('click', showBackup);
    $('#form-emails').addEventListener('submit', (ev) => {
      ev.preventDefault();
      let expenseTo = $('#settings-expense-to').value.trim() || AsEmailTemplates.EXPENSE_TO;
      let timesheetTo = $('#settings-timesheet-to').value.trim() || AsEmailTemplates.TIMESHEET_TO;
      if (!AsEmailTemplates.isPlausibleEmail(expenseTo)) {
        toast('Check expense email format');
        return;
      }
      if (!AsEmailTemplates.isPlausibleEmail(timesheetTo)) {
        toast('Check timesheets email format');
        return;
      }
      AsStorage.saveSettings({ expenseTo, timesheetTo, sendTo: expenseTo });
      toast('Emails saved');
      updateListHeaders();
      showSettings();
    });
    $('#form-templates').addEventListener('submit', (ev) => {
      ev.preventDefault();
      AsStorage.saveSettings({
        expenseSubject: $('#tpl-expense-subject').value,
        expenseBody: $('#tpl-expense-body').value,
        timesheetSubject: $('#tpl-timesheet-subject').value,
        timesheetBody: $('#tpl-timesheet-body').value,
      });
      toast('Templates saved');
      showSettings();
    });
    $('#btn-backup-export').addEventListener('click', async () => {
      const st = $('#backup-status');
      st.classList.remove('error');
      st.textContent = 'Building backup…';
      try {
        const name = await AsExport.exportBackupZip();
        st.textContent = 'Downloaded ' + name;
        toast('Backup exported');
      } catch (e) {
        st.classList.add('error');
        st.textContent = e.message || String(e);
      }
    });
    $('#btn-backup-import').addEventListener('click', () => $('#backup-import-file').click());
    $('#backup-import-file').addEventListener('change', async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      if (!confirm('This replaces claims and timesheets in this browser. Continue?')) return;
      const st = $('#backup-status');
      st.classList.remove('error');
      st.textContent = 'Importing…';
      try {
        await AsExport.importBackupZip(file);
        st.textContent = 'Import complete';
        toast('Backup imported');
        updateListHeaders();
      } catch (e) {
        console.error(e);
        st.classList.add('error');
        st.textContent = e.message || String(e);
      }
    });
  }


  function promptDisplayNameIfNeeded() {
    const s = AsStorage.getSettings();
    if ((s.displayName || '').trim() || s.namePromptSeen) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const root = $('#modal-root');
      root.className = 'modal-backdrop';
      root.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="welcome-name-title">' +
        '<h2 id="welcome-name-title">Welcome to AS Forms</h2>' +
        '<p class="hint">Enter the name that should appear on expense claims and timesheets. Data stays in this browser only.</p>' +
        '<label class="field" style="display:block;margin:12px 0">' +
        'Display name' +
        '<input type="text" id="welcome-name-input" maxlength="80" autocomplete="name" placeholder="Your name" ' +
        'style="display:block;width:100%;margin-top:4px;padding:10px 12px;border:1px solid var(--border);border-radius:8px" />' +
        '</label>' +
        '<p id="welcome-name-error" class="hint error hidden" style="color:var(--danger)">Please enter your name, or tap Skip.</p>' +
        '<div class="actions">' +
        '<button type="button" class="btn primary" id="welcome-name-continue">Continue</button>' +
        '<button type="button" class="btn ghost" id="welcome-name-skip">Skip</button>' +
        '</div></div>';

      const input = $('#welcome-name-input', root);
      const err = $('#welcome-name-error', root);

      function finish(name, skipped) {
        AsStorage.saveSettings({
          displayName: name,
          namePromptSeen: true,
        });
        root.className = 'hidden';
        root.innerHTML = '';
        updateListHeaders();
        if ($('#settings-name')) $('#settings-name').value = name;
        resolve(!skipped);
      }

      function onContinue() {
        const name = (input.value || '').trim();
        if (!name) {
          err.classList.remove('hidden');
          input.focus();
          return;
        }
        finish(name, false);
      }

      $('#welcome-name-continue', root).onclick = onContinue;
      $('#welcome-name-skip', root).onclick = () => finish('', true);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          onContinue();
        }
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  async function boot() {
    wire();
    AsStorage.saveSettings(AsStorage.getSettings());
    updateListHeaders();
    await promptDisplayNameIfNeeded();
    await showExpenses();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
