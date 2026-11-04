/*
 * AS Forms web — personal details lock screens (1.2.2-web). The logic is in js/lock-core.js.
 *
 *  - "Lock personal details?" the first time Profile opens in a session while no lock is set.
 *    Lock → a passkey (fingerprint / Face ID / device PIN); browsers without the passkey PRF
 *    extension get an app passphrase instead, and are told so.
 *    No thanks → "Personal details won't be saved between sessions." + "Remember name only".
 *  - Unlock once per session (when something needs the personal details), and Lock now.
 *  - Recovery key: made when the lock is turned on (optional); Save to password manager, Copy,
 *    Save as file. Restoring a backup on a new device asks for it.
 *  - Settings → Security: Lock now / Unlock, change or remove the lock, new recovery key,
 *    Remember name only.
 *  - With the name off, exports ask for the name and keep it for this session (ensureName).
 */
(function (global) {
  const A = () => global.AsApp;
  const K = () => global.AsLock;
  const S = () => global.AsFormsStore;
  const St = () => global.AsStorage;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let askedThisSession = false;
  let autoLockMs = 5 * 60 * 1000; // re-lock after this long hidden
  let hiddenTimer = null;
  function autoLock() {
    if (K().mode() !== 'lock' || !K().isUnlocked()) return;
    K().lockNow();
    S().lockChanged('lock').catch(() => {});
    // an open personal screen would still show what was on it: go back to Settings
    const v = [...document.querySelectorAll('.view')].find((x) => !x.classList.contains('hidden'));
    if (v && /^view-(hr|signature|form-home|form-edit)$/.test(v.id)) A().showSettings();
    refresh();
  }

  function sheet(html, onClose) { return A().openSheet('<div class="sheet" role="dialog"><div class="sheet-grip"></div>' + html + '</div>', onClose); }
  /** A sheet that resolves with what was chosen (null when closed / cancelled). */
  function choose(html, wire) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      const sh = sheet(html, () => finish(null));
      wire(sh, (v) => { finish(v); sh.close(); });
    });
  }

  function statusText() {
    if (K().mode() === 'lock') return K().isUnlocked() ? 'Unlocked' : (K().method() === 'passkey' ? 'Locked with passkey' : 'Locked with passphrase');
    return 'Not locked';
  }

  // ——— turning the lock on ———
  /** Asks "Lock personal details?" (Profile, once per session while no lock is set, unless
   *  "Don't ask again" was ticked; and at the first start for 1.2.1 users with saved details). */
  async function askLock() {
    askedThisSession = true;
    const pick = await choose('<h2>Lock personal details?</h2><p class="hint">HR details, signatures and filled forms</p>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-lock-yes">Lock</button><button type="button" class="btn ghost" id="btn-lock-no">No thanks</button></div>',
      (sh, done) => { $('#btn-lock-yes', sh.el).onclick = () => done('yes'); $('#btn-lock-no', sh.el).onclick = () => done('no'); });
    if (pick === 'yes') return setupLock();
    if (pick === 'no') return declineSheet();
    return false;
  }

  /** Sets the lock: passkey when the browser can, otherwise an app passphrase. True when set. */
  async function setupLock(how) {
    let note = null;
    if (how === 'passphrase') note = 'Choose an app passphrase.';
    else if (await K().passkeyAvailable()) {
      try {
        await K().setPasskey();
      } catch (e) {
        if (e && e.name === 'NotAllowedError') { A().toast('Not set'); return false; } // cancelled
        note = e && e.name === 'NoPrf' ? "This browser can't lock with a passkey. Use an app passphrase instead." : "Passkey didn't work. Use an app passphrase instead.";
      }
    } else note = 'No fingerprint, face or PIN lock here. Use an app passphrase instead.';
    if (note) { const ok = await passphraseSet(note); if (!ok) return false; }
    await S().lockChanged('lock-on');
    K().takePendingRecovery(); // a restored backup's recovery key keeps working
    refresh();
    A().toast('Locked');
    if (!K().hasRecovery()) await offerRecovery();
    return true;
  }

  function passphraseSet(note) {
    return choose('<h2>App passphrase</h2><p class="hint" id="pp-note">' + esc(note) + '</p>' +
      '<form id="pp-set-form" autocomplete="on"><input type="text" name="username" autocomplete="username" value="AS Forms passphrase" readonly hidden />' +
      '<label>Passphrase <input type="password" id="pp-new" autocomplete="new-password" /></label>' +
      '<p class="hint" id="pp-strength" aria-live="polite">At least ' + K().MIN_PASS + ' characters</p>' +
      '<label>Again <input type="password" id="pp-new2" autocomplete="new-password" /></label>' +
      '<p class="status error" id="pp-set-error" role="status"></p>' +
      '<div class="sheet-actions"><button type="submit" class="btn primary" id="btn-pp-set">Set</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>',
      (sh, done) => {
        const err = $('#pp-set-error', sh.el);
        sh.el.addEventListener('input', () => { err.textContent = ''; $('#pp-strength', sh.el).textContent = K().passStrength($('#pp-new', sh.el).value).label; });
        $('#pp-set-form', sh.el).addEventListener('submit', async (e) => {
          e.preventDefault();
          const a = $('#pp-new', sh.el).value, b = $('#pp-new2', sh.el).value;
          if (a.length < K().MIN_PASS) { err.textContent = 'At least ' + K().MIN_PASS + ' characters'; return; }
          if (a !== b) { err.textContent = "Doesn't match"; return; }
          $('#btn-pp-set', sh.el).disabled = true; $('#btn-pp-set', sh.el).textContent = 'Setting…';
          try { await K().setPassphrase(a); done(true); } catch (x) { err.textContent = x.message || 'Failed'; $('#btn-pp-set', sh.el).disabled = false; $('#btn-pp-set', sh.el).textContent = 'Set'; }
        });
      });
  }

  /** "No thanks": nothing personal is saved; optionally just the name. */
  async function declineSheet() {
    const keep = await choose('<h2>Don\u2019t lock</h2><p class="hint">Personal details won\u2019t be saved between sessions.</p>' +
      '<label class="toggle-control wide" for="chk-remember-name"><span>Remember name only</span><input type="checkbox" id="chk-remember-name" checked /><span class="switch" aria-hidden="true"></span></label>' +
      '<label class="check-row small" for="chk-no-ask"><input type="checkbox" id="chk-no-ask" /> <span>Don\u2019t ask again</span></label>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-decline-ok">OK</button></div>',
      (sh, done) => { $('#btn-decline-ok', sh.el).onclick = () => done({ name: $('#chk-remember-name', sh.el).checked, noAsk: $('#chk-no-ask', sh.el).checked }); });
    if (keep == null) return false;
    await declineWith(keep.name, keep.noAsk);
    return true;
  }
  /** Declined: personal details move to memory only (1.2.1 copies on disk are deleted). */
  async function declineWith(rememberName, noAsk) {
    const name = St().getSettings().displayName || '';
    K().decline(rememberName, noAsk);
    if (!rememberName) { K().setSessionName(name); St().saveSettings({}); } // removes the stored name
    await S().lockChanged('declined');
    refresh();
  }

  // ——— unlocking ———
  /** Resolves true when personal details can be used now (unlocking first if needed). */
  async function need() {
    if (K().mode() !== 'lock' || K().isUnlocked()) return true;
    return unlockSheet();
  }
  function unlockSheet() {
    const pass = K().method() === 'passphrase';
    return choose('<h2>Personal details are locked</h2>' +
      (pass ? '<form id="pp-unlock-form"><input type="text" name="username" autocomplete="username" value="AS Forms passphrase" readonly hidden />' +
        '<label>Passphrase <input type="password" id="pp-unlock" autocomplete="current-password" /></label>' : '<form id="pp-unlock-form">') +
      '<p class="status error" id="unlock-error" role="status"></p>' +
      '<div class="sheet-actions"><button type="submit" class="btn primary" id="btn-unlock">Unlock</button>' +
      (K().hasRecovery() ? '<button type="button" class="btn secondary" id="btn-unlock-rk">Use recovery key</button>' : '') +
      '<button type="button" class="btn ghost" data-close>Not now</button></div>' +
      '<p class="hint"><button type="button" class="link-btn" id="btn-unlock-reset">Forgot? Reset personal details</button></p></form>',
      (sh, done) => {
        const err = $('#unlock-error', sh.el);
        const rkBtn = $('#btn-unlock-rk', sh.el);
        if (rkBtn) rkBtn.onclick = () => done('recovery');
        $('#btn-unlock-reset', sh.el).onclick = () => done('reset');
        const failed = (pass ? "Couldn't unlock. Try again" : "Couldn't unlock. Try again") + (K().hasRecovery() ? ' or use the recovery key.' : '.');
        sh.el.addEventListener('input', () => { err.textContent = ''; });
        $('#pp-unlock-form', sh.el).addEventListener('submit', async (e) => {
          e.preventDefault();
          const b = $('#btn-unlock', sh.el); b.disabled = true;
          try {
            if (pass) await K().unlockPassphrase($('#pp-unlock', sh.el).value); else await K().unlockPasskey();
            await S().lockChanged('unlock');
            refresh();
            done(true);
          } catch (x) {
            b.disabled = false;
            err.textContent = x && x.name === 'WrongKey' && pass ? 'Wrong passphrase' : x && x.name === 'NotAllowedError' ? 'Cancelled' : failed;
          }
        });
      }).then((v) => (v === 'recovery' ? recoveryUnlock() : v === 'reset' ? resetPersonal() : !!v));
  }
  /** Forgot the passkey / passphrase: unlock with the saved recovery key, then set the lock again. */
  async function recoveryUnlock() {
    const ok = await choose('<h2>Use recovery key</h2>' +
      '<form id="rk-unlock-form" autocomplete="on"><input type="text" name="username" autocomplete="username" value="AS Forms recovery key" readonly class="rk-hidden" tabindex="-1" aria-hidden="true" />' +
      '<label>Recovery key <input type="password" name="password" id="rk-unlock" autocomplete="current-password" autocapitalize="characters" spellcheck="false" /></label>' +
      '<p class="status error" id="rk-unlock-error" role="status"></p>' +
      '<div class="sheet-actions"><button type="submit" class="btn primary" id="btn-rk-unlock">Unlock</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>',
      (sh, done) => {
        const err = $('#rk-unlock-error', sh.el);
        sh.el.addEventListener('input', () => { err.textContent = ''; });
        $('#rk-unlock-form', sh.el).addEventListener('submit', async (e) => {
          e.preventDefault();
          const b = $('#btn-rk-unlock', sh.el); b.disabled = true; b.textContent = 'Checking…';
          try { await K().unlockRecovery($('#rk-unlock', sh.el).value); done(true); } catch (_) { err.textContent = 'Wrong recovery key'; b.disabled = false; b.textContent = 'Unlock'; }
        });
      });
    if (!ok) return false;
    await S().lockChanged('unlock');
    refresh();
    // reset the lock: a new passkey (or passphrase) for the same personal details
    const again = await choose('<h2>Set the lock again</h2><p class="hint">Unlocked. Set a new passkey or passphrase.</p>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-relock">Lock</button><button type="button" class="btn ghost" data-close>Not now</button></div>',
      (sh, done) => { $('#btn-relock', sh.el).onclick = () => done(true); });
    if (again) await setupLock();
    return true;
  }
  /** Forgot everything: delete the locked personal details on this device and start again. */
  async function resetPersonal() {
    const ok = await choose('<h2>Reset personal details?</h2><p class="hint">Deletes HR details, signatures and filled forms on this device. Claims, timesheets and receipts stay.</p>' +
      '<div class="sheet-actions"><button type="button" class="btn danger" id="btn-reset-yes">Reset</button><button type="button" class="btn ghost" data-close>Cancel</button></div>',
      (sh, done) => { $('#btn-reset-yes', sh.el).onclick = () => done(true); });
    if (!ok) return false;
    K().removeLock();
    await S().lockChanged('lock-off');
    refresh();
    A().toast('Personal details reset');
    await askLock();
    return K().mode() !== 'lock' || K().isUnlocked();
  }
  async function lockNow() { K().lockNow(); await S().lockChanged('lock'); refresh(); A().toast('Locked'); }

  // ——— recovery key ———
  async function offerRecovery() {
    const pick = await choose('<h2>Create a recovery key?</h2><p class="hint">Needed to restore personal details from a backup on a new device.</p>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-rk-create">Create</button><button type="button" class="btn ghost" id="btn-rk-skip">Skip</button></div>',
      (sh, done) => { $('#btn-rk-create', sh.el).onclick = () => done(true); $('#btn-rk-skip', sh.el).onclick = () => done(false); });
    if (pick) await createRecovery();
  }
  async function createRecovery() {
    if (!(await need())) return;
    const rk = await K().newRecovery();
    refresh();
    await showRecovery(rk);
  }
  /** Offers the key to the browser's password manager; true only when reading it back confirms the
   *  save (store() itself resolves whether or not the person tapped Save). */
  async function savedToPasswordManager(rk) {
    if (!global.PasswordCredential || !navigator.credentials || !navigator.credentials.store) return false;
    try {
      await navigator.credentials.store(new global.PasswordCredential({ id: 'AS Forms recovery key', password: rk, name: 'AS Forms recovery key' }));
      const c = await navigator.credentials.get({ password: true, mediation: 'silent' });
      return !!(c && c.id === 'AS Forms recovery key' && c.password === rk);
    } catch (_) { return false; }
  }
  /** Shows a new recovery key ONCE, with the ways to keep it. */
  function showRecovery(rk) {
    return choose('<h2>Recovery key</h2><p class="hint">Keep it safe. Shown once.</p><p class="rk-text" id="rk-text">' + esc(rk) + '</p>' +
      // a real login form, so Chrome / iCloud Keychain offer to save it as a password
      '<form id="rk-form" autocomplete="on"><input type="text" name="username" id="rk-user" autocomplete="username" value="AS Forms recovery key" readonly class="rk-hidden" tabindex="-1" aria-hidden="true" />' +
      '<input type="password" name="password" id="rk-pass" autocomplete="new-password" value="' + esc(rk) + '" readonly class="rk-hidden" tabindex="-1" aria-hidden="true" />' +
      '<div class="sheet-actions"><button type="submit" class="btn primary" id="btn-rk-save">Save to password manager</button>' +
      '<button type="button" class="btn secondary" id="btn-rk-copy">Copy</button><button type="button" class="btn secondary" id="btn-rk-file">Save as file</button>' +
      '<button type="button" class="btn ghost" id="btn-rk-done">Done</button></div></form>',
      (sh, done) => {
        $('#rk-form', sh.el).addEventListener('submit', async (e) => {
          e.preventDefault();
          A().toast((await savedToPasswordManager(rk)) ? 'Saved' : 'No prompt? Use Copy or Save as file.');
        });
        $('#btn-rk-copy', sh.el).onclick = async () => {
          try { await navigator.clipboard.writeText(rk); A().toast('Copied'); } catch (_) { A().toast("Couldn't copy"); }
        };
        $('#btn-rk-file', sh.el).onclick = () => {
          global.AsExport.downloadBlob(new Blob(['AS Forms recovery key\n' + rk + '\n'], { type: 'text/plain' }), 'AS-Forms-recovery-key.txt');
          A().toast('Saved AS-Forms-recovery-key.txt');
        };
        $('#btn-rk-done', sh.el).onclick = () => done(true);
      });
  }

  // ——— restoring a backup's personal details ———
  /** Called after a backup zip is restored, when it has a personal.json. */
  async function offerRestore(part) {
    if (!part || !part.recovery) return false;
    const own = K().recoveryRecord();
    if (K().mode() === 'lock' && own && own.ct === part.recovery.ct) {
      // this device's own backup: same data key, no recovery key needed
      if (!(await need())) return false;
      await S().applyPersonal(await S().openPersonal(part, K().key()));
      return true;
    }
    const raw = await choose('<h2>Restore personal details</h2><p class="hint">Enter your recovery key.</p>' +
      '<form id="rk-restore-form" autocomplete="on"><input type="text" name="username" autocomplete="username" value="AS Forms recovery key" readonly class="rk-hidden" tabindex="-1" aria-hidden="true" />' +
      '<label>Recovery key <input type="password" name="password" id="rk-restore" autocomplete="current-password" autocapitalize="characters" spellcheck="false" /></label>' +
      '<p class="status error" id="rk-restore-error" role="status"></p>' +
      '<div class="sheet-actions"><button type="submit" class="btn primary" id="btn-rk-restore">Restore</button><button type="button" class="btn ghost" id="btn-rk-restore-skip">Skip</button></div></form>',
      (sh, done) => {
        const err = $('#rk-restore-error', sh.el);
        sh.el.addEventListener('input', () => { err.textContent = ''; });
        $('#btn-rk-restore-skip', sh.el).onclick = () => done(null);
        $('#rk-restore-form', sh.el).addEventListener('submit', async (e) => {
          e.preventDefault();
          const b = $('#btn-rk-restore', sh.el); b.disabled = true; b.textContent = 'Checking…';
          try { done(await K().openRecovery(part.recovery, $('#rk-restore', sh.el).value)); } catch (_) { err.textContent = 'Wrong recovery key'; b.disabled = false; b.textContent = 'Restore'; }
        });
      });
    if (!raw) { A().toast('Personal details not restored'); return false; }
    const p = await S().openPersonal(part, raw);
    if (K().mode() === 'lock') {
      if (!(await need())) { A().toast('Personal details not restored'); return false; }
      await S().applyPersonal(p);
      A().toast('Personal details restored');
      return true;
    }
    // new device: use the backup's data key, then set the lock again
    await K().adoptFromBackup(raw, part.recovery);
    await S().applyPersonal(p);
    const again = await choose('<h2>Set the lock again</h2><p class="hint">Fingerprint, face or device PIN.</p>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-relock">Lock</button><button type="button" class="btn ghost" data-close>Not now</button></div>',
      (sh, done) => { $('#btn-relock', sh.el).onclick = () => done(true); });
    if (again && (await setupLock())) { A().toast('Personal details restored'); return true; }
    A().toast('Restored for this session only. Lock to keep them.');
    return true;
  }

  // ——— name for exports when "Remember name only" is off ———
  /** Resolves true when there's a name to put on the export (asking once per session). */
  async function ensureName() {
    if (K().rememberName() || (St().getSettings().displayName || '').trim()) return true;
    const name = await choose('<h2>Your name</h2><p class="hint">For this session only.</p>' +
      '<form id="name-once-form"><label>Name <input type="text" id="name-once" autocomplete="name" maxlength="80" /></label>' +
      '<div class="sheet-actions"><button type="submit" class="btn primary" id="btn-name-once">Continue</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>',
      (sh, done) => {
        $('#name-once-form', sh.el).addEventListener('submit', (e) => { e.preventDefault(); const v = $('#name-once', sh.el).value.trim(); if (v) done(v); });
        setTimeout(() => { const i = $('#name-once', sh.el); if (i) i.focus(); }, 50);
      });
    if (!name) return false;
    K().setSessionName(name);
    return true;
  }

  // ——— Settings → Security ———
  function injectView() {
    const v = document.createElement('div');
    v.innerHTML = `
    <section id="view-security" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-security-back">← Back</button><h1>Security</h1></header>
      <div class="panel">
        <p class="sec-status" id="sec-status"></p>
        <div class="btn-row">
          <button type="button" class="btn primary hidden" id="btn-sec-unlock">Unlock</button>
          <button type="button" class="btn primary hidden" id="btn-sec-lock-now">Lock now</button>
          <button type="button" class="btn primary hidden" id="btn-sec-turn-on">Lock personal details</button>
          <button type="button" class="btn secondary hidden" id="btn-sec-change">Change lock</button>
          <button type="button" class="btn secondary hidden" id="btn-sec-recovery">New recovery key</button>
          <button type="button" class="btn ghost danger hidden" id="btn-sec-remove">Remove lock</button>
        </div>
        <label class="toggle-control wide hidden" for="sec-remember-name" id="sec-name-row"><span>Remember name only</span><input type="checkbox" id="sec-remember-name" /><span class="switch" aria-hidden="true"></span></label>
        <p class="hint" id="sec-hint"></p>
      </div>
    </section>`;
    document.getElementById('app').appendChild(v.firstElementChild);
    A().registerView('security', '#view-security');
  }
  function refresh() {
    const sub = document.getElementById('sb-security-sub');
    if (sub) sub.textContent = statusText();
    const v = document.getElementById('view-security');
    if (!v) return;
    const lock = K().mode() === 'lock', open = K().isUnlocked();
    $('#sec-status').textContent = statusText();
    const show = (id, on) => $(id).classList.toggle('hidden', !on);
    show('#btn-sec-unlock', lock && !open);
    show('#btn-sec-lock-now', lock && open);
    show('#btn-sec-turn-on', !lock);
    show('#btn-sec-change', lock);
    show('#btn-sec-recovery', lock);
    show('#btn-sec-remove', lock);
    show('#sec-name-row', !lock);
    $('#sec-remember-name').checked = K().rememberName();
    $('#sec-hint').textContent = lock ? (K().hasRecovery() ? 'Backups include personal details (recovery key needed).' : 'No recovery key: backups leave out personal details.')
      : 'Personal details are kept for this session only.';
  }
  function showSecurity() { refresh(); A().showView('security'); }

  function wire() {
    injectView();
    $('#btn-security-back').onclick = () => A().showSettings();
    const row = document.getElementById('btn-goto-security');
    if (row) row.onclick = showSecurity;
    $('#btn-sec-unlock').onclick = async () => { await need(); refresh(); };
    $('#btn-sec-lock-now').onclick = lockNow;
    $('#btn-sec-turn-on').onclick = async () => { await setupLock(); refresh(); };
    $('#btn-sec-change').onclick = async () => {
      if (!(await need())) return;
      const pk = await K().passkeyAvailable();
      const how = await choose('<h2>Change lock</h2><div class="sheet-actions change-options">' +
        (pk ? '<button type="button" class="btn primary" id="btn-change-passkey">New passkey</button><p class="hint">Fingerprint, face or device PIN on this device.</p>' : '') +
        '<button type="button" class="btn secondary" id="btn-change-pp">App passphrase</button><p class="hint">A phrase you type. Works in any browser.</p>' +
        '<button type="button" class="btn ghost" data-close>Cancel</button></div>',
        (sh, done) => { const b = $('#btn-change-passkey', sh.el); if (b) b.onclick = () => done('passkey'); $('#btn-change-pp', sh.el).onclick = () => done('passphrase'); });
      if (how && (await setupLock(how))) A().toast('Lock changed');
      refresh();
    };
    $('#btn-sec-recovery').onclick = async () => { await createRecovery(); refresh(); };
    $('#btn-sec-remove').onclick = async () => {
      if (!(await need())) return;
      const ok = await choose('<h2>Remove lock?</h2><p class="hint">Personal details won\u2019t be saved between sessions.</p>' +
        '<div class="sheet-actions"><button type="button" class="btn danger" id="btn-sec-remove-yes">Remove</button><button type="button" class="btn ghost" data-close>Cancel</button></div>',
        (sh, done) => { $('#btn-sec-remove-yes', sh.el).onclick = () => done(true); });
      if (!ok) return;
      K().removeLock();
      await S().lockChanged('lock-off');
      refresh();
      A().toast('Lock removed');
    };
    $('#sec-remember-name').addEventListener('change', async (e) => {
      const on = e.target.checked;
      const name = St().getSettings().displayName || '';
      K().setRememberName(on);
      if (on) St().saveSettings({ displayName: name, namePromptSeen: true }); // keep the session name
      else { K().setSessionName(name); St().saveSettings({}); }
      refresh();
    });
    // Profile: ask once per session while no lock is set
    const prof = document.getElementById('btn-goto-profile');
    if (prof) prof.addEventListener('click', () => { if (K().mode() !== 'lock' && !K().noAsk() && !askedThisSession) setTimeout(askLock, 50); });
    // 1.2.2-web upgrade: Bank & NI saved by 1.2.1 were deleted — say so once
    S().init().then(async () => {
      if (S().bankNotice()) {
        S().clearBankNotice();
        await choose('<p class="hint" id="bank-notice">Saved bank and NI details were deleted. Type them on each form.</p><div class="sheet-actions"><button type="button" class="btn primary" id="btn-bank-ok">OK</button></div>',
          (sh, done) => { $('#btn-bank-ok', sh.el).onclick = () => done(true); });
      }
      // 1.2.1 users with saved HR details, signatures or filled forms: ask at the first start (and
      // every start until they answer), so nobody stays on the old device-key storage
      if (K().mode() == null && S().hasPersonal() && !askedThisSession) await askLock();
    }).catch((e) => console.error(e));
    // Auto-lock: about 5 minutes in the background, or when the page is closed / hidden for good
    document.addEventListener('visibilitychange', () => {
      clearTimeout(hiddenTimer);
      if (document.visibilityState === 'hidden') hiddenTimer = setTimeout(autoLock, autoLockMs);
    });
    global.addEventListener('pagehide', autoLock);
    refresh();
  }
  A().onBoot(wire);

  global.AsLockUi = { setAutoLockMs: (ms) => { autoLockMs = ms; }, autoLock, recoveryUnlock, resetPersonal, askLock, setupLock, declineSheet, declineWith, need, unlockSheet, lockNow, offerRecovery, createRecovery, showRecovery, offerRestore, ensureName, showSecurity, refresh };
})(window);
