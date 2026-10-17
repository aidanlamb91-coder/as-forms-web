/**
 * 1.1.0-web — The backup zip format, shared with Android (port of util/AppBackupFormat.kt).
 *
 * In plain English: a backup is one zip that holds
 *   as-forms-backup.json   — every claim, line, timesheet, mileage claim + journey and the settings
 *   receipts/<claim>/line_<line>.<ext>        — receipt photos / PDFs
 *   receipts/<claim>/line_<line>_stmt.<ext>   — bank statements
 * The cloud copy is the same zip named AS-Forms-backup.zip. Because the web and Android apps
 * now write exactly the same thing, either one can restore the other's backup.
 *
 * Android needs whole-number ids and epoch-millisecond dates, so:
 *  - new web records already get whole-number ids (AsStorage.uid);
 *  - older web ids like "claim_lk3j_x8a" are turned into a stable number (same every time);
 *  - dates are local midnight in milliseconds, exactly as Android stores them.
 * Nothing here reads the database; js/export.js / js/storage.js do that.
 */
(function (global) {
  const SCHEMA_VERSION = 1;
  const MANIFEST_NAME = 'as-forms-backup.json';
  const CLOUD_ZIP_NAME = 'AS-Forms-backup.zip';
  /** Android's marker for a receipt removed from the device after it went into a yearly archive. */
  const ARCHIVED_MIME = 'application/x-asforms-archived';
  const ARCHIVED_LABEL = 'receipt archived';
  const STATEMENT_ARCHIVED_LABEL = 'statement archived';

  /** A whole-number id for any web id: numbers stay as they are, old text ids get a stable hash. */
  function numericId(id) {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return id;
    const s = String(id == null ? '' : id);
    if (/^[1-9]\d{0,15}$/.test(s) && Number.isSafeInteger(Number(s))) return Number(s);
    // FNV-1a 32-bit, then lifted into a range Android never auto-generates (≥ 9e12)
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 9e12 + h;
  }

  /** "2026-09-01" → local-midnight epoch ms (what Android stores). Blank → null. */
  function isoToMillis(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }
  /** Epoch ms → local "2026-09-01" (NOT toISOString, which is UTC and slips a day in summer). */
  function millisToIso(ms) {
    if (ms == null || ms === '') return '';
    const d = new Date(Number(ms));
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** ".jpg" from a file name, ".bin" when there is none. */
  function extOf(name) {
    const n = String(name || '');
    const i = n.lastIndexOf('.');
    const e = i >= 0 ? n.slice(i).toLowerCase() : '';
    return e && e.length <= 6 ? e : '.bin';
  }
  const str = (v, d) => (v == null ? (d || '') : String(v));
  const isArchivedMeta = (meta) => !!meta && (meta.type === ARCHIVED_MIME || meta.name === ARCHIVED_LABEL || meta.name === STATEMENT_ARCHIVED_LABEL);

  /**
   * Build the manifest. Inputs are web records; returns { snapshot, files:[{path, receiptId}] }
   * where files lists which stored receipt blob goes at which zip path.
   */
  function toSnapshot({ settings, claims, timesheets, mileage, appVersion, now }) {
    const s = settings || {};
    const C = global.AsExpenseCategory;
    const files = [];
    const claimSnaps = [], lineSnaps = [];
    for (const c of claims || []) {
      const cid = numericId(c.id);
      claimSnaps.push({
        id: cid,
        jobNumber: str(c.jobNo),
        dateFromMillis: isoToMillis(c.dateFrom) ?? (c.createdAt || 0),
        dateToMillis: isoToMillis(c.dateTo) ?? (c.createdAt || 0),
        completed: !!c.completed,
        completedAtMillis: c.completed ? (c.completedAt || null) : null,
        exportDocumentUri: null,
        exportFileName: null,
        exportFolderKind: null,
        createdAtMillis: c.createdAt || 0,
        updatedAtMillis: c.updatedAt || 0,
      });
      (c.lines || []).forEach((l, idx) => {
        const lid = numericId(l.id);
        let rPath = null, sPath = null;
        if (l.receiptId) {
          rPath = 'receipts/' + cid + '/line_' + lid + extOf(l.receiptMeta && l.receiptMeta.name);
          files.push({ path: rPath, receiptId: l.receiptId });
        }
        if (l.statementId) {
          sPath = 'receipts/' + cid + '/line_' + lid + '_stmt' + extOf(l.statementMeta && l.statementMeta.name);
          files.push({ path: sPath, receiptId: l.statementId });
        }
        const split = C ? C.splitLine(l) : { category: 'MISC' };
        lineSnaps.push({
          id: lid,
          claimId: cid,
          sortOrder: idx,
          dateMillis: isoToMillis(l.date),
          jobNo: str(l.jobNo || c.jobNo),
          description: C ? C.lineText(l) : str(l.description),
          foreignCurrency: str(l.foreignCurrency),
          net: l.net ?? null,
          vat: l.vat ?? null,
          total: l.total ?? null,
          receiptBackupPath: rPath,
          receiptDisplayName: l.receiptMeta ? str(l.receiptMeta.name) : null,
          receiptMime: l.receiptMeta ? str(l.receiptMeta.type) : null,
          statementBackupPath: sPath,
          statementDisplayName: l.statementMeta ? str(l.statementMeta.name) : null,
          statementMime: l.statementMeta ? str(l.statementMeta.type) : null,
          category: split.category,
        });
      });
    }
    const tsSnaps = [], entrySnaps = [];
    for (const t of timesheets || []) {
      const tid = numericId(t.id);
      tsSnaps.push({
        id: tid, year: t.year, month: t.month, completed: !!t.completed,
        completedAtMillis: t.completed ? (t.completedAt || null) : null,
        exportDocumentUri: null, exportFileName: null, exportFolderKind: null,
        createdAtMillis: t.createdAt || 0, updatedAtMillis: t.updatedAt || 0,
      });
      for (const e of t.entries || []) {
        entrySnaps.push({
          id: numericId(e.id), timesheetId: tid, startDay: e.startDay, endDay: e.endDay,
          jobNumber: str(e.jobNumber || e.jobNo), description: str(e.description), dayType: e.dayType || 'OFFICE',
        });
      }
    }
    const M = global.AsMileage;
    const mcSnaps = [], mjSnaps = [];
    for (const m of mileage || []) {
      const mid = numericId(m.id);
      const dates = M ? M.claimDates(m) : { dateFrom: m.dateFrom, dateTo: m.dateTo };
      mcSnaps.push({
        id: mid, jobNumber: str(m.jobNo),
        dateFromMillis: isoToMillis(dates.dateFrom) ?? (m.createdAt || 0),
        dateToMillis: isoToMillis(dates.dateTo) ?? (m.createdAt || 0),
        ratePence: Number(m.ratePence) || 55, completed: !!m.completed,
        completedAtMillis: m.completed ? (m.completedAt || null) : null,
        unlinked: !!m.unlinked, exportFileName: null, exportDocumentUri: null, exportFolderKind: null,
        createdAtMillis: m.createdAt || 0, updatedAtMillis: m.updatedAt || 0,
      });
      (m.journeys || []).forEach((j, i) => {
        mjSnaps.push({
          id: numericId(j.id), claimId: mid, sortOrder: j.sortOrder ?? i,
          dateMillis: isoToMillis(j.date) ?? 0, projectNumber: str(j.projectNumber),
          fromPostcode: str(j.fromPostcode), toPostcode: str(j.toPostcode),
          fromLabel: str(j.fromLabel), toLabel: str(j.toLabel), purpose: str(j.purpose),
          oneWayMiles: Number(j.oneWayMiles) || 0, returnTrip: !!j.returnTrip,
        });
      });
    }
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      exportedAtMillis: now || Date.now(),
      appVersionName: appVersion || '',
      prefs: {
        displayName: str(s.displayName),
        expenseSubject: str(s.expenseSubject),
        expenseBody: str(s.expenseBody),
        timesheetSubject: str(s.timesheetSubject),
        timesheetBody: str(s.timesheetBody),
        accountPromptDone: true,
        expenseTo: str(s.expenseTo, 'invoice@andrewssurvey.com'),
        timesheetTo: str(s.timesheetTo, 'timesheet@andrewssurvey.com'),
        yearStartMonth: global.AsYearPeriods ? global.AsYearPeriods.normalizeMonth(s.yearStartMonth) : (s.yearStartMonth || 3),
        homePostcode: str(s.homePostcode),
        ccEngine: str(s.ccEngine),
        mileageRatePence: Number(s.mileageRatePence) || 55,
        savedPlaces: (s.savedPlaces || []).map((p, i) => ({ id: str(p.id, 'p' + i), name: str(p.name), postcode: str(p.postcode) })),
      },
      claims: claimSnaps,
      lineItems: lineSnaps,
      timesheets: tsSnaps,
      timesheetEntries: entrySnaps,
      mileageClaims: mcSnaps,
      mileageJourneys: mjSnaps,
    };
    return { snapshot, files };
  }

  /**
   * Read a manifest (from Android or web) into web records. Receipt blobs are attached by the
   * caller: each line's receiptPath / statementPath says which zip entry to use.
   * Also accepts the old 1.0.3-web layout (string ids, ISO `date` fields).
   */
  function fromSnapshot(snap) {
    if (!snap || snap.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('Unsupported backup schemaVersion ' + (snap && snap.schemaVersion));
    }
    const C = global.AsExpenseCategory;
    const p = snap.prefs || {};
    const prefs = {
      displayName: p.displayName, expenseSubject: p.expenseSubject, expenseBody: p.expenseBody,
      timesheetSubject: p.timesheetSubject, timesheetBody: p.timesheetBody,
      expenseTo: p.expenseTo, timesheetTo: p.timesheetTo,
      yearStartMonth: p.yearStartMonth,
      homePostcode: p.homePostcode, ccEngine: p.ccEngine, mileageRatePence: p.mileageRatePence,
      savedPlaces: Array.isArray(p.savedPlaces) ? p.savedPlaces : (typeof p.savedPlacesJson === 'string' ? safeJson(p.savedPlacesJson) : undefined),
    };
    const claims = (snap.claims || []).map((c) => {
      const lines = (snap.lineItems || []).filter((l) => String(l.claimId) === String(c.id))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((l) => {
          let category, description = l.description || '';
          if (C) { const [cat, detail] = C.fromImport(l.category, description); category = cat; description = C.composeForStorage(cat, detail); }
          const rArch = !l.receiptBackupPath && (l.receiptMime === ARCHIVED_MIME || l.receiptDisplayName === ARCHIVED_LABEL);
          const sArch = !l.statementBackupPath && (l.statementMime === ARCHIVED_MIME || l.statementDisplayName === STATEMENT_ARCHIVED_LABEL || l.statementDisplayName === ARCHIVED_LABEL);
          return {
            id: String(l.id),
            date: l.date || millisToIso(l.dateMillis),
            jobNo: l.jobNo || '',
            category, description,
            foreignCurrency: l.foreignCurrency || '',
            net: l.net ?? null, vat: l.vat ?? null, total: l.total ?? null,
            receiptPath: l.receiptBackupPath || null,
            receiptName: l.receiptDisplayName || null, receiptMime: l.receiptMime || null,
            statementPath: l.statementBackupPath || null,
            statementName: l.statementDisplayName || null, statementMime: l.statementMime || null,
            receiptMeta: rArch ? { name: ARCHIVED_LABEL, type: ARCHIVED_MIME, size: 0 } : null,
            statementMeta: sArch ? { name: STATEMENT_ARCHIVED_LABEL, type: ARCHIVED_MIME, size: 0 } : null,
          };
        });
      return {
        id: String(c.id),
        jobNo: c.jobNumber || c.jobNo || '',
        dateFrom: c.dateFrom || millisToIso(c.dateFromMillis),
        dateTo: c.dateTo || millisToIso(c.dateToMillis),
        completed: !!c.completed,
        completedAt: c.completedAtMillis || c.completedAt || null,
        lines,
        createdAt: c.createdAtMillis || c.createdAt || Date.now(),
        updatedAt: c.updatedAtMillis || c.updatedAt || Date.now(),
      };
    });
    const timesheets = (snap.timesheets || []).map((t) => ({
      id: String(t.id), year: t.year, month: t.month, completed: !!t.completed,
      completedAt: t.completedAtMillis || t.completedAt || null,
      entries: (snap.timesheetEntries || []).filter((e) => String(e.timesheetId) === String(t.id)).map((e) => ({
        id: String(e.id), startDay: e.startDay, endDay: e.endDay,
        jobNumber: e.jobNumber || e.jobNo || '', description: e.description || '', dayType: e.dayType || 'OFFICE',
      })),
      createdAt: t.createdAtMillis || t.createdAt || Date.now(),
      updatedAt: t.updatedAtMillis || t.updatedAt || Date.now(),
    }));
    const mileage = (snap.mileageClaims || []).map((m) => ({
      id: String(m.id), jobNo: m.jobNumber || '',
      dateFrom: millisToIso(m.dateFromMillis), dateTo: millisToIso(m.dateToMillis),
      ratePence: m.ratePence || 55, completed: !!m.completed, completedAt: m.completedAtMillis || null,
      unlinked: !!m.unlinked,
      journeys: (snap.mileageJourneys || []).filter((j) => String(j.claimId) === String(m.id))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((j) => ({
          id: String(j.id), sortOrder: j.sortOrder || 0, date: millisToIso(j.dateMillis),
          projectNumber: j.projectNumber || '', fromPostcode: j.fromPostcode || '', toPostcode: j.toPostcode || '',
          fromLabel: j.fromLabel || '', toLabel: j.toLabel || '', purpose: j.purpose || '',
          oneWayMiles: Number(j.oneWayMiles) || 0, returnTrip: !!j.returnTrip,
        })),
      createdAt: m.createdAtMillis || Date.now(), updatedAt: m.updatedAtMillis || Date.now(),
    }));
    return { prefs, claims, timesheets, mileage };
  }
  function safeJson(s) { try { return JSON.parse(s); } catch (_) { return undefined; } }

  global.AsBackupFormat = {
    SCHEMA_VERSION, MANIFEST_NAME, CLOUD_ZIP_NAME, ARCHIVED_MIME, ARCHIVED_LABEL, STATEMENT_ARCHIVED_LABEL,
    numericId, isoToMillis, millisToIso, extOf, toSnapshot, fromSnapshot, isArchivedMeta,
  };
})(typeof window !== 'undefined' ? window : globalThis);
