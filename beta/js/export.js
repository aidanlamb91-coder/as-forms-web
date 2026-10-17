/**
 * Client-side export: claim zip/docx, timesheet odt, backup, mailto handoff.
 */
(function (global) {
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function safeName(s) {
    return String(s || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  }

  function claimYear(claim) {
    const iso = claim.dateTo || claim.dateFrom || '';
    const y = parseInt(iso.slice(0, 4), 10);
    return Number.isFinite(y) ? y : new Date().getFullYear();
  }

  function claimFolderName(claim) {
    const job = safeName(claim.jobNo || 'job');
    return job + '.zip';
  }

  function claimZipInnerFolder(claim) {
    // Optional Archive/YYYY/expenses path metadata in zip
    if (claim.completed) {
      return 'Archive/' + claimYear(claim) + '/expenses/' + safeName(claim.jobNo || 'job');
    }
    return 'Active/' + safeName(claim.jobNo || 'job');
  }

  function claimToJson(claim) {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: 'as-forms-web',
      claim: {
        id: claim.id,
        jobNo: claim.jobNo,
        name: claim.name,
        sendTo: claim.sendTo,
        dateFrom: claim.dateFrom,
        dateTo: claim.dateTo,
        completed: !!claim.completed,
        completedAt: claim.completedAt || null,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
        lines: (claim.lines || []).map((line, idx) => ({
          index: idx + 1,
          date: line.date,
          jobNo: line.jobNo,
          category: global.AsExpenseCategory ? global.AsExpenseCategory.splitLine(line).category : undefined,
          description: line.description,
          foreignCurrency: line.foreignCurrency || '',
          net: line.net,
          vat: line.vat,
          total: line.total,
          receipt: line.receiptMeta
            ? {
                fileName: line.receiptMeta.name,
                type: line.receiptMeta.type,
                size: line.receiptMeta.size,
                id: line.receiptId,
              }
            : null,
        })),
      },
    };
  }

  /** Force every line JOB NO from claim (Android ClaimRepository sync). */
  function syncLinesJobFromClaim(claim) {
    const job = claim.jobNo || '';
    (claim.lines || []).forEach((line) => {
      line.jobNo = job;
    });
    return claim;
  }

  function receiptExtension(name, mime) {
    const n = String(name || '');
    const dot = n.lastIndexOf('.');
    if (dot >= 0) return n.slice(dot).toLowerCase();
    if (mime === 'application/pdf') return '.pdf';
    if (mime && String(mime).startsWith('image/')) {
      const sub = String(mime).slice(6).toLowerCase();
      if (sub === 'jpeg') return '.jpg';
      if (sub && sub.length <= 4) return '.' + sub;
      return '.jpg';
    }
    return '';
  }

  function linesForDocx(claim) {
    const claimJob = claim.jobNo || '';
    return (claim.lines || []).map((l) => ({
      date: l.date,
      jobNo: claimJob, // always claim-level (Android toLineData)
      description: global.AsExpenseCategory ? global.AsExpenseCategory.lineText(l) : l.description,
      foreignCurrency: l.foreignCurrency || '',
      net: l.net,
      vat: l.vat,
      total: l.total != null && l.total !== ''
        ? l.total
        : ((Number(l.net) || 0) + (Number(l.vat) || 0) || null),
    }));
  }

  async function fillClaimDocxBlob(claim) {
    const settings = AsStorage.getSettings();
    syncLinesJobFromClaim(claim);
    return AsDocxFiller.fillExpenseClaim({
      name: claim.name || settings.displayName,
      sendTo: claim.sendTo || settings.expenseTo || settings.sendTo,
      dateFrom: claim.dateFrom,
      dateTo: claim.dateTo,
      lines: linesForDocx(claim),
    });
  }

  /**
   * Android ZipPackager parity: flat zip of filled ExpenseClaim_YYYY-MM-DD.docx
   * plus receipt files named by 1-based form line index (e.g. 1.jpg, 3.pdf).
   * When receipt + bank statement both present: merge to one tall JPEG when possible;
   * else write N.1.ext (receipt) and N.2.ext (statement).
   */
  /** Expense-only zip (kept for older callers): the Word form + numbered receipts. */
  async function buildClaimZipBlob(claim) {
    const zip = new JSZip();
    await addExpenseToZip(zip, claim);
    return zip.generateAsync({ type: 'blob' });
  }

  /**
   * 1.1.0-web combined job zip (Android MileageRepository.buildJobExport):
   *   ExpenseClaim_<date>.docx + numbered receipts (when there is an expense claim)
   *   MileageClaim_<date>.docx for each linked mileage claim.
   * Name: "P5503.zip" with an expense claim, "P5520_Mileage.zip" for mileage on its own.
   * Returns { blob, name, entries:[{ name, size }] } so Review & export can list the contents.
   */
  async function buildJobZip(expense, mileageClaims) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    const zip = new JSZip();
    if (expense) await addExpenseToZip(zip, expense);
    const s = AsStorage.getSettings();
    const used = new Set();
    for (const m of mileageClaims || []) {
      let name = global.AsMileage.docxFileName(m);
      if (used.has(name)) name = name.replace(/\.docx$/, '_' + String(m.id).slice(-4) + '.docx');
      used.add(name);
      zip.file(name, await global.AsMileageDocx.fill(global.AsMileageDocx.claimToForm(m, s)));
    }
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
    // Read sizes back from the finished zip (what the user will actually send)
    const back = await JSZip.loadAsync(blob);
    const entries = [];
    for (const n of Object.keys(back.files)) {
      if (back.files[n].dir) continue;
      const b = await back.files[n].async('uint8array');
      entries.push({ name: n, size: b.length, file: back.files[n] });
    }
    const name = expense ? safeName(expense.jobNo || 'claim') + '.zip' : global.AsMileage.soloZipName(mileageClaims[0]);
    return { blob, name, entries };
  }

  async function addExpenseToZip(zip, claim) {
    syncLinesJobFromClaim(claim);
    const filledDocx = await fillClaimDocxBlob(claim);
    const dateFrom = claim.dateFrom || new Date().toISOString().slice(0, 10);
    const docxName = 'ExpenseClaim_' + dateFrom + '.docx';
    zip.file(docxName, filledDocx);

    const lines = claim.lines || [];
    const merge = global.AsImageMerge;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;
      const rcpt = line.receiptId ? await AsStorage.getReceipt(line.receiptId) : null;
      const stmt = line.statementId ? await AsStorage.getReceipt(line.statementId) : null;
      const hasR = rcpt && rcpt.blob;
      const hasS = stmt && stmt.blob;
      if (!hasR && !hasS) continue;

      if (hasR && hasS && merge) {
        const rName = rcpt.name || (line.receiptMeta && line.receiptMeta.name) || '';
        const sName = stmt.name || (line.statementMeta && line.statementMeta.name) || '';
        const canMerge =
          merge.isRasterMime(rcpt.type, rName) && merge.isRasterMime(stmt.type, sName);
        let merged = null;
        if (canMerge) merged = await merge.mergeVertical(rcpt.blob, stmt.blob);
        if (merged) {
          zip.file(String(lineNumber) + '.jpg', merged);
          continue;
        }
        const extR = receiptExtension(rName, rcpt.type);
        const extS = receiptExtension(sName, stmt.type);
        zip.file(String(lineNumber) + '.1' + extR, rcpt.blob);
        zip.file(String(lineNumber) + '.2' + extS, stmt.blob);
        continue;
      }
      if (hasR) {
        const ext = receiptExtension(rcpt.name || (line.receiptMeta && line.receiptMeta.name), rcpt.type);
        zip.file(String(lineNumber) + ext, rcpt.blob);
      } else if (hasS) {
        const ext = receiptExtension(stmt.name || (line.statementMeta && line.statementMeta.name), stmt.type);
        zip.file(String(lineNumber) + ext, stmt.blob);
      }
    }
  }

  async function exportClaimZip(claim) {
    const blob = await buildClaimZipBlob(claim);
    const name = safeName(claim.jobNo || 'claim') + '.zip';
    downloadBlob(blob, name);
    return name;
  }

  async function exportFilledDocx(claim) {
    const blob = await fillClaimDocxBlob(claim);
    const dateFrom = claim.dateFrom || new Date().toISOString().slice(0, 10);
    const name = 'ExpenseClaim_' + dateFrom + '.docx';
    downloadBlob(blob, name);
    return name;
  }

  async function buildTimesheetOdtBlob(ts) {
    const settings = AsStorage.getSettings();
    return AsTimesheetFiller.fillTimesheet({
      year: ts.year,
      month: ts.month,
      name: settings.displayName,
      entries: ts.entries || [],
    });
  }

  async function exportTimesheetOdt(ts) {
    const blob = await buildTimesheetOdtBlob(ts);
    const name = AsTimesheetFiller.exportFileName(ts.year, ts.month);
    downloadBlob(blob, name);
    return name;
  }

  function formatUkDate(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function buildExpenseEmail(claim, filename) {
    const s = AsStorage.getSettings();
    const placeholders = {
      name: s.displayName,
      job: claim.jobNo || '',
      dateFrom: formatUkDate(claim.dateFrom),
      dateTo: formatUkDate(claim.dateTo),
      month: '',
      year: '',
      filename: filename || (safeName(claim.jobNo || 'claim') + '.zip'),
    };
    return {
      to: s.expenseTo || s.sendTo,
      subject: AsEmailTemplates.fill(s.expenseSubject, placeholders),
      body: AsEmailTemplates.fill(s.expenseBody, placeholders),
      filename: placeholders.filename,
    };
  }

  function buildTimesheetEmail(ts, filename) {
    const s = AsStorage.getSettings();
    const monthName = AsTimesheetFiller.monthDisplayName(ts.month);
    const placeholders = {
      name: s.displayName,
      job: '',
      dateFrom: '',
      dateTo: '',
      month: monthName,
      year: String(ts.year),
      filename: filename || AsTimesheetFiller.exportFileName(ts.year, ts.month),
    };
    return {
      to: s.timesheetTo,
      subject: AsEmailTemplates.fill(s.timesheetSubject, placeholders),
      body: AsEmailTemplates.fill(s.timesheetBody, placeholders),
      filename: placeholders.filename,
    };
  }

  function openMailto(to, subject, body) {
    const url =
      'mailto:' + encodeURIComponent(to) +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
    // Cap length — some browsers truncate very long mailto
    if (url.length > 1800) {
      const shortBody = body.slice(0, 800) + '\n\n[Body truncated — attach the downloaded file manually]';
      window.location.href =
        'mailto:' + encodeURIComponent(to) +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(shortBody);
    } else {
      window.location.href = url;
    }
  }

  function blobToFile(blob, filename, mime) {
    const type = mime || blob.type || 'application/octet-stream';
    try {
      return new File([blob], filename, { type });
    } catch (_) {
      // Older browsers: File ctor may fail; share will be unavailable.
      return null;
    }
  }

  /** True when Web Share can hand off File objects (best on Android Chrome). */
  function canShareFiles(files) {
    if (!navigator.share || !navigator.canShare || !files || !files.length) return false;
    try {
      return !!navigator.canShare({ files });
    } catch (_) {
      return false;
    }
  }

  /**
   * Share files when canShare({files}) works; otherwise title/text only.
   * Returns: 'shared' | 'aborted' | 'unavailable' | 'failed'
   */
  async function tryShare(files, title, text) {
    if (!navigator.share) return 'unavailable';
    try {
      if (files && files.length && canShareFiles(files)) {
        const payload = { files, title: title || '', text: text || '' };
        await navigator.share(payload);
        return 'shared';
      }
      await navigator.share({ title: title || '', text: text || '' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'aborted';
      return 'failed';
    }
  }

  /**
   * Build the portable backup package shared by zip download and folder sync.
   * Returns { snapshot, receiptEntries: [{ path, blob }] }.
   */
  /**
   * 1.1.0-web: the backup manifest + receipt list in Android's format (js/backup-format.js),
   * so Android and web can restore each other's backups.
   */
  async function buildBackupPackage() {
    const s = AsStorage.getSettings();
    const claims = await AsStorage.listClaims();
    const timesheets = await AsStorage.listTimesheets();
    const mileage = AsStorage.listMileage ? await AsStorage.listMileage() : [];
    const { snapshot, files } = AsBackupFormat.toSnapshot({
      settings: s, claims, timesheets, mileage, appVersion: AsStorage.APP_VERSION,
    });
    const receiptEntries = [];
    for (const f of files) {
      const r = await AsStorage.getReceipt(f.receiptId);
      if (r && r.blob) receiptEntries.push({ path: f.path, blob: r.blob });
    }
    return { snapshot, receiptEntries, claims, timesheets, mileage };
  }

  /** The whole backup as one zip Blob (same bytes go to the cloud as AS-Forms-backup.zip). */
  async function buildBackupZipBlob() {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    const { snapshot, receiptEntries } = await buildBackupPackage();
    const zip = new JSZip();
    zip.file(AsBackupFormat.MANIFEST_NAME, JSON.stringify(snapshot, null, 2));
    for (const e of receiptEntries) zip.file(e.path, e.blob);
    // 1.2.2-web: personal details (HR details, signatures, filled forms) go in ONLY when the lock
    // is on and a recovery key exists, still encrypted (personal.json, see forms-store
    // personalForBackup). Otherwise the backup has no personal details. Bank & NI never.
    if (global.AsFormsStore && global.AsLock) {
      const part = await global.AsFormsStore.personalForBackup();
      if (part) zip.file(PERSONAL_NAME, JSON.stringify(part));
    }
    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }

  /** Download backup: the one storage option kept on web besides the cloud. */
  async function exportBackupZip() {
    const blob = await buildBackupZipBlob();
    const name = 'AS-Forms-backup-' + AsBackupFormat.millisToIso(Date.now()) + '.zip'; // same name Android suggests
    downloadBlob(blob, name);
    if (AsStorage.markBackupSuccess) AsStorage.markBackupSuccess();
    AsStorage.saveSettings({ lastLocalBackupSize: blob.size, lastLocalBackupName: name, lastLocalBackupAt: Date.now() });
    return name;
  }

  async function importBackupParts(snapshot, receiptBlobs) {
    if (!snapshot || snapshot.schemaVersion !== 1) {
      throw new Error('Unsupported backup schemaVersion ' + (snapshot && snapshot.schemaVersion));
    }
    await AsStorage.importBackup(snapshot, receiptBlobs || {});
  }

  /** Restore from a backup zip (a File, Blob or ArrayBuffer — Android's or the web's). */
  async function importBackupZip(file) {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file('as-forms-backup.json');
    if (!manifestFile) throw new Error('Backup missing as-forms-backup.json');
    const snapshot = JSON.parse(await manifestFile.async('string'));
    const receiptBlobs = {};
    const paths = Object.keys(zip.files).filter((n) => n.startsWith('receipts/') && !zip.files[n].dir);
    for (const p of paths) {
      receiptBlobs[p] = await zip.files[p].async('blob');
    }
    await importBackupParts(snapshot, receiptBlobs);
    // 1.2.2-web: locked personal details. They need the recovery key, so they are handed back to
    // the caller (js/lock-ui.js asks for the key); everything else is already restored.
    const pf = zip.file(PERSONAL_NAME);
    const personal = pf ? JSON.parse(await pf.async('string')) : null;
    // 1.2.1 backups: plain forms profile + signatures (restored without Bank & NI)
    const fp = zip.file(FORMS_PROFILE_NAME);
    if (fp && global.AsFormsStore) {
      const sigs = {};
      for (const p of Object.keys(zip.files).filter((n) => /^signatures\/sig_\d\.png$/.test(n))) sigs[p] = await zip.files[p].async('uint8array');
      await global.AsFormsStore.restore(await fp.async('string'), sigs);
    }
    if (personal && global.AsLockUi) await global.AsLockUi.offerRestore(personal);
    return { personal: !!personal };
  }
  const FORMS_PROFILE_NAME = 'forms-profile.json';
  const PERSONAL_NAME = 'personal.json';

  global.AsExport = {
    downloadBlob,
    exportClaimZip,
    buildClaimZipBlob,
    buildJobZip,
    fillClaimDocxBlob,
    syncLinesJobFromClaim,
    exportFilledDocx,
    buildTimesheetOdtBlob,
    exportTimesheetOdt,
    buildExpenseEmail,
    buildTimesheetEmail,
    openMailto,
    blobToFile,
    canShareFiles,
    tryShare,
    buildBackupPackage,
    exportBackupZip,
    buildBackupZipBlob,
    importBackupParts,
    importBackupZip,
    claimFolderName,
    formatUkDate,
    safeName,
  };
})(window);
