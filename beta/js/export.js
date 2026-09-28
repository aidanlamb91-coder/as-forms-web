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

  async function buildClaimZipBlob(claim) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    const zip = new JSZip();
    const folder = claimZipInnerFolder(claim);
    const root = zip.folder(folder);
    root.file('claim.json', JSON.stringify(claimToJson(claim), null, 2));
    const receipts = root.folder('receipts');
    let i = 0;
    for (const line of claim.lines || []) {
      if (!line.receiptId) continue;
      i += 1;
      const rcpt = await AsStorage.getReceipt(line.receiptId);
      if (!rcpt || !rcpt.blob) continue;
      const ext = (rcpt.name && rcpt.name.includes('.'))
        ? rcpt.name.slice(rcpt.name.lastIndexOf('.'))
        : (rcpt.type === 'application/pdf' ? '.pdf' : '.jpg');
      const base = String(i).padStart(2, '0') + '_' + safeName(line.description || 'receipt');
      receipts.file(base + ext, rcpt.blob);
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
    const settings = AsStorage.getSettings();
    const blob = await AsDocxFiller.fillExpenseClaim({
      name: claim.name || settings.displayName,
      sendTo: claim.sendTo || settings.expenseTo || settings.sendTo,
      dateFrom: claim.dateFrom,
      dateTo: claim.dateTo,
      lines: (claim.lines || []).map((l) => ({
        date: l.date,
        jobNo: l.jobNo,
        description: l.description,
        foreignCurrency: l.foreignCurrency || '',
        net: l.net,
        vat: l.vat,
        total: l.total != null && l.total !== ''
          ? l.total
          : ((Number(l.net) || 0) + (Number(l.vat) || 0) || null),
      })),
    });
    const name = safeName(claim.jobNo || 'claim') + '.docx';
    downloadBlob(blob, name);
    return name;
  }

  async function exportTimesheetOdt(ts) {
    const settings = AsStorage.getSettings();
    const blob = await AsTimesheetFiller.fillTimesheet({
      year: ts.year,
      month: ts.month,
      name: settings.displayName,
      entries: ts.entries || [],
    });
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

  async function tryShare(files, title, text) {
    if (!navigator.share) return false;
    try {
      if (navigator.canShare && files && files.length) {
        if (!navigator.canShare({ files })) return false;
        await navigator.share({ files, title, text });
        return true;
      }
      await navigator.share({ title, text });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return true;
      return false;
    }
  }

  /** Full backup zip compatible with Android schema (web-adapted ids as strings). */
  async function exportBackupZip() {
    if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
    const s = AsStorage.getSettings();
    const claims = await AsStorage.listClaims();
    const timesheets = await AsStorage.listTimesheets();
    const zip = new JSZip();

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
        });
        if (line.receiptId && receiptPath) {
          // defer blob fetch
        }
      });
    }

    for (const c of claims) {
      for (const line of c.lines || []) {
        if (!line.receiptId) continue;
        const snap = lineSnaps.find((l) => l.id === line.id && l.claimId === c.id);
        if (!snap || !snap.receiptBackupPath) continue;
        const rcpt = await AsStorage.getReceipt(line.receiptId);
        if (rcpt && rcpt.blob) zip.file(snap.receiptBackupPath, rcpt.blob);
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

    const manifest = {
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
    zip.file('as-forms-backup.json', JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const name = 'as-forms-backup-' + new Date().toISOString().slice(0, 10) + '.zip';
    downloadBlob(blob, name);
    return name;
  }

  async function importBackupZip(file) {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file('as-forms-backup.json');
    if (!manifestFile) throw new Error('Backup missing as-forms-backup.json');
    const snapshot = JSON.parse(await manifestFile.async('string'));
    if (snapshot.schemaVersion !== 1) {
      throw new Error('Unsupported backup schemaVersion ' + snapshot.schemaVersion);
    }
    const receiptBlobs = {};
    const paths = Object.keys(zip.files).filter((n) => n.startsWith('receipts/') && !zip.files[n].dir);
    for (const p of paths) {
      receiptBlobs[p] = await zip.files[p].async('blob');
    }
    await AsStorage.importBackup(snapshot, receiptBlobs);
  }

  global.AsExport = {
    downloadBlob,
    exportClaimZip,
    buildClaimZipBlob,
    exportFilledDocx,
    exportTimesheetOdt,
    buildExpenseEmail,
    buildTimesheetEmail,
    openMailto,
    tryShare,
    exportBackupZip,
    importBackupZip,
    claimFolderName,
    formatUkDate,
  };
})(window);
