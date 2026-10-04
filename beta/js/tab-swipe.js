/**
 * 1.0.3: swipe left / right on blank space of a top-level tab (Expenses ⇄ Timesheets ⇄
 * Settings) to change tab (Android ui/components/TabSwipe.kt).
 *
 * Never fights other gestures: a swipe that STARTS on a hold-then-swipe row, a form field,
 * the calendar, a zoom viewer, a dialog / sheet, the guided tour, the bottom nav, or anything
 * horizontally scrollable is ignored; so are swipes from the screen edge (iOS / Android back
 * gesture), two-finger gestures, and anything that is not clearly horizontal:
 * |dx| ≥ 72 px and the largest |dy| seen ≤ ½ |dx|. Touch only (desktop uses the nav buttons).
 */
(function (global) {
  const MIN_DISTANCE = 72;
  const MAX_SLOPE = 0.5;
  const EDGE = 16;
  const EXCLUDE = [
    '.swipe-row', 'input', 'textarea', 'select', 'button.year-step', '[contenteditable]', '.entry-cal',
    '.viewer', '.zoom-viewport', '.viewer-stage', '#modal-root', '.modal-backdrop', '.sheet-backdrop',
    '.tut-root', '.bottom-nav', '[data-no-tab-swipe]',
  ].join(',');

  /** -1 = previous tab, +1 = next tab, 0 = not a tab swipe. */
  function decide(dx, maxAbsDy) {
    if (Math.abs(dx) < MIN_DISTANCE) return 0;
    if (maxAbsDy > Math.abs(dx) * MAX_SLOPE) return 0;
    return dx < 0 ? 1 : -1;
  }

  function target(current, dir, order) {
    const i = order.indexOf(current);
    if (i < 0 || !dir) return null;
    const t = i + dir;
    return t >= 0 && t < order.length ? order[t] : null;
  }

  function scrollsSideways(el) {
    if (!el || el.nodeType !== 1 || !global.getComputedStyle) return false;
    const ox = getComputedStyle(el).overflowX;
    return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1;
  }

  /** True when a gesture starting on [el] must never become a tab swipe. */
  function excluded(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.matches(EXCLUDE)) return true;
      if (scrollsSideways(n)) return true;
    }
    return false;
  }

  /**
   * opts.canSwipe() → true when a top-level tab is showing and nothing is open on top.
   * opts.onSwipe(dir) with dir = -1 / +1.
   */
  function attach(opts) {
    const root = opts.root || document;
    let g = null;
    root.addEventListener('touchstart', (e) => {
      g = null;
      if (e.touches.length !== 1 || !opts.canSwipe()) return;
      const t = e.touches[0];
      const w = global.innerWidth || 0;
      if (t.clientX < EDGE || (w && t.clientX > w - EDGE)) return;
      if (excluded(e.target)) return;
      g = { id: t.identifier, x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, maxDy: 0 };
    }, { passive: true });
    root.addEventListener('touchmove', (e) => {
      if (!g) return;
      if (e.touches.length > 1) { g = null; return; }
      const t = Array.from(e.changedTouches).find((x) => x.identifier === g.id);
      if (!t) return;
      g.lx = t.clientX;
      g.ly = t.clientY;
      g.maxDy = Math.max(g.maxDy, Math.abs(t.clientY - g.y));
    }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (!g) return;
      const t = Array.from(e.changedTouches).find((x) => x.identifier === g.id);
      const cur = g;
      g = null;
      if (!t || !opts.canSwipe()) return;
      const maxDy = Math.max(cur.maxDy, Math.abs(t.clientY - cur.y));
      const dir = decide(t.clientX - cur.x, maxDy);
      if (dir) opts.onSwipe(dir);
    }, { passive: true });
    root.addEventListener('touchcancel', () => { g = null; }, { passive: true });
  }

  global.AsTabSwipe = { attach, decide, target, excluded, MIN_DISTANCE, MAX_SLOPE, EDGE };
})(typeof window !== 'undefined' ? window : globalThis);
