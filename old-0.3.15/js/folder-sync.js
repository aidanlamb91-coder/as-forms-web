/**
 * User-chosen data-folder sync via File System Access API.
 * Chrome/Edge desktop primarily. Safari/Firefox keep zip backup only.
 */
(function (global) {
  const MANIFEST_NAME = 'as-forms-folder-manifest.json';
  const BACKUP_JSON = 'as-forms-backup.json';
  const DEBOUNCE_MS = 1000;

  let syncTimer = null;
  let syncInFlight = false;
  let syncQueued = false;

  function isSupported() {
    return typeof global.showDirectoryPicker === 'function';
  }

  function supportHint() {
    return 'Folder sync needs Chrome or Edge on desktop. Use Export/Import backup zip on this browser.';
  }

  async function ensurePermission(handle, mode) {
    if (!handle) return false;
    const opts = { mode: mode || 'readwrite' };
    try {
      if (handle.queryPermission) {
        let state = await handle.queryPermission(opts);
        if (state === 'granted') return true;
        if (handle.requestPermission) {
          state = await handle.requestPermission(opts);
          return state === 'granted';
        }
      }
      // Older implementations: try a probe write/read
      return true;
    } catch (_) {
      return false;
    }
  }

  async function getStoredHandle() {
    try {
      return await AsStorage.getDataFolderHandle();
    } catch (_) {
      return null;
    }
  }

  async function folderName() {
    const h = await getStoredHandle();
    return h && h.name ? h.name : null;
  }

  async function chooseFolder() {
    if (!isSupported()) throw new Error(supportHint());
    const handle = await global.showDirectoryPicker({ mode: 'readwrite' });
    const ok = await ensurePermission(handle, 'readwrite');
    if (!ok) throw new Error('Folder permission was not granted');
    await AsStorage.setDataFolderHandle(handle);
    const s = AsStorage.getSettings();
    if (s.folderAutoSync == null) {
      AsStorage.saveSettings({ folderAutoSync: true });
    }
    return handle;
  }

  async function disconnectFolder() {
    await AsStorage.setDataFolderHandle(null);
  }

  async function getWritableRoot(reuseOrPick) {
    if (!isSupported()) throw new Error(supportHint());
    let handle = await getStoredHandle();
    if (!handle && reuseOrPick === 'pick') {
      handle = await chooseFolder();
    }
    if (!handle) throw new Error('No data folder connected');
    const ok = await ensurePermission(handle, 'readwrite');
    if (!ok) throw new Error('Folder permission was not granted — Choose data folder again');
    return handle;
  }

  async function getDir(root, parts, create) {
    let dir = root;
    for (const part of parts) {
      if (!part) continue;
      dir = await dir.getDirectoryHandle(part, { create: !!create });
    }
    return dir;
  }

  async function writeBlob(root, relativePath, data) {
    const parts = String(relativePath).split('/').filter(Boolean);
    const fileName = parts.pop();
    const dir = await getDir(root, parts, true);
    const fh = await dir.getFileHandle(fileName, { create: true });
    const writable = await fh.createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }
  }

  async function readFileBlob(root, relativePath) {
    const parts = String(relativePath).split('/').filter(Boolean);
    const fileName = parts.pop();
    const dir = await getDir(root, parts, false);
    const fh = await dir.getFileHandle(fileName);
    return fh.getFile();
  }

  async function fileExists(root, relativePath) {
    try {
      await readFileBlob(root, relativePath);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function clearDirectoryContents(dirHandle) {
    // Copy names first — mutating while iterating can be unreliable.
    const names = [];
    for await (const entry of dirHandle.values()) {
      names.push(entry);
    }
    for (const entry of names) {
      await dirHandle.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
    }
  }

  async function ensureEmptyDir(root, name) {
    let dir;
    try {
      dir = await root.getDirectoryHandle(name, { create: true });
    } catch (e) {
      throw e;
    }
    await clearDirectoryContents(dir);
    return dir;
  }

  function claimZipPath(claim) {
    const job = AsExport.safeName(claim.jobNo || 'job') + '.zip';
    if (claim.completed) {
      const iso = claim.dateTo || claim.dateFrom || '';
      const y = parseInt(String(iso).slice(0, 4), 10);
      const year = Number.isFinite(y) ? y : new Date().getFullYear();
      return 'Archive/' + year + '/expenses/' + job;
    }
    return 'Active/' + job;
  }

  function timesheetPath(ts) {
    const name = AsTimesheetFiller.exportFileName(ts.year, ts.month);
    if (ts.completed) {
      return 'Archive/' + ts.year + '/timesheets/' + name;
    }
    return 'Timesheets/' + name;
  }

  async function writeFriendlyExports(root, claims, timesheets) {
    await ensureEmptyDir(root, 'Active');
    await ensureEmptyDir(root, 'Archive');
    await ensureEmptyDir(root, 'Timesheets');

    for (const claim of claims) {
      try {
        const blob = await AsExport.buildClaimZipBlob(claim);
        await writeBlob(root, claimZipPath(claim), blob);
      } catch (e) {
        console.warn('Folder sync claim zip failed', claim.jobNo, e);
      }
    }
    for (const ts of timesheets) {
      try {
        const blob = await AsExport.buildTimesheetOdtBlob(ts);
        await writeBlob(root, timesheetPath(ts), blob);
      } catch (e) {
        console.warn('Folder sync timesheet failed', ts.year, ts.month, e);
      }
    }
  }

  async function writeReceiptTree(root, receiptEntries) {
    // Replace receipts/ entirely so deleted receipts do not linger.
    try {
      await root.removeEntry('receipts', { recursive: true });
    } catch (_) {
      /* may not exist */
    }
    for (const entr of receiptEntries) {
      await writeBlob(root, entr.path, entr.blob);
    }
  }

  function buildFolderManifest(snapshot, claims, timesheets) {
    return {
      schemaVersion: 1,
      appVersion: AsStorage.APP_VERSION,
      exportedAt: new Date().toISOString(),
      exportedAtMillis: snapshot.exportedAtMillis,
      prefs: snapshot.prefs,
      claims: (claims || []).map((c) => ({
        id: c.id,
        jobNo: c.jobNo || '',
        dateFrom: c.dateFrom,
        dateTo: c.dateTo,
        completed: !!c.completed,
        path: claimZipPath(c),
      })),
      timesheets: (timesheets || []).map((t) => ({
        id: t.id,
        year: t.year,
        month: t.month,
        completed: !!t.completed,
        path: timesheetPath(t),
      })),
      restore: {
        prefer: BACKUP_JSON,
        receiptsDir: 'receipts/',
      },
    };
  }

  /**
   * Write full restore package + human-friendly Active/Archive/Timesheets.
   */
  async function syncNow(opts) {
    const root = await getWritableRoot(opts && opts.pickIfMissing ? 'pick' : 'reuse');
    const { snapshot, receiptEntries, claims, timesheets } = await AsExport.buildBackupPackage();

    await writeBlob(root, BACKUP_JSON, JSON.stringify(snapshot, null, 2));
    await writeReceiptTree(root, receiptEntries);
    await writeFriendlyExports(root, claims, timesheets);
    const folderManifest = buildFolderManifest(snapshot, claims, timesheets);
    await writeBlob(root, MANIFEST_NAME, JSON.stringify(folderManifest, null, 2));
    return { folderName: root.name, claimCount: claims.length, timesheetCount: timesheets.length };
  }

  async function collectReceiptBlobs(root) {
    const blobs = {};
    let receiptsDir;
    try {
      receiptsDir = await root.getDirectoryHandle('receipts');
    } catch (_) {
      return blobs;
    }

    async function walk(dir, prefix) {
      for await (const entry of dir.values()) {
        const path = prefix + entry.name;
        if (entry.kind === 'directory') {
          await walk(entry, path + '/');
        } else {
          const file = await entry.getFile();
          blobs[path] = file;
        }
      }
    }
    await walk(receiptsDir, 'receipts/');
    return blobs;
  }

  async function restoreFromHandle(root) {
    if (!(await fileExists(root, BACKUP_JSON))) {
      throw new Error(
        'Folder is missing as-forms-backup.json. Sync from AS Forms first, or use Import backup zip.'
      );
    }
    const file = await readFileBlob(root, BACKUP_JSON);
    const text = await file.text();
    const snapshot = JSON.parse(text);
    const receiptBlobs = await collectReceiptBlobs(root);
    await AsExport.importBackupParts(snapshot, receiptBlobs);
  }

  /**
   * Pick a folder (or reuse granted one) and replace browser data from it.
   */
  async function restoreFromFolder(opts) {
    if (!isSupported()) throw new Error(supportHint());
    let handle = null;
    const forcePick = !opts || opts.forcePick !== false;
    if (!forcePick) {
      handle = await getStoredHandle();
      if (handle) {
        const ok = await ensurePermission(handle, 'readwrite');
        if (!ok) handle = null;
      }
    }
    if (!handle) {
      handle = await global.showDirectoryPicker({ mode: 'readwrite' });
      const ok = await ensurePermission(handle, 'readwrite');
      if (!ok) throw new Error('Folder permission was not granted');
    }
    await restoreFromHandle(handle);
    await AsStorage.setDataFolderHandle(handle);
    AsStorage.saveSettings({ folderAutoSync: true });
    return { folderName: handle.name };
  }

  function autoSyncEnabled() {
    const s = AsStorage.getSettings();
    return s.folderAutoSync !== false;
  }

  function scheduleSync() {
    if (!isSupported()) return;
    if (!autoSyncEnabled()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      runBackgroundSync();
    }, DEBOUNCE_MS);
  }

  async function runBackgroundSync() {
    if (syncInFlight) {
      syncQueued = true;
      return;
    }
    const handle = await getStoredHandle();
    if (!handle) return;
    if (!autoSyncEnabled()) return;
    syncInFlight = true;
    try {
      const ok = await ensurePermission(handle, 'readwrite');
      if (!ok) {
        if (typeof global.__asFolderSyncToast === 'function') {
          global.__asFolderSyncToast('Folder sync needs permission — open Backup');
        }
        return;
      }
      await syncNow();
    } catch (e) {
      console.warn('Auto folder sync failed', e);
      if (typeof global.__asFolderSyncToast === 'function') {
        global.__asFolderSyncToast('Folder sync failed (data still in browser)');
      }
    } finally {
      syncInFlight = false;
      if (syncQueued) {
        syncQueued = false;
        scheduleSync();
      }
    }
  }

  global.AsFolderSync = {
    isSupported,
    supportHint,
    chooseFolder,
    disconnectFolder,
    folderName,
    getStoredHandle,
    ensurePermission,
    syncNow,
    restoreFromFolder,
    scheduleSync,
    autoSyncEnabled,
  };
})(window);
