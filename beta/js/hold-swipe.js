/**
 * Safer swipes (port of Android ui/components/SwipeableRow.kt, 0.3.8):
 * a quick swipe does nothing. Press and hold ~400 ms without moving (light vibration where
 * supported; the row lifts slightly with a soft highlight), THEN drag sideways:
 *   right = red Delete, left = green Completed (only when onComplete is given),
 * released past 30% of the row width; otherwise it springs back.
 * Moving before the hold completes is left to the browser, so vertical scrolling is untouched
 * (rows use touch-action: pan-y; once armed, touchmove is cancelled so iOS Safari does not scroll).
 */
(function (global) {
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
      const bgOk = document.createElement('div');
      bgOk.className = 'swipe-bg complete';
      bgOk.innerHTML = '<span>Completed</span>';
      row.appendChild(bgOk);
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
      row.classList.toggle('show-delete', x > 4);
      row.classList.toggle('show-complete', x < -4 && !!opts.onComplete);
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
      setOffset(action === 'delete' ? width() : -width());
      try {
        if (action === 'delete') {
          if (opts.confirmDelete && !confirm(opts.deleteConfirm || 'Delete this item?')) {
            busy = false;
            reset();
            return;
          }
          await opts.onDelete();
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
      if (!opts.onComplete && x < 0) x = Math.max(x, -20); // no left action: slight rubber band
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
      if (ev.type === 'pointerup' && past && dx > 0) commit('delete');
      else if (ev.type === 'pointerup' && past && dx < 0 && opts.onComplete) commit('complete');
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

  global.AsHoldSwipe = { wrap, HOLD_MS, COMMIT_FRACTION };
})(window);
