/**
 * 1.1.0-web — Yearly receipt archives (port of Android ReceiptArchivePolicy + ReceiptArchiveManager).
 *
 * THE RULE (same as Android)
 *   - One zip per calendar year, AS-Forms-YYYY.zip. A claim belongs to the year of its Date From.
 *   - Year Y can be archived from 1 January of Y+2 (so you always keep this year and last year).
 *   - The zip holds regenerated Word forms (forms/…) and every receipt / statement
 *     (receipts/<claim>/line_<line>_receipt.jpg …), plus mileage forms.
 *
 * WHERE THE COPIES GO
 *   - "Local": kept inside this browser (IndexedDB).
 *   - "Cloud": the same AS Forms folder as the backup (Google Drive / OneDrive), when connected.
 *
 * DELETING IMAGES — only after every copy is confirmed
 *   Images are removed from the claims only when the cloud copy has been uploaded AND re-checked
 *   (the browser copy alone isn't enough: clearing site data would lose both). Each removed
 *   receipt keeps Android's "receipt archived" marker so either app knows where it went.
 *   With automatic archiving off, nothing happens until the user taps Archive now.
 */
(function (global) {
  const STATE_KEY = 'as-forms-archive';
  const META_PREFIX = 'archive:';
  const NAME_RE = /^AS-Forms-(\d{4})\.zip$/;
  const F = () => global.AsBackupFormat;

  // ——— Policy (ReceiptArchivePolicy.kt) — pure ———
  const dueDate = (year) => new Date(year + 2, 0, 1);
  const isYearDue = (year, today) => (today || new Date()) >= dueDate(year);
  const latestDueYear = (today) => (today || new Date()).getFullYear() - 2;
  const fileName = (year) => 'AS-Forms-' + year + '.zip';
  const yearFromFileName = (n) => { const m = NAME_RE.exec(n || ''); return m ? Number(m[1]) : null; };
  const claimYear = (claim) => Number(String(claim.dateFrom || '').slice(0, 4)) || null;
  const dueYears = (years, today) => Array.from(new Set(years)).filter((y) => y && isYearDue(y, today)).sort((a, b) => a - b);

  /** Warning text for Clear (approved trim #50). */
  function clearWarning(local, thisYears, otherYears) {
    const here = local ? 'browser' : 'cloud folder';
    const other = local ? 'cloud' : 'browser';
    const only = thisYears.filter((y) => !otherYears.includes(y)).sort();
    if (only.length) return 'Only copy of ' + only.join(', ') + " receipts. Can't be undone.";
    return 'Deletes the receipt archive zips (' + thisYears.slice().sort().join(', ') + ') from your ' + here + '. The ' + other + ' copies are kept.';
  }

  // ——— Saved per-year state ———
  function states() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (_) { return {}; } }
  function putState(y, patch) {
    const all = states();
    all[y] = { ...(all[y] || {}), ...patch, year: y };
    localStorage.setItem(STATE_KEY, JSON.stringify(all));
  }

  // ——— Local (browser) store ———
  const local = {
    async list() {
      const out = [];
      const now = new Date().getFullYear();
      for (let y = 2015; y <= now; y++) {
        const b = await global.AsStorage.getMeta(META_PREFIX + y);
        if (b && b.size != null) out.push({ year: y, size: b.size });
      }
      return out;
    },
    read: (y) => global.AsStorage.getMeta(META_PREFIX + y),
    async write(y, blob) {
      await global.AsStorage.setMeta(META_PREFIX + y, blob);
      const back = await global.AsStorage.getMeta(META_PREFIX + y);
      return !!back && back.size === blob.size;
    },
    remove: (y) => global.AsStorage.deleteMeta(META_PREFIX + y),
  };

  /** Short text fingerprint of a year's records (not image paths, so clearing isn't an "edit"). */
  function fingerprint(year, claims, mileage) {
    const parts = ['y=' + year];
    claims.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach((c) => {
      parts.push(['c', c.id, c.jobNo, c.dateFrom, c.dateTo].join('|'));
      (c.lines || []).forEach((l) => parts.push(['l', l.id, l.date, l.description, l.foreignCurrency, l.net, l.vat, l.total,
        'r=' + !!(l.receiptId || F().isArchivedMeta(l.receiptMeta)), 's=' + !!(l.statementId || F().isArchivedMeta(l.statementMeta))].join('|')));
    });
    mileage.forEach((m) => parts.push(['m', m.id, m.jobNo, JSON.stringify(m.journeys || [])].join('|')));
    const s = parts.join('\n');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16) + ':' + s.length;
  }

  /** Build AS-Forms-YYYY.zip; images already cleared from this browser are carried over from `base`. */
  async function buildYearZip(year, claims, mileage, base) {
    const zip = new JSZip();
    const old = base ? await JSZip.loadAsync(base) : null;
    const s = global.AsStorage.getSettings();
    for (const c of claims) {
      const cid = F().numericId(c.id);
      const job = (c.jobNo || 'claim').replace(/[^A-Za-z0-9_-]/g, '_');
      try { zip.file('forms/' + c.dateFrom + '_' + job + '_' + cid + '.docx', await global.AsExport.fillClaimDocxBlob(c)); } catch (e) { console.warn('archive form', e); }
      for (const l of c.lines || []) {
        const lid = F().numericId(l.id);
        for (const [idKey, metaKey, tag] of [['receiptId', 'receiptMeta', 'receipt'], ['statementId', 'statementMeta', 'statement']]) {
          const prefix = 'receipts/' + cid + '/line_' + lid + '_' + tag;
          if (l[idKey]) {
            const r = await global.AsStorage.getReceipt(l[idKey]);
            if (r && r.blob) zip.file(prefix + F().extOf((l[metaKey] && l[metaKey].name) || r.name), r.blob);
          } else if (old && F().isArchivedMeta(l[metaKey])) {
            const hit = Object.keys(old.files).find((n) => n.startsWith(prefix + '.'));
            if (hit) zip.file(hit, await old.files[hit].async('uint8array'));
          }
        }
      }
    }
    for (const m of mileage) {
      const job = (m.jobNo || 'mileage').replace(/[^A-Za-z0-9_-]/g, '_');
      try { zip.file('forms/' + m.dateFrom + '_' + job + '_mileage_' + F().numericId(m.id) + '.docx', await global.AsMileageDocx.fill(global.AsMileageDocx.claimToForm(m, s))); } catch (e) { console.warn('archive mileage', e); }
    }
    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }

  let running = false;
  /**
   * One archive pass. includeNewYears = start archiving years never archived before
   * (automatic archiving on, or the user tapped Archive now).
   * Returns { archived:[years], removed:n, errors:[text] }.
   */
  async function runPass(includeNewYears) {
    if (running) return { archived: [], removed: 0, errors: [] };
    running = true;
    const result = { archived: [], removed: 0, errors: [] };
    try {
      const claims = await global.AsStorage.listClaims();
      const mileage = global.AsStorage.listMileage ? await global.AsStorage.listMileage() : [];
      const years = dueYears(claims.map(claimYear).concat(mileage.map(claimYear)));
      const cloudOn = global.AsCloud && global.AsCloud.archives.available();
      for (const year of years) {
        const st = states()[year];
        const yc = claims.filter((c) => claimYear(c) === year);
        const ym = mileage.filter((m) => claimYear(m) === year);
        const hasImages = yc.some((c) => (c.lines || []).some((l) => l.receiptId || l.statementId));
        if (!st && (!includeNewYears || (!hasImages && !ym.length))) continue;
        const fp = fingerprint(year, yc, ym);
        const needLocal = !(st && st.localClearedByUser);
        const needCloud = cloudOn && !(st && st.cloudClearedByUser);
        if (st && st.fp === fp && !hasImages && (!needLocal || st.localSaved) && (!needCloud || st.cloudSaved)) continue;
        try {
          const base = (await local.read(year)) || (cloudOn ? await global.AsCloud.archives.read(year).catch(() => null) : null);
          const hasMarkers = yc.some((c) => (c.lines || []).some((l) => F().isArchivedMeta(l.receiptMeta) || F().isArchivedMeta(l.statementMeta)));
          if (!base && hasMarkers) { result.errors.push(year + ': existing archive not reachable — will retry'); continue; }
          const blob = await buildYearZip(year, yc, ym, base);
          const localOk = needLocal ? await local.write(year, blob) : true;
          let cloudOk = true;
          if (needCloud) {
            try { cloudOk = await global.AsCloud.archives.write(year, blob); } catch (e) { cloudOk = false; result.errors.push(year + ': cloud upload failed (' + global.AsCloud.friendly(e) + ')'); }
          }
          // Only delete images when the cloud copy is confirmed AND every other copy is too.
          const allConfirmed = localOk && cloudOk && needCloud;
          let removed = 0;
          if (allConfirmed && hasImages) removed = await clearYearImages(yc);
          result.removed += removed;
          putState(year, {
            fp: allConfirmed ? fp : (st && st.fp) || '',
            localSaved: needLocal ? localOk : !!(st && st.localSaved),
            cloudSaved: needCloud ? cloudOk : !!(st && st.cloudSaved),
            imagesCleared: !!(st && st.imagesCleared) || (allConfirmed && (removed > 0 || hasMarkers)),
            sizeBytes: blob.size,
          });
          if (!needCloud && hasImages) result.errors.push(year + ': saved in this browser. Connect cloud sync to free the space.');
          if (localOk && (cloudOk || !needCloud)) result.archived.push(year);
        } catch (e) {
          result.errors.push(year + ': ' + ((e && e.message) || e));
        }
      }
    } finally {
      running = false;
    }
    try {
      // Only touch storage when there is something to say (keeps quiet passes write-free)
      if (result.errors[0]) localStorage.setItem(STATE_KEY + ':err', result.errors[0]);
      else localStorage.removeItem(STATE_KEY + ':err');
    } catch (_) {}
    return result;
  }

  /** Remove the year's images from this browser, leaving Android's "receipt archived" marker. */
  async function clearYearImages(yearClaims) {
    let n = 0;
    for (const c of yearClaims) {
      const fresh = await global.AsStorage.getClaim(c.id);
      if (!fresh) continue;
      let touched = false;
      for (const l of fresh.lines || []) {
        if (l.receiptId) {
          await global.AsStorage.deleteReceipt(l.receiptId);
          l.receiptId = null;
          l.receiptMeta = { name: F().ARCHIVED_LABEL, type: F().ARCHIVED_MIME, size: 0 };
          n++; touched = true;
        }
        if (l.statementId) {
          await global.AsStorage.deleteReceipt(l.statementId);
          l.statementId = null;
          l.statementMeta = { name: F().STATEMENT_ARCHIVED_LABEL, type: F().ARCHIVED_MIME, size: 0 };
          n++; touched = true;
        }
      }
      if (touched) await global.AsStorage.putClaim({ ...fresh, updatedAt: fresh.updatedAt });
    }
    return n;
  }

  /** Sizes for the Archive row: { local:{bytes, years}, cloud:{bytes, years, connected, cached} }. */
  async function space() {
    const lf = await local.list();
    const out = { local: { bytes: lf.reduce((s, f) => s + f.size, 0), years: lf.map((f) => f.year) }, cloud: { connected: false, bytes: 0, years: [], cached: false } };
    if (global.AsCloud && global.AsCloud.status().connected) {
      out.cloud.connected = true;
      try {
        const cf = await global.AsCloud.archives.list();
        out.cloud.bytes = cf.reduce((s, f) => s + (f.size || 0), 0);
        out.cloud.years = cf.map((f) => f.year);
      } catch (_) {
        const cached = Object.values(states()).filter((s) => s.cloudSaved);
        out.cloud.bytes = cached.reduce((s, x) => s + (x.sizeBytes || 0), 0);
        out.cloud.years = cached.map((x) => x.year);
        out.cloud.cached = true;
      }
    }
    return out;
  }

  /** Delete every archive zip from the browser (local=true) or the cloud. Returns the years. */
  async function clear(isLocal) {
    const years = isLocal ? (await local.list()).map((f) => f.year) : (await global.AsCloud.archives.list()).map((f) => f.year);
    for (const y of years) {
      if (isLocal) await local.remove(y); else await global.AsCloud.archives.remove(y);
      putState(y, isLocal ? { localSaved: false, localClearedByUser: true } : { cloudSaved: false, cloudClearedByUser: true });
    }
    return years;
  }

  /** Due years not archived yet (for the quiet banner when automatic archiving is off). */
  async function pendingDueYears() {
    const claims = await global.AsStorage.listClaims();
    const st = states();
    return dueYears(claims.filter((c) => (c.lines || []).some((l) => l.receiptId || l.statementId)).map(claimYear)).filter((y) => !st[y]);
  }

  let autoTimer = null;
  /** After a sync / on open: run the automatic pass a little later when it's switched on. */
  function scheduleAuto(ms) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      // Wait while the guided tour is open (the tour must not change saved data)
      if (global.AsTutorial && global.AsTutorial.isOpen()) { scheduleAuto(10000); return; }
      const on = global.AsStorage.getSettings().autoArchive !== false;
      runPass(on).catch((e) => console.warn('archive', e));
    }, ms == null ? 5000 : ms);
  }

  global.AsArchive = {
    dueDate, isYearDue, latestDueYear, fileName, yearFromFileName, claimYear, dueYears, clearWarning,
    fingerprint, buildYearZip, runPass, space, clear, pendingDueYears, scheduleAuto, local, states,
    downloadYear: async (y) => { const b = await local.read(y); if (b) global.AsExport.downloadBlob(b, fileName(y)); return !!b; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
