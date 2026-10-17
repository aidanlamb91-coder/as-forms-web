/**
 * 1.2.1-web Other forms: what's kept on this device (port of Android SecretBox, HrDetailsStore,
 * SignatureStore, FormDraftStore, FormsBackup). 1.2.2-web: personal details lock.
 *
 * One IndexedDB database of its own ("as-forms-forms", scoped per copy), so "Clear data on this
 * device" can drop it in one go. Stores:
 *  - kv:     the library key (a NON-EXTRACTABLE CryptoKey made from the access code; the code itself
 *            is never saved), this device's own key (also non-extractable), favourites, and the
 *            personal details: HR details, signatures, default signature slot.
 *  - files:  downloaded forms and policies, still encrypted exactly as they came from the website.
 *  - drafts: filled copies of forms (personal details).
 *  - text:   text read out of downloaded files for search (sealed with the device key).
 *
 * Personal details (HR details, signatures, drafts) — 1.2.2-web, see js/lock-core.js:
 *  - lock on:  sealed with the lock's data key; while locked they can't be read at all.
 *  - lock off ("No thanks"): kept in memory for this session only, nothing on disk.
 *  - not decided yet (only possible before Profile is first opened): sealed with the device key,
 *    as in 1.2.1, so nothing is lost before you choose.
 * Bank & NI are NEVER stored or backed up: they live in memory for the open form only
 * (forgetBank), and any saved by 1.2.1 are deleted once on upgrade (bankNotice).
 */
(function (global) {
  // 1.2.1-web: scoped per copy (main site / beta) — see js/app-scope.js
  const DB_NAME = global.AsScope ? global.AsScope.db('as-forms-forms') : 'as-forms-forms';
  const STORES = ['kv', 'files', 'drafts', 'text'];
  const MAX_SIGNATURES = 3;
  const C = () => global.AsFormsCrypto;
  const R = () => global.AsFormRules;
  const L = () => global.AsLock;
  /** Personal details mode: 'lock', 'off' (session only) or null (not decided yet). */
  const pmode = () => (L() ? L().mode() : null);
  class Locked extends Error { constructor() { super('Personal details are locked'); this.name = 'Locked'; } }
  let dbp = null;
  let deviceKey = null;
  const mem = { hr: {}, sigs: {}, defaultSig: null, drafts: [], favs: new Set(), locked: false, bankNotice: false };
  /** Bank & NI answers of open forms: memory only, never saved (draft id → { key: value }). */
  let bankMem = {};
  const listeners = new Set();

  function db() {
    if (!dbp) {
      const scopeReady = (global.AsScope && global.AsScope.ready) || Promise.resolve();
      dbp = scopeReady.then(() => new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }));
    }
    return dbp;
  }
  async function op(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const get = (s, k) => op(s, 'readonly', (o) => o.get(k));
  const put = (s, k, v) => op(s, 'readwrite', (o) => o.put(v, k));
  const del = (s, k) => op(s, 'readwrite', (o) => o.delete(k));
  const keys = (s) => op(s, 'readonly', (o) => o.getAllKeys());
  const clear = (s) => op(s, 'readwrite', (o) => o.clear());

  const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));
  const dec = (b) => JSON.parse(new TextDecoder().decode(b));
  async function sealObj(obj) { return C().seal(await devKey(), enc(obj)); }
  async function openObj(b) { try { return dec(await C().open(await devKey(), b)); } catch (_) { return null; } }
  async function openWith(key, b) { try { return b ? dec(await C().open(key, b)) : null; } catch (_) { return null; } }

  /** The key personal details are saved with right now: the lock's data key, the device key
   *  (not decided yet) or null (lock off: don't save). Throws Locked while locked. */
  async function personalKey() {
    const m = pmode();
    if (m === 'off') return null;
    if (m === 'lock') { const k = L().key(); if (!k) throw new Locked(); return k; }
    return devKey();
  }
  async function persist(store, k, obj) {
    const key = await personalKey();
    if (!key) return; // lock off: memory only
    await put(store, k, await C().seal(key, enc(obj)));
    await put('kv', 'pfmt', pmode() === 'lock' ? 'lock' : 'device');
  }
  /** Bank & NI of a draft? (fixed list + the form's own "private" boxes) */
  const isBank = (k, d) => R().isBankField(k) || ((d && d.privateKeys) || []).includes(k);
  const stripHrBank = (hr) => Object.fromEntries(Object.entries(hr || {}).filter(([k]) => !R().BANK_KEYS.includes(k)));
  function stripDraft(d) { return Object.assign({}, d, { values: Object.fromEntries(Object.entries(d.values || {}).filter(([k]) => !isBank(k, d))) }); }

  /** This device's own key, made once (non-extractable, so no script can copy it out). */
  async function devKey() {
    if (deviceKey) return deviceKey;
    deviceKey = await get('kv', 'deviceKey');
    if (!deviceKey) { deviceKey = await C().newDeviceKey(); await put('kv', 'deviceKey', deviceKey); }
    return deviceKey;
  }

  function changed(kind) { for (const fn of listeners) { try { fn(kind); } catch (e) { console.error(e); } } }

  let ready = null;
  /** Loads favourites and (when they can be read) the personal details into memory. */
  function init() {
    if (!ready) {
      ready = (async () => {
        await devKey();
        mem.favs = new Set((await get('kv', 'favourites')) || []);
        await loadPersonal();
      })().catch((e) => { ready = null; throw e; });
    }
    return ready;
  }
  async function loadPersonal() {
    const m = pmode();
    if (m === 'off') { await wipePersonal(); mem.locked = false; return; } // session only: keep what's in memory
    const fmt = (await get('kv', 'pfmt')) || 'device';
    let key;
    if (fmt === 'lock') {
      key = L() && L().key();
      if (!key) { mem.hr = {}; mem.sigs = {}; mem.defaultSig = null; mem.drafts = []; mem.locked = true; return; }
    } else key = await devKey();
    mem.locked = false;
    mem.hr = (await openWith(key, await get('kv', 'hr'))) || {};
    mem.sigs = (await openWith(key, await get('kv', 'sigs'))) || {};
    mem.defaultSig = (await get('kv', 'defaultSig')) ?? null;
    const out = [];
    for (const id of await keys('drafts')) { const d = await openWith(key, await get('drafts', id)); if (d) out.push(d); }
    mem.drafts = out.sort((a, b) => b.updatedAt - a.updatedAt);
    await purgeBankOnce();
    if (m === 'lock' && fmt !== 'lock') await saveAllPersonal(); // lock was just set: seal with it
  }
  /** 1.2.2-web upgrade: Bank & NI saved by 1.2.1 are deleted once (HR details and drafts). */
  async function purgeBankOnce() {
    if (await get('kv', 'bankPurged')) return;
    const hrClean = stripHrBank(mem.hr);
    let removed = Object.keys(hrClean).length !== Object.keys(mem.hr).length;
    const drafts = mem.drafts.map((d) => { const c = stripDraft(d); if (Object.keys(c.values).length !== Object.keys(d.values || {}).length) removed = true; return c; });
    if (removed) {
      mem.hr = hrClean; mem.drafts = drafts;
      await saveAllPersonal();
      mem.bankNotice = true;
    }
    await put('kv', 'bankPurged', true);
  }
  /** Writes every personal record again with the current key (used after the lock changes). */
  async function saveAllPersonal() {
    if (!(await personalKey())) return;
    await persist('kv', 'hr', stripHrBank(mem.hr));
    await persist('kv', 'sigs', mem.sigs);
    await put('kv', 'defaultSig', mem.defaultSig);
    await clear('drafts');
    for (const d of mem.drafts) await persist('drafts', d.id, stripDraft(d));
  }
  /** Removes personal details from disk (memory copy kept for this session). */
  async function wipePersonal() {
    for (const k of ['hr', 'sigs', 'defaultSig', 'pfmt']) await del('kv', k);
    await clear('drafts');
  }
  /** Called by the lock screens after the lock changes. */
  async function lockChanged(kind) {
    await init().catch(() => {});
    if (kind === 'lock-on') { mem.locked = false; await saveAllPersonal(); }
    else if (kind === 'unlock') { await loadPersonal(); }
    else if (kind === 'lock') { mem.hr = {}; mem.sigs = {}; mem.defaultSig = null; mem.drafts = []; bankMem = {}; mem.locked = true; }
    else if (kind === 'lock-off' || kind === 'declined') { await wipePersonal(); mem.locked = false; }
    changed(kind);
  }

  // ——— HR details ———
  const hr = () => Object.assign({}, mem.hr);
  /** Saves HR details. Bank & NI are dropped here, so they can never be stored. */
  async function setHr(changes) {
    const next = Object.assign({}, mem.hr);
    for (const [k, v] of Object.entries(changes)) { if (v == null || !String(v).trim()) delete next[k]; else next[k] = String(v); }
    mem.hr = stripHrBank(next);
    await persist('kv', 'hr', mem.hr);
    changed('hr');
  }

  // ——— Signatures: up to 3 PNGs, one default (applied to new forms automatically) ———
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const sigSlots = () => Object.keys(mem.sigs).map(Number).filter((n) => n < MAX_SIGNATURES).sort();
  const sigBytes = (slot) => (slot != null && mem.sigs[slot] ? C().b64ToBytes(mem.sigs[slot]) : null);
  function sigDefault() { const have = sigSlots(); return have.includes(mem.defaultSig) ? mem.defaultSig : (have[0] ?? null); }
  async function saveSigs() {
    await persist('kv', 'sigs', mem.sigs);
    if (pmode() !== 'off') await put('kv', 'defaultSig', mem.defaultSig);
    changed('sigs');
  }
  async function sigAdd(png) {
    const slot = [0, 1, 2].find((s) => !mem.sigs[s]);
    if (slot == null) return null;
    mem.sigs[slot] = b64(png);
    if (sigSlots().length === 1) mem.defaultSig = slot;
    await saveSigs();
    return slot;
  }
  async function sigDelete(slot) { delete mem.sigs[slot]; await saveSigs(); }
  async function sigSetDefault(slot) { mem.defaultSig = slot; await saveSigs(); }

  // ——— Drafts (filled copies) ———
  const drafts = () => mem.drafts.slice();
  const draftsFor = (n) => mem.drafts.filter((d) => d.formNumber === n);
  /** One draft, with the Bank & NI typed for it this session (memory only) put back in. */
  function draft(id) {
    const d = mem.drafts.find((x) => x.id === id);
    if (!d) return null;
    return bankMem[id] ? Object.assign({}, d, { values: Object.assign({}, d.values, bankMem[id]) }) : d;
  }
  /** Forget the Bank & NI typed for one form (after export / on leaving it), or for all. */
  function forgetBank(id) { if (id == null) bankMem = {}; else delete bankMem[id]; }
  const newId = () => (global.crypto.randomUUID ? global.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  async function saveDraft(d) {
    // Bank & NI answers go to memory only; the saved draft never has them
    const bank = Object.fromEntries(Object.entries(d.values || {}).filter(([k]) => isBank(k, d)));
    if (Object.keys(bank).length) bankMem[d.id] = bank; else delete bankMem[d.id];
    const safe = stripDraft(d);
    mem.drafts = mem.drafts.filter((x) => x.id !== d.id).concat([safe]).sort((a, b) => b.updatedAt - a.updatedAt);
    await persist('drafts', d.id, safe);
    changed('drafts');
    return draft(d.id);
  }
  async function deleteDraft(id) { mem.drafts = mem.drafts.filter((x) => x.id !== id); delete bankMem[id]; await del('drafts', id); changed('drafts'); }
  /** "Edit as new copy": a new draft, answers kept, signature and signing date cleared. */
  function newVersion(from, spec) {
    return saveDraft(Object.assign({}, from, {
      id: newId(), version: (from.version || 1) + 1, values: R().forNewVersion(spec, from.values),
      signatureSlot: null, updatedAt: Date.now(), exportedAt: null, unsure: [], exportFormat: null, sentTo: null, importedFrom: null,
    }));
  }

  // ——— Favourites ———
  const favourites = () => new Set(mem.favs);
  async function setFavourites(set) { mem.favs = new Set(set); await put('kv', 'favourites', Array.from(mem.favs)); }

  // ——— Library key + downloaded files (still encrypted) + search text ———
  const libKey = () => get('kv', 'libKey');
  const setLibKey = (v) => put('kv', 'libKey', v);
  const forgetLibKey = () => del('kv', 'libKey');
  const fileGet = (n) => get('files', n);
  const filePut = (n, b) => put('files', n, b);
  const fileDel = (n) => del('files', n);
  const fileNames = () => keys('files');
  async function textGet(blob) { const b = await get('text', blob); return b ? openObj(b) : null; }
  async function textPut(blob, t) { await put('text', blob, await sealObj(t)); }
  const textDel = (blob) => del('text', blob);
  const textClear = () => clear('text');
  const textNames = () => keys('text');

  // ——— Backup (same layout as Android: forms-profile.json + signatures/sig_N.png) ———
  /** Android's draft JSON shape. stripPrivate removes Bank & NI answers. */
  function draftToJson(d, stripPrivate) {
    const v = stripPrivate ? R().draftForBackup(d).values : d.values;
    const o = { id: d.id, form: d.formNumber, version: d.version || 1, values: v, updated: d.updatedAt, private: d.privateKeys || [] };
    if (d.signatureSlot != null) o.sig = d.signatureSlot;
    if (d.exportedAt) o.exported = d.exportedAt;
    if (d.importedFrom) o.importedFrom = d.importedFrom;
    if (d.unsure && d.unsure.length) o.unsure = d.unsure;
    if (d.exportFormat) o.format = d.exportFormat;
    if (d.sentTo) o.sentTo = d.sentTo;
    return o;
  }
  function draftFromJson(o) {
    return {
      id: String(o.id), formNumber: String(o.form), version: Number(o.version) || 1, values: o.values || {},
      signatureSlot: o.sig != null ? Number(o.sig) : null, updatedAt: Number(o.updated) || Date.now(),
      exportedAt: o.exported ? Number(o.exported) : null, privateKeys: o.private || [], importedFrom: o.importedFrom || null,
      unsure: o.unsure || [], exportFormat: o.format || null, sentTo: o.sentTo || null,
    };
  }
  /**
   * 1.2.2-web backup part "personal.json": the personal details exactly as sealed on this device
   * (with the lock's data key) plus the recovery record that can open that key. Only when the lock
   * is on AND a recovery key was made — otherwise backups carry no personal details at all.
   * Works while locked (nothing is decrypted). Bank & NI are never in it (never stored).
   */
  async function personalForBackup() {
    await init();
    if (pmode() !== 'lock' || !L().hasRecovery() || (await get('kv', 'pfmt')) !== 'lock') return null;
    const b = (u8) => (u8 ? L().b64(u8) : null);
    const ids = await keys('drafts');
    const drafts = [];
    for (const id of ids) drafts.push(b(await get('drafts', id)));
    return { version: 1, kind: 'as-forms-personal', recovery: L().recoveryRecord(), hr: b(await get('kv', 'hr')), sigs: b(await get('kv', 'sigs')),
      defaultSig: (await get('kv', 'defaultSig')) ?? null, drafts: drafts.filter(Boolean) };
  }
  /** Opens a backup's personal.json with the data key from its recovery key; returns what's in it. */
  async function openPersonal(part, raw) {
    // raw = recovery-opened key bytes, or this device's own unlocked key (same recovery key)
    const key = raw instanceof CryptoKey ? raw : await L().importDataKey(raw);
    const u = (s) => (s ? L().unb64(s) : null);
    const hrIn = (await openWith(key, u(part.hr))) || {};
    const sigs = (await openWith(key, u(part.sigs))) || {};
    const ds = [];
    for (const s of part.drafts || []) { const d = await openWith(key, u(s)); if (d) ds.push(stripDraft(d)); }
    return { hr: stripHrBank(hrIn), sigs, defaultSig: part.defaultSig ?? null, drafts: ds };
  }
  /** Puts opened personal details on this device (saved with the current lock, if any). */
  async function applyPersonal(p) {
    await init();
    mem.hr = stripHrBank(p.hr); mem.sigs = p.sigs || {}; mem.defaultSig = p.defaultSig ?? null;
    mem.drafts = (p.drafts || []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
    mem.locked = false;
    if (pmode() === 'lock' && L().key()) await saveAllPersonal();
    changed('restore');
  }

  /** Older backups (1.2.1 forms-profile.json, plain): restored without Bank & NI. */
  async function restore(json, signatures) {
    await init();
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    mem.hr = stripHrBank(o.hr || {});
    mem.drafts = (o.drafts || []).map((raw) => stripDraft(draftFromJson(raw))).sort((a, b) => b.updatedAt - a.updatedAt);
    if (signatures && Object.keys(signatures).length) {
      mem.sigs = {};
      for (const [path, png] of Object.entries(signatures)) {
        const m = /sig_(\d)\.png$/.exec(path);
        if (m && Number(m[1]) < MAX_SIGNATURES) mem.sigs[m[1]] = b64(new Uint8Array(png));
      }
      mem.defaultSig = o.defaultSignature != null ? Number(o.defaultSignature) : null;
    }
    try { await saveAllPersonal(); } catch (e) { if (!(e instanceof Locked)) throw e; }
    changed('restore');
  }

  /** "Clear data on this device": drops this whole database (forms, keys, HR details, drafts…). */
  async function clearAll() {
    if (dbp) { try { (await dbp).close(); } catch (_) { /* already closed */ } }
    dbp = null; deviceKey = null; ready = null; bankMem = {};
    mem.hr = {}; mem.sigs = {}; mem.defaultSig = null; mem.drafts = []; mem.favs = new Set(); mem.locked = false;
    await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  }

  global.AsFormsStore = {
    init, hr, setHr, sigSlots, sigBytes, sigDefault, sigAdd, sigDelete, sigSetDefault, MAX_SIGNATURES,
    drafts, draftsFor, draft, saveDraft, deleteDraft, newVersion, newId, favourites, setFavourites,
    libKey, setLibKey, forgetLibKey, fileGet, filePut, fileDel, fileNames, textGet, textPut, textDel, textClear, textNames,
    personalForBackup, openPersonal, applyPersonal, restore, draftToJson, draftFromJson, clearAll, onChange: (fn) => listeners.add(fn), DB_NAME,
    // 1.2.2-web lock
    lockChanged, forgetBank, isLocked: () => mem.locked, bankNotice: () => mem.bankNotice, clearBankNotice: () => { mem.bankNotice = false; }, Locked,
  };
})(typeof window !== 'undefined' ? window : globalThis);
