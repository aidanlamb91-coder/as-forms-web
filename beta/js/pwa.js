/**
 * Install to Home Screen + offline (web 1.0.0).
 * - Registers sw.js (scope = this folder, so /beta/ and the stable root stay separate).
 * - "New version available — Reload" bar when an updated worker is waiting.
 * - Android / desktop Chrome & Edge: the browser's own install prompt (beforeinstallprompt).
 * - iPhone / iPad Safari: there is no prompt API, so we show a short illustrated sheet
 *   (Share → Add to Home Screen → Add).
 * - Everything install-related is hidden when already running as the installed app.
 */
(function (global) {
  const BANNER_KEY = 'as-forms-install-banner-dismissed';
  let deferredPrompt = null;
  let waitingWorker = null;
  let reloading = false;
  const listeners = new Set();

  function notify() { listeners.forEach((fn) => { try { fn(state()); } catch (_) { /* ignore */ } }); }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function isStandalone() {
    try {
      if (global.matchMedia && (global.matchMedia('(display-mode: standalone)').matches ||
        global.matchMedia('(display-mode: fullscreen)').matches ||
        global.matchMedia('(display-mode: minimal-ui)').matches)) return true;
    } catch (_) { /* ignore */ }
    return global.navigator.standalone === true;
  }

  function isIos() {
    const ua = global.navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS 13+ reports itself as a Mac; a touch screen gives it away
    return /Macintosh/.test(ua) && (global.navigator.maxTouchPoints || 0) > 1;
  }

  /** iOS browsers other than Safari (Chrome/Firefox/Edge on iPhone) cannot add web apps before iOS 16.4. */
  function isIosNonSafari() {
    const ua = global.navigator.userAgent || '';
    return isIos() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  }

  function state() {
    return {
      standalone: isStandalone(),
      ios: isIos(),
      iosNonSafari: isIosNonSafari(),
      canPrompt: !!deferredPrompt,
      updateReady: !!waitingWorker,
      swSupported: 'serviceWorker' in global.navigator,
    };
  }

  /** Can we offer an "Install" action right now? */
  function canOfferInstall() {
    const s = state();
    return !s.standalone && (s.canPrompt || s.ios);
  }

  async function promptInstall() {
    if (!deferredPrompt) return 'unavailable';
    const p = deferredPrompt;
    deferredPrompt = null;
    p.prompt();
    let outcome = 'dismissed';
    try { outcome = (await p.userChoice).outcome; } catch (_) { /* ignore */ }
    notify();
    return outcome;
  }

  function bannerDismissed() {
    try { return global.localStorage.getItem(BANNER_KEY) === '1'; } catch (_) { return false; }
  }
  function dismissBanner() {
    try { global.localStorage.setItem(BANNER_KEY, '1'); } catch (_) { /* ignore */ }
    notify();
  }
  function shouldShowBanner() { return canOfferInstall() && !bannerDismissed(); }

  // ——— Service worker ———
  function showUpdate(worker) {
    waitingWorker = worker;
    notify();
  }

  function applyUpdate() {
    if (!waitingWorker) { global.location.reload(); return; }
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    // controllerchange → reload (below). Fallback in case it never fires.
    setTimeout(() => { if (!reloading) global.location.reload(); }, 3000);
  }

  async function register() {
    if (!('serviceWorker' in global.navigator)) return null;
    if (global.location.protocol !== 'https:' && global.location.hostname !== 'localhost' && global.location.hostname !== '127.0.0.1') return null;
    try {
      const hadController = !!global.navigator.serviceWorker.controller;
      const reg = await global.navigator.serviceWorker.register('sw.js', { scope: './' });
      if (reg.waiting && hadController) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          // Only an UPDATE (a page already controlled) needs the prompt; first install just works.
          if (w.state === 'installed' && global.navigator.serviceWorker.controller) showUpdate(w);
        });
      });
      global.navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return; // first install claiming the page: no reload
        if (!waitingWorker) return;
        reloading = true;
        global.location.reload();
      });
      // Check for a new version when the app comes back to the foreground.
      global.document.addEventListener('visibilitychange', () => {
        if (global.document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      return reg;
    } catch (e) {
      console.warn('Service worker registration failed', e);
      return null;
    }
  }

  global.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button/banner instead of the mini-infobar
    deferredPrompt = e;
    notify();
  });
  global.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    dismissBanner();
  });
  try {
    global.matchMedia('(display-mode: standalone)').addEventListener('change', notify);
  } catch (_) { /* old Safari */ }

  // ——— iOS instruction sheet markup ———
  const SHARE_ICON = '<svg class="ios-glyph" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M7.5 7.5 12 3l4.5 4.5M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg>';
  const ADD_ICON = '<svg class="ios-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function iosSheetHtml() {
    const nonSafari = isIosNonSafari();
    return '<div class="install-sheet" role="dialog" aria-modal="true" aria-labelledby="ios-install-title">' +
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="install-sheet-head"><img src="icons/apple-touch-icon.png" alt="" class="install-app-icon"><div><h2 id="ios-install-title">Add AS Forms to your Home Screen</h2><p class="muted">Opens full-screen like an app and works offline.</p></div></div>' +
      (nonSafari ? '<p class="install-warn">Open this page in <b>Safari</b> first — other iPhone browsers may not offer “Add to Home Screen”.</p>' : '') +
      '<ol class="ios-steps">' +
      '<li><span class="step-num">1</span><span class="step-text">Tap the <b>Share</b> button ' + SHARE_ICON + ' in Safari’s toolbar <span class="muted">(bottom of the screen on iPhone, top on iPad)</span>.</span></li>' +
      '<li><span class="step-num">2</span><span class="step-text">Scroll down and tap <b>Add to Home Screen</b> ' + ADD_ICON + '.</span></li>' +
      '<li><span class="step-num">3</span><span class="step-text">Tap <b>Add</b> (top right). Then open <b>AS Forms</b> from your Home Screen.</span></li>' +
      '</ol>' +
      '<div class="ios-mock" aria-hidden="true">' +
      '<div class="ios-mock-row"><span>Copy</span></div>' +
      '<div class="ios-mock-row"><span>Add to Reading List</span></div>' +
      '<div class="ios-mock-row hl"><span>Add to Home Screen</span>' + ADD_ICON + '</div>' +
      '<div class="ios-mock-row"><span>Find on Page</span></div>' +
      '</div>' +
      '<p class="install-note"><b>Your data:</b> the Home Screen app keeps its own storage, separate from Safari. Expenses or timesheets entered in Safari won’t appear in the Home Screen app. To move them: in Safari go to <b>Settings → Backup &amp; restore → Export backup</b>, then in the Home Screen app use <b>Restore backup</b>.</p>' +
      '<div class="actions"><button type="button" class="btn primary" data-close>Got it</button></div>' +
      '</div>';
  }

  global.AsPwa = {
    register,
    state,
    onChange,
    isStandalone,
    isIos,
    isIosNonSafari,
    canOfferInstall,
    promptInstall,
    shouldShowBanner,
    dismissBanner,
    applyUpdate,
    iosSheetHtml,
  };
})(window);
