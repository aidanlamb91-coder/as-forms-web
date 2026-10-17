/*
 * AS Forms web — personal details lock (1.2.2-web). The parts with no screens, so they can be tested.
 *
 * What "personal details" means here: HR details, signatures and filled-in forms (drafts).
 * Timesheets, expenses, receipts and mileage are NOT part of it and work exactly as before.
 *
 * How the lock works
 *  - One random "data key" encrypts the personal details in IndexedDB (AES-256-GCM).
 *  - The data key itself is stored only wrapped (encrypted) by a "lock key":
 *      passkey:    a passkey on this device (fingerprint, Face ID or device PIN) with the WebAuthn
 *                  PRF extension, which gives back the same secret every time you unlock;
 *      passphrase: when the browser can't do PRF, an app passphrase stretched with PBKDF2.
 *  - Optionally the data key is ALSO wrapped by a recovery key (24 letters/digits) so the
 *    personal details in a backup can be opened on a new device.
 *  - Unlocking puts the data key in memory for this session only; "Lock now" or closing the app
 *    forgets it. Nothing here ever stores the passphrase, the recovery key or the passkey secret.
 *
 * If you choose not to lock: personal details stay in memory for the session only, and (with
 * "Remember name only" on, the default) just your name is kept.
 *
 * Settings live in localStorage under the scoped key "as-forms-lock" (see js/app-scope.js), so
 * the beta and the main site each have their own lock.
 */
(function (global) {
  const KEY = global.AsScope ? global.AsScope.key('as-forms-lock') : 'as-forms-lock';
  const MIN_PASS = 10;           // shortest app passphrase allowed
  const PASS_ITER = 600000;      // PBKDF2-SHA256 rounds for an app passphrase
  const RECOVERY_ITER = 210000;  // the recovery key is long and random; this is just extra margin
  const RK_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
  const INFO = new TextEncoder().encode('AS Forms personal lock v1');
  const subtle = () => global.crypto.subtle;
  const listeners = new Set();

  class WrongKey extends Error { constructor(m) { super(m || 'Wrong key'); this.name = 'WrongKey'; } }
  class NoPrf extends Error { constructor() { super("This browser can't lock with a passkey"); this.name = 'NoPrf'; } }

  // ——— small helpers ———
  const rand = (n) => global.crypto.getRandomValues(new Uint8Array(n));
  function b64(u8) { let s = ''; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { const t = atob(s || ''); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
  const b64url = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (s) => unb64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));

  // ——— saved lock settings (no secrets in here: only wrapped keys, salts and ids) ———
  function load() { try { return JSON.parse(global.localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } }
  let cfg = load();
  function save(patch) {
    cfg = Object.assign({}, cfg, patch);
    for (const k of Object.keys(cfg)) if (cfg[k] === undefined) delete cfg[k];
    try { global.localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) { /* private mode */ }
  }
  function emit(kind) { for (const fn of listeners) { try { fn(kind); } catch (e) { console.error(e); } } }

  // ——— session (memory only) ———
  let dataKey = null;   // CryptoKey for sealing personal details (non-extractable)
  let dataRaw = null;   // its raw bytes, kept only while unlocked so it can be re-wrapped
  let sessionName = '';

  // ——— crypto building blocks ———
  const importDataKey = (raw) => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  async function wrap(kek, raw) { const iv = rand(12); return { iv: b64(iv), ct: b64(await subtle().encrypt({ name: 'AES-GCM', iv }, kek, raw)) }; }
  async function unwrap(kek, w) {
    try { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, kek, unb64(w.ct))); } catch (_) { throw new WrongKey(); }
  }
  async function kekFromPrf(secret, salt) {
    const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function kekFromText(text, salt, iterations) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // ——— recovery key: 24 characters, shown as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (120 bits) ———
  function newRecoveryKey() {
    const r = rand(24);
    const chars = Array.from(r, (b) => RK_ALPHABET[b & 31]).join('');
    return chars.match(/.{4}/g).join('-');
  }
  /** Tidies what was typed or pasted: case, spaces and dashes don't matter; O→0, I/L→1. */
  function tidyRecoveryKey(s) {
    const t = String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return t.length === 24 && [...t].every((c) => RK_ALPHABET.includes(c)) ? t : null;
  }
  async function recoveryRecord(rk, raw) {
    const salt = rand(16);
    const kek = await kekFromText(tidyRecoveryKey(rk), salt, RECOVERY_ITER);
    return Object.assign({ salt: b64(salt), iterations: RECOVERY_ITER }, await wrap(kek, raw));
  }
  /** Opens a recovery record (from this device or a backup) → the data key's raw bytes. */
  async function openRecovery(rec, rk) {
    const t = tidyRecoveryKey(rk);
    if (!t || !rec) throw new WrongKey('Not a recovery key');
    return unwrap(await kekFromText(t, unb64(rec.salt), rec.iterations || RECOVERY_ITER), rec);
  }

  // ——— passkeys (WebAuthn, platform authenticator, user verification required, PRF) ———
  async function passkeyAvailable() {
    try { return !!(global.PublicKeyCredential && await global.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (_) { return false; }
  }
  const scopeLabel = () => (global.AsScope && global.AsScope.scope ? ' (' + global.AsScope.scope + ')' : '');
  /** Makes a passkey and returns the PRF secret it gives (throws NoPrf when the browser has none). */
  async function createPasskey() {
    const prfSalt = rand(32);
    const cred = await global.navigator.credentials.create({ publicKey: {
      challenge: rand(32),
      rp: { name: 'AS Forms' },
      user: { id: rand(16), name: 'AS Forms personal details' + scopeLabel(), displayName: 'AS Forms personal details' + scopeLabel() },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 120000,
      extensions: { prf: { eval: { first: prfSalt } } },
    } });
    const ext = (cred.getClientExtensionResults && cred.getClientExtensionResults()) || {};
    const credId = b64url(new Uint8Array(cred.rawId));
    if (!ext.prf || ext.prf.enabled === false) throw new NoPrf();
    // Some browsers give the secret straight away; others only when you use the passkey.
    let secret = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
    if (!secret) secret = await passkeySecret(credId, b64(prfSalt));
    return { credId, prfSalt: b64(prfSalt), secret };
  }
  /** Uses the passkey (fingerprint / face / PIN) and returns its PRF secret. */
  async function passkeySecret(credId, prfSaltB64) {
    const a = await global.navigator.credentials.get({ publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: unb64url(credId), transports: ['internal', 'hybrid'] }],
      userVerification: 'required',
      timeout: 120000,
      extensions: { prf: { eval: { first: unb64(prfSaltB64) } } },
    } });
    const ext = (a.getClientExtensionResults && a.getClientExtensionResults()) || {};
    if (!ext.prf || !ext.prf.results || !ext.prf.results.first) throw new NoPrf();
    return new Uint8Array(ext.prf.results.first);
  }

  // ——— turning the lock on / changing it ———
  async function useDataKey(raw) { dataRaw = new Uint8Array(raw); dataKey = await importDataKey(dataRaw); }
  /** The data key to lock: the one already open (unlocked, or from a restored backup) or a new one. */
  const currentOrNewRaw = () => dataRaw || rand(32);
  async function setPasskey() {
    const raw = currentOrNewRaw();
    const p = await createPasskey();
    const kek = await kekFromPrf(p.secret, unb64(p.prfSalt));
    save({ mode: 'lock', method: 'passkey', credId: p.credId, prfSalt: p.prfSalt, wrapped: await wrap(kek, raw), ppSalt: undefined, ppIter: undefined, asked: true });
    await useDataKey(raw);
    emit('lock-on');
  }
  async function setPassphrase(pp) {
    if (String(pp || '').length < MIN_PASS) throw new Error('Use at least ' + MIN_PASS + ' characters');
    const raw = currentOrNewRaw();
    const salt = rand(16);
    const kek = await kekFromText(pp, salt, PASS_ITER);
    save({ mode: 'lock', method: 'passphrase', ppSalt: b64(salt), ppIter: PASS_ITER, wrapped: await wrap(kek, raw), credId: undefined, prfSalt: undefined, asked: true });
    await useDataKey(raw);
    emit('lock-on');
  }
  async function unlockPasskey() {
    if (cfg.mode !== 'lock' || cfg.method !== 'passkey') throw new Error('No passkey lock');
    const secret = await passkeySecret(cfg.credId, cfg.prfSalt);
    await useDataKey(await unwrap(await kekFromPrf(secret, unb64(cfg.prfSalt)), cfg.wrapped));
    emit('unlock');
  }
  async function unlockPassphrase(pp) {
    if (cfg.mode !== 'lock' || cfg.method !== 'passphrase') throw new Error('No passphrase lock');
    const raw = await unwrap(await kekFromText(pp, unb64(cfg.ppSalt), cfg.ppIter || PASS_ITER), cfg.wrapped);
    await useDataKey(raw);
    emit('unlock');
  }
  /** Forgot the passkey / passphrase: open with the recovery key instead (then the lock is set again). */
  async function unlockRecovery(rk) {
    if (cfg.mode !== 'lock' || !cfg.recovery) throw new WrongKey('No recovery key');
    await useDataKey(await openRecovery(cfg.recovery, rk));
    emit('unlock');
  }
  function lockNow() { if (!dataKey) return; dataKey = null; dataRaw = null; emit('lock'); }
  /** Clear data on this device: drop the open key, the session name and the saved lock settings. */
  function forget() {
    dataKey = null; dataRaw = null; sessionName = ''; pendingRecovery = null;
    try { global.localStorage.removeItem(KEY); } catch (_) { /* ignore */ }
    cfg = {};
    emit('lock');
  }
  /** Rough passphrase strength for the hint under the box (not a rule beyond MIN_PASS). */
  function passStrength(pp) {
    const s = String(pp || '');
    if (s.length < MIN_PASS) return { ok: false, label: 'At least ' + MIN_PASS + ' characters' };
    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;
    const score = (s.length >= 14) + (s.length >= 20) + (kinds >= 2) + (kinds >= 3) + (/\s/.test(s.trim()) ? 1 : 0);
    return { ok: true, label: score >= 3 ? 'Strong' : score >= 2 ? 'OK' : 'Weak: add words or numbers' };
  }
  /** New recovery key (needs the lock open). Returns the key to show the user ONCE. */
  async function newRecovery() {
    if (!dataRaw) throw new Error('Unlock first');
    const rk = newRecoveryKey();
    save({ recovery: await recoveryRecord(rk, dataRaw) });
    emit('recovery');
    return rk;
  }
  /** Turn the lock off: personal details are kept for this session only from now on. */
  function removeLock() {
    save({ mode: 'off', method: undefined, credId: undefined, prfSalt: undefined, ppSalt: undefined, ppIter: undefined, wrapped: undefined, recovery: undefined, asked: true });
    dataKey = null; dataRaw = null;
    emit('lock-off');
  }
  /** "No thanks" to the lock. */
  function decline(rememberName, noAsk) {
    save({ mode: 'off', rememberName: rememberName !== false, asked: true, noAsk: !!noAsk });
    emit('declined');
  }
  /** A backup's personal details opened with its recovery key: use that data key on this device,
   *  and keep the backup's recovery record so the same recovery key keeps working. */
  async function adoptFromBackup(raw, rec) {
    await useDataKey(raw);
    pendingRecovery = rec; // saved once the lock is set on this device (takePendingRecovery)
    emit('adopted');
  }
  let pendingRecovery = null;
  function takePendingRecovery() { const r = pendingRecovery; pendingRecovery = null; if (r && cfg.mode === 'lock' && !cfg.recovery) save({ recovery: r }); return r; }

  // ——— name ———
  const rememberName = () => cfg.mode === 'lock' || cfg.rememberName !== false;
  function setRememberName(on) { save({ rememberName: !!on }); emit('name'); }

  global.AsLock = {
    // state
    mode: () => cfg.mode || null, method: () => cfg.method || null, isUnlocked: () => !!dataKey, key: () => dataKey,
    noAsk: () => !!cfg.noAsk, setNoAsk: (on) => save({ noAsk: !!on }),
    hasRecovery: () => !!cfg.recovery, recoveryRecord: () => cfg.recovery || null, asked: () => !!cfg.asked,
    rememberName, setRememberName, sessionName: () => sessionName, setSessionName: (n) => { sessionName = String(n || '').trim(); emit('name'); },
    // actions
    passkeyAvailable, setPasskey, setPassphrase, unlockPasskey, unlockPassphrase, lockNow, unlockRecovery, forget, passStrength, newRecovery, removeLock, decline,
    openRecovery, adoptFromBackup, takePendingRecovery,
    // helpers (tests, backup)
    newRecoveryKey, tidyRecoveryKey, makeRecoveryRecord: recoveryRecord, b64, unb64, importDataKey, kekFromText, wrap, unwrap,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    reload: () => { cfg = load(); },
    WrongKey, NoPrf, MIN_PASS, PASS_ITER, RECOVERY_ITER, KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
