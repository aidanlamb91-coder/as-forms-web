/*
 * AS Forms web — UK dates everywhere (1.2.1-web, Coach review).
 *
 * Browsers show <input type="date"> in the computer's own format (an American laptop shows
 * mm/dd/yyyy). This file puts a dd/mm/yyyy box in front of every date input on the page, while
 * the real date input stays underneath as the one that holds the value — so all the existing app
 * code still reads and writes "yyyy-mm-dd" from the same element and nothing else had to change.
 *
 *   - Type the date (the slashes go in by themselves), or tap the calendar button for the
 *     browser's own date picker.
 *   - When a full, real date is typed the real input is updated and its input/change events fire.
 *   - Anything the app sets with `.value = …` shows straight away in the UK box.
 * New date inputs (sheets, cards drawn later) are picked up automatically.
 */
(function (global) {
  const doc = global.document;
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2zm-1 8v10h12V10H6zm2 2h3v3H8v-3z"/></svg>';
  let n = 0;

  /** "2026-10-17" → "17/10/2026" ('' when empty or not a date). */
  function toUk(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  /** "17/10/2026" → "2026-10-17"; null when it isn't a real calendar date. */
  function toIso(uk) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(uk || '');
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return m[3] + '-' + m[2] + '-' + m[1];
  }
  /** Puts the slashes in while typing: "1710" → "17/10", "17102026" → "17/10/2026". */
  function shape(text) {
    const d = String(text || '').replace(/\D/g, '').slice(0, 8);
    return d.length > 4 ? d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4) : d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  }

  function enhance(native) {
    if (native.dataset.ukDate) return;
    native.dataset.ukDate = '1';
    const wrap = doc.createElement('span');
    wrap.className = 'uk-date';
    native.parentNode.insertBefore(wrap, native);
    const text = doc.createElement('input');
    text.type = 'text';
    text.className = 'uk-date-text';
    text.id = (native.id || 'uk-date-' + (++n)) + '-uk';
    text.inputMode = 'numeric';
    text.placeholder = 'dd/mm/yyyy';
    text.maxLength = 10;
    text.autocomplete = 'off';
    wrap.appendChild(text);
    const ro = native.readOnly;
    let btn = null;
    if (!ro) {
      btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn uk-date-cal';
      btn.setAttribute('aria-label', 'Pick a date');
      btn.tabIndex = -1;
      btn.innerHTML = CAL;
      wrap.appendChild(btn);
    }
    wrap.appendChild(native);
    native.classList.add('uk-date-native');
    native.tabIndex = -1;
    native.setAttribute('aria-hidden', 'true');
    // a <label for="…"> now points at the box you can see
    if (native.id) doc.querySelectorAll('label[for="' + CSS.escape(native.id) + '"]').forEach((l) => { l.htmlFor = text.id; });

    const show = () => { text.value = toUk(proto.get.call(native)); text.classList.remove('invalid'); };
    const mirror = () => {
      text.disabled = native.disabled; text.readOnly = native.readOnly || native.disabled;
      if (btn) btn.disabled = native.disabled || native.readOnly;
      text.required = native.required;
    };
    // app code setting .value = "yyyy-mm-dd" shows at once in the UK box
    Object.defineProperty(native, 'value', {
      configurable: true,
      get() { return proto.get.call(this); },
      set(v) { proto.set.call(this, v); show(); },
    });
    const fire = () => {
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    };
    text.addEventListener('input', () => {
      const shaped = shape(text.value);
      if (shaped !== text.value) text.value = shaped;
      if (!shaped) { if (proto.get.call(native)) { proto.set.call(native, ''); fire(); } text.classList.remove('invalid'); return; }
      const iso = toIso(shaped);
      text.classList.toggle('invalid', shaped.length === 10 && !iso);
      if (iso && iso !== proto.get.call(native)) { proto.set.call(native, iso); fire(); }
    });
    text.addEventListener('blur', show); // a half-typed date goes back to the saved one
    native.addEventListener('input', show);
    native.addEventListener('change', show);
    if (btn) btn.addEventListener('click', () => {
      try { native.showPicker(); } catch (_) { native.focus(); }
    });
    new MutationObserver(mirror).observe(native, { attributes: true, attributeFilter: ['disabled', 'readonly', 'required'] });
    mirror();
    show();
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[type="date"]')) enhance(root);
    root.querySelectorAll('input[type="date"]:not([data-uk-date])').forEach(enhance);
  }
  function start() {
    scan(doc.body);
    new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach((x) => { if (x.nodeType === 1) scan(x); }); })
      .observe(doc.body, { childList: true, subtree: true });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();

  global.AsUkDate = { toUk, toIso, shape, enhance };
})(window);
