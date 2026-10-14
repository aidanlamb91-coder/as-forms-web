/**
 * 1.1.0-web — shared look-and-feel pieces ported from Android 1.0.8–1.1.0:
 *  - Splash: the AS Forms logo starts big in the middle, glides/shrinks into the top-bar logo,
 *    then the app is revealed by a circle growing from the top-left (SplashTarget.kt timings:
 *    650 ms glide + 350 ms reveal). Respects "reduce motion".
 *  - Keyboard-safe inputs: when a field gets focus or the on-screen keyboard resizes the
 *    visible area, the field is scrolled into the middle of what is still visible.
 *  - Swipe back: drag from the left edge on a Settings sub-page = ← Back.
 *  - Review & export: lists every file that will go in the job zip (with sizes); tap one to
 *    preview it (photos/PDFs as they are, Word forms drawn as a table). Download zip or Send —
 *    Send only opens a prepared email; nothing is ever sent automatically.
 */
(function (global) {
  const A = () => global.AsApp;
  const reduced = () => global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ——— Splash ———
  let splashFinished = false;
  function splashDone() {
    if (splashFinished) return;
    splashFinished = true;
    const splash = document.getElementById('splash');
    const logo = document.getElementById('splash-logo');
    const target = document.getElementById('top-bar-logo');
    if (!splash) return;
    const finish = () => { splash.remove(); document.body.classList.remove('splashing'); };
    const app = document.getElementById('app');
    if (reduced() || !logo || !target || !target.getBoundingClientRect().width || !logo.animate) {
      splash.animate ? splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).onfinish = finish : finish();
      return;
    }
    const a = logo.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const scale = b.width / a.width;
    target.style.visibility = 'hidden';
    const glide = logo.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
      { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    glide.onfinish = () => {
      target.style.visibility = '';
      // The app sits underneath; the white splash is cut away by a growing circle from the logo.
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const r = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
      logo.style.visibility = 'hidden';
      const rev = splash.animate([
        { clipPath: `circle(${r}px at ${cx}px ${cy}px)`, offset: 0 },
        { clipPath: `circle(0px at ${cx}px ${cy}px)` },
      ], { duration: 350, easing: 'ease-in', fill: 'forwards' });
      // Older browsers without clip-path animation: just fade.
      rev.onfinish = finish;
      setTimeout(finish, 600);
      void app;
    };
    setTimeout(() => { if (splash.isConnected) finish(); }, 2000); // never get stuck on the splash
  }

  // ——— Keyboard never covers the field ———
  function keepFocusedVisible() {
    const el = document.activeElement;
    if (!el || !el.matches || !el.matches('input, textarea, select')) return;
    const vv = global.visualViewport;
    const r = el.getBoundingClientRect();
    const visibleBottom = vv ? vv.height + vv.offsetTop : innerHeight;
    if (r.bottom > visibleBottom - 12 || r.top < (vv ? vv.offsetTop : 0) + 56) {
      el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    }
  }
  function wireKeyboard() {
    document.addEventListener('focusin', () => setTimeout(keepFocusedVisible, 300));
    if (global.visualViewport) {
      visualViewport.addEventListener('resize', () => {
        document.documentElement.style.setProperty('--kb-inset', Math.max(0, innerHeight - visualViewport.height) + 'px');
        keepFocusedVisible();
      });
    }
  }

  // ——— Swipe back on Settings sub-pages (Android: back gesture) ———
  // Start within 28 px of the left edge and drag right ≥ 80 px (mostly sideways) → same as ← Back.
  function wireSwipeBack() {
    let start = null;
    const backBtn = () => {
      const v = Array.from(document.querySelectorAll('.view')).find((x) => !x.classList.contains('hidden'));
      return v ? v.querySelector('.back-btn[data-back="settings"], .back-btn[data-back="set-email"]') : null;
    };
    document.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && t.clientX <= 28 && backBtn() && !document.querySelector('.sheet-backdrop, #modal-root.modal-backdrop')
        ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = Math.abs(t.clientY - start.y);
      start = null;
      if (dx >= 80 && dy < dx * 0.6) { const b = backBtn(); if (b) b.click(); }
    }, { passive: true });
  }

  // ——— Review & export ———
  const st = { built: null, expenseId: null, mileageId: null, urls: [] };
  function injectView() {
    document.getElementById('app').insertAdjacentHTML('beforeend', `
    <section id="view-review" class="view hidden">
      <header class="topbar">
        <button type="button" class="btn ghost back-btn" id="btn-review-back">← Back</button>
        <h1>Review &amp; export</h1>
      </header>
      <p class="hint pad" id="review-sub">Tap a file to preview it.</p>
      <div id="review-list" class="card-list"></div>
      <p class="status pad" id="review-status" role="status"></p>
      <div class="panel btn-row">
        <button type="button" class="btn secondary" id="btn-review-download">Download zip</button>
        <button type="button" class="btn primary" id="btn-review-send">Send</button>
      </div>
    </section>`);
    A().registerView('review', '#view-review');
  }
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const kind = (n) => (/\.docx$/i.test(n) ? 'form' : /\.pdf$/i.test(n) ? 'pdf' : 'image');

  async function openJobExport(expenseId, mileageId) {
    st.expenseId = expenseId;
    st.mileageId = mileageId;
    const $ = A().$;
    $('#review-list').innerHTML = '<p class="empty">Building…</p>';
    $('#review-status').textContent = '';
    A().showView('review');
    try {
      const S = global.AsStorage;
      const exp = expenseId ? await S.getClaim(expenseId) : null;
      const ms = exp ? await global.AsMileageUi.linkedTo(exp) : [await S.getMileage(mileageId)].filter(Boolean);
      if (!exp && !ms.length) throw new Error('Nothing to export');
      st.built = await global.AsExport.buildJobZip(exp, ms);
      st.exp = exp;
      st.ms = ms;
      renderList();
    } catch (e) {
      console.error(e);
      $('#review-list').innerHTML = '';
      $('#review-status').textContent = e.message || String(e);
    }
  }
  function renderList() {
    const $ = A().$;
    const list = $('#review-list');
    list.innerHTML = '';
    const total = st.built.entries.reduce((s, e) => s + e.size, 0);
    $('#review-sub').textContent = st.built.name + ' · ' + st.built.entries.length + ' files · ' + kb(total) + ' (zip ' + kb(st.built.blob.size) + ')';
    st.built.entries.forEach((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card review-row';
      const k = kind(e.name);
      b.innerHTML = '<span class="rv-ico" aria-hidden="true">' + (k === 'form' ? '📄' : k === 'pdf' ? '📕' : '🖼️') + '</span>' +
        '<span class="rv-name">' + A().escapeHtml(e.name) + '</span><span class="rv-size">' + kb(e.size) + '</span>';
      b.onclick = () => preview(e);
      list.appendChild(b);
    });
  }

  /** Word form → simple HTML tables (enough to check names, dates and amounts before sending). */
  function docxToHtml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const text = (n) => Array.from(n.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('');
    const esc = A().escapeHtml;
    let out = '';
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    for (const node of Array.from(body ? body.childNodes : [])) {
      if (node.localName === 'p') { const t = text(node); if (t.trim()) out += '<p>' + esc(t) + '</p>'; }
      if (node.localName === 'tbl') {
        out += '<table class="docx-table">';
        for (const tr of Array.from(node.childNodes).filter((x) => x.localName === 'tr')) {
          out += '<tr>' + Array.from(tr.childNodes).filter((x) => x.localName === 'tc').map((tc) => '<td>' + esc(text(tc)) + '</td>').join('') + '</tr>';
        }
        out += '</table>';
      }
    }
    return out || '<p>(empty form)</p>';
  }

  async function preview(e) {
    const k = kind(e.name);
    const esc = A().escapeHtml;
    let inner;
    if (k === 'form') {
      const z = await JSZip.loadAsync(await e.file.async('arraybuffer'));
      inner = '<div class="docx-preview">' + docxToHtml(await z.file('word/document.xml').async('string')) + '</div>';
    } else {
      const type = k === 'pdf' ? 'application/pdf' : /\.png$/i.test(e.name) ? 'image/png' : 'image/jpeg';
      const url = URL.createObjectURL(new Blob([await e.file.async('uint8array')], { type }));
      st.urls.push(url);
      inner = k === 'pdf' ? '<iframe class="pdf-preview" src="' + url + '" title="' + esc(e.name) + '"></iframe>' +
        '<p><a href="' + url + '" target="_blank" rel="noopener">Open PDF</a></p>'
        : '<img class="img-preview" src="' + url + '" alt="' + esc(e.name) + '" />';
    }
    A().openSheet('<div class="sheet preview-sheet" role="dialog" aria-label="Preview"><h2>' + esc(e.name) + '</h2>' + inner +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Close</button></div></div>',
      () => { st.urls.forEach((u) => URL.revokeObjectURL(u)); st.urls = []; });
  }

  function download() {
    if (!st.built) return;
    global.AsExport.downloadBlob(st.built.blob, st.built.name);
    A().toast('Downloaded ' + st.built.name);
  }
  function send() {
    if (!st.built) return;
    const ex = global.AsExport;
    // Mileage on its own uses the expense email wording (same as Android), with the journey dates.
    const m0 = st.ms[0];
    const email = ex.buildExpenseEmail(st.exp || { jobNo: m0.jobNo, ...global.AsMileage.claimDates(m0) }, st.built.name);
    download();
    A().showEmailPreview({
      title: 'Send', to: email.to, subject: email.subject, body: email.body, filename: st.built.name,
      attachmentNote: 'Your mail app opens with the email ready. Attach the downloaded zip, then send it yourself.',
      onDownload: download,
      onMailto: () => ex.openMailto(email.to, email.subject, email.body),
    });
  }

  function wire() {
    injectView();
    wireKeyboard();
    wireSwipeBack();
    const $ = A().$;
    $('#btn-review-back').onclick = () => {
      if (st.expenseId) A().openClaim(st.expenseId); else global.AsMileageUi.openClaim(st.mileageId);
    };
    $('#btn-review-download').onclick = download;
    $('#btn-review-send').onclick = send;
    const rb = $('#btn-review-export');
    if (rb) rb.onclick = () => openJobExport(A().state.claimId, null);
  }
  A().onBoot(wire);
  setTimeout(splashDone, 5000); // safety net: never leave the splash up if boot stalls

  global.AsUi110 = { splashDone, openJobExport, docxToHtml, keepFocusedVisible };
})(window);
