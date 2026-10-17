/**
 * Safer swipes (port of Android ui/components/SwipeableRow.kt, 0.3.8):
 * a quick swipe does nothing. Press and hold ~400 ms without moving (light vibration where
 * supported; the row lifts slightly with a soft highlight), THEN drag sideways:
 *   right = red Delete, left = green Completed (only when onComplete is given),
 * released past 30% of the row width; otherwise it springs back.
 * Moving before the hold completes is left to the browser, so vertical scrolling is untouched
 * (rows use touch-action: pan-y; once armed, touchmove is cancelled so iOS Safari does not scroll).
 *
 * 1.1.0-web: directions now match Android 1.0.8+ — items swipe toward the tab they are going to:
 *   Active tab (opts.onComplete):   right = green Complete, left = red Delete
 *   Completed tab (opts.onReopen):  left = blue Reopen,     right = red Delete
 *   Lines / entries (neither):      right = red Delete only
 */
(function (global) {
  /**
   * Plain rule used by the row and the tests: which action a drag of dx pixels means.
   * Returns 'delete', 'complete', 'reopen' or null (no action that way).
   */
  function actionFor(opts, dx) {
    if (!dx) return null;
    const right = dx > 0;
    if (opts.onComplete) return right ? 'complete' : (opts.onDelete ? 'delete' : null);
    if (opts.onReopen) return right ? (opts.onDelete ? 'delete' : null) : 'reopen';
    return right && opts.onDelete ? 'delete' : null;
  }

  const HOLD_MS = 400;
  const SLOP = 10; // px of movement allowed during the hold
  const COMMIT_FRACTION = 0.3;

  function wrap(frontEl, opts) {
    opts = opts || {};
    const row = document.createElement('div');
    row.className = 'swipe-row';
    const bgDel = document.createElement('div');
    bgDel.className = 'swipe-bg delete';
    bgDel.innerHTML = '<span>Delete</span>';
    row.appendChild(bgDel);
    if (opts.onComplete) {
      // Active rows: green Complete shows on the left as the card slides right
      bgDel.classList.add('on-right');
      const bgOk = document.createElement('div');
      bgOk.className = 'swipe-bg complete on-left';
      bgOk.innerHTML = '<span>Complete</span>';
      row.appendChild(bgOk);
    } else if (opts.onReopen) {
      const bgRe = document.createElement('div');
      bgRe.className = 'swipe-bg reopen on-right';
      bgRe.innerHTML = '<span>Reopen</span>';
      row.appendChild(bgRe);
    }
    frontEl.classList.add('swipe-front');
    row.appendChild(frontEl);

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let holdTimer = null;
    let armed = false;
    let suppressClick = false;
    let busy = false;

    function width() { return row.clientWidth || 300; }

    function setOffset(x) {
      dx = x;
      frontEl.style.transform = x ? 'translateX(' + x + 'px)' : '';
      const a = Math.abs(x) > 4 ? actionFor(opts, x) : null;
      row.classList.toggle('show-delete', a === 'delete');
      row.classList.toggle('show-complete', a === 'complete');
      row.classList.toggle('show-reopen', a === 'reopen');
      const past = Math.abs(x) >= width() * COMMIT_FRACTION;
      row.classList.toggle('past-threshold', past);
    }

    function clearHold() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    }

    function reset() {
      clearHold();
      armed = false;
      pointerId = null;
      row.classList.remove('armed', 'dragging', 'past-threshold');
      setOffset(0);
    }

    function arm() {
      holdTimer = null;
      if (pointerId == null) return;
      armed = true;
      row.classList.add('armed', 'dragging');
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) { /* ignore */ } }
      try { frontEl.setPointerCapture(pointerId); } catch (_) { /* ignore */ }
    }

    async function commit(action) {
      busy = true;
      row.classList.remove('dragging');
      setOffset(dx > 0 ? width() : -width());
      try {
        if (action === 'delete') {
          if (opts.confirmDelete && !confirm(opts.deleteConfirm || 'Delete this item?')) {
            busy = false;
            reset();
            return;
          }
          await opts.onDelete();
        } else if (action === 'reopen') {
          await opts.onReopen();
        } else {
          await opts.onComplete();
        }
      } catch (e) {
        console.error(e);
        if (global.__asToast) global.__asToast('Action failed');
      }
      busy = false;
      if (row.isConnected) reset();
    }

    frontEl.addEventListener('click', (ev) => {
      if (suppressClick) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        suppressClick = false;
      }
    }, true);

    frontEl.addEventListener('contextmenu', (ev) => {
      if (holdTimer || armed) ev.preventDefault();
    });

    frontEl.addEventListener('pointerdown', (ev) => {
      if (busy) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (pointerId != null) { reset(); return; } // second finger → cancel
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      dx = 0;
      armed = false;
      suppressClick = false;
      clearHold();
      holdTimer = setTimeout(arm, HOLD_MS);
    });

    frontEl.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== pointerId) return;
      const mx = ev.clientX - startX;
      const my = ev.clientY - startY;
      if (!armed) {
        // Moved before the hold finished → a scroll or quick swipe: leave it alone.
        if (Math.abs(mx) > SLOP || Math.abs(my) > SLOP) {
          clearHold();
          pointerId = null;
        }
        return;
      }
      ev.preventDefault();
      let x = mx;
      const max = width() * 0.9;
      if (!actionFor(opts, x)) x = Math.max(-20, Math.min(20, x)); // no action that way: slight rubber band
      x = Math.max(-max, Math.min(max, x));
      setOffset(x);
    });

    function end(ev) {
      if (ev.pointerId !== pointerId) return;
      clearHold();
      if (!armed) { pointerId = null; return; }
      suppressClick = true; // a hold never opens the row
      try { frontEl.releasePointerCapture(pointerId); } catch (_) { /* ignore */ }
      pointerId = null;
      const past = Math.abs(dx) >= width() * COMMIT_FRACTION;
      const action = actionFor(opts, dx);
      if (ev.type === 'pointerup' && past && action) commit(action);
      else reset();
      // Clear suppress shortly after in case no click follows (touch devices)
      setTimeout(() => { suppressClick = false; }, 400);
    }
    frontEl.addEventListener('pointerup', end);
    frontEl.addEventListener('pointercancel', end);

    // iOS Safari: once armed, stop the page from scrolling while the finger drags sideways.
    frontEl.addEventListener('touchmove', (ev) => {
      if (armed) ev.preventDefault();
    }, { passive: false });

    return row;
  }

  global.AsHoldSwipe = { wrap, actionFor, HOLD_MS, COMMIT_FRACTION };
})(window);
