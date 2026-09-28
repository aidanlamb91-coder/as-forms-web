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
      description: l.description,
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
  async function buildClaimZipBlob(claim) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    syncLinesJobFromClaim(claim);
    const filledDocx = await fillClaimDocxBlob(claim);
    const dateFrom = claim.dateFrom || new Date().toISOString().slice(0, 10);
    const docxName = 'ExpenseClaim_' + dateFrom + '.docx';

    const zip = new JSZip();
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
    return zip.generateAsync({ type: 'blob' });
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
  async function buildBackupPackage() {
    const s = AsStorage.getSettings();
    const claims = await AsStorage.listClaims();
    const timesheets = await AsStorage.listTimesheets();

    const claimSnaps = [];
    const lineSnaps = [];
    for (const c of claims) {
      const fromMs = c.dateFrom ? Date.parse(c.dateFrom + 'T00:00:00') : 0;
      const toMs = c.dateTo ? Date.parse(c.dateTo + 'T00:00:00') : 0;
      claimSnaps.push({
        id: c.id,
        jobNumber: c.jobNo || '',
        dateFromMillis: fromMs,
        dateToMillis: toMs,
        dateFrom: c.dateFrom,
        dateTo: c.dateTo,
        completed: !!c.completed,
        completedAtMillis: c.completedAt || null,
        exportDocumentUri: null,
        exportFileName: null,
        exportFolderKind: c.completed ? 'Archive' : 'Active',
        createdAtMillis: c.createdAt || 0,
        updatedAtMillis: c.updatedAt || 0,
      });
      (c.lines || []).forEach((line, idx) => {
        let receiptPath = null;
        if (line.receiptId) {
          const ext = line.receiptMeta && line.receiptMeta.name && line.receiptMeta.name.includes('.')
            ? line.receiptMeta.name.slice(line.receiptMeta.name.lastIndexOf('.'))
            : '.bin';
          receiptPath = 'receipts/' + c.id + '/line_' + line.id + ext;
        }
        let statementPath = null;
        if (line.statementId) {
          const sext = line.statementMeta && line.statementMeta.name && line.statementMeta.name.includes('.')
            ? line.statementMeta.name.slice(line.statementMeta.name.lastIndexOf('.'))
            : '.bin';
          statementPath = 'receipts/' + c.id + '/line_' + line.id + '_stmt' + sext;
        }
        lineSnaps.push({
          id: line.id,
          claimId: c.id,
          sortOrder: idx,
          dateMillis: line.date ? Date.parse(line.date + 'T00:00:00') : null,
          date: line.date,
          jobNo: line.jobNo || '',
          description: line.description || '',
          foreignCurrency: line.foreignCurrency || '',
          net: line.net,
          vat: line.vat,
          total: line.total,
          receiptBackupPath: receiptPath,
          receiptDisplayName: line.receiptMeta ? line.receiptMeta.name : null,
          receiptMime: line.receiptMeta ? line.receiptMeta.type : null,
          statementBackupPath: statementPath,
          statementDisplayName: line.statementMeta ? line.statementMeta.name : null,
          statementMime: line.statementMeta ? line.statementMeta.type : null,
        });
      });
    }

    const receiptEntries = [];
    for (const c of claims) {
      for (const line of c.lines || []) {
        const snap = lineSnaps.find((l) => l.id === line.id && l.claimId === c.id);
        if (!snap) continue;
        if (line.receiptId && snap.receiptBackupPath) {
          const rcpt = await AsStorage.getReceipt(line.receiptId);
          if (rcpt && rcpt.blob) {
            receiptEntries.push({ path: snap.receiptBackupPath, blob: rcpt.blob });
          }
        }
        if (line.statementId && snap.statementBackupPath) {
          const stmt = await AsStorage.getReceipt(line.statementId);
          if (stmt && stmt.blob) {
            receiptEntries.push({ path: snap.statementBackupPath, blob: stmt.blob });
          }
        }
      }
    }

    const tsSnaps = [];
    const entrySnaps = [];
    for (const t of timesheets) {
      tsSnaps.push({
        id: t.id,
        year: t.year,
        month: t.month,
        completed: !!t.completed,
        completedAtMillis: t.completedAt || null,
        exportDocumentUri: null,
        exportFileName: null,
        exportFolderKind: t.completed ? 'Archive' : 'Active',
        createdAtMillis: t.createdAt || 0,
        updatedAtMillis: t.updatedAt || 0,
      });
      for (const e of t.entries || []) {
        entrySnaps.push({
          id: e.id,
          timesheetId: t.id,
          startDay: e.startDay,
          endDay: e.endDay,
          jobNumber: e.jobNumber || '',
          description: e.description || '',
          dayType: e.dayType || 'OFFICE',
        });
      }
    }

    const snapshot = {
      schemaVersion: 1,
      exportedAtMillis: Date.now(),
      appVersionName: AsStorage.APP_VERSION,
      prefs: {
        displayName: s.displayName,
        expenseSubject: s.expenseSubject,
        expenseBody: s.expenseBody,
        timesheetSubject: s.timesheetSubject,
        timesheetBody: s.timesheetBody,
        accountPromptDone: true,
        exportFolderTreeUri: null,
        expenseTo: s.expenseTo,
        timesheetTo: s.timesheetTo,
      },
      claims: claimSnaps,
      lineItems: lineSnaps,
      timesheets: tsSnaps,
      timesheetEntries: entrySnaps,
    };
    return { snapshot, receiptEntries, claims, timesheets };
  }

  /** Full backup zip compatible with Android schema (web-adapted ids as strings). */
  async function exportBackupZip() {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    const { snapshot, receiptEntries } = await buildBackupPackage();
    const zip = new JSZip();
    for (const entr of receiptEntries) {
      zip.file(entr.path, entr.blob);
    }
    zip.file('as-forms-backup.json', JSON.stringify(snapshot, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const name = 'as-forms-backup-' + new Date().toISOString().slice(0, 10) + '.zip';
    downloadBlob(blob, name);
    if (AsStorage.markBackupSuccess) AsStorage.markBackupSuccess();
    return name;
  }

  async function importBackupParts(snapshot, receiptBlobs) {
    if (!snapshot || snapshot.schemaVersion !== 1) {
      throw new Error('Unsupported backup schemaVersion ' + (snapshot && snapshot.schemaVersion));
    }
    await AsStorage.importBackup(snapshot, receiptBlobs || {});
  }

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
  }

  global.AsExport = {
    downloadBlob,
    exportClaimZip,
    buildClaimZipBlob,
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
    importBackupParts,
    importBackupZip,
    claimFolderName,
    formatUkDate,
    safeName,
  };
})(window);
