/**
 * AS Forms web 1.0.1 — first-run guided tour (a controlled simulation).
 *
 * Sandbox: the tour draws its OWN mock screens (same CSS classes as the real app) inside a
 * full-screen layer. It never calls AsStorage, IndexedDB, folder sync or any app function, and
 * all demo values live in this closure only — they vanish when the tour ends or is skipped.
 * The only thing persisted is the "seen" flag (localStorage `as-forms-tutorialSeen`).
 *
 * Spotlight: a dimmed layer with a cut-out (box-shadow) around the one element to tap, with a
 * pulsing ring. Everything else is blocked (a full-screen catcher + `inert` on the real app);
 * Skip is always visible. Typed values fill themselves with a typing animation.
 * prefers-reduced-motion → fades instead of movement.
 *
 *   AsTutorial.start({ displayName, onEnd(reason) })  → Promise<{ reason: 'done' | 'skip' }>
 *   AsTutorial.isOpen(), AsTutorial.skip(), AsTutorial.seen(), AsTutorial.markSeen()
 */
(function (global) {
  'use strict';

  const SEEN_KEY = 'as-forms-tutorialSeen';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const STEPS = ['e-new', 'e-line', 'e-food', 'e-attach', 'e-accept', 'e-swipe', 't-month', 't-start', 't-end', 't-offshore', 'd-big', 'd-tiles', 'd-year'];
  // Material "touch_app" glyph (Apache 2.0)
  const HAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z"/></svg>';

  let active = null;

  function seen() {
    try { return global.localStorage.getItem(SEEN_KEY) === '1'; } catch (_) { return false; }
  }
  function markSeen() {
    try { global.localStorage.setItem(SEEN_KEY, '1'); } catch (_) { /* private mode */ }
  }
  function isOpen() { return !!active; }
  function skip() { if (active) active.finish('skip'); }
  function currentStep() { return active ? active.step : null; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function start(opts) {
    if (active) return active.promise;
    active = createRun(opts || {});
    return active.promise;
  }

  function createRun(opts) {
    const reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const speed = Math.max(0.1, Number(opts.speed || global.AS_TUTORIAL_SPEED || 1));
    const CANCEL = new Error('tutorial-cancelled');
    const ctx = {
      step: null, finished: false, cancelled: false, timers: new Set(), rejects: new Set(),
      target: null, pad: 6, radius: 12, lastKey: '', raf: 0, onHit: null, onNext: null, swipe: null,
    };
    let resolveEnd;
    ctx.promise = new Promise((r) => { resolveEnd = r; });

    // ——— Demo data (memory only) ———
    const now = new Date();
    const M = now.getMonth();
    const Y = now.getFullYear();
    const monthName = MONTHS[M];
    const lastDay = new Date(Y, M + 1, 0).getDate();
    const firstDow = (new Date(Y, M, 1).getDay() + 6) % 7; // Monday first
    const dStart = 6;
    const dEnd = Math.min(19, lastDay);
    const iso = Y + '-' + pad2(M + 1) + '-' + pad2(now.getDate());
    const tallyY = M >= 2 ? Y : Y - 1;
    const tallyLabel = 'Mar ' + tallyY + ' – Feb ' + (tallyY + 1);
    const prevTallyLabel = 'Mar ' + (tallyY - 1) + ' – Feb ' + tallyY;
    const who = (opts.displayName || '').trim();
    const sub = (who ? esc(who) + ' · ' : '') + 'Demo';

    // ——— DOM ———
    const root = document.createElement('div');
    root.className = 'tut-root' + (reduced ? ' tut-reduced' : '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Quick tour');
    root.innerHTML =
      '<div class="tut-stage" inert aria-hidden="true"></div>' +
      '<nav class="tut-nav" inert aria-hidden="true"><div class="inner">' +
      '<button type="button" data-tn="expenses"><span class="ico">£</span>Expenses</button>' +
      '<button type="button" data-tn="timesheets"><span class="ico">⏱</span>Timesheets</button>' +
      '<button type="button" data-tn="settings"><span class="ico">⚙</span>Settings</button>' +
      '</div></nav>' +
      '<div class="tut-block"></div>' +
      '<div class="tut-hole tut-clear"></div>' +
      '<button type="button" class="tut-hit" hidden></button>' +
      '<div class="tut-cap" aria-live="polite"><span class="tut-cap-text"></span><button type="button" class="tut-next hidden">Next</button></div>' +
      '<div class="tut-progress" aria-hidden="true"><span></span></div>' +
      '<button type="button" class="tut-skip">Skip</button>' +
      '<div class="tut-toast hidden" role="status"></div>';
    const $r = (sel) => root.querySelector(sel);
    const stage = $r('.tut-stage');
    const hole = $r('.tut-hole');
    const hit = $r('.tut-hit');
    const cap = $r('.tut-cap');
    const capText = $r('.tut-cap-text');
    const nextBtn = $r('.tut-next');
    const bar = $r('.tut-progress span');
    const toastEl = $r('.tut-toast');
    const q = (name) => stage.querySelector('.tut-screen:last-child [data-t="' + name + '"]');

    // Block the real app underneath (keyboard + pointer), remember what to restore.
    const inertEls = ['#app', '.bottom-nav', '#toast', '#modal-root', '#update-bar']
      .map((s) => document.querySelector(s)).filter(Boolean)
      .map((el) => ({ el, was: el.inert }));
    const prevFocus = document.activeElement;
    inertEls.forEach((x) => { x.el.inert = true; });
    document.documentElement.classList.add('tut-open');
    document.body.appendChild(root);

    // ——— Cancellable waits ———
    function waitable(executor) {
      return new Promise((resolve, reject) => {
        if (ctx.cancelled) { reject(CANCEL); return; }
        const rej = () => reject(CANCEL);
        ctx.rejects.add(rej);
        executor((v) => {
          ctx.rejects.delete(rej);
          if (ctx.cancelled) reject(CANCEL); else resolve(v);
        });
      });
    }
    function later(fn, ms) {
      const t = setTimeout(() => { ctx.timers.delete(t); if (!ctx.cancelled) fn(); }, ms);
      ctx.timers.add(t);
      return t;
    }
    function sleep(ms) {
      return waitable((done) => { later(done, ms / speed); });
    }

    // ——— Spotlight layout (follows resize / scroll / animations every frame) ———
    function frame() {
      if (ctx.cancelled) return;
      layout();
      ctx.raf = requestAnimationFrame(frame);
    }
    function layout() {
      const t = ctx.target;
      if (!t || !t.isConnected) return;
      const r = t.getBoundingClientRect();
      const p = ctx.pad;
      const x = Math.round(r.left - p);
      const y = Math.round(r.top - p);
      const w = Math.round(r.width + 2 * p);
      const h = Math.round(r.height + 2 * p);
      const key = x + ',' + y + ',' + w + ',' + h + ',' + innerWidth + ',' + innerHeight + ',' + cap.offsetWidth;
      if (key === ctx.lastKey) return;
      ctx.lastKey = key;
      const box = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;border-radius:' + ctx.radius + 'px';
      hole.style.cssText = box;
      hit.style.cssText = box;
      placeCaption(x, y, w, h);
    }
    function placeCaption(x, y, w, h) {
      if (!cap.classList.contains('show')) return;
      const vw = innerWidth;
      const vh = innerHeight;
      const cw = cap.offsetWidth;
      const ch = cap.offsetHeight;
      const cx = x + w / 2;
      const left = Math.max(10, Math.min(vw - cw - 10, cx - cw / 2));
      const below = y + h + 14 + ch < vh - 10;
      const top = below ? y + h + 14 : Math.max(52, y - ch - 14);
      cap.style.left = Math.round(left) + 'px';
      cap.style.top = Math.round(top) + 'px';
      cap.classList.toggle('above', !below);
      cap.style.setProperty('--ax', Math.round(Math.max(18, Math.min(cw - 18, cx - left))) + 'px');
    }
    function radiusOf(el) {
      const v = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      return Math.min(v, 999);
    }
    function setTarget(el, o) {
      o = o || {};
      ctx.target = el;
      ctx.pad = o.pad != null ? o.pad : 6;
      ctx.radius = o.radius != null ? o.radius : Math.min(radiusOf(el) + ctx.pad, 40);
      ctx.lastKey = '';
      hole.classList.remove('tut-clear', 'tut-moving');
      void hole.offsetWidth;
      hole.classList.add('tut-moving');
      hole.classList.toggle('tut-ring', !!o.ring);
      clearTimeout(ctx.movingT);
      ctx.movingT = setTimeout(() => hole.classList.remove('tut-moving'), 450);
      layout();
    }
    function clearTarget() {
      ctx.target = null;
      hole.classList.add('tut-clear');
      hole.classList.remove('tut-ring');
      hit.hidden = true;
      hideCaption();
    }
    function showCaption(text, o) {
      o = o || {};
      capText.textContent = text;
      nextBtn.textContent = o.next || 'Next';
      nextBtn.classList.toggle('hidden', !o.next);
      cap.classList.remove('show');
      void cap.offsetWidth;
      cap.classList.add('show');
      ctx.lastKey = '';
      layout();
    }
    function hideCaption() { cap.classList.remove('show'); }
    function setStep(id) {
      ctx.step = id;
      root.dataset.step = id || '';
      const i = STEPS.indexOf(id);
      if (i >= 0) bar.style.width = Math.round(((i + 1) / STEPS.length) * 100) + '%';
    }
    function nudge() {
      hole.classList.remove('tut-nudge');
      void hole.offsetWidth;
      hole.classList.add('tut-nudge');
    }
    function pressFx(el) {
      if (!el) return;
      el.classList.add('tut-pressed');
      later(() => el.classList.remove('tut-pressed'), 200);
    }
    /** The app "taps" something for you: a white touch dot + press effect. */
    function autoTap(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dot = document.createElement('span');
      dot.className = 'tut-tapdot';
      dot.style.left = Math.round(r.left + r.width / 2) + 'px';
      dot.style.top = Math.round(r.top + r.height / 2) + 'px';
      root.appendChild(dot);
      later(() => dot.remove(), 600);
      pressFx(el);
    }
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.remove('hidden');
      clearTimeout(ctx.toastT);
      ctx.toastT = setTimeout(() => toastEl.classList.add('hidden'), 1500 / speed);
    }
    function navTab(name) {
      root.querySelectorAll('.tut-nav button').forEach((b) => b.classList.toggle('on', b.dataset.tn === name));
    }
    async function reveal(el) {
      const sc = el.closest('.tut-screen');
      if (!sc) return;
      const r = el.getBoundingClientRect();
      const topLimit = 64;
      const bottomLimit = innerHeight - 64 - 76; // nav + room for the caption
      if (r.top >= topLimit && r.bottom <= bottomLimit) return;
      const delta = r.top - Math.max(topLimit, Math.min(innerHeight * 0.32, bottomLimit - r.height));
      sc.scrollTo({ top: sc.scrollTop + delta, behavior: reduced ? 'auto' : 'smooth' });
      await sleep(reduced ? 60 : 420);
    }
    async function go(html, dir) {
      const prev = stage.querySelector('.tut-screen');
      const next = document.createElement('div');
      next.className = 'tut-screen';
      next.innerHTML = '<div class="tut-page">' + html + '</div>';
      if (!prev) { stage.appendChild(next); return; }
      next.classList.add('enter-' + dir);
      prev.classList.add('leave-' + dir);
      stage.appendChild(next);
      void next.offsetWidth;
      next.classList.add('in');
      prev.classList.add('out');
      await sleep(reduced ? 260 : 340);
      prev.remove();
      next.className = 'tut-screen';
    }
    async function typeText(input, text, onChar) {
      input.classList.add('tut-typing');
      input.value = '';
      for (const ch of text) {
        input.value += ch;
        if (onChar) onChar(input.value);
        await sleep(reduced ? 35 : 80);
      }
      input.classList.remove('tut-typing');
    }
    function fill(input, value) {
      input.value = value;
      input.classList.remove('tut-flash');
      void input.offsetWidth;
      input.classList.add('tut-flash');
    }

    /** Spotlight `el` with a pulsing ring and wait for a tap on it. */
    async function tap(el, caption, o) {
      o = o || {};
      if (o.step) setStep(o.step);
      await reveal(el);
      setTarget(el, { ring: true, pad: o.pad, radius: o.radius });
      hit.hidden = false;
      hit.classList.remove('tut-swipe');
      hit.setAttribute('aria-label', o.label || caption);
      await sleep(reduced ? 0 : 180);
      showCaption(caption);
      try { hit.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      await waitable((done) => { ctx.onHit = () => { ctx.onHit = null; done(); }; });
      hit.hidden = true;
      hole.classList.remove('tut-ring');
      hideCaption();
      pressFx(el);
      await sleep(170);
    }
    /** A "slide": spotlight + one-line caption + Next/Done button. */
    async function slide(el, caption, step, o) {
      o = o || {};
      setStep(step);
      await reveal(el);
      setTarget(el, { pad: o.pad != null ? o.pad : 8 });
      await sleep(reduced ? 0 : 200);
      showCaption(caption, { next: o.button || 'Next' });
      try { nextBtn.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      await waitable((done) => { ctx.onNext = () => { ctx.onNext = null; done(); }; });
      hideCaption();
      await sleep(120);
    }

    // ——— Mock screens (look like the real 1.0.x UI; nothing is wired to app code) ———
    function header(title) {
      return '<header class="app-header"><div class="brand">' +
        '<img class="brand-logo" src="templates/as-logo.jpg" alt="" width="36" height="36" />' +
        '<div><h1>AS Forms</h1><p class="sub">' + esc(title) + ' · ' + sub + '</p></div></div></header>';
    }
    function topbar(title, extra) {
      return '<header class="topbar"><button type="button" class="btn ghost back-btn" data-t="back">← Back</button>' +
        '<h1 data-t="title">' + esc(title) + '</h1>' + (extra || '') + '</header>';
    }
    function scrExpenses(withClaim) {
      return header('Expenses') +
        '<div class="chips"><button type="button" class="chip on">Active</button><button type="button" class="chip">Completed</button></div>' +
        '<div class="toolbar"><h2>Expense claims</h2><div class="btn-row inline">' +
        '<button type="button" class="btn secondary">Import…</button>' +
        '<button type="button" class="btn primary" data-t="new">+ New</button></div></div>' +
        '<div class="card-list">' + (withClaim
          ? '<div class="swipe-row" data-t="row"><div class="swipe-bg complete"><span>Completed</span></div>' +
            '<div class="card swipe-front" data-t="front"><p class="title">P1234</p>' +
            '<p class="meta">' + iso + ' → ' + iso + ' · 1 line(s)</p><p class="money">£12.50</p>' +
            '<span class="tut-ghost" aria-hidden="true">' + HAND + '</span></div></div>'
          : '') + '</div>' +
        (withClaim ? '' : '<p class="empty">No claims yet. Tap <strong>+ New</strong> to start.</p>');
    }
    function scrClaim(withLine) {
      return topbar(withLine ? 'P1234' : 'Claim', '<button type="button" class="btn danger ghost">🗑</button>') +
        '<form class="panel">' +
        '<label>Job number<div class="job-prefix" data-t="jobwrap"><span class="pfx">P</span>' +
        '<input type="text" readonly tabindex="-1" data-t="job" value="' + (withLine ? '1234' : '') + '" /></div></label>' +
        '<div class="grid-2"><label>Date from <input type="date" readonly tabindex="-1" value="' + iso + '" /></label>' +
        '<label>Date to <input type="date" readonly tabindex="-1" value="' + iso + '" /></label></div>' +
        '<div class="save-row"><button type="button" class="btn primary">Save claim</button>' +
        '<label class="toggle-control"><span>Completed</span><input type="checkbox" tabindex="-1" /><span class="switch"></span></label></div>' +
        '</form>' +
        '<div class="toolbar"><h2>Line items <span class="badge">' + (withLine ? 1 : 0) + '</span></h2>' +
        '<button type="button" class="btn primary" data-t="add-line">+ Line</button></div>' +
        '<div class="card-list">' + (withLine
          ? '<div class="card line-card tut-new" data-t="line-card"><div class="line-card-body">' +
            '<p class="title"><span class="cat-tag cat-food">Food</span> Demo Café</p>' +
            '<p class="meta">2026-09-15</p><p class="money">£12.50</p></div>' +
            '<div class="line-thumbs"><span class="att-thumb"><img src="img/demo-receipt.svg" alt="" />' +
            '<span class="att-thumb-label">Receipt</span></span></div></div>'
          : '') + '</div>' +
        (withLine ? '' : '<p class="empty">No lines yet.</p>');
    }
    function scrLine() {
      const cats = [['TRAVEL', 'Travel'], ['FOOD', 'Food'], ['EQUIPMENT', 'Equipment'], ['TRAINING', 'Training'], ['MISC', 'Misc']];
      return topbar('Line item', '<button type="button" class="btn danger ghost">🗑</button>') +
        '<form class="panel">' +
        '<label>Date <input type="date" readonly tabindex="-1" data-t="date" value="' + iso + '" /></label>' +
        '<div class="field-block"><span class="field-label">Category</span><div class="cat-chips">' +
        cats.map((c) => '<button type="button" class="cat-chip' + (c[0] === 'MISC' ? ' on' : '') + '" data-t="cat-' + c[0] + '">' + c[1] + '</button>').join('') +
        '</div></div>' +
        '<div data-t="fields">' +
        '<label>Description<div class="desc-prefix"><span class="pfx" data-t="pfx">Misc - </span>' +
        '<input type="text" readonly tabindex="-1" data-t="desc" placeholder="e.g. Taxi to heliport" /></div></label>' +
        '<div class="grid-3"><label>£ Net <input type="text" readonly tabindex="-1" data-t="net" /></label>' +
        '<label>£ VAT <input type="text" readonly tabindex="-1" data-t="vat" /></label>' +
        '<label>£ Total <input type="text" readonly tabindex="-1" data-t="total" /></label></div></div>' +
        '<fieldset class="receipt-box"><legend><span>Receipt</span></legend>' +
        '<div class="tut-file" data-t="attach"><span class="tut-file-btn">Choose file</span><span data-t="fname">No file chosen</span></div>' +
        '<div class="tut-receipt hidden" data-t="preview"><div class="tut-receipt-img" data-t="rimg">' +
        '<img src="img/demo-receipt.svg" alt="Demo receipt" /><span class="tut-scan"></span></div></div>' +
        '<div class="ocr-status hidden" data-t="ocr-status"><span>Reading receipt…</span></div>' +
        '<div class="ocr-suggest hidden" data-t="suggest"><p class="ocr-suggest-title">Suggested from receipt</p>' +
        '<div class="grid-2"><label>Date <input type="date" readonly tabindex="-1" value="2026-09-15" /></label>' +
        '<label>Description <input type="text" readonly tabindex="-1" value="Demo Café" /></label></div>' +
        '<div class="grid-3"><label>£ Net <input type="text" readonly tabindex="-1" value="10.42" /></label>' +
        '<label>£ VAT <input type="text" readonly tabindex="-1" value="2.08" /></label>' +
        '<label>£ Total <input type="text" readonly tabindex="-1" value="12.50" /></label></div>' +
        '<div class="btn-row inline"><button type="button" class="btn primary" data-t="use">Use these</button>' +
        '<button type="button" class="btn secondary">Dismiss</button></div></div>' +
        '</fieldset>' +
        '<button type="button" class="btn primary tut-wide" data-t="save">Save line</button>' +
        '</form>';
    }
    function scrTimesheets(completed) {
      return header('Timesheets') +
        '<div class="chips"><button type="button" class="chip' + (completed ? '' : ' on') + '">Active</button>' +
        '<button type="button" class="chip' + (completed ? ' on' : '') + '" data-t="chip-completed">Completed</button></div>' +
        '<div class="toolbar"><h2>Timesheets</h2><div class="btn-row inline">' +
        '<button type="button" class="btn secondary">Import…</button>' +
        '<button type="button" class="btn primary" data-t="new">+ New</button></div></div>' +
        (completed ? scrDaysList() : '<div class="card-list"></div><p class="empty">No timesheets yet.</p>');
    }
    function scrDaysList() {
      const tiles = [['Holiday', 14], ['Sick', 1], ['Office', 22], ['Training', 5]];
      return '<div class="card-list"><div class="year-group open">' +
        '<button type="button" class="year-toggle open" data-t="year"><span class="yt-text">' +
        '<span class="yt-title">' + tallyLabel + ' · 63 offshore days</span>' +
        '<span class="yt-sub">This year · 6 completed timesheets</span></span><span class="yt-chev">⌄</span></button>' +
        '<div class="days-banner"><p class="period">Days worked · this year</p><p class="label">Offshore days</p>' +
        '<button type="button" class="big tally-tap" data-t="big">63</button>' +
        '<div class="tally-tiles" data-t="tiles">' +
        tiles.map((t) => '<span class="tally-tile"><span class="n">' + t[1] + '</span><span class="lbl">' + t[0] + '</span></span>').join('') +
        '</div></div>' +
        '<button type="button" class="card"><p class="title">' + monthName + ' ' + Y + '</p><p class="meta">2 entries · completed</p></button>' +
        '</div><div class="year-group"><button type="button" class="year-toggle"><span class="yt-text">' +
        '<span class="yt-title">' + prevTallyLabel + ' · 48 offshore days</span>' +
        '<span class="yt-sub">9 completed timesheets</span></span><span class="yt-chev">⌄</span></button></div></div>';
    }
    function scrTsNew() {
      const opts = [-2, -1, 0, 1, 2].map((d) => MONTHS[(M + d + 12) % 12]);
      return topbar('New timesheet') +
        '<form class="panel"><div class="grid-2">' +
        '<label>Month<div class="tut-dd"><div class="tut-select" data-t="month"><span class="v">Month</span><span>▾</span></div>' +
        '<div class="tut-dd-list hidden" data-t="month-list">' +
        opts.map((m) => '<div' + (m === monthName ? ' data-t="month-opt"' : '') + '>' + m + '</div>').join('') +
        '</div></div></label>' +
        '<label>Year<div class="tut-select"><span>' + Y + '</span><span>▾</span></div></label></div>' +
        '<button type="button" class="btn primary tut-wide" data-t="create">Create</button></form>';
    }
    function scrTsEdit(withEntry) {
      return topbar(monthName + ' ' + Y, '<button type="button" class="btn danger ghost">🗑</button>') +
        '<form class="panel"><div class="grid-2">' +
        '<label>Month <div class="tut-select"><span>' + monthName + '</span><span>▾</span></div></label>' +
        '<label>Year <div class="tut-select"><span>' + Y + '</span><span>▾</span></div></label></div></form>' +
        '<div class="ts-file-row"><button type="button" class="btn secondary">Preview</button><button type="button" class="btn secondary">Open file</button></div>' +
        '<div class="toolbar"><h2>Entries <span class="badge">' + (withEntry ? 1 : 0) + '</span></h2>' +
        '<button type="button" class="btn primary" data-t="add-entry">+ Entry</button></div>' +
        '<div class="card-list">' + (withEntry
          ? '<button type="button" class="card tut-new" data-t="entry-card"><p class="title">Days ' + dStart + '–' + dEnd + ' · Offshore</p>' +
            '<p class="meta">P1234 · Offshore survey</p></button>'
          : '') + '</div>' + (withEntry ? '' : '<p class="empty">No entries.</p>');
    }
    function scrEntry() {
      let grid = '';
      for (let i = 0; i < firstDow; i++) grid += '<button type="button" class="cal-day cal-pad" disabled></button>';
      for (let d = 1; d <= lastDay; d++) grid += '<button type="button" class="cal-day" data-t="d' + d + '">' + d + '</button>';
      const types = [['OFFICE', 'Office'], ['OFFSHORE', 'Offshore'], ['ANNUAL_LEAVE', 'Holiday'], ['ROSTER_LEAVE', 'Roster Leave'], ['TRAINING', 'Training'], ['SICK', 'Sick']];
      return topbar('Entry', '<button type="button" class="btn danger ghost">🗑</button>') +
        '<form class="panel">' +
        '<div class="entry-dates"><div class="grid-2">' +
        '<label>Start day <input type="text" readonly tabindex="-1" data-t="start" /></label>' +
        '<label>End day <input type="text" readonly tabindex="-1" data-t="end" /></label></div>' +
        '<button type="button" class="btn secondary">📅 Pick dates…</button></div>' +
        '<div class="entry-cal" data-t="cal"><div class="entry-cal-head"><strong>' + monthName + ' ' + Y + '</strong>' +
        '<span class="hint" data-t="cal-status">Tap start, then end</span></div>' +
        '<div class="entry-cal-weekdays"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>' +
        '<div class="entry-cal-grid">' + grid + '</div>' +
        '<div class="entry-cal-actions"><button type="button" class="btn ghost">Clear</button>' +
        '<button type="button" class="btn primary" data-t="cal-done">Done</button></div></div>' +
        '<div data-t="jobdesc"><label>Project (job)<div class="job-prefix"><span class="pfx">P</span>' +
        '<input type="text" readonly tabindex="-1" data-t="job" /></div></label>' +
        '<label>Description <input type="text" readonly tabindex="-1" data-t="desc" /></label></div>' +
        '<p class="hint" style="margin-bottom:6px">Day type (one only)</p>' +
        '<div class="day-type-grid">' +
        types.map((t) => '<label class="radio" data-t="type-' + t[0] + '"><input type="radio" tabindex="-1" name="tut-dt" /> ' + t[1] + '</label>').join('') +
        '</div>' +
        '<button type="button" class="btn primary tut-wide" data-t="save">Save entry</button></form>';
    }

    // ——— The script ———
    async function swipeStep() {
      const row = q('row');
      const front = q('front');
      setStep('e-swipe');
      await reveal(row);
      setTarget(row, { pad: 6 });
      row.classList.add('tut-demo');
      hit.hidden = false;
      hit.classList.add('tut-swipe');
      hit.setAttribute('aria-label', 'Hold, then swipe left. Or press Next.');
      await sleep(reduced ? 0 : 200);
      showCaption('Hold, then swipe', { next: 'Next' });
      const how = await waitable((done) => {
        let pid = null;
        let sx = 0;
        let dx = 0;
        let armed = false;
        let holdT = null;
        const W = () => row.clientWidth || 300;
        const set = (x) => {
          dx = x;
          front.style.transform = x ? 'translateX(' + x + 'px)' : '';
          row.classList.toggle('show-complete', x < -4);
          row.classList.toggle('past-threshold', x <= -W() * 0.3);
        };
        const reset = () => {
          clearTimeout(holdT);
          armed = false;
          pid = null;
          row.classList.remove('armed', 'dragging', 'past-threshold');
          set(0);
          row.classList.add('tut-demo');
        };
        ctx.swipe = {
          down(e) {
            if (pid !== null) return;
            pid = e.pointerId;
            sx = e.clientX;
            row.classList.remove('tut-demo');
            try { hit.setPointerCapture(pid); } catch (_) { /* ignore */ }
            holdT = setTimeout(() => {
              armed = true;
              row.classList.add('armed', 'dragging');
              if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) { /* ignore */ } }
            }, 400);
          },
          move(e) {
            if (e.pointerId !== pid) return;
            const d = e.clientX - sx;
            if (!armed) { if (Math.abs(d) > 10) clearTimeout(holdT); return; }
            set(Math.min(0, d));
          },
          up(e) {
            if (e.pointerId !== pid) return;
            clearTimeout(holdT);
            if (armed && dx <= -W() * 0.3) { ctx.swipe = null; done('swiped'); } else reset();
          },
          cancel() { reset(); },
        };
        ctx.onNext = () => { ctx.onNext = null; ctx.swipe = null; done('next'); };
      });
      ctx.swipe = null;
      root.dataset.swipe = how;
      hit.hidden = true;
      hit.classList.remove('tut-swipe');
      hideCaption();
      row.classList.remove('tut-demo', 'dragging');
      row.classList.add('armed', 'show-complete');
      front.style.transform = 'translateX(-105%)';
      await sleep(reduced ? 150 : 380);
      row.classList.add('tut-gone');
      toast('Marked complete');
      await sleep(reduced ? 300 : 650);
    }

    async function script() {
      // ——— Expenses ———
      navTab('expenses');
      await go(scrExpenses(false));
      bar.style.width = '2%';
      await sleep(reduced ? 150 : 380);
      await tap(q('new'), 'Tap +', { step: 'e-new', label: 'New claim' });
      await go(scrClaim(false), 'push');
      setTarget(q('jobwrap'), { pad: 6 });
      await sleep(320);
      const title = q('title');
      await typeText(q('job'), '1234', (v) => { title.textContent = 'P' + v; });
      await sleep(300);
      await tap(q('add-line'), 'Add a line', { step: 'e-line' });
      await go(scrLine(), 'push');
      await tap(q('cat-FOOD'), 'Food', { step: 'e-food', pad: 4 });
      q('cat-MISC').classList.remove('on');
      q('cat-FOOD').classList.add('on');
      const pfx = q('pfx');
      pfx.textContent = 'Food - ';
      pfx.classList.add('tut-pfx-in');
      setTarget(pfx.parentElement, { pad: 6 });
      await sleep(650);
      await tap(q('attach'), 'Attach a receipt', { step: 'e-attach', pad: 8 });
      q('fname').textContent = 'demo-receipt.jpg';
      const preview = q('preview');
      preview.classList.remove('hidden');
      await sleep(reduced ? 80 : 280);
      await reveal(preview);
      setTarget(q('rimg'), { pad: 6 });
      preview.classList.add('scanning');
      q('ocr-status').classList.remove('hidden');
      await sleep(1900);
      preview.classList.remove('scanning');
      q('ocr-status').classList.add('hidden');
      const sug = q('suggest');
      sug.classList.remove('hidden');
      sug.classList.add('tut-pop');
      await sleep(reduced ? 80 : 300);
      await tap(q('use'), 'Accept', { step: 'e-accept', label: 'Use these' });
      sug.classList.add('hidden');
      const fields = q('fields');
      await reveal(fields);
      setTarget(fields, { pad: 8 });
      await sleep(200);
      await typeText(q('desc'), 'Demo Café');
      q('date').value = '2026-09-15';
      for (const [k, v] of [['net', '10.42'], ['vat', '2.08'], ['total', '12.50']]) {
        fill(q(k), v);
        await sleep(reduced ? 60 : 170);
      }
      await sleep(450);
      const save = q('save');
      clearTarget();
      await reveal(save);
      autoTap(save);
      await sleep(320);
      await go(scrClaim(true), 'pop');
      await sleep(reduced ? 100 : 350);
      setTarget(q('line-card'), { pad: 6 });
      await sleep(1300);
      clearTarget();
      autoTap(q('back'));
      await sleep(280);
      await go(scrExpenses(true), 'pop');
      await sleep(250);
      await swipeStep();

      // ——— Timesheets ———
      clearTarget();
      const tsTab = root.querySelector('.tut-nav [data-tn="timesheets"]');
      autoTap(tsTab);
      navTab('timesheets');
      await sleep(250);
      await go(scrTimesheets(false), 'fade');
      await sleep(300);
      autoTap(q('new'));
      await sleep(320);
      await go(scrTsNew(), 'push');
      await tap(q('month'), 'Pick a month', { step: 't-month' });
      const list = q('month-list');
      list.classList.remove('hidden');
      setTarget(list, { pad: 4 });
      await sleep(500);
      q('month-opt').classList.add('on');
      await sleep(450);
      list.classList.add('hidden');
      q('month').querySelector('.v').textContent = monthName;
      setTarget(q('month'), { pad: 6 });
      await sleep(380);
      clearTarget();
      autoTap(q('create'));
      await sleep(300);
      await go(scrTsEdit(false), 'push');
      await sleep(320);
      autoTap(q('add-entry'));
      await sleep(300);
      await go(scrEntry(), 'push');
      await tap(q('d' + dStart), 'Tap start', { step: 't-start', pad: 3, label: 'Day ' + dStart });
      q('d' + dStart).classList.add('range-start', 'pending');
      q('start').value = String(dStart);
      q('cal-status').textContent = 'Tap end';
      await tap(q('d' + dEnd), 'Tap end', { step: 't-end', pad: 3, label: 'Day ' + dEnd });
      q('d' + dStart).classList.remove('pending');
      setTarget(q('cal'), { pad: 4 });
      for (let d = dStart + 1; d < dEnd; d++) {
        q('d' + d).classList.add('in-range');
        if (!reduced) await sleep(28);
      }
      q('d' + dEnd).classList.add('range-end');
      q('end').value = String(dEnd);
      q('cal-status').textContent = dStart + '–' + dEnd + ' · ' + (dEnd - dStart + 1) + ' days';
      await sleep(650);
      autoTap(q('cal-done'));
      await sleep(260);
      q('cal').classList.add('hidden');
      const jd = q('jobdesc');
      await reveal(jd);
      setTarget(jd, { pad: 8 });
      await typeText(q('job'), '1234');
      await typeText(q('desc'), 'Offshore survey');
      await sleep(200);
      const off = q('type-OFFSHORE');
      await tap(off, 'Offshore', { step: 't-offshore', pad: 3 });
      off.querySelector('input').checked = true;
      off.classList.add('tut-checked');
      await sleep(350);
      clearTarget();
      const saveE = q('save');
      await reveal(saveE);
      autoTap(saveE);
      await sleep(300);
      await go(scrTsEdit(true), 'pop');
      await sleep(reduced ? 100 : 350);
      setTarget(q('entry-card'), { pad: 6 });
      await sleep(1300);

      // ——— Days worked (Timesheets → Completed) ———
      clearTarget();
      autoTap(q('back'));
      await sleep(260);
      await go(scrTimesheets(false), 'pop');
      await sleep(300);
      autoTap(q('chip-completed'));
      await sleep(250);
      await go(scrTimesheets(true), 'fade');
      await sleep(300);
      await slide(q('big'), 'Offshore days', 'd-big', { pad: 6 });
      await slide(q('tiles'), 'Holiday · Sick · Office · Training', 'd-tiles', { pad: 6 });
      await slide(q('year'), 'Each Mar–Feb tally year', 'd-year', { pad: 6, button: 'Done' });
    }

    // ——— Input ———
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish('skip'); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(root.querySelectorAll('button')).filter((b) =>
        !b.hidden && !b.disabled && !b.closest('[inert]') && !b.closest('.hidden') && b.getClientRects().length);
      if (!f.length) return;
      e.preventDefault();
      const i = f.indexOf(document.activeElement);
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length;
      f[n].focus();
    }
    document.addEventListener('keydown', onKey, true);
    $r('.tut-skip').addEventListener('click', () => finish('skip'));
    $r('.tut-block').addEventListener('pointerdown', (e) => { e.preventDefault(); nudge(); });
    $r('.tut-block').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    hit.addEventListener('click', () => { if (ctx.onHit) ctx.onHit(); });
    hit.addEventListener('pointerdown', (e) => { if (ctx.swipe) ctx.swipe.down(e); });
    hit.addEventListener('pointermove', (e) => { if (ctx.swipe) ctx.swipe.move(e); });
    hit.addEventListener('pointerup', (e) => { if (ctx.swipe) ctx.swipe.up(e); });
    hit.addEventListener('pointercancel', () => { if (ctx.swipe) ctx.swipe.cancel(); });
    hit.addEventListener('contextmenu', (e) => e.preventDefault());
    nextBtn.addEventListener('click', () => { if (ctx.onNext) ctx.onNext(); });

    function finish(reason) {
      if (ctx.finished) return;
      ctx.finished = true;
      ctx.cancelled = true;
      ctx.timers.forEach((t) => clearTimeout(t));
      ctx.timers.clear();
      clearTimeout(ctx.movingT);
      clearTimeout(ctx.toastT);
      ctx.rejects.forEach((r) => r());
      ctx.rejects.clear();
      cancelAnimationFrame(ctx.raf);
      document.removeEventListener('keydown', onKey, true);
      inertEls.forEach((x) => { x.el.inert = x.was; });
      document.documentElement.classList.remove('tut-open');
      active = null;
      if (reason === 'done' && !reduced) {
        root.classList.add('tut-out');
        setTimeout(() => root.remove(), 260);
      } else {
        root.remove();
      }
      try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      resolveEnd({ reason });
      if (opts.onEnd) { try { opts.onEnd(reason); } catch (e) { console.error(e); } }
    }
    ctx.finish = finish;

    ctx.raf = requestAnimationFrame(frame);
    script().then(() => finish('done'), (e) => {
      if (e !== CANCEL) { console.error(e); finish('error'); }
    });
    return ctx;
  }

  global.AsTutorial = { start, isOpen, skip, seen, markSeen, currentStep, SEEN_KEY, STEPS };
})(typeof window !== 'undefined' ? window : globalThis);
