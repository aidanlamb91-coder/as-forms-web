/**
 * 1.2.1-web Profile and device safety (port of Android 1.2.0 ProfileExtrasScreens.kt and the
 * 1.2.1 condensed ProfileScreen):
 *  - Profile: Name, then rows for Mileage (postcode · rate · CC), Favourite locations (count),
 *    HR details and Signature.
 *  - Mileage: Home postcode, CC of engine, mileage rate. (No rounding text, as asked.)
 *  - Favourite locations: add / edit / delete; Home is shown "from Mileage".
 *  - HR details: the personal details that fill the HR forms, kept encrypted on this device.
 *    Bank & NI are never put in any backup.
 *  - Signature: up to 3, drawn or uploaded (paper turned see-through and cropped); the default
 *    goes on new forms automatically.
 *  - Settings → Other forms row, and "Clear data on this device" for shared devices.
 */
(function (global) {
  const A = () => global.AsApp;
  const S = () => global.AsFormsStore;
  const R = () => global.AsFormRules;
  const St = () => global.AsStorage;
  const esc = (s) => A().escapeHtml(s == null ? '' : String(s));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const b64 = (u8) => { let t = ''; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(t); };

  function injectViews() {
    $('#app').insertAdjacentHTML('beforeend', `
    <section id="view-hr" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-hr-back">← Back</button><h1>HR details</h1></header>
      <p class="hint pad">Bank and NI aren’t saved — type them on each form.</p>
      <div id="hr-cards"></div>
    </section>
    <section id="view-signature" class="view hidden">
      <header class="topbar"><button type="button" class="btn ghost back-btn" id="btn-sig-back">← Back</button><h1>Signature</h1></header>
      <div class="panel"><div id="sig-slots" class="sig-slots"></div><p class="hint">Hold, or tap Make default. Used on new forms.</p></div>
      <input type="file" id="sig-upload" accept="image/*" hidden />
    </section>`);
    A().registerView('set-mileage', '#view-set-mileage');
    A().registerView('set-places', '#view-set-places');
    A().registerView('hr', '#view-hr');
    A().registerView('signature', '#view-signature');
  }

  // ——— Profile rows ———
  function refreshProfileRows() {
    const s = St().getSettings();
    const bits = [s.homePostcode, s.mileageRatePence ? s.mileageRatePence + 'p' : '', s.ccEngine ? s.ccEngine + 'cc' : ''].filter(Boolean);
    $('#sb-mileage-sub').textContent = bits.join(' · ') || 'Not set';
    const n = (s.savedPlaces || []).length + (s.homePostcode ? 1 : 0);
    $('#sb-places-sub').textContent = n ? n + (n === 1 ? ' location' : ' locations') : 'None';
    S().init().then(() => {
      const hrN = Object.keys(S().hr()).length;
      $('#sb-hr-sub').textContent = hrN ? hrN + ' filled' : 'For HR forms';
      const sg = S().sigSlots().length;
      $('#sb-sig-sub').textContent = sg ? sg + ' saved' : 'None';
    }).catch(() => {});
  }

  function showMileage() { global.AsMileageUi.fillProfile(); A().showView('set-mileage'); }
  function showPlaces() {
    const s = St().getSettings();
    $('#places-home').innerHTML = s.homePostcode ? '<div class="card line-card"><p class="title">Home <span class="fh-tag tag-imp">from Mileage</span></p><p class="meta">' + esc(s.homePostcode) + '</p></div>' : '';
    global.AsMileageUi.fillProfile(); // draws the saved places list
    A().showView('set-places');
  }

  // ——— HR details ———
  async function showHr() {
    if (global.AsLockUi && !(await global.AsLockUi.need())) return; // 1.2.2-web lock
    S().init().then(() => {
      const hr = S().hr();
      // 1.2.2-web: no Bank & NI card — they are typed on each form and never saved
      $('#hr-cards').innerHTML = R().HR_CARDS.filter((c) => !c.bank).map((c) => '<details class="panel fe-card"' + (c.title === 'Personal' ? ' open' : '') + '><summary><span>' + esc(c.title) + '</span>' +
        (c.bank ? '<span class="hint">Never in backups</span>' : '<span class="hint">' + c.items.filter((i) => hr[i.key]).length + ' of ' + c.items.length + '</span>') + '</summary><div class="fe-grid">' +
        c.items.map((i) => {
          const id = 'hr-' + i.key; const v = hr[i.key] || '';
          const input = i.kind === 'date' ? '<input type="date" id="' + id + '" data-hr="' + i.key + '" data-kind="date" value="' + esc(R().toIso(v)) + '" />'
            : '<div class="fe-input' + (i.masked ? ' has-eye' : '') + '"><input type="' + (i.kind === 'email' ? 'email' : i.kind === 'phone' ? 'tel' : 'text') + '" id="' + id + '" data-hr="' + i.key + '"' +
              (i.kind === 'number' ? ' inputmode="numeric"' : '') + (i.masked ? ' class="masked" autocomplete="off"' : '') + ' value="' + esc(v) + '" />' +
              (i.masked ? '<button type="button" class="icon-btn eye" data-eye="' + id + '" aria-label="Show"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg></button>' : '') + '</div>';
          return '<div class="fe-field' + (i.half ? ' half' : '') + '"><label for="' + id + '">' + esc(i.label) + '</label>' + input + '<p class="fe-err" data-hr-err="' + i.key + '">' + esc(R().check(i.rule, v) || '') + '</p></div>';
        }).join('') + '</div></details>').join('');
      A().showView('hr');
    });
  }
  function wireHr() {
    $('#btn-hr-back').onclick = () => { A().showView('set-profile'); refreshProfileRows(); };
    const box = $('#hr-cards');
    box.addEventListener('change', (e) => {
      const el = e.target; if (!el.dataset || !el.dataset.hr) return;
      const v = el.dataset.kind === 'date' ? R().fromIso(el.value) : el.value.trim();
      const item = R().HR_CARDS.flatMap((c) => c.items).find((i) => i.key === el.dataset.hr);
      const err = R().check(item && item.rule, v);
      const p = box.querySelector('[data-hr-err="' + el.dataset.hr + '"]'); if (p) p.textContent = err || '';
      S().setHr({ [el.dataset.hr]: item && item.rule ? R().tidy(item.rule === 'percent' ? null : item.rule, v) : v });
    });
    box.addEventListener('click', (e) => { const eye = e.target.closest('[data-eye]'); if (eye) document.getElementById(eye.dataset.eye).classList.toggle('masked'); });
  }

  // ——— Signatures ———
  function renderSigs() {
    const def = S().sigDefault();
    const have = new Set(S().sigSlots());
    $('#sig-slots').innerHTML = [0, 1, 2].map((slot) => {
      if (!have.has(slot)) return '<div class="sig-slot empty"><span class="hint">Empty</span><div class="btn-row"><button type="button" class="btn secondary small" data-draw="' + slot + '">Draw</button><button type="button" class="btn ghost small" data-upload="' + slot + '">Upload</button></div></div>';
      return '<div class="sig-slot' + (slot === def ? ' default' : '') + '" data-slot="' + slot + '"><img alt="Signature ' + (slot + 1) + '" src="data:image/png;base64,' + b64(S().sigBytes(slot)) + '" />' +
        '<div class="btn-row">' + (slot === def ? '<span class="badge on">Default</span>' : '<button type="button" class="btn ghost small" data-default="' + slot + '">Make default</button>') +
        '<button type="button" class="btn ghost small danger" data-sigdel="' + slot + '">Delete</button></div></div>';
    }).join('');
  }
  async function showSignatures() {
    if (global.AsLockUi && !(await global.AsLockUi.need())) return; // 1.2.2-web lock
    S().init().then(() => { renderSigs(); A().showView('signature'); });
  }

  /** Paper → see-through, crop to the ink (Android SignatureImage.clean). Pixels: Uint8ClampedArray RGBA. */
  function cleanPixels(w, h, px, margin) {
    const CUT = 215; const m = margin == null ? 8 : margin;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; const a = px[i + 3];
      const light = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      if (a < 16 || light >= CUT) { px[i + 3] = 0; continue; }
      px[i + 3] = Math.min(a, Math.max(60, Math.min(255, Math.round(a * (CUT - light) / CUT))));
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) return null;
    const x0 = Math.max(0, minX - m), y0 = Math.max(0, minY - m), x1 = Math.min(w - 1, maxX + m), y1 = Math.min(h - 1, maxY + m);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  async function canvasToCleanPng(canvas) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const box = cleanPixels(canvas.width, canvas.height, img.data);
    if (!box) return null;
    ctx.putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = box.w; out.height = box.h;
    out.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function addPng(png) {
    if (!png) { A().toast('No signature found'); return; }
    const slot = await S().sigAdd(png);
    if (slot == null) A().toast('3 signatures max'); else A().toast('Saved');
    renderSigs();
  }
  function drawSheet() {
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Draw signature"><div class="sheet-grip"></div><h2>Sign here</h2>' +
      '<canvas id="sig-pad" class="sig-pad" width="900" height="300"></canvas>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="btn-sig-save">Save</button><button type="button" class="btn ghost" id="btn-sig-clear">Clear</button><button type="button" class="btn ghost" data-close>Cancel</button></div></div>');
    const c = $('#sig-pad', sh.el); const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10205a';
    let drawing = false;
    const pt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.addEventListener('pointerdown', (e) => { drawing = true; c.setPointerCapture(e.pointerId); const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); e.preventDefault(); });
    c.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
    ['pointerup', 'pointercancel'].forEach((t) => c.addEventListener(t, () => { drawing = false; }));
    $('#btn-sig-clear', sh.el).onclick = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); };
    $('#btn-sig-save', sh.el).onclick = async () => { const png = await canvasToCleanPng(c); sh.close(); await addPng(png); };
  }
  async function uploadFile(file) {
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      await addPng(await canvasToCleanPng(c));
    } catch (_) { A().toast("Couldn't read that picture"); }
  }
  function wireSigs() {
    $('#btn-sig-back').onclick = () => { A().showView('set-profile'); refreshProfileRows(); };
    $('#sig-upload').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; uploadFile(f); });
    let hold = null;
    const box = $('#sig-slots');
    box.addEventListener('pointerdown', (e) => { const s = e.target.closest('[data-slot]'); if (!s || e.target.closest('button')) return; hold = setTimeout(async () => { await S().sigSetDefault(Number(s.dataset.slot)); renderSigs(); A().toast('Default'); }, 600); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => box.addEventListener(t, () => clearTimeout(hold)));
    box.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.draw != null) drawSheet();
      else if (t.dataset.upload != null) $('#sig-upload').click();
      else if (t.dataset.default != null) { await S().sigSetDefault(Number(t.dataset.default)); renderSigs(); }
      else if (t.dataset.sigdel != null) {
        const slot = Number(t.dataset.sigdel); const png = S().sigBytes(slot); const wasDef = S().sigDefault() === slot;
        await S().sigDelete(slot); renderSigs();
        A().toastUndo('Signature deleted', async () => { await S().sigAdd(png); if (wasDef) await S().sigSetDefault(S().sigSlots().slice(-1)[0]); renderSigs(); });
      }
    });
  }

  // ——— Clear data on this device (shared devices) ———
  function clearDeviceSheet() {
    const sh = A().openSheet('<div class="sheet" role="dialog" aria-label="Clear data on this device"><div class="sheet-grip"></div><h2>Clear data on this device?</h2>' +
      '<p class="hint">Removes claims, timesheets, receipts, forms, HR details, signatures, the access code and cloud sign-in from this browser. Back up first if you need them.</p>' +
      '<div class="sheet-actions"><button type="button" class="btn danger" id="btn-clear-device-yes">Clear everything</button><button type="button" class="btn ghost" data-close>Cancel</button></div></div>');
    $('#btn-clear-device-yes', sh.el).onclick = async () => {
      sh.close();
      await clearDevice();
      A().toast('Cleared');
      setTimeout(() => location.reload(), 600);
    };
  }
  async function clearDevice() {
    try { await S().clearAll(); } catch (e) { console.error(e); }
    try { await St().clearAllData(); } catch (e) { console.error(e); }
    // Only this copy's own keys and databases: the main site and the beta share one web address,
    // so clearing the beta must never touch the main site's data (and the other way round).
    await global.AsScope.clearOwn();
  }

  function wire() {
    injectViews();
    wireHr(); wireSigs();
    $('#btn-goto-profile').addEventListener('click', refreshProfileRows);
    $('#btn-profile-mileage').onclick = showMileage;
    $('#btn-profile-places').onclick = showPlaces;
    $('#btn-profile-hr').onclick = showHr;
    $('#btn-profile-signature').onclick = showSignatures;
    $('#btn-mileage-profile-back').onclick = () => { A().showView('set-profile'); refreshProfileRows(); };
    $('#btn-places-back').onclick = () => { A().showView('set-profile'); refreshProfileRows(); };
    $('#form-profile-mileage').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!global.AsMileageUi.saveProfileFields()) return; // bad postcode: stay
      St().notifyChanged('prefs');
      A().toast('Saved');
      A().showView('set-profile'); refreshProfileRows();
    });
    $('#btn-goto-other-forms').onclick = () => global.AsFormsUi.showList();
    $('#btn-clear-device').onclick = clearDeviceSheet;
    // "Default: …" under each destination email, from the app's own defaults (one source)
    const defs = St().defaultSettings();
    document.querySelectorAll('[data-default-for]').forEach((el) => { el.textContent = 'Default: ' + (defs[el.dataset.defaultFor] || ''); });
    refreshProfileRows();
  }
  A().onBoot(wire);

  global.AsProfile121 = { refreshProfileRows, cleanPixels, clearDevice, showHr, showSignatures };
})(window);
