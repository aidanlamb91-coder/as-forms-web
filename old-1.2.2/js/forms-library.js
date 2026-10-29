/**
 * 1.2.1-web Settings → Other forms: the encrypted forms library (port of Android FormsLibrary.kt).
 *
 * - The access code is typed once. It is turned into a NON-EXTRACTABLE AES key, and only that key
 *   is kept (IndexedDB, js/forms-store.js); the code itself is never saved. A wrong code is caught
 *   by trying to unlock index.bin.
 * - index.bin lists every form and policy. It's checked for new revisions whenever Other forms
 *   opens and the device is online; offline the last copy is used.
 * - Each file downloads the first time it's tapped and is kept (still encrypted) so it works
 *   offline. Favourites download ahead of time. Downloads run ONE AT A TIME (a queue), so two quick
 *   taps can't race, and each item keeps its own spinner on screen.
 * - Specs for fill-in forms come with the index. A form is "Fill in" only when its spec matches the
 *   listed revision and its Word template's markers; otherwise it's offered under Download with
 *   "Needs updating". Until the template is on the device the form is "unverified" and is checked
 *   as soon as it downloads (before the edit screen opens).
 * The library lives on the main site (/as-forms-web/forms/), shared by the main site and /beta/.
 */
(function (global) {
  const C = () => global.AsFormsCrypto;
  const S = () => global.AsFormsStore;
  const R = () => global.AsFormRules;
  const KEYINFO = 'key.json';
  const INDEX = 'index.bin';
  const SUMMARIES_URL = 'data/forms-summaries.bin';

  class Offline extends Error { constructor() { super('Needs internet'); this.name = 'Offline'; } }

  /** Where the forms folder is: always the main site's forms/ (beta shares it). */
  function base() {
    if (global.AS_FORMS_BASE) return global.AS_FORMS_BASE;
    const m = /^(.*?\/as-forms-web\/)/.exec(location.pathname);
    return location.origin + (m ? m[1] : '/') + 'forms/';
  }
  const online = () => (typeof navigator === 'undefined' || navigator.onLine !== false);

  async function fetchFile(name) {
    let res;
    try {
      res = await fetch(base() + name + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
    } catch (e) { throw new Offline(); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  let state = { hasCode: false, index: null, specs: {}, needsUpdating: new Set(), unverified: new Set(), downloaded: new Set(), favourites: new Set(), busy: false, message: null };
  const listeners = new Set();
  function setState(patch) { state = Object.assign({}, state, patch); for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } }

  let lib = null; // { key: CryptoKey, salt, iterations }
  const markerCache = new Map(); // template blob → Set of markers
  let summaries = null;

  async function libKey() { if (!lib) lib = (await S().libKey()) || null; return lib; }
  async function cachedText(name) { const b = await S().fileGet(name); return b ? new TextDecoder().decode(b) : null; }

  /** The library key, if it fits the key.json on this device; else WrongCode ("Access code has changed"). */
  async function currentKey() {
    const k = await libKey();
    if (!k) throw new (C().WrongCode)();
    const infoTxt = await cachedText(KEYINFO);
    if (infoTxt) { const info = JSON.parse(infoTxt); if (info.salt !== k.salt) throw new (C().WrongCode)(); }
    return k.key;
  }

  async function unlockIndex(blob) { return JSON.parse(new TextDecoder().decode(await C().open(await currentKey(), blob))); }

  /** Decrypts a stored file and checks its fingerprint. Null when not downloaded (or damaged). */
  async function openCached(ref) {
    const blob = await S().fileGet(ref.blob);
    if (!blob) return null;
    const plain = await C().open(await currentKey(), blob);
    if ((await C().sha256Hex(plain)) !== ref.sha256) { await S().fileDel(ref.blob); return null; }
    return plain;
  }

  async function markersOf(ref) {
    if (markerCache.has(ref.blob)) return markerCache.get(ref.blob);
    const plain = await openCached(ref);
    if (!plain) return null;
    const m = await global.AsFormDocx.markers(plain);
    markerCache.set(ref.blob, m);
    return m;
  }

  // Rebuilds run one after another, so a slow one can never overwrite a newer picture.
  let rebuildChain = Promise.resolve();
  function loadCached() { rebuildChain = rebuildChain.then(rebuild, rebuild); return rebuildChain; }
  async function rebuild() {
    const hasCode = !!(await libKey());
    let index = null;
    try { const b = await S().fileGet(INDEX); index = b && hasCode ? await unlockIndex(b) : null; } catch (_) { index = null; }
    const specs = {}; const needsUpdating = new Set(); const unverified = new Set(); const downloaded = new Set();
    const have = new Set(await S().fileNames());
    for (const item of (index && index.items) || []) {
      if (have.has(item.file.blob)) downloaded.add(item.number);
      if (item.kind === 'policy') continue;
      if (item.spec) { try { const p = await openCached(item.spec); if (p) specs[item.number] = JSON.parse(new TextDecoder().decode(p)); } catch (_) { /* not usable */ } }
      if (!item.fillable) continue;
      let markers = null;
      if (item.template) { try { markers = await markersOf(item.template); } catch (_) { markers = null; } }
      const v = R().matches(item, specs[item.number], markers);
      if (v === false) needsUpdating.add(item.number); else if (v === null) unverified.add(item.number);
    }
    setState({ hasCode, index, specs, needsUpdating, unverified, downloaded, favourites: S().favourites() });
  }

  /** Fill-in forms that can be filled here now / Download forms (incl. those needing an update). */
  function fillIn(st) { const s = st || state; return ((s.index && s.index.items) || []).filter((i) => i.kind !== 'policy' && i.fillable && s.specs[i.number] && !s.needsUpdating.has(i.number)); }
  function downloadForms(st) { const s = st || state; const f = new Set(fillIn(s).map((i) => i.number)); return ((s.index && s.index.items) || []).filter((i) => i.kind !== 'policy' && !f.has(i.number)); }
  const policies = (st) => (((st || state).index && (st || state).index.items) || []).filter((i) => i.kind === 'policy');

  /** Saves a new access code after checking it unlocks the library. Returns null or a short message. */
  async function setCode(code) {
    const c = String(code || '').trim();
    if (!c) return 'Enter the code';
    if (!online()) return 'Needs internet';
    let info, idx;
    try { info = await fetchFile(KEYINFO); idx = await fetchFile(INDEX); } catch (e) { return "Couldn't reach the forms site"; }
    try {
      const o = JSON.parse(new TextDecoder().decode(info));
      const key = await C().deriveKey(c, o.salt, o.iterations);
      await C().open(key, idx); // throws WrongCode
      lib = { key, salt: o.salt, iterations: o.iterations };
      await S().setLibKey(lib);
      await S().filePut(KEYINFO, info); await S().filePut(INDEX, idx);
      summaries = null;
    } catch (e) {
      return e && e.name === 'WrongCode' ? 'Wrong code' : "Couldn't reach the forms site";
    }
    await loadCached();
    await refresh(true);
    return null;
  }

  /** Removes the code and every downloaded file (drafts and HR details stay). */
  async function clearCode() {
    await S().forgetLibKey(); lib = null; summaries = null; markerCache.clear();
    for (const n of await S().fileNames()) await S().fileDel(n);
    await S().textClear();
    await loadCached();
  }

  async function download(ref) {
    const have = await S().fileGet(ref.blob);
    if (have) return;
    const blob = await fetchFile(ref.blob);
    const plain = await C().open(await currentKey(), blob);
    if ((await C().sha256Hex(plain)) !== ref.sha256) throw new (C().BadFile)('Download damaged');
    await S().filePut(ref.blob, blob);
  }

  /** Checks for new revisions (online only), then fetches specs and favourites. Offline: cached copy. */
  async function refresh(force) {
    if (!(await libKey())) { await loadCached(); return; }
    if (!online()) { await loadCached(); return; }
    setState({ busy: true, message: null });
    try {
      const info = await fetchFile(KEYINFO);
      const idxBlob = await fetchFile(INDEX);
      const o = JSON.parse(new TextDecoder().decode(info));
      if (o.salt !== lib.salt) { setState({ busy: false, message: 'Access code has changed' }); await loadCached(); return; }
      let idx;
      try { idx = JSON.parse(new TextDecoder().decode(await C().open(lib.key, idxBlob))); }
      catch (e) { setState({ busy: false, message: 'Access code has changed' }); await loadCached(); return; }
      await S().filePut(KEYINFO, info); await S().filePut(INDEX, idxBlob);
      // drop stored files that are no longer listed (old revisions)
      const keep = new Set([KEYINFO, INDEX]);
      for (const it of idx.items) for (const r of [it.file, it.template, it.spec]) if (r) keep.add(r.blob);
      for (const n of await S().fileNames()) if (!keep.has(n)) { await S().fileDel(n); await S().textDel(n); markerCache.delete(n); }
      for (const it of idx.items) if (it.kind !== 'policy' && it.spec) await queued(() => download(it.spec));
      const fav = S().favourites();
      for (const it of idx.items.filter((i) => fav.has(i.number))) await queued(async () => { await download(it.file); if (it.template) await download(it.template); });
      await loadCached();
    } catch (e) {
      await loadCached();
      if (force) setState({ message: "Couldn't check for updates" });
    }
    setState({ busy: false });
  }

  // One download at a time: two quick taps queue instead of racing on the same file.
  let queue = Promise.resolve();
  function queued(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }

  /** Opens a file, downloading it first when needed (queued). */
  function ensure(ref) {
    return queued(async () => {
      const have = await openCached(ref);
      if (have) return have;
      if (!online()) throw new Offline();
      await download(ref);
      return openCached(ref);
    });
  }

  /** The company file itself (download-only use). */
  async function original(item) { const b = await ensure(item.file); await loadCached(); return b; }
  /** Word template with markers (null for the PDF Observation Card); state is rebuilt afterwards. */
  async function template(item) { const b = item.template ? await ensure(item.template) : null; await loadCached(); return b; }

  /** Why a fill-in form can't be checked (shown in the error). Null when fine. */
  async function checkProblem(item) {
    try {
      const sp = item.spec ? await openCached(item.spec) : null;
      if (!sp) return 'form details missing';
      const parsed = JSON.parse(new TextDecoder().decode(sp));
      if (parsed.rev !== item.rev) return 'revision ' + parsed.rev + ' vs ' + item.rev;
      if (!item.template) return null;
      const m = await markersOf(item.template);
      if (!m) return 'template not downloaded';
      if (!m.size) return 'no boxes found in template';
      return R().matches(item, parsed, m) === false ? "template boxes don't match" : null;
    } catch (e) { return (e && (e.name + (e.message ? ': ' + String(e.message).slice(0, 80) : ''))) || 'error'; }
  }

  /** Makes sure a fill-in form's template is here and checked. Returns an error message or null. */
  async function ready(item) {
    if (state.unverified.has(item.number)) {
      try { await template(item); } catch (e) { return errorMessage(e); }
    }
    if (state.needsUpdating.has(item.number)) return 'Needs updating - download only';
    if (state.unverified.has(item.number) || !state.specs[item.number]) return "Couldn't check this form (" + ((await checkProblem(item)) || 'try again') + ')';
    return null;
  }

  const blobsOf = (item) => [item.file, item.template].filter(Boolean).map((r) => r.blob);

  async function deleteDownload(item) {
    await queued(async () => { for (const b of blobsOf(item)) { await S().fileDel(b); markerCache.delete(b); } await S().textDel(item.file.blob); });
    await loadCached();
  }
  async function deleteAllDownloads() {
    const items = (state.index && state.index.items) || [];
    await queued(async () => { for (const it of items) for (const b of blobsOf(it)) { await S().fileDel(b); markerCache.delete(b); } await S().textClear(); });
    await loadCached();
  }
  /** Space used by downloaded forms and policies, in bytes. */
  async function downloadedBytes() {
    let n = 0; const seen = new Set();
    for (const it of (state.index && state.index.items) || []) for (const b of blobsOf(it)) {
      if (seen.has(b)) continue; seen.add(b);
      const f = await S().fileGet(b); if (f) n += f.byteLength;
    }
    return n;
  }
  /** Size of everything when all is downloaded (from the index). */
  const totalBytes = () => ((state.index && state.index.items) || []).flatMap((i) => [i.file, i.template].filter(Boolean)).reduce((a, r) => a + (r.size || 0), 0);
  async function missing() {
    const have = new Set(await S().fileNames());
    return ((state.index && state.index.items) || []).filter((i) => blobsOf(i).some((b) => !have.has(b)));
  }
  /** Downloads everything not here yet, one at a time, reporting (done, total). Stops at the first failure. */
  async function downloadAll(onProgress, isCancelled) {
    const todo = await missing();
    onProgress(0, todo.length);
    for (let i = 0; i < todo.length; i++) {
      if (isCancelled && isCancelled()) break;
      await ensure(todo[i].file);
      if (todo[i].template) await ensure(todo[i].template);
      onProgress(i + 1, todo.length);
    }
    await loadCached();
  }

  async function loadSummaries() {
    if (summaries) return summaries;
    try {
      const res = await fetch(new URL(SUMMARIES_URL, document.baseURI).href);
      if (!res.ok) return null;
      const plain = await C().open(await currentKey(), new Uint8Array(await res.arrayBuffer()));
      summaries = JSON.parse(new TextDecoder().decode(plain)).items || null; // only kept when it opened
    } catch (_) { summaries = null; } // wrong key / offline: tried again next time
    return summaries;
  }

  /** Plain text of a downloaded file (docx or PDF). Null when it can't be read (tried again later). */
  async function textOf(name, bytes) {
    try {
      const raw = /\.pdf$/i.test(name) ? await global.AsFormPdf.pdfText(bytes) : await global.AsFormDocx.docxText(bytes);
      return global.AsFormsSearch.squash(raw);
    } catch (_) { return null; }
  }

  let searchToken = 0;
  /**
   * Search across titles and contents. Reads the text of any downloaded item not read yet (once),
   * then matches. A newer search stops an older one (returns null).
   */
  async function find(query) {
    const my = ++searchToken;
    const idx = state.index;
    if (!idx || !String(query || '').trim()) return [];
    const sums = await loadSummaries();
    const texts = {};
    const have = new Set(await S().fileNames());
    for (const it of idx.items) {
      if (my !== searchToken) return null;
      let t = await S().textGet(it.file.blob);
      if (t == null && have.has(it.file.blob)) {
        const plain = await openCached(it.file).catch(() => null);
        if (plain) { t = await textOf(it.file.name, plain); if (t) await S().textPut(it.file.blob, t); } // failures aren't kept
      }
      if (t) texts[it.number] = t;
    }
    if (my !== searchToken) return null;
    return global.AsFormsSearch.search(idx.items, query, (i) => texts[i.number] || null, sums);
  }

  async function toggleFavourite(item) {
    const f = S().favourites();
    if (f.has(item.number)) f.delete(item.number); else f.add(item.number);
    await S().setFavourites(f);
    setState({ favourites: f });
    if (f.has(item.number) && online()) {
      try { await queued(async () => { await download(item.file); if (item.template) await download(item.template); }); } catch (_) { /* later */ }
      await loadCached();
    }
  }

  /** Short, honest message for a failed tap: "Needs internet" only for real connection problems. */
  function errorMessage(e) {
    if (!e) return "Couldn't download";
    if (e.name === 'Offline') return 'Needs internet';
    if (e.name === 'WrongCode') return 'Access code has changed';
    if (e.name === 'BadFile') return 'Download damaged - try again';
    return "Couldn't download: " + (e.message || e.name);
  }

  global.AsFormsLibrary = {
    base, getState: () => state, onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    loadCached, setCode, clearCode, refresh, original, template, ready, checkProblem, fillIn, downloadForms, policies,
    deleteDownload, deleteAllDownloads, downloadedBytes, totalBytes, missing, downloadAll, find, toggleFavourite, errorMessage,
    openCached, Offline,
    _reset() { lib = null; summaries = null; markerCache.clear(); state = Object.assign({}, state, { hasCode: false, index: null, specs: {} }); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
