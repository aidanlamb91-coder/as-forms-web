/**
 * 1.0.3: timesheet Year picker (Android ui/components/MonthYearSelectors.kt TimesheetYears).
 *
 * Until 1.0.2 the Year <select> was filled with the current calendar year ± 2 only
 * (2024–2028 in 2026), so nothing earlier than 2024 or later than 2028 could be picked, and a
 * timesheet whose year was outside that window showed (and saved) the wrong year.
 * Now: ◀ / ▶ buttons step one year at a time across MIN..MAX (any sensible four-digit year)
 * and the drop-down is a quick list of (this year + 10) … 2000, always including the selected
 * year. The current year stays the default for a new timesheet.
 */
(function (global) {
  const MIN = 1900;
  const MAX = 2999;
  const QUICK_FIRST = 2000;
  const QUICK_AHEAD = 10;

  const clamp = (y) => Math.min(MAX, Math.max(MIN, y));
  function step(year, by) { return clamp(Number(year) + by); }
  function canStep(year, by) { return step(year, by) !== Number(year); }

  /** Quick list, newest first: (now + 10) down to 2000, extended to include [selected]. */
  function quickList(selected, now) {
    if (now == null) now = new Date().getFullYear();
    selected = Number(selected) || now;
    const hi = clamp(Math.max(now + QUICK_AHEAD, selected));
    const lo = clamp(Math.min(QUICK_FIRST, selected));
    const out = [];
    for (let y = hi; y >= lo; y--) out.push(y);
    return out;
  }

  function fillYearSelect(sel, selected) {
    selected = Number(selected) || new Date().getFullYear();
    sel.innerHTML = '';
    for (const y of quickList(selected)) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      if (y === selected) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.value = String(selected);
    syncButtons(sel);
  }

  function syncButtons(sel) {
    const box = sel.closest('.year-stepper');
    if (!box) return;
    const y = Number(sel.value);
    box.querySelector('.year-prev').disabled = sel.disabled || !canStep(y, -1);
    box.querySelector('.year-next').disabled = sel.disabled || !canStep(y, +1);
  }

  /** Wrap a year <select> with ◀ / ▶ buttons. Changing the year fires 'change' on the select. */
  function attachStepper(sel) {
    if (sel.closest('.year-stepper')) return;
    const box = document.createElement('span');
    box.className = 'year-stepper';
    const mk = (cls, label, txt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost year-step ' + cls;
      b.setAttribute('aria-label', label);
      b.textContent = txt;
      return b;
    };
    const prev = mk('year-prev', 'Previous year', '◀');
    const next = mk('year-next', 'Next year', '▶');
    sel.parentNode.insertBefore(box, sel);
    box.appendChild(prev);
    box.appendChild(sel);
    box.appendChild(next);
    const go = (by) => {
      if (sel.disabled) return;
      fillYearSelect(sel, step(sel.value, by));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    prev.addEventListener('click', (e) => { e.preventDefault(); go(-1); });
    next.addEventListener('click', (e) => { e.preventDefault(); go(+1); });
    sel.addEventListener('change', () => syncButtons(sel));
    new MutationObserver(() => syncButtons(sel)).observe(sel, { attributes: true, attributeFilter: ['disabled'] });
    syncButtons(sel);
  }

  global.AsYearPicker = { MIN, MAX, QUICK_FIRST, QUICK_AHEAD, step, canStep, quickList, fillYearSelect, attachStepper };
})(typeof window !== 'undefined' ? window : globalThis);
