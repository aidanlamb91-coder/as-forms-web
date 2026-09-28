/**
 * IndexedDB + localStorage persistence for AS Forms web MVP.
 * Claims metadata + line items in IDB; receipt blobs in IDB; settings in localStorage.
 */
(function (global) {
  const DB_NAME = 'as-forms-web';
  const DB_VERSION = 1;
  const STORE_CLAIMS = 'claims';
  const STORE_RECEIPTS = 'receipts';
  const SETTINGS_KEY = 'as-forms-settings';

  const DEFAULT_SETTINGS = {
    displayName: 'Aidan Lamb',
    sendTo: 'invoice@andrewssurvey.com',
  };

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CLAIMS)) {
          db.createObjectStore(STORE_CLAIMS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_RECEIPTS)) {
          db.createObjectStore(STORE_RECEIPTS, { keyPath: 'id' });
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
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings( partial ) {
    const next = { ...getSettings(), ...partial };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  async function listClaims() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CLAIMS, 'readonly');
      const req = tx.objectStore(STORE_CLAIMS).getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getClaim(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CLAIMS, 'readonly');
      const req = tx.objectStore(STORE_CLAIMS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function putClaim(claim) {
    const db = await openDb();
    const now = Date.now();
    const row = {
      ...claim,
      updatedAt: now,
      createdAt: claim.createdAt || now,
    };
    const tx = db.transaction(STORE_CLAIMS, 'readwrite');
    tx.objectStore(STORE_CLAIMS).put(row);
    await txDone(tx);
    return row;
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
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECEIPTS, 'readonly');
      const req = tx.objectStore(STORE_RECEIPTS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteReceipt(id) {
    if (!id) return;
    const db = await openDb();
    const tx = db.transaction(STORE_RECEIPTS, 'readwrite');
    tx.objectStore(STORE_RECEIPTS).delete(id);
    await txDone(tx);
  }

  global.AsStorage = {
    uid,
    getSettings,
    saveSettings,
    listClaims,
    getClaim,
    putClaim,
    deleteClaim,
    putReceipt,
    getReceipt,
    deleteReceipt,
    DEFAULT_SETTINGS,
  };
})(window);
