/*
 * AS Forms web — storage scope (1.2.1-web).
 *
 * The main site (/as-forms-web/) and the beta (/as-forms-web/beta/) live on the same web address,
 * so the browser gives them ONE shared localStorage and ONE shared set of IndexedDB databases.
 * This file keeps them apart:
 *   - Main site: names stay exactly as they always were ("as-forms-settings", "as-forms-web" …),
 *     so existing main-site users keep everything with no move needed.
 *   - Beta (or any other sub-folder copy): every name gets the folder name in front,
 *     e.g. "beta:as-forms-settings", "beta:as-forms-web".
 * "Clear data on this device" only removes names that belong to the copy you are using.
 *
 * Loaded before every other app script. Other files call AsScope.key(name) for localStorage keys
 * and AsScope.db(name) for database names, and wait for AsScope.ready before opening a database.
 *
 * One-time move for the beta: before this change the beta shared the main site's names. The
 * first time the new beta opens it COPIES the main site's data into its own names (the main site's
 * copy is never changed). The forms database ("as-forms-forms") was only ever made by the beta,
 * so it is moved across (copied, then the old one removed) — unless the main site already runs
 * this code itself (it then owns that name), in which case it is only copied.
 */
(function (global) {
  const ROOT_MARK = 'as-forms-scope';      // set by the main site once it runs scoped code
  const DONE_MARK = 'as-forms-scope-done'; // set (inside the beta's names) after the one-time copy
  const OWN_ROOT = /^as-forms/;             // every name the main site uses starts like this
  const DB_NAMES = ['as-forms-web', 'as-forms-forms'];
  const BETA_ONLY_DBS = ['as-forms-forms'];

  /** "beta" for /as-forms-web/beta/…, "" (the main site) for /as-forms-web/… or anywhere else. */
  function scopeFromPath(pathname) {
    const m = /\/as-forms-web\/([^/]+)\//.exec(pathname || '');
    return m && !m[1].includes('.') ? m[1] : '';
  }

  /** The naming rules for one scope (also used by the tests). */
  function make(scope) {
    const prefix = scope ? scope + ':' : '';
    return {
      scope,
      prefix,
      key: (name) => prefix + name,
      db: (name) => prefix + name,
      /** True when a localStorage key / database name belongs to this copy of the app. */
      owns: (name) => (prefix ? String(name).startsWith(prefix) : OWN_ROOT.test(String(name))),
    };
  }

  const here = make(scopeFromPath(global.location && global.location.pathname));
  const ls = () => { try { return global.localStorage; } catch (_) { return null; } };

  // ——— IndexedDB helpers (raw, no app code) ———
  /** Opens a database only if it already exists (never creates an empty one). */
  function openIfExists(name) {
    return new Promise((resolve) => {
      let created = false;
      let req;
      try { req = indexedDB.open(name); } catch (_) { return resolve(null); }
      req.onupgradeneeded = (e) => { if (e.oldVersion === 0) { created = true; req.transaction.abort(); } };
      req.onsuccess = () => resolve(created ? null : req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  function deleteDb(name) {
    return new Promise((resolve) => {
      try {
        const r = indexedDB.deleteDatabase(name);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      } catch (_) { resolve(); }
    });
  }
  const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  /** Copies every store and record of database `from` into a new database `to` (same layout). */
  async function copyDb(from, to) {
    const src = await openIfExists(from);
    if (!src) return false;
    const exists = await openIfExists(to);
    if (exists) { exists.close(); src.close(); return false; } // never overwrite
    const layout = [...src.objectStoreNames].map((n) => {
      const os = src.transaction(n, 'readonly').objectStore(n);
      return {
        name: n, keyPath: os.keyPath, autoIncrement: os.autoIncrement,
        indexes: [...os.indexNames].map((i) => { const ix = os.index(i); return { name: i, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry }; }),
      };
    });
    const data = {};
    for (const s of layout) {
      const tx = src.transaction(s.name, 'readonly').objectStore(s.name);
      data[s.name] = { keys: await reqP(tx.getAllKeys()), values: await reqP(src.transaction(s.name, 'readonly').objectStore(s.name).getAll()) };
    }
    const version = src.version;
    src.close();
    const dst = await new Promise((resolve, reject) => {
      const req = indexedDB.open(to, version);
      req.onupgradeneeded = () => {
        for (const s of layout) {
          const os = req.result.createObjectStore(s.name, s.keyPath == null ? { autoIncrement: s.autoIncrement } : { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
          for (const i of s.indexes) os.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const s of layout) {
      if (!data[s.name].values.length) continue;
      await new Promise((resolve, reject) => {
        const tx = dst.transaction(s.name, 'readwrite');
        const os = tx.objectStore(s.name);
        data[s.name].values.forEach((v, i) => { if (s.keyPath == null) os.put(v, data[s.name].keys[i]); else os.put(v); });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    dst.close();
    return true;
  }

  // ——— One-time copy for a sub-folder copy (beta) ———
  function copyKeysOnce(scoped) {
    const s = ls(); if (!s) return;
    const names = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (OWN_ROOT.test(k) && k !== ROOT_MARK) names.push(k); }
    for (const k of names) if (s.getItem(scoped.key(k)) == null) s.setItem(scoped.key(k), s.getItem(k));
  }
  async function moveDatabasesOnce(scoped, rootRunsScoped) {
    if (typeof indexedDB === 'undefined') return;
    for (const name of DB_NAMES) {
      try {
        const copied = await copyDb(name, scoped.db(name));
        if (copied && BETA_ONLY_DBS.includes(name) && !rootRunsScoped) await deleteDb(name);
      } catch (e) { console.error('Storage copy', name, e); }
    }
  }

  let ready = Promise.resolve();
  const s = ls();
  if (s) {
    if (!here.prefix) {
      try { s.setItem(ROOT_MARK, '1'); } catch (_) { /* private mode */ }
    } else if (s.getItem(here.key(DONE_MARK)) == null) {
      const rootRunsScoped = s.getItem(ROOT_MARK) === '1';
      try { copyKeysOnce(here); } catch (e) { console.error(e); }
      ready = moveDatabasesOnce(here, rootRunsScoped)
        .catch((e) => console.error(e))
        .then(() => { try { s.setItem(here.key(DONE_MARK), '1'); } catch (_) { /* private mode */ } });
    }
  }

  /**
   * "Clear data on this device": removes ONLY this copy's localStorage / sessionStorage keys and
   * databases. The other copy (main site or beta) on the same address is left alone.
   */
  async function clearOwn() {
    for (const st of [ls(), (() => { try { return global.sessionStorage; } catch (_) { return null; } })()]) {
      if (!st) continue;
      const mine = [];
      for (let i = 0; i < st.length; i++) { const k = st.key(i); if (here.owns(k)) mine.push(k); }
      mine.forEach((k) => st.removeItem(k));
    }
    let names = DB_NAMES.map(here.db);
    try {
      if (indexedDB.databases) names = names.concat((await indexedDB.databases()).map((d) => d.name).filter((n) => n && here.owns(n)));
    } catch (_) { /* older browsers: the known names are enough */ }
    await Promise.all([...new Set(names)].map(deleteDb));
    // Don't copy the main site's data back in after a clear
    try { if (here.prefix) ls().setItem(here.key(DONE_MARK), '1'); else ls().setItem(ROOT_MARK, '1'); } catch (_) { /* private mode */ }
  }

  global.AsScope = Object.assign({}, here, { ready, clearOwn, make, scopeFromPath, copyDb, ROOT_MARK, DONE_MARK, DB_NAMES });
})(typeof window !== 'undefined' ? window : globalThis);
