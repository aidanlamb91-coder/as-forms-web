/**
 * IndexedDB + localStorage for AS Forms web.
 * Claims, timesheets, mileage claims, receipts/statements live in IndexedDB (the browser's
 * database); settings live in localStorage.
 *
 * 1.1.0-web: adds the `mileage` store (DB version 4), Profile fields (Home postcode, CC,
 * mileage rate, saved places, Year starts in), whole-number ids (so backups match Android),
 * and an "as-data-changed" event after every save/delete so cloud sync can follow up.
 */
(function (global) {
  // 1.2.1-web: names are scoped per copy (main site / beta) — see js/app-scope.js
  const DB_NAME = globalThis.AsScope ? globalThis.AsScope.db('as-forms-web') : 'as-forms-web';
  const DB_VERSION = 4;
  const STORE_CLAIMS = 'claims';
  const STORE_TIMESHEETS = 'timesheets';
  const STORE_RECEIPTS = 'receipts';
  const STORE_META = 'meta';
  const STORE_MILEAGE = 'mileage';
  const SETTINGS_KEY = globalThis.AsScope ? globalThis.AsScope.key('as-forms-settings') : 'as-forms-settings';
  const APP_VERSION = '1.2.1-web';
  // 1.2.1-web Other forms: where Payroll and HR forms are addressed (editable in Destination emails)
  const DEFAULT_PAYROLL_TO = 'jillian.robertson@andrewssurvey.com';
  const DEFAULT_HR_TO = 'jillian.robertson@andrewssurvey.com';
  const META_FOLDER_HANDLE = 'dataFolderHandle';

  const ET = () => global.AsEmailTemplates;

  function defaultSettings() {
    const e = ET();
    return {
      displayName: e ? e.DEFAULT_NAME : '',
      expenseTo: e ? e.EXPENSE_TO : 'invoice@andrewssurvey.com',
      timesheetTo: e ? e.TIMESHEET_TO : 'timesheet@andrewssurvey.com',
      expenseSubject: e ? e.DEFAULT_EXPENSE_SUBJECT : '',
      expenseBody: e ? e.DEFAULT_EXPENSE_BODY : '',
      timesheetSubject: e ? e.DEFAULT_TIMESHEET_SUBJECT : '',
      timesheetBody: e ? e.DEFAULT_TIMESHEET_BODY : '',
      // legacy alias
      sendTo: e ? e.EXPENSE_TO : 'invoice@andrewssurvey.com',
      // Data-folder sync (File System Access API)
      folderAutoSync: true,
      folderHintSeen: false,
      // Backup reminder (ms epoch); null/0 = never backed up
      lastBackupAt: null,
      backupReminderDismissedAt: null,
      // 1.1.0-web Profile (same fields as Android's backup prefs)
      yearStartMonth: 3,
      homePostcode: '',
      ccEngine: '',
      mileageRatePence: 55,
      savedPlaces: [],
      // 1.1.0-web archive: build AS-Forms-YYYY.zip automatically when a year is due
      autoArchive: true,
      payrollTo: DEFAULT_PAYROLL_TO,
      hrTo: DEFAULT_HR_TO,
      lastLocalBackupSize: 0,
      lastLocalBackupName: '',
    };
  }

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    // wait for the beta's one-time copy of the main site's data (js/app-scope.js) before opening
    const scopeReady = (globalThis.AsScope && globalThis.AsScope.ready) || Promise.resolve();
    dbPromise = scopeReady.then(() => new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CLAIMS)) {
          db.createObjectStore(STORE_CLAIMS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_RECEIPTS)) {
          db.createObjectStore(STORE_RECEIPTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TIMESHEETS)) {
          db.createObjectStore(STORE_TIMESHEETS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_MILEAGE)) {
          db.createObjectStore(STORE_MILEAGE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  }

  /**
   * New record id. 1.1.0-web: a whole number as text (e.g. "1760380000000123") so the backup
   * matches Android, which needs numeric ids. The prefix argument is kept for old callers.
   */
  let uidLast = 0;
  function uid(_prefix) {
    let n = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    if (n <= uidLast) n = uidLast + 1;
    uidLast = n;
    return String(n);
  }

  /** Tell the rest of the app (cloud sync, archive) that saved data changed. */
  let quiet = 0;
  function notifyChanged(kind) {
    if (quiet) return;
    try {
      global.dispatchEvent(new CustomEvent('as-data-changed', { detail: { kind } }));
    } catch (_) { /* old browsers / tests */ }
  }

  /** Old default 'Timesheets@andrewssurvey.com' (any case) → new default; other addresses untouched. */
  function migrateTimesheetTo(value) {
    const e = ET();
    if (e && e.migrateTimesheetTo) return e.migrateTimesheetTo(value);
    if (typeof value !== 'string') return value;
    return value.trim().toLowerCase() === 'timesheets@andrewssurvey.com'
      ? 'timesheet@andrewssurvey.com'
      : value;
  }

  function getSettings() {
    const defaults = defaultSettings();
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      // migrate legacy sendTo → expenseTo
      if (parsed.sendTo && !parsed.expenseTo) parsed.expenseTo = parsed.sendTo;
      // 0.3.15-web: migrate old default timesheet address
      if (parsed.timesheetTo != null) parsed.timesheetTo = migrateTimesheetTo(parsed.timesheetTo);
      return { ...defaults, ...parsed, sendTo: parsed.expenseTo || parsed.sendTo || defaults.expenseTo };
    } catch {
      return { ...defaults };
    }
  }

  function saveSettings(partial) {
    const next = { ...getSettings(), ...partial };
    if (partial.expenseTo != null) next.sendTo = partial.expenseTo;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  async function listAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getById(storeName, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function putRow(storeName, row) {
    const db = await openDb();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(row);
    await txDone(tx);
    if (storeName !== STORE_META && storeName !== STORE_RECEIPTS) notifyChanged(storeName);
    return row;
  }

  // ——— Claims ———
  async function listClaims() {
    const rows = await listAll(STORE_CLAIMS);
    rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return rows;
  }

  async function getClaim(id) { return getById(STORE_CLAIMS, id); }

  async function putClaim(claim) {
    const now = Date.now();
    const row = {
      ...claim,
      completed: !!claim.completed,
      completedAt: claim.completed ? (claim.completedAt || now) : null,
      updatedAt: now,
      createdAt: claim.createdAt || now,
    };
    return putRow(STORE_CLAIMS, row);
  }

  async function deleteClaim(id) {
    const claim = await getClaim(id);
    const db = await openDb();
    const tx = db.transaction([STORE_CLAIMS, STORE_RECEIPTS], 'readwrite');
    tx.objectStore(STORE_CLAIMS).delete(id);
    if (claim && Array.isArray(claim.lines)) {
      for (const line of claim.lines) {
        if (line.receiptId) tx.objectStore(STORE_RECEIPTS).delete(line.receiptId);
        if (line.statementId) tx.objectStore(STORE_RECEIPTS).delete(line.statementId);
      }
    }
    await txDone(tx);
    notifyChanged('claims');
  }

  // ——— Timesheets ———
  async function listTimesheets() {
    const rows = await listAll(STORE_TIMESHEETS);
    rows.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      if (a.month !== b.month) return b.month - a.month;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return rows;
  }

  async function getTimesheet(id) { return getById(STORE_TIMESHEETS, id); }

  async function putTimesheet(ts) {
    const now = Date.now();
    const row = {
      ...ts,
      completed: !!ts.completed,
      completedAt: ts.completed ? (ts.completedAt || now) : null,
      updatedAt: now,
      createdAt: ts.createdAt || now,
      entries: ts.entries || [],
    };
    return putRow(STORE_TIMESHEETS, row);
  }

  async function deleteTimesheet(id) {
    const db = await openDb();
    const tx = db.transaction(STORE_TIMESHEETS, 'readwrite');
    tx.objectStore(STORE_TIMESHEETS).delete(id);
    await txDone(tx);
    notifyChanged('timesheets');
  }

  // ——— Mileage claims (1.1.0-web) ———
  // { id, jobNo, unlinked, ratePence, completed, completedAt, dismissed:[keys],
  //   journeys:[{ id, date, projectNumber, fromPostcode, toPostcode, fromLabel, toLabel,
  //               purpose, oneWayMiles, returnTrip, sortOrder }], createdAt, updatedAt }
  async function listMileage() {
    const rows = await listAll(STORE_MILEAGE);
    rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return rows;
  }
  async function getMileage(id) { return getById(STORE_MILEAGE, id); }
  async function putMileage(m) {
    const now = Date.now();
    const M = global.AsMileage;
    const row = {
      ...m,
      completed: !!m.completed,
      completedAt: m.completed ? (m.completedAt || now) : null,
      journeys: m.journeys || [],
      updatedAt: now,
      createdAt: m.createdAt || now,
    };
    if (M) Object.assign(row, M.claimDates(row));
    return putRow(STORE_MILEAGE, row);
  }
  async function deleteMileage(id) {
    const db = await openDb();
    const tx = db.transaction(STORE_MILEAGE, 'readwrite');
    tx.objectStore(STORE_MILEAGE).delete(id);
    await txDone(tx);
    notifyChanged('mileage');
  }

  async function findTimesheetByYearMonth(year, month, excludeId) {
    const all = await listTimesheets();
    return all.find((t) => t.year === year && t.month === month && t.id !== excludeId) || null;
  }

  /** Match Android findByJobAndDates — job + dateFrom + dateTo (ISO). */
  async function findClaimByJobAndDates(jobNo, dateFrom, dateTo, excludeId) {
    const job = String(jobNo || '').trim();
    if (!job) return null;
    const all = await listClaims();
    return all.find((c) =>
      c.jobNo === job &&
      c.dateFrom === dateFrom &&
      c.dateTo === dateTo &&
      c.id !== excludeId
    ) || null;
  }

  // ——— Receipts ———
  async function putReceipt(blob, meta) {
    const db = await openDb();
    const id = uid('rcpt');
    const row = {
      id,
      blob,
      name: meta.name || 'receipt',
      type: meta.type || blob.type || 'application/octet-stream',
      size: blob.size || 0,
      createdAt: Date.now(),
    };
    const tx = db.transaction(STORE_RECEIPTS, 'readwrite');
    tx.objectStore(STORE_RECEIPTS).put(row);
    await txDone(tx);
    return { id: row.id, name: row.name, type: row.type, size: row.size };
  }

  async function getReceipt(id) {
    if (!id) return null;
    return getById(STORE_RECEIPTS, id);
  }

  async function deleteReceipt(id) {
    if (!id) return;
    const db = await openDb();
    const tx = db.transaction(STORE_RECEIPTS, 'readwrite');
    tx.objectStore(STORE_RECEIPTS).delete(id);
    await txDone(tx);
  }


  // ——— Meta (directory handles, etc.) ———
  async function getMeta(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function setMeta(key, value) {
    const db = await openDb();
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key, value });
    await txDone(tx);
  }

  async function deleteMeta(key) {
    const db = await openDb();
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).delete(key);
    await txDone(tx);
  }

  async function getDataFolderHandle() {
    return getMeta(META_FOLDER_HANDLE);
  }

  async function setDataFolderHandle(handle) {
    if (!handle) {
      await deleteMeta(META_FOLDER_HANDLE);
      return null;
    }
    await setMeta(META_FOLDER_HANDLE, handle);
    return handle;
  }

  async function clearAllData() {
    const db = await openDb();
    const tx = db.transaction([STORE_CLAIMS, STORE_TIMESHEETS, STORE_RECEIPTS, STORE_MILEAGE], 'readwrite');
    tx.objectStore(STORE_CLAIMS).clear();
    tx.objectStore(STORE_TIMESHEETS).clear();
    tx.objectStore(STORE_RECEIPTS).clear();
    tx.objectStore(STORE_MILEAGE).clear();
    await txDone(tx);
  }

  /**
   * Replace-all import from backup snapshot + receipt map { path: Blob }.
   * Snapshot uses web-friendly shape (string ids OK).
   */
  /** Category + composed description for a backup / import line (category carried or inferred). */
  function categoryFields(l) {
    const C = global.AsExpenseCategory;
    if (!C) return { description: l.description || '' };
    const [category, detail] = C.fromImport(l.category, l.description || '');
    return { category, description: C.composeForStorage(category, detail) };
  }

  /**
   * Replace everything in this browser with a backup (Android's or the web's — same format,
   * see js/backup-format.js). receiptBlobs = { "receipts/1/line_2.jpg": Blob, ... }.
   */
  async function importBackup(snapshot, receiptBlobs) {
    const F = global.AsBackupFormat;
    const data = F.fromSnapshot(snapshot); // throws on an unknown schema before anything is wiped
    quiet++;
    try {
      await clearAllData();
      const p = data.prefs || {};
      const d = defaultSettings();
      const pick = (v, def) => (v == null || v === '' ? def : v);
      saveSettings({
        displayName: pick(p.displayName, d.displayName),
        expenseTo: pick(p.expenseTo, d.expenseTo),
        timesheetTo: migrateTimesheetTo(pick(p.timesheetTo, d.timesheetTo)),
        expenseSubject: pick(p.expenseSubject, d.expenseSubject),
        expenseBody: pick(p.expenseBody, d.expenseBody),
        timesheetSubject: pick(p.timesheetSubject, d.timesheetSubject),
        timesheetBody: pick(p.timesheetBody, d.timesheetBody),
        yearStartMonth: global.AsYearPeriods ? global.AsYearPeriods.normalizeMonth(p.yearStartMonth) : (p.yearStartMonth || 3),
        homePostcode: pick(p.homePostcode, getSettings().homePostcode || ''),
        ccEngine: pick(p.ccEngine, getSettings().ccEngine || ''),
        mileageRatePence: Number(p.mileageRatePence) || getSettings().mileageRatePence || 55,
        savedPlaces: Array.isArray(p.savedPlaces) ? p.savedPlaces : (getSettings().savedPlaces || []),
        payrollTo: pick(p.payrollTo, getSettings().payrollTo || DEFAULT_PAYROLL_TO),
        hrTo: pick(p.hrTo, getSettings().hrTo || DEFAULT_HR_TO),
      });
      const blobs = receiptBlobs || {};
      for (const c of data.claims) {
        for (const l of c.lines) {
          if (l.receiptPath && blobs[l.receiptPath]) {
            const b = blobs[l.receiptPath];
            l.receiptMeta = await putReceipt(b, { name: l.receiptName || 'receipt', type: l.receiptMime || b.type });
            l.receiptId = l.receiptMeta.id;
          }
          if (l.statementPath && blobs[l.statementPath]) {
            const b = blobs[l.statementPath];
            l.statementMeta = await putReceipt(b, { name: l.statementName || 'statement', type: l.statementMime || b.type });
            l.statementId = l.statementMeta.id;
          }
          ['receiptPath', 'receiptName', 'receiptMime', 'statementPath', 'statementName', 'statementMime'].forEach((k) => delete l[k]);
        }
        await putRow(STORE_CLAIMS, { ...c, name: getSettings().displayName });
      }
      for (const t of data.timesheets) await putRow(STORE_TIMESHEETS, t);
      for (const m of data.mileage) await putRow(STORE_MILEAGE, m);
    } finally {
      quiet--;
    }
    notifyChanged('import');
  }


  function markBackupSuccess(at) {
    return saveSettings({
      lastBackupAt: at || Date.now(),
      backupReminderDismissedAt: null,
    });
  }

  function dismissBackupReminder(at) {
    return saveSettings({ backupReminderDismissedAt: at || Date.now() });
  }

  function shouldShowBackupReminder() {
    const s = getSettings();
    const last = s.lastBackupAt || 0;
    const now = Date.now();
    const overdue = !last || (now - last) >= 28 * 24 * 60 * 60 * 1000;
    if (!overdue) return false;
    const dismissed = s.backupReminderDismissedAt || 0;
    if (dismissed && dismissed >= last) return false;
    return true;
  }

  /** Delete claim row but keep receipt blobs (for undo window). */
  async function softDeleteClaim(id) {
    const claim = await getClaim(id);
    if (!claim) return null;
    const db = await openDb();
    const tx = db.transaction(STORE_CLAIMS, 'readwrite');
    tx.objectStore(STORE_CLAIMS).delete(id);
    await txDone(tx);
    notifyChanged('claims');
    return claim;
  }

  async function purgeClaimReceipts(claim) {
    if (!claim || !Array.isArray(claim.lines)) return;
    for (const line of claim.lines) {
      if (line.receiptId) await deleteReceipt(line.receiptId);
      if (line.statementId) await deleteReceipt(line.statementId);
    }
  }

  global.AsStorage = {
    uid,
    APP_VERSION,
    DEFAULT_PAYROLL_TO,
    DEFAULT_HR_TO,
    markBackupSuccess,
    dismissBackupReminder,
    shouldShowBackupReminder,
    softDeleteClaim,
    purgeClaimReceipts,
    getSettings,
    saveSettings,
    migrateTimesheetTo,
    defaultSettings,
    listClaims,
    getClaim,
    putClaim,
    deleteClaim,
    findClaimByJobAndDates,
    listTimesheets,
    getTimesheet,
    putTimesheet,
    deleteTimesheet,
    findTimesheetByYearMonth,
    listMileage,
    getMileage,
    putMileage,
    deleteMileage,
    notifyChanged,
    putReceipt,
    getReceipt,
    deleteReceipt,
    clearAllData,
    importBackup,
    openDb,
    getMeta,
    setMeta,
    deleteMeta,
    getDataFolderHandle,
    setDataFolderHandle,
  };
})(window);
