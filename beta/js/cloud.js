/**
 * 1.1.0-web — Google Drive / OneDrive sync for the browser (port of Android sync/*).
 *
 * WHAT IS SYNCED
 *   One file: AS-Forms-backup.zip (exactly the same format as Android, js/backup-format.js),
 *   plus the yearly AS-Forms-YYYY.zip receipt archives, in the same folder Android uses:
 *     Google Drive: a visible "AS Forms" folder in My Drive (scope drive.file = the app can only
 *                   see files it made itself).
 *     OneDrive:     Apps / <app name> / AS Forms (the app's own folder, "approot").
 *   Because the file names and folders match Android, the phone and the browser share data.
 *
 * WHEN
 *   When the app opens and shortly after a change (browsers can't sync in the background),
 *   plus "Sync now" and tapping the cloud icon. Sync always pushes this browser's data up;
 *   pulling the cloud copy down ("Replace with cloud") is always the user's choice.
 *
 * SIGN-IN (no client secret anywhere)
 *   OneDrive: authorization code + PKCE (Azure "Single-page application" platform). Gives a
 *             refresh token, so renewal follows Android's rules exactly (js/token-refresh.js).
 *   Google:   Google does not allow PKCE without a client secret for website clients, and a
 *             secret can't be kept secret on a public website. So Google uses its browser
 *             "token" flow: the access token (≈1 hour) is renewed by a quick silent trip to
 *             Google (prompt=none) — 5 minutes early when the app opens with changes waiting,
 *             or once after a 401. If Google says the sign-in is gone, we show "Sign in again".
 *   Sign-in uses a full-page redirect and comes back to this same page (works in an installed
 *   app better than pop-ups).
 */
(function (global) {
  const TR = () => global.AsTokenRefresh;
  const CFG = () => global.AsCloudConfig;
  // 1.2.1-web: names are scoped per copy (main site / beta) — see js/app-scope.js
  const scoped = (n) => (globalThis.AsScope ? globalThis.AsScope.key(n) : n);
  const STATE_KEY = scoped('as-forms-cloud');
  const PENDING_KEY = scoped('as-forms-oauth-pending');
  const FOLDER_NAME = 'AS Forms';
  const CLOUD_ZIP_NAME = 'AS-Forms-backup.zip';
  const ARCHIVE_RE = /^AS-Forms-(\d{4})\.zip$/;
  const DEBOUNCE_MS = 30000;
  const SILENT_RENEW_GAP_MS = 30 * 60 * 1000;

  const KINDS = {
    google: { label: 'Google Drive', icon: 'img/ic_google_drive.png' },
    onedrive: { label: 'OneDrive', icon: 'img/ic_onedrive.png' },
  };
  const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
  const ONEDRIVE_SCOPES = 'Files.ReadWrite Files.ReadWrite.AppFolder User.Read offline_access openid profile';
  const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';

  // ——— Saved state (localStorage) ———
  function load() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null') || {}; } catch (_) { return {}; }
  }
  function save(patch) {
    const next = { ...load(), ...patch };
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    emit();
    return next;
  }
  const listeners = new Set();
  function emit() { listeners.forEach((fn) => { try { fn(status()); } catch (e) { console.error(e); } }); }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /** What the Sync and Backup page shows. */
  function status() {
    const s = load();
    return {
      connected: !!s.kind,
      kind: s.kind || null,
      label: s.kind ? KINDS[s.kind].label : null,
      email: s.email || '',
      folderName: s.folderName || FOLDER_NAME,
      lastSyncAt: s.lastSyncAt || null,
      cloudSize: s.cloudSize ?? s.lastUploadSize ?? null,
      cloudUpdatedAt: s.cloudUpdatedAt || s.lastUploadAt || null,
      needsSignIn: !!s.needsSignIn,
      renewNeeded: !!s.renewNeeded,
      dirty: !!s.dirty,
      busy,
      lastError: s.lastError || null,
    };
  }
  let busy = false;

  // ——— PKCE helpers ———
  function randomString(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a);
  }
  function b64url(bytes) {
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function challengeFor(verifier) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(d));
  }

  // ——— Sign-in (redirect out) ———
  /**
   * Start sign-in. mode 'connect' (first time / Sign in again) or 'renew' (Google silent renew).
   * resume = what to do after coming back ('sync').
   */
  async function startSignIn(kind, mode, resume) {
    if (!CFG().isConfigured(kind)) throw new Error('Cloud sign-in is not set up yet for ' + KINDS[kind].label + '.');
    const state = randomString(16);
    const pending = { kind, state, mode: mode || 'connect', resume: resume || null, at: Date.now() };
    const redirect = CFG().redirectUri();
    let url;
    if (kind === 'google') {
      const p = new URLSearchParams({
        client_id: CFG().config.googleClientId,
        redirect_uri: redirect,
        response_type: 'token',
        scope: GOOGLE_SCOPES,
        include_granted_scopes: 'true',
        state,
      });
      if (mode === 'renew') {
        p.set('prompt', 'none');
        const s = load();
        if (s.email) p.set('login_hint', s.email);
      } else p.set('prompt', 'select_account');
      url = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
    } else {
      pending.verifier = randomString(48);
      const p = new URLSearchParams({
        client_id: CFG().config.oneDriveClientId,
        redirect_uri: redirect,
        response_type: 'code',
        response_mode: 'query',
        scope: ONEDRIVE_SCOPES,
        code_challenge: await challengeFor(pending.verifier),
        code_challenge_method: 'S256',
        state,
        prompt: 'select_account',
      });
      url = MS_AUTH + '/authorize?' + p;
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    global.location.assign(url);
    return new Promise(() => {}); // the page is leaving
  }

  /** Read ?code=… or #access_token=… off the address bar as early as possible (then tidy it). */
  const landed = (function captureRedirect() {
    try {
      const loc = global.location;
      const q = new URLSearchParams(loc.search);
      const h = new URLSearchParams((loc.hash || '').replace(/^#/, ''));
      const src = h.get('access_token') || (h.get('error') && h.get('state')) ? h
        : (q.get('code') || (q.get('error') && q.get('state'))) ? q : null;
      if (!src) return null;
      const out = {};
      src.forEach((v, k) => { out[k] = v; });
      history.replaceState(history.state, '', loc.pathname); // remove the code/token from the address bar
      return out;
    } catch (_) { return null; }
  })();

  async function postForm(url, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    return { status: res.status, body: await res.text() };
  }

  /**
   * Finish a sign-in that just came back to the page. Returns
   *   null (nothing to do) | { kind, mode, resume, cloudHasData, error }.
   */
  async function completeRedirect() {
    if (!landed) return null;
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (_) {}
    localStorage.removeItem(PENDING_KEY);
    if (!pending || pending.state !== landed.state) return { error: 'Sign-in could not be checked — try again.' };
    const kind = pending.kind;
    if (landed.error) {
      if (pending.mode === 'renew') {
        // Google silent renew refused → the user must sign in again
        save({ needsSignIn: true, renewNeeded: false, lastSilentRenewAt: Date.now() });
        return { kind, mode: pending.mode, error: null };
      }
      return { kind, mode: pending.mode, error: landed.error === 'access_denied' ? 'Sign-in cancelled.' : 'Sign-in failed (' + landed.error + ').' };
    }
    const now = Date.now();
    if (kind === 'google') {
      save({
        kind, access: landed.access_token, expiresAt: now + (Number(landed.expires_in) || 3600) * 1000,
        refresh: null, needsSignIn: false, renewNeeded: false, lastSilentRenewAt: now, lastError: null,
      });
    } else {
      const r = await postForm(MS_AUTH + '/token', {
        client_id: CFG().config.oneDriveClientId,
        grant_type: 'authorization_code',
        code: landed.code,
        redirect_uri: CFG().redirectUri(),
        code_verifier: pending.verifier,
        scope: ONEDRIVE_SCOPES,
      });
      let j = {};
      try { j = JSON.parse(r.body); } catch (_) {}
      if (r.status !== 200 || !j.access_token) {
        return { kind, mode: pending.mode, error: 'OneDrive sign-in failed' + (j.error_description ? ': ' + j.error_description.split('\n')[0] : '') };
      }
      save({
        kind, access: j.access_token, refresh: j.refresh_token || null,
        expiresAt: now + (Number(j.expires_in) || 3600) * 1000, needsSignIn: false, renewNeeded: false, lastError: null,
      });
    }
    const p = provider();
    let cloudHasData = null;
    try {
      const email = await p.email();
      const { id, name } = await p.ensureFolder(FOLDER_NAME);
      save({ email, folderId: id, folderName: name });
      if (pending.mode === 'connect' && !load().lastSyncAt) {
        const zip = (await p.list(id)).find((f) => f.name === CLOUD_ZIP_NAME);
        if (zip) cloudHasData = { size: zip.size, modified: zip.modified };
      }
    } catch (e) {
      save({ lastError: friendly(e) });
    }
    return { kind, mode: pending.mode, resume: pending.resume, cloudHasData, error: null };
  }

  // ——— Tokens ———
  class RenewNeeded extends Error { constructor() { super('Tap Sync now to continue'); } }
  /** Whether the current sync was started by a tap (so a Google silent renew may leave the page). */
  let userInitiated = false;

  async function token(force) {
    const s = load();
    const now = Date.now();
    if (!TR().needsRefresh(s.access, s.expiresAt, now, force)) return s.access;
    if (s.kind === 'google') {
      // 1.2.2-web fix: quiet renewal with Google Identity Services first (no page reload).
      try { return await renewGoogle(); } catch (e) {
        if (e instanceof TR().SignInRequired) throw e;
      }
      if (userInitiated) await startSignIn('google', 'renew', 'sync'); // fallback: leaves the page and comes back
      save({ renewNeeded: true });
      throw new RenewNeeded();
    }
    const out = await TR().renew(s.refresh, now, () => postForm(MS_AUTH + '/token', {
      client_id: CFG().config.oneDriveClientId,
      grant_type: 'refresh_token',
      refresh_token: s.refresh,
      scope: ONEDRIVE_SCOPES,
    }));
    if (out.type === 'renewed') {
      save({ access: out.access, refresh: out.refresh, expiresAt: out.expiresAt, needsSignIn: false });
      return out.access;
    }
    if (out.type === 'signInRequired') throw new (TR().SignInRequired)(s.kind);
    throw new Error(out.message);
  }

  /** One HTTP call with the bearer token and the renew-once-on-401 rule. */
  async function api(url, init, as) {
    return TR().withAuthRetry(load().kind, token, async (tok) => {
      const res = await fetch(url, { ...(init || {}), headers: { ...((init && init.headers) || {}), Authorization: 'Bearer ' + tok } });
      if (res.status === 401) throw new (TR().Unauthorized)(await res.text());
      if (!res.ok) {
        const body = await res.text();
        const err = new Error(cloudMessage(res.status, body));
        err.status = res.status;
        throw err;
      }
      if (as === 'raw') return res;
      if (as === 'blob') return res.blob();
      if (res.status === 204) return null;
      const t = await res.text();
      return t ? JSON.parse(t) : null;
    });
  }
  function cloudMessage(status, body) {
    if (status === 507 || /quota|insufficientStorage|storageQuotaExceeded/i.test(body)) return 'Cloud storage is full — free some space, then try Sync again.';
    if (status === 403) return 'The cloud refused access (403). Disconnect and connect again.';
    if (status === 429 || status >= 500) return 'The cloud is busy — try again shortly.';
    return 'Cloud error (HTTP ' + status + ').';
  }

  // ——— Google Drive (drive.file + visible "AS Forms" folder) ———
  const google = {
    async email() {
      const j = await api('https://www.googleapis.com/oauth2/v3/userinfo');
      return (j && j.email) || 'Google account';
    },
    async ensureFolder(name) {
      const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='" + name + "' and trashed=false");
      const found = await api(DRIVE + '/files?q=' + q + '&spaces=drive&fields=files(id,name)&pageSize=25&orderBy=createdTime');
      const files = (found && found.files) || [];
      if (files.length) return { id: files[files.length - 1].id, name };
      // No "parents" → My Drive root (the "root" alias 404s for many drive.file tokens)
      const made = await api(DRIVE + '/files?fields=id,name', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
      });
      return { id: made.id, name };
    },
    async list(folderId) {
      const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
      const j = await api(DRIVE + '/files?q=' + q + '&spaces=drive&fields=files(id,name,size,modifiedTime)&pageSize=200');
      return ((j && j.files) || []).map((f) => ({ id: f.id, name: f.name, size: Number(f.size) || 0, modified: Date.parse(f.modifiedTime) || 0 }));
    },
    read(id) { return api(DRIVE + '/files/' + encodeURIComponent(id) + '?alt=media', null, 'blob'); },
    async write(folderId, name, blob, existingId) {
      // Resumable upload: one call to start (gets an upload address), one PUT with the bytes.
      const start = await api(
        existingId ? DRIVE_UP + '/files/' + encodeURIComponent(existingId) + '?uploadType=resumable&fields=id,size,modifiedTime'
          : DRIVE_UP + '/files?uploadType=resumable&fields=id,size,modifiedTime',
        {
          method: existingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(blob.size) },
          body: JSON.stringify(existingId ? { name } : { name, parents: [folderId], mimeType: 'application/zip' }),
        }, 'raw');
      const where = start.headers.get('Location');
      if (!where) throw new Error('Google Drive did not return an upload address.');
      const res = await fetch(where, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: blob });
      if (!res.ok) throw new Error(cloudMessage(res.status, await res.text()));
      const j = await res.json();
      return { id: j.id, size: Number(j.size) || blob.size, modified: Date.parse(j.modifiedTime) || Date.now() };
    },
    async remove(id) { await api(DRIVE + '/files/' + encodeURIComponent(id), { method: 'DELETE' }); },
  };

  // ——— OneDrive (Graph, app folder) ———
  const onedrive = {
    async email() {
      const j = await api(GRAPH + '/me?$select=mail,userPrincipalName');
      return (j && (j.mail || j.userPrincipalName)) || 'OneDrive account';
    },
    async ensureFolder(name) {
      const root = await api(GRAPH + '/me/drive/special/approot?$select=id,name');
      const kids = await api(GRAPH + '/me/drive/items/' + root.id + '/children?$select=id,name,folder&$top=200');
      const hit = ((kids && kids.value) || []).find((f) => f.folder && f.name === name);
      if (hit) return { id: hit.id, name };
      try {
        const made = await api(GRAPH + '/me/drive/items/' + root.id + '/children', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
        });
        return { id: made.id, name };
      } catch (e) {
        if (e.status === 409) return onedrive.ensureFolder(name);
        throw e;
      }
    },
    async list(folderId) {
      const j = await api(GRAPH + '/me/drive/items/' + folderId + '/children?$select=id,name,size,lastModifiedDateTime,file&$top=200');
      return ((j && j.value) || []).filter((f) => f.file).map((f) => ({ id: f.id, name: f.name, size: f.size || 0, modified: Date.parse(f.lastModifiedDateTime) || 0 }));
    },
    async read(id) {
      // Browsers: use the pre-signed download address (the /content redirect trips CORS)
      const meta = await api(GRAPH + '/me/drive/items/' + id + '?$select=id,@microsoft.graph.downloadUrl');
      const res = await fetch(meta['@microsoft.graph.downloadUrl']);
      if (!res.ok) throw new Error(cloudMessage(res.status, ''));
      return res.blob();
    },
    async write(folderId, name, blob) {
      const path = GRAPH + '/me/drive/items/' + folderId + ':/' + encodeURIComponent(name) + ':';
      if (blob.size <= 4 * 1024 * 1024) {
        const j = await api(path + '/content', { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: blob });
        return { id: j.id, size: j.size || blob.size, modified: Date.parse(j.lastModifiedDateTime) || Date.now() };
      }
      // Bigger than 4 MB: an upload session, sent in 5 MB pieces (multiples of 320 KiB)
      const sess = await api(path + '/createUploadSession', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
      });
      const CHUNK = 320 * 1024 * 16;
      let last = null;
      for (let off = 0; off < blob.size; off += CHUNK) {
        const end = Math.min(off + CHUNK, blob.size);
        const res = await fetch(sess.uploadUrl, { // no Authorization header on the session address
          method: 'PUT',
          headers: { 'Content-Range': 'bytes ' + off + '-' + (end - 1) + '/' + blob.size },
          body: blob.slice(off, end),
        });
        if (!res.ok && res.status !== 202) throw new Error(cloudMessage(res.status, await res.text()));
        last = res;
      }
      const j = last && (last.status === 200 || last.status === 201) ? await last.json() : {};
      return { id: j.id, size: j.size || blob.size, modified: Date.parse(j.lastModifiedDateTime) || Date.now() };
    },
    async remove(id) { await api(GRAPH + '/me/drive/items/' + id, { method: 'DELETE' }); },
  };

  function provider() { return load().kind === 'onedrive' ? onedrive : google; }

  function friendly(e) {
    if (e instanceof TR().SignInRequired) return KINDS[load().kind || 'google'].label + ' sign-in has expired.';
    if (e instanceof RenewNeeded) return 'Tap Sync now to continue.';
    if (e instanceof TypeError || !navigator.onLine) return "You're offline — will sync when back online.";
    return (e && e.message) || String(e);
  }

  async function folderId() {
    const s = load();
    if (s.folderId) return s.folderId;
    const f = await provider().ensureFolder(FOLDER_NAME);
    save({ folderId: f.id, folderName: f.name });
    return f.id;
  }

  // ——— Google quiet renewal (Google Identity Services token client) ———
  // No refresh token and no secret: Google hands a new ~1-hour token while the user is still
  // signed in to Google in this browser and has already given consent (prompt:'').
  // Errors that mean "Google needs the user" → Reconnect. Anything else (pop-up blocked, offline,
  // closed) → keep quiet and try again later / on the next tap.
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const GIS_NEEDS_USER = ['interaction_required', 'login_required', 'consent_required', 'access_denied', 'invalid_grant'];
  let gisLoading = null;
  let googleRenewing = null;
  let renewTimer = null;
  function loadGis() {
    if (global.google && global.google.accounts && global.google.accounts.oauth2) return Promise.resolve();
    if (!gisLoading) {
      gisLoading = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = GIS_SRC; el.async = true;
        el.onload = () => resolve();
        el.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in')); };
        document.head.appendChild(el);
      });
    }
    return gisLoading;
  }
  function renewGoogle() {
    if (googleRenewing) return googleRenewing;
    googleRenewing = (async () => {
      await loadGis();
      const s = load();
      const r = await new Promise((resolve) => {
        const tc = global.google.accounts.oauth2.initTokenClient({
          client_id: CFG().config.googleClientId,
          scope: GOOGLE_SCOPES,
          prompt: '',
          login_hint: s.email || undefined,
          include_granted_scopes: true,
          callback: (resp) => resolve(resp || {}),
          error_callback: (err) => resolve({ error: (err && err.type) || 'unknown' }),
        });
        tc.requestAccessToken();
      });
      if (r.access_token) {
        const now = Date.now();
        save({ access: r.access_token, expiresAt: now + (Number(r.expires_in) || 3600) * 1000, needsSignIn: false, renewNeeded: false, lastSilentRenewAt: now });
        scheduleGoogleRenew();
        return r.access_token;
      }
      if (GIS_NEEDS_USER.includes(String(r.error))) {
        save({ needsSignIn: true });
        throw new (TR().SignInRequired)('google');
      }
      throw new Error('Google renewal did not finish (' + r.error + ')');
    })();
    googleRenewing.then(() => { googleRenewing = null; }, () => { googleRenewing = null; });
    return googleRenewing;
  }
  /** Renew 5 minutes before the Google token runs out. */
  function scheduleGoogleRenew() {
    clearTimeout(renewTimer);
    const s = load();
    if (s.kind !== 'google' || s.needsSignIn || !s.expiresAt) return;
    const wait = Math.max(0, s.expiresAt - TR().EARLY_MS - Date.now());
    renewTimer = setTimeout(() => { quietGoogleRenew(); }, wait);
  }
  /** Timer / app back in view: renew if due. Never throws; Reconnect shows only if Google needs the user. */
  function quietGoogleRenew() {
    const s = load();
    if (s.kind !== 'google' || s.needsSignIn || !navigator.onLine) return Promise.resolve();
    if (!TR().needsRefresh(s.access, s.expiresAt, Date.now())) { scheduleGoogleRenew(); return Promise.resolve(); }
    return renewGoogle().catch(() => {});
  }

  // ——— Sync ———
  /**
   * Push this browser's data to AS-Forms-backup.zip. manual = the user tapped (Sync now / cloud
   * icon): uploads even with no changes, and lets Google do its quick renew trip.
   */
  async function syncNow(opts) {
    const manual = !!(opts && opts.manual);
    const s = load();
    if (!s.kind || busy) return { skipped: true };
    if (s.needsSignIn) return { error: friendly(new (TR().SignInRequired)(s.kind)), signIn: true };
    if (!manual && !s.dirty && s.lastSyncAt) return { skipped: true };
    if (!navigator.onLine) { save({ lastError: "You're offline — will sync when back online." }); return { offline: true }; }
    busy = true; userInitiated = manual; emit();
    try {
      const fid = await folderId();
      const blob = await global.AsExport.buildBackupZipBlob();
      const p = provider();
      const existing = (await p.list(fid)).find((f) => f.name === CLOUD_ZIP_NAME);
      const out = await p.write(fid, CLOUD_ZIP_NAME, blob, existing && existing.id);
      save({
        dirty: false, lastSyncAt: Date.now(), lastUploadSize: blob.size, lastUploadAt: Date.now(),
        cloudSize: out.size || blob.size, cloudUpdatedAt: out.modified || Date.now(),
        lastError: null, renewNeeded: false,
      });
      if (global.AsArchive) global.AsArchive.scheduleAuto();
      return { ok: true, size: blob.size };
    } catch (e) {
      if (e instanceof TR().SignInRequired) save({ needsSignIn: true });
      const msg = friendly(e);
      save({ lastError: msg });
      return { error: msg, signIn: e instanceof TR().SignInRequired };
    } finally {
      busy = false; userInitiated = false; emit();
    }
  }

  /** "Replace with cloud": download AS-Forms-backup.zip and restore it over this browser's data. */
  async function replaceWithCloud() {
    busy = true; userInitiated = true; emit();
    try {
      const fid = await folderId();
      const p = provider();
      const ref = (await p.list(fid)).find((f) => f.name === CLOUD_ZIP_NAME);
      if (!ref) throw new Error('No ' + CLOUD_ZIP_NAME + ' in the cloud folder yet.');
      const blob = await p.read(ref.id);
      await global.AsExport.importBackupZip(blob);
      save({ dirty: false, lastSyncAt: Date.now(), cloudSize: ref.size, cloudUpdatedAt: ref.modified, lastError: null });
      return { ok: true };
    } catch (e) {
      const msg = friendly(e);
      save({ lastError: msg });
      return { error: msg };
    } finally {
      busy = false; userInitiated = false; emit();
    }
  }

  /** Live size/time of the cloud backup (falls back to what this browser last uploaded). */
  async function refreshCloudInfo() {
    const s = load();
    if (!s.kind || s.needsSignIn || !navigator.onLine) return status();
    try {
      const ref = (await provider().list(await folderId())).find((f) => f.name === CLOUD_ZIP_NAME);
      if (ref) save({ cloudSize: ref.size, cloudUpdatedAt: ref.modified });
    } catch (_) { /* keep the cached numbers */ }
    return status();
  }

  function disconnect() {
    localStorage.removeItem(STATE_KEY);
    emit();
  }

  // Mark "changes waiting" after every save, then sync a little later (debounced).
  let timer = null;
  function scheduleSync(ms) {
    const s = load();
    if (!s.kind) return;
    if (!s.dirty) save({ dirty: true });
    clearTimeout(timer);
    timer = setTimeout(() => syncNow({ manual: false }), ms == null ? DEBOUNCE_MS : ms);
  }

  /**
   * App start: finish a sign-in redirect if there is one, then sync if changes are waiting.
   * For Google, if the token has run out and changes are waiting, do the silent renew trip
   * (at most every 30 minutes, only when online).
   */
  async function boot(hooks) {
    hooks = hooks || {};
    let result = null;
    try { result = await completeRedirect(); } catch (e) { result = { error: friendly(e) }; }
    if (result && hooks.onRedirect) await hooks.onRedirect(result);
    const s = load();
    if (!s.kind || s.needsSignIn) return result;
    if (result && result.resume === 'sync') { await syncNow({ manual: true }); return result; }
    if (result && result.cloudHasData) return result; // the page asks Keep / Replace first
    if (s.kind === 'google' && (s.dirty || !s.lastSyncAt) && navigator.onLine &&
      TR().needsRefresh(s.access, s.expiresAt, Date.now()) &&
      Date.now() - (s.lastSilentRenewAt || 0) > SILENT_RENEW_GAP_MS) {
      let renewed = false;
      try { await renewGoogle(); renewed = true; } catch (e) {
        if (e instanceof TR().SignInRequired) return result;
      }
      if (!renewed) {
        save({ lastSilentRenewAt: Date.now() });
        await startSignIn('google', 'renew', 'sync');
      }
    }
    if (s.dirty || !s.lastSyncAt) syncNow({ manual: false });
    global.addEventListener('online', () => { if (load().dirty) syncNow({ manual: false }); });
    if (s.kind === 'google') {
      scheduleGoogleRenew();
      const back = () => { if (document.visibilityState === 'visible') quietGoogleRenew(); };
      document.addEventListener('visibilitychange', back);
      global.addEventListener('focus', back);
    }
    return result;
  }

  // ——— Yearly archive files in the cloud (used by js/archive.js) ———
  const archives = {
    available() { const s = load(); return !!s.kind && !s.needsSignIn; },
    async list() {
      const files = await provider().list(await folderId());
      return files.filter((f) => ARCHIVE_RE.test(f.name)).map((f) => ({ ...f, year: Number(ARCHIVE_RE.exec(f.name)[1]) }));
    },
    async read(year) {
      const f = (await archives.list()).find((x) => x.year === year);
      return f ? provider().read(f.id) : null;
    },
    /** Upload, then re-list to confirm the file is really there at the right size. */
    async write(year, blob) {
      const name = 'AS-Forms-' + year + '.zip';
      const fid = await folderId();
      const existing = (await provider().list(fid)).find((f) => f.name === name);
      await provider().write(fid, name, blob, existing && existing.id);
      const check = (await provider().list(fid)).find((f) => f.name === name);
      return !!check && (!check.size || check.size === blob.size);
    },
    async remove(year) {
      const f = (await archives.list()).find((x) => x.year === year);
      if (f) await provider().remove(f.id);
    },
  };

  global.AsCloud = {
    KINDS, FOLDER_NAME, CLOUD_ZIP_NAME, status, onChange, startSignIn, completeRedirect, boot,
    syncNow, scheduleSync, replaceWithCloud, refreshCloudInfo, disconnect, archives, friendly,
    _internal: { load, save, token, api, challengeFor, b64url, renewGoogle, quietGoogleRenew },
  };
})(typeof window !== 'undefined' ? window : globalThis);
