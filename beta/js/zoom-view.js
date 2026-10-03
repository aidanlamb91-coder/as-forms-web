/**
 * Pinch / double-tap / drag zoom for a content element inside a viewport (port of the idea of
 * Android ui/components/ZoomableBox.kt). Pointer-event based: works with touch (iOS Safari,
 * Android Chrome), pen and mouse (drag to pan, double-click or Ctrl+wheel / buttons to zoom).
 *
 *   const z = AsZoomView.attach(viewport, content, { fit: 'contain' | 'width', maxScale: 5 });
 *   z.zoomBy(1.5); z.reset(); z.destroy();
 */
(function (global) {
  function attach(viewport, content, opts) {
    opts = opts || {};
    const fitMode = opts.fit || 'contain';
    const maxFactor = opts.maxScale || 5;
    viewport.classList.add('zoom-viewport');
    content.classList.add('zoom-content');
    content.style.transformOrigin = '0 0';

    let s = 1;
    let tx = 0;
    let ty = 0;
    let fit = 1;
    const pointers = new Map();
    let pinch = null;
    let pan = null;
    let lastTap = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    function natural() {
      return { w: content.offsetWidth || 1, h: content.offsetHeight || 1 };
    }
    function vp() {
      return { w: viewport.clientWidth || 1, h: viewport.clientHeight || 1 };
    }
    function computeFit() {
      const n = natural();
      const v = vp();
      fit = fitMode === 'width' ? v.w / n.w : Math.min(v.w / n.w, v.h / n.h);
      if (opts.noUpscale) fit = Math.min(fit, 1);
      if (!Number.isFinite(fit) || fit <= 0) fit = 1;
    }
    function clamp() {
      const n = natural();
      const v = vp();
      const cw = n.w * s;
      const ch = n.h * s;
      if (cw <= v.w) tx = (v.w - cw) / 2;
      else tx = Math.min(0, Math.max(v.w - cw, tx));
      if (ch <= v.h) ty = fitMode === 'width' ? 0 : (v.h - ch) / 2;
      else ty = Math.min(0, Math.max(v.h - ch, ty));
    }
    function apply() {
      clamp();
      content.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
      if (opts.onChange) opts.onChange(s / fit);
    }
    function zoomAt(newScale, cx, cy) {
      const minS = fit;
      const maxS = fit * maxFactor;
      newScale = Math.max(minS, Math.min(maxS, newScale));
      // keep the content point under (cx, cy) fixed
      const px = (cx - tx) / s;
      const py = (cy - ty) / s;
      s = newScale;
      tx = cx - px * s;
      ty = cy - py * s;
      apply();
    }
    function local(ev) {
      const r = viewport.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }
    function reset() {
      computeFit();
      s = fit;
      tx = 0;
      ty = 0;
      apply();
    }
    function zoomBy(f) {
      const v = vp();
      zoomAt(s * f, v.w / 2, v.h / 2);
    }

    function onDown(ev) {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      viewport.setPointerCapture && viewport.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, local(ev));
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx, ty };
        pan = null;
      } else if (pointers.size === 1) {
        const p = local(ev);
        pan = { x: p.x, y: p.y, tx, ty, moved: false };
      }
    }
    function onMove(ev) {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, local(ev));
      if (pinch && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        // scale around the original pinch centre, then follow the centre's movement
        s = pinch.s;
        tx = pinch.tx;
        ty = pinch.ty;
        zoomAt(pinch.s * (d / pinch.d), pinch.cx, pinch.cy);
        tx += cx - pinch.cx;
        ty += cy - pinch.cy;
        apply();
        ev.preventDefault();
      } else if (pan) {
        const p = local(ev);
        const ddx = p.x - pan.x;
        const ddy = p.y - pan.y;
        if (Math.abs(ddx) + Math.abs(ddy) > 3) pan.moved = true;
        tx = pan.tx + ddx;
        ty = pan.ty + ddy;
        apply();
        ev.preventDefault();
      }
    }
    function onUp(ev) {
      if (!pointers.has(ev.pointerId)) return;
      const p = local(ev);
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const rest = Array.from(pointers.values())[0];
        pan = { x: rest.x, y: rest.y, tx, ty, moved: true };
        return;
      }
      if (pointers.size === 0) {
        const wasTap = pan && !pan.moved;
        pan = null;
        if (wasTap && ev.type === 'pointerup') {
          const now = Date.now();
          if (now - lastTap < 320 && Math.abs(p.x - lastTapX) < 30 && Math.abs(p.y - lastTapY) < 30) {
            // double-tap: toggle between fit and 2.5×
            if (s > fit * 1.05) reset();
            else zoomAt(fit * 2.5, p.x, p.y);
            lastTap = 0;
          } else {
            lastTap = now;
            lastTapX = p.x;
            lastTapY = p.y;
          }
        }
      }
    }
    function onWheel(ev) {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        const p = local(ev);
        zoomAt(s * Math.exp(-ev.deltaY * 0.01), p.x, p.y);
      } else {
        ev.preventDefault();
        tx -= ev.deltaX;
        ty -= ev.deltaY;
        apply();
      }
    }
    // Safari's own pinch gesture events — stop page zoom inside the viewer
    function stopGesture(ev) { ev.preventDefault(); }

    viewport.addEventListener('pointerdown', onDown);
    viewport.addEventListener('pointermove', onMove);
    viewport.addEventListener('pointerup', onUp);
    viewport.addEventListener('pointercancel', onUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('gesturestart', stopGesture);
    viewport.addEventListener('gesturechange', stopGesture);
    const ro = global.ResizeObserver ? new ResizeObserver(() => {
      const rel = s / fit;
      computeFit();
      s = fit * rel;
      apply();
    }) : null;
    if (ro) { ro.observe(viewport); ro.observe(content); }

    reset();

    return {
      reset,
      zoomBy,
      get scale() { return s / fit; },
      refresh: reset,
      destroy() {
        if (ro) ro.disconnect();
        viewport.removeEventListener('pointerdown', onDown);
        viewport.removeEventListener('pointermove', onMove);
        viewport.removeEventListener('pointerup', onUp);
        viewport.removeEventListener('pointercancel', onUp);
        viewport.removeEventListener('wheel', onWheel);
        viewport.removeEventListener('gesturestart', stopGesture);
        viewport.removeEventListener('gesturechange', stopGesture);
      },
    };
  }

  global.AsZoomView = { attach };
})(window);
