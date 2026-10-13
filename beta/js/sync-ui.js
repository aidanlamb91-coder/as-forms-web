/**
 * 1.1.0-web — the Sync and Backup page (layout of Android CloudSettingsScreen 1.1.0) and the
 * glue between saving data and syncing.
 *   Cloud card: Google Drive / OneDrive rows → Connect. Once connected: account, folder,
 *     "Last sync …", "Backup <size>", Sync now, Disconnect (and "Sign in again" when needed).
 *   Archive card: automatic switch, Local / Cloud sizes with Clear to the right of each, Archive now.
 *   Every save fires 'as-data-changed' → sync ~30 s later. Nothing syncs in the background.
 */
(function (global) {
  const A = () => global.AsApp;
  const C = () => global.AsCloud;
  const esc = (s) => A().escapeHtml(s);
  const size = (n) => (n == null ? '—' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  function ago(ms) {
    if (!ms) return 'never';
    const d = new Date(ms);
    const today = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === today.toDateString()) return 'today ' + hm;
    return A().ukDate(global.AsBackupFormat.millisToIso(ms)) + ' ' + hm;
  }

  /** Settings banner subtitle: "Google Drive · synced today 14:02" etc. */
  function refreshSubtitle() {
    const el = document.getElementById('sb-backup-sub');
    const s = C().status();
    const text = !s.connected ? 'Google Drive, OneDrive, backup zip'
      : s.needsSignIn ? s.label + ' · sign in again'
        : s.label + ' · ' + (s.lastSyncAt ? 'synced ' + ago(s.lastSyncAt) : 'not synced yet');
    if (el) el.textContent = text;
    const btn = document.getElementById('top-bar-cloud');
    const dot = document.getElementById('top-bar-cloud-dot');
    if (btn) {
      btn.classList.toggle('hidden', !s.connected);
      btn.classList.toggle('busy', !!s.busy);
      btn.title = s.needsSignIn ? 'Sign in again' : s.dirty ? 'Changes waiting — tap to upload' : 'Up to date';
    }
    if (dot) dot.classList.toggle('hidden', !(s.dirty || s.needsSignIn));
  }

  function renderCloud() {
    const card = document.getElementById('cloud-card');
    if (!card) return;
    const s = C().status();
    if (!s.connected) {
      card.innerHTML = '<p class="hint">Sync with the Android app through your own cloud storage.</p>' +
        Object.entries(C().KINDS).map(([k, v]) => {
          const ok = global.AsCloudConfig.isConfigured(k);
          return '<button type="button" class="provider-row" data-connect="' + k + '"' + (ok ? '' : ' disabled') + '>' +
            '<img src="' + v.icon + '" alt="" width="28" height="28" /><span class="pr-name">' + v.label + '</span>' +
            '<span class="pr-act">' + (ok ? 'Connect' : 'Not set up yet') + '</span></button>';
        }).join('') + '<p class="status" id="cloud-status" role="status"></p>';
      card.querySelectorAll('[data-connect]').forEach((b) => {
        b.onclick = async () => {
          try { await C().startSignIn(b.dataset.connect, 'connect'); } catch (e) { setStatus(C().friendly(e), true); }
        };
      });
      return;
    }
    const k = C().KINDS[s.kind];
    card.innerHTML =
      '<div class="provider-row connected"><img src="' + k.icon + '" alt="" width="28" height="28" />' +
      '<span class="pr-name">' + esc(s.label) + (s.email ? '<small>' + esc(s.email) + '</small>' : '') + '</span></div>' +
      '<p class="kv"><span>Folder</span><span>' + esc(s.folderName) + '</span></p>' +
      '<p class="kv"><span>Last sync</span><span>' + esc(s.busy ? 'syncing…' : ago(s.lastSyncAt)) + '</span></p>' +
      '<p class="kv"><span>Backup</span><span>' + esc(size(s.cloudSize)) + '</span></p>' +
      (s.needsSignIn ? '<p class="status error">Sign-in expired.</p>' : '') +
      '<div class="btn-row">' +
      (s.needsSignIn ? '<button type="button" class="btn primary" id="btn-cloud-signin">Sign in again</button>'
        : '<button type="button" class="btn primary" id="btn-cloud-sync"' + (s.busy ? ' disabled' : '') + '>Sync now</button>') +
      '<button type="button" class="btn ghost" id="btn-cloud-replace">Replace with cloud</button>' +
      '<button type="button" class="btn ghost danger" id="btn-cloud-disconnect">Disconnect</button></div>' +
      '<p class="status' + (s.lastError ? ' error' : '') + '" id="cloud-status" role="status">' + esc(s.lastError || '') + '</p>';
    const q = (id) => card.querySelector(id);
    if (q('#btn-cloud-sync')) q('#btn-cloud-sync').onclick = manualSync;
    if (q('#btn-cloud-signin')) q('#btn-cloud-signin').onclick = () => C().startSignIn(s.kind, 'connect', 'sync').catch((e) => setStatus(C().friendly(e), true));
    q('#btn-cloud-replace').onclick = replace;
    q('#btn-cloud-disconnect').onclick = () => {
      if (!confirm('Disconnect ' + s.label + '? Files in the cloud are kept.')) return;
      C().disconnect();
      render();
    };
  }
  function setStatus(msg, err) {
    const el = document.getElementById('cloud-status');
    if (el) { el.textContent = msg || ''; el.classList.toggle('error', !!err); }
  }

  async function manualSync() {
    const s = C().status();
    if (s.needsSignIn) return C().startSignIn(s.kind, 'connect', 'sync');
    const r = await C().syncNow({ manual: true });
    if (r && r.ok) A().toast('Synced');
    else if (r && r.error) A().toast(r.error);
  }
  async function replace() {
    if (!confirm('Replace everything in this browser with the cloud backup? This browser\'s changes since the last sync are lost.')) return;
    const r = await C().replaceWithCloud();
    if (r.ok) { A().toast('Restored from cloud'); await A().refreshClaimList(); } else A().toast(r.error);
    render();
  }

  // ——— Archive card ———
  async function renderArchive() {
    const $ = A().$;
    if (!$('#archive-card')) return;
    $('#chk-auto-archive').checked = global.AsStorage.getSettings().autoArchive !== false;
    $('#archive-size-local').textContent = '…';
    $('#archive-size-cloud').textContent = '…';
    const sp = await global.AsArchive.space();
    $('#archive-size-local').textContent = sp.local.years.length ? size(sp.local.bytes) + ' · ' + sp.local.years.sort().join(', ') : 'None';
    $('#archive-size-cloud').textContent = !sp.cloud.connected ? 'Not connected' : sp.cloud.years.length ? size(sp.cloud.bytes) + ' · ' + sp.cloud.years.sort().join(', ') : 'None';
    $('#btn-archive-clear-local').disabled = !sp.local.years.length;
    $('#btn-archive-clear-cloud').disabled = !sp.cloud.years.length;
    st.space = sp;
  }
  const st = { space: null };
  async function clearArchive(isLocal) {
    const sp = st.space || await global.AsArchive.space();
    const mine = isLocal ? sp.local.years : sp.cloud.years;
    const other = isLocal ? sp.cloud.years : sp.local.years;
    if (!mine.length) return;
    if (!confirm(global.AsArchive.clearWarning(isLocal, mine, other))) return;
    try { await global.AsArchive.clear(isLocal); A().toast('Cleared'); } catch (e) { A().toast(C().friendly(e)); }
    renderArchive();
  }
  async function archiveNow() {
    const info = A().$('#archive-info');
    info.textContent = 'Archiving…';
    try {
      const r = await global.AsArchive.runPass(true);
      info.textContent = r.archived.length ? 'Archived ' + r.archived.join(', ') + (r.removed ? ' · ' + r.removed + ' images removed' : '') :
        r.errors.length ? r.errors.join(' ') : 'Nothing due yet.';
    } catch (e) { info.textContent = e.message || String(e); }
    renderArchive();
  }

  /** Quiet chip on the Expenses list when due years are waiting and automatic archiving is off. */
  global.AsArchiveBanner = async function (chip) {
    if (!chip) return;
    const off = global.AsStorage.getSettings().autoArchive === false;
    const ys = off ? await global.AsArchive.pendingDueYears() : [];
    chip.classList.toggle('hidden', !ys.length);
    if (ys.length) { chip.textContent = 'Receipts from ' + ys.join(', ') + ' can be archived'; chip.onclick = () => A().showSettings && showBackupPage(); }
  };
  function showBackupPage() { const b = document.getElementById('btn-goto-backup'); if (b) b.click(); }

  function render() { renderCloud(); renderArchive(); refreshSubtitle(); }

  // After sign-in redirect: maybe ask Keep this browser / Replace with cloud (Android wording).
  async function afterBoot() {
    const res = await C().boot({
      onRedirect: async (r) => {
        if (r.error) { A().toast(r.error); return; }
        A().toast('Connected to ' + C().KINDS[r.kind].label);
        if (r.cloudHasData) {
          const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Cloud already has data"><h2>Cloud already has data</h2>' +
            '<p>The cloud backup (' + size(r.cloudHasData.size) + ') was saved by another device. Keep this browser\'s data (uploads over the cloud copy) or replace this browser with the cloud copy?</p>' +
            '<div class="actions"><button type="button" class="btn primary" id="cd-keep">Keep browser</button><button type="button" class="btn secondary" id="cd-replace">Replace with cloud</button></div></div>');
          sh.el.querySelector('#cd-keep').onclick = async () => { sh.close(); await manualSync(); render(); };
          sh.el.querySelector('#cd-replace').onclick = async () => {
            sh.close();
            const x = await C().replaceWithCloud();
            A().toast(x.ok ? 'Restored from cloud' : x.error);
            await A().refreshClaimList();
            render();
          };
        }
      },
    });
    if (C().status().connected) C().refreshCloudInfo().then(refreshSubtitle);
    if (global.AsStorage.getSettings().autoArchive !== false) global.AsArchive.scheduleAuto(8000);
    return res;
  }

  function wire() {
    const $ = A().$;
    C().onChange(() => {
      refreshSubtitle();
      if (!document.getElementById('view-backup').classList.contains('hidden')) renderCloud();
    });
    global.addEventListener('as-data-changed', () => { C().scheduleSync(); refreshSubtitle(); });
    $('#top-bar-cloud').onclick = manualSync;
    $('#chk-auto-archive').addEventListener('change', (e) => {
      global.AsStorage.saveSettings({ autoArchive: e.target.checked });
      if (e.target.checked) global.AsArchive.scheduleAuto(1000);
    });
    $('#btn-archive-clear-local').onclick = () => clearArchive(true);
    $('#btn-archive-clear-cloud').onclick = () => clearArchive(false);
    $('#btn-archive-now').onclick = archiveNow;
    refreshSubtitle();
  }
  A().onBoot(wire);

  global.AsSyncUi = { refreshSubtitle, afterBoot, render, manualSync };
})(window);
