/**
 * IndexedDB + localStorage for AS Forms web 0.3.1-web-beta.
 * Claims, timesheets, receipts in IDB; settings in localStorage.
 */
(function (global) {
  const DB_NAME = 'as-forms-web';
  const DB_VERSION = 2;
  const STORE_CLAIMS = 'claims';
  const STORE_TIMESHEETS = 'timesheets';
  const STORE_RECEIPTS = 'receipts';
  const SETTINGS_KEY = 'as-forms-settings';
  const APP_VERSION = '0.3.1-web-beta';

  const ET = () => global.AsEmailTemplates;

  function defaultSettings() {
    const e = ET();
    return {
      displayName: e ? e.DEFAULT_NAME : 'Aidan Lamb',
      expenseTo: e ? e.EXPENSE_TO : 'invoice@andrewssurvey.com',
      timesheetTo: e ? e.TIMESHEET_TO : 'Timesheets@andrewssurvey.com',
      expenseSubject: e ? e.DEFAULT_EXPENSE_SUBJECT : '',
      expenseBody: e ? e.DEFAULT_EXPENSE_BODY : '',
      timesheetSubject: e ? e.DEFAULT_TIMESHEET_SUBJECT : '',
      timesheetBody: e ? e.DEFAULT_TIMESHEET_BODY : '',
      // legacy alias
      sendTo: e ? e.EXPENSE_TO : 'invoice@andrewssurvey.com',
    };
  }

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getSettings() {
    const defaults = defaultSettings();
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      // migrate legacy sendTo → expenseTo
      if (parsed.sendTo && !parsed.expenseTo) parsed.expenseTo = parsed.sendTo;
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
      }
    }
    await txDone(tx);
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
  }

  async function findTimesheetByYearMonth(year, month, excludeId) {
    const all = await listTimesheets();
    return all.find((t) => t.year === year && t.month === month && t.id !== excludeId) || null;
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

  async function clearAllData() {
    const db = await openDb();
    const tx = db.transaction([STORE_CLAIMS, STORE_TIMESHEETS, STORE_RECEIPTS], 'readwrite');
    tx.objectStore(STORE_CLAIMS).clear();
    tx.objectStore(STORE_TIMESHEETS).clear();
    tx.objectStore(STORE_RECEIPTS).clear();
    await txDone(tx);
  }

  /**
   * Replace-all import from backup snapshot + receipt map { path: Blob }.
   * Snapshot uses web-friendly shape (string ids OK).
   */
  async function importBackup(snapshot, receiptBlobs) {
    await clearAllData();
    if (snapshot.prefs) {
      saveSettings({
        displayName: snapshot.prefs.displayName || defaultSettings().displayName,
        expenseTo: snapshot.prefs.expenseTo || defaultSettings().expenseTo,
        timesheetTo: snapshot.prefs.timesheetTo || defaultSettings().timesheetTo,
        expenseSubject: snapshot.prefs.expenseSubject || defaultSettings().expenseSubject,
        expenseBody: snapshot.prefs.expenseBody || defaultSettings().expenseBody,
        timesheetSubject: snapshot.prefs.timesheetSubject || defaultSettings().timesheetSubject,
        timesheetBody: snapshot.prefs.timesheetBody || defaultSettings().timesheetBody,
      });
    }

    const claimIdMap = {};
    for (const c of snapshot.claims || []) {
      const id = c.id != null ? String(c.id) : uid('claim');
      claimIdMap[c.id] = id;
      const lines = (snapshot.lineItems || [])
        .filter((l) => String(l.claimId) === String(c.id))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

      const webLines = [];
      for (const l of lines) {
        let receiptId = null;
        let receiptMeta = null;
        if (l.receiptBackupPath && receiptBlobs[l.receiptBackupPath]) {
          const blob = receiptBlobs[l.receiptBackupPath];
          receiptMeta = await putReceipt(blob, {
            name: l.receiptDisplayName || 'receipt',
            type: l.receiptMime || blob.type,
          });
          receiptId = receiptMeta.id;
        }
        const dateIso = l.date || (l.dateMillis
          ? new Date(l.dateMillis).toISOString().slice(0, 10)
          : '');
        webLines.push({
          id: l.id != null ? String(l.id) : uid('line'),
          date: dateIso,
          jobNo: l.jobNo || '',
          description: l.description || '',
          foreignCurrency: l.foreignCurrency || '',
          net: l.net,
          vat: l.vat,
          total: l.total,
          receiptId,
          receiptMeta,
        });
      }

      const dateFrom = c.dateFrom || (c.dateFromMillis
        ? new Date(c.dateFromMillis).toISOString().slice(0, 10) : '');
      const dateTo = c.dateTo || (c.dateToMillis
        ? new Date(c.dateToMillis).toISOString().slice(0, 10) : '');

      await putClaim({
        id,
        jobNo: c.jobNumber || c.jobNo || '',
        name: getSettings().displayName,
        dateFrom,
        dateTo,
        completed: !!c.completed,
        completedAt: c.completedAtMillis || c.completedAt || null,
        lines: webLines,
        createdAt: c.createdAtMillis || c.createdAt || Date.now(),
        updatedAt: c.updatedAtMillis || c.updatedAt || Date.now(),
      });
    }

    const tsIdMap = {};
    for (const t of snapshot.timesheets || []) {
      const id = t.id != null ? String(t.id) : uid('ts');
      tsIdMap[t.id] = id;
      const entries = (snapshot.timesheetEntries || [])
        .filter((e) => String(e.timesheetId) === String(t.id))
        .map((e) => ({
          id: e.id != null ? String(e.id) : uid('tse'),
          startDay: e.startDay,
          endDay: e.endDay,
          jobNumber: e.jobNumber || e.jobNo || '',
          description: e.description || '',
          dayType: e.dayType || 'OFFICE',
        }));
      await putTimesheet({
        id,
        year: t.year,
        month: t.month,
        completed: !!t.completed,
        completedAt: t.completedAtMillis || t.completedAt || null,
        entries,
        createdAt: t.createdAtMillis || t.createdAt || Date.now(),
        updatedAt: t.updatedAtMillis || t.updatedAt || Date.now(),
      });
    }
  }

  global.AsStorage = {
    uid,
    APP_VERSION,
    getSettings,
    saveSettings,
    defaultSettings,
    listClaims,
    getClaim,
    putClaim,
    deleteClaim,
    listTimesheets,
    getTimesheet,
    putTimesheet,
    deleteTimesheet,
    findTimesheetByYearMonth,
    putReceipt,
    getReceipt,
    deleteReceipt,
    clearAllData,
    importBackup,
    openDb,
  };
})(window);
