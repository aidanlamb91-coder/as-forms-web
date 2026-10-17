/**
 * 1.2.1-web Other forms: what's kept on this device (port of Android SecretBox, HrDetailsStore,
 * SignatureStore, FormDraftStore, FormsBackup).
 *
 * One IndexedDB database of its own ("as-forms-forms"), so "Clear data on this device" can drop it
 * in one go. Stores:
 *  - kv:     the library key (a NON-EXTRACTABLE CryptoKey made from the access code; the code itself
 *            is never saved), this device's own key (also non-extractable), favourites, HR details,
 *            signatures and the default signature slot.
 *  - files:  downloaded forms and policies, still encrypted exactly as they came from the website.
 *  - drafts: filled copies of forms (sealed with the device key).
 *  - text:   text read out of downloaded files for search (sealed with the device key).
 * HR details, signatures, drafts and search text are encrypted with the device key, which lives
 * only in this browser. Bank & NI never go into any backup (cloud or downloaded).
 */
(function (global) {
  const DB_NAME = 'as-forms-forms';
  const STORES = ['kv', 'files', 'drafts', 'text'];
  const MAX_SIGNATURES = 3;
  const C = () => global.AsFormsCrypto;
  const R = () => global.AsFormRules;
  let dbp = null;
  let deviceKey = null;
  const mem = { hr: {}, sigs: {}, defaultSig: null, drafts: [], favs: new Set() };
  const listeners = new Set();

  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
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

  /** This device's own key, made once (non-extractable, so no script can copy it out). */
  async function devKey() {
    if (deviceKey) return deviceKey;
    deviceKey = await get('kv', 'deviceKey');
    if (!deviceKey) { deviceKey = await C().newDeviceKey(); await put('kv', 'deviceKey', deviceKey); }
    return deviceKey;
  }

  function changed(kind) { for (const fn of listeners) { try { fn(kind); } catch (e) { console.error(e); } } }

  let ready = null;
  /** Loads HR details, signatures, drafts and favourites into memory (screens read them at once). */
  function init() {
    if (!ready) {
      ready = (async () => {
        await devKey();
        const hr = await get('kv', 'hr'); mem.hr = (hr && (await openObj(hr))) || {};
        const sg = await get('kv', 'sigs'); mem.sigs = (sg && (await openObj(sg))) || {};
        mem.defaultSig = (await get('kv', 'defaultSig')) ?? null;
        mem.favs = new Set((await get('kv', 'favourites')) || []);
        const ids = await keys('drafts');
        const out = [];
        for (const id of ids) { const d = await openObj(await get('drafts', id)); if (d) out.push(d); }
        mem.drafts = out.sort((a, b) => b.updatedAt - a.updatedAt);
      })().catch((e) => { ready = null; throw e; });
    }
    return ready;
  }

  // ——— HR details ———
  const hr = () => Object.assign({}, mem.hr);
  async function setHr(changes) {
    const next = Object.assign({}, mem.hr);
    for (const [k, v] of Object.entries(changes)) { if (v == null || !String(v).trim()) delete next[k]; else next[k] = String(v); }
    mem.hr = next;
    await put('kv', 'hr', await sealObj(next));
    changed('hr');
  }

  // ——— Signatures: up to 3 PNGs, one default (applied to new forms automatically) ———
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const sigSlots = () => Object.keys(mem.sigs).map(Number).filter((n) => n < MAX_SIGNATURES).sort();
  const sigBytes = (slot) => (slot != null && mem.sigs[slot] ? C().b64ToBytes(mem.sigs[slot]) : null);
  function sigDefault() { const have = sigSlots(); return have.includes(mem.defaultSig) ? mem.defaultSig : (have[0] ?? null); }
  async function saveSigs() { await put('kv', 'sigs', await sealObj(mem.sigs)); await put('kv', 'defaultSig', mem.defaultSig); changed('sigs'); }
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
  const draft = (id) => mem.drafts.find((d) => d.id === id) || null;
  const newId = () => (global.crypto.randomUUID ? global.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  async function saveDraft(d) {
    mem.drafts = mem.drafts.filter((x) => x.id !== d.id).concat([d]).sort((a, b) => b.updatedAt - a.updatedAt);
    await put('drafts', d.id, await sealObj(d));
    changed('drafts');
    return d;
  }
  async function deleteDraft(id) { mem.drafts = mem.drafts.filter((x) => x.id !== id); await del('drafts', id); changed('drafts'); }
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
  /** { json, signatures: { 'signatures/sig_0.png': Uint8Array } }. No Bank & NI anywhere in it. */
  async function forBackup() {
    await init();
    const out = { version: 1, hr: R().hrForBackup(mem.hr), drafts: mem.drafts.map((d) => draftToJson(d, true)) };
    const def = sigDefault();
    if (def != null) out.defaultSignature = def;
    const signatures = {};
    for (const s of sigSlots()) signatures['signatures/sig_' + s + '.png'] = sigBytes(s);
    return { json: JSON.stringify(out), signatures };
  }
  /** Restore. Bank & NI already on this device are kept (backups never hold them). */
  async function restore(json, signatures) {
    await init();
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    const bank = Object.fromEntries(Object.entries(mem.hr).filter(([k]) => R().BANK_KEYS.includes(k)));
    const hrIn = R().hrForBackup(o.hr || {});
    mem.hr = Object.assign({}, hrIn, bank);
    await put('kv', 'hr', await sealObj(mem.hr));
    const old = new Map(mem.drafts.map((d) => [d.id, d]));
    await clear('drafts');
    mem.drafts = [];
    for (const raw of o.drafts || []) {
      const d = draftFromJson(raw);
      const prev = old.get(d.id);
      if (prev) for (const k of prev.privateKeys || []) if (prev.values[k] != null) d.values[k] = prev.values[k];
      await saveDraft(d);
    }
    if (signatures && Object.keys(signatures).length) {
      mem.sigs = {};
      for (const [path, png] of Object.entries(signatures)) {
        const m = /sig_(\d)\.png$/.exec(path);
        if (m && Number(m[1]) < MAX_SIGNATURES) mem.sigs[m[1]] = b64(new Uint8Array(png));
      }
      mem.defaultSig = o.defaultSignature != null ? Number(o.defaultSignature) : null;
      await saveSigs();
    }
    changed('restore');
  }

  /** "Clear data on this device": drops this whole database (forms, keys, HR details, drafts…). */
  async function clearAll() {
    if (dbp) { try { (await dbp).close(); } catch (_) { /* already closed */ } }
    dbp = null; deviceKey = null; ready = null;
    mem.hr = {}; mem.sigs = {}; mem.defaultSig = null; mem.drafts = []; mem.favs = new Set();
    await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  }

  global.AsFormsStore = {
    init, hr, setHr, sigSlots, sigBytes, sigDefault, sigAdd, sigDelete, sigSetDefault, MAX_SIGNATURES,
    drafts, draftsFor, draft, saveDraft, deleteDraft, newVersion, newId, favourites, setFavourites,
    libKey, setLibKey, forgetLibKey, fileGet, filePut, fileDel, fileNames, textGet, textPut, textDel, textClear, textNames,
    forBackup, restore, draftToJson, draftFromJson, clearAll, onChange: (fn) => listeners.add(fn), DB_NAME,
  };
})(typeof window !== 'undefined' ? window : globalThis);
