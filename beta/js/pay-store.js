/**
 * 1.2.6-web Pay data in this browser: pay settings, payslips and the payslip / statement PDFs.
 * Kept in the app's IndexedDB "meta" store (already separate for the beta copy):
 *   'pay-settings' → Android PaySettingsJson object, 'payslips' → Android PayslipJson array,
 *   'payslip-pdf:YYYY-MM-DD' / 'statement-pdf:YYYY-MM-DD' → PDF Blob.
 * Like Android, this is NOT under the personal-details lock and goes in backups unencrypted
 * (prefs.pay, prefs.payslips, payslips/payslip-DATE.pdf, statements/statement-DATE.pdf).
 * Only pay figures are stored: names, NI numbers, bank details and addresses are never read.
 */
(function (global) {
  const S = () => global.AsStorage;
  const C = () => global.AsPayCalc;
  const K_PAY = 'pay-settings', K_SLIPS = 'payslips';
  const pdfKey = (kind, date) => kind + '-pdf:' + date;
  let pay = null, slips = null, version = 0;
  const listeners = [];

  async function load() {
    if (pay && slips) return;
    let p = null, l = null;
    try { p = await S().getMeta(K_PAY); l = await S().getMeta(K_SLIPS); } catch (e) { console.error('Pay load', e); }
    pay = C().normalize(p);
    slips = global.AsPayslip.normalizeList(l);
  }
  const changed = () => { version++; listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); };
  function onChange(f) { listeners.push(f); }
  function settings() { return pay || C().defaults(); }
  function payslips() { return slips || []; }
  async function saveSettings(n) { await load(); pay = C().normalize(n); await S().setMeta(K_PAY, C().toJson(pay)); changed(); }
  async function savePayslips(list) {
    slips = global.AsInsights.dedupe(global.AsPayslip.normalizeList(list));
    await S().setMeta(K_SLIPS, slips); changed();
  }
  async function addPayslips(list) { await load(); await savePayslips(payslips().filter((p) => !list.some((x) => x.date === p.date)).concat(list)); }
  async function removePayslips(dates) {
    await load();
    await savePayslips(payslips().filter((p) => !dates.includes(p.date)));
    for (const d of dates) await S().deleteMeta(pdfKey('payslip', d));
  }
  const putPdf = (kind, date, blob) => S().setMeta(pdfKey(kind, date), blob);
  const getPdf = (kind, date) => S().getMeta(pdfKey(kind, date));
  const deletePdf = (kind, date) => S().deleteMeta(pdfKey(kind, date));

  /** Pot values, falling back to the old single starting value (Android PaySettingsScreen). */
  function pots(s) {
    s = s || settings();
    if (s.potValues.length) return s.potValues;
    const st = C().pensionStart(s);
    return st ? [{ date: st.date, value: st.value, source: 'Manual' }] : [];
  }

  // ——— estimates from timesheets ———
  let engine = null;
  async function periodResults() {
    await load();
    const tss = await S().listTimesheets();
    const { dates, months } = C().fromTimesheets(tss);
    engine = engine || new (C().PayEngine)();
    return engine.update(settings(), dates, months);
  }
  /** EstimatePoints for Insights (only when rates are set, as Android). */
  async function estimates() {
    const m = await periodResults();
    if (!C().configured(settings())) return [];
    return Array.from(m.values()).map(global.AsInsights.estimatePoint);
  }

  // ——— backup ———
  /** {pay, payslips} for the manifest prefs and [{path, blob}] PDF entries (Android paths). */
  async function forBackup() {
    await load();
    const files = [];
    for (const p of payslips()) { const b = await getPdf('payslip', p.date); if (b) files.push({ path: 'payslips/payslip-' + p.date + '.pdf', blob: b }); }
    for (const st of settings().statements) { const b = await getPdf('statement', st.end); if (b) files.push({ path: 'statements/statement-' + st.end + '.pdf', blob: b }); }
    return { pay: C().toJson(settings()), payslips: payslips(), files };
  }
  /**
   * Restore from a backup. A backup without pay data (older web backups) leaves this browser's
   * pay data alone, so nothing is lost. pdfs: { 'payslips/payslip-DATE.pdf': Blob, ... }.
   */
  async function restore(prefs, pdfs) {
    await load();
    const p = prefs || {};
    let n = 0;
    if (p.pay && typeof p.pay === 'object') { pay = C().normalize(p.pay); await S().setMeta(K_PAY, C().toJson(pay)); n++; }
    if (Array.isArray(p.payslips)) { slips = global.AsInsights.dedupe(global.AsPayslip.normalizeList(p.payslips)); await S().setMeta(K_SLIPS, slips); n++; }
    for (const [path, blob] of Object.entries(pdfs || {})) {
      let m = /^payslips\/payslip-(\d{4}-\d{2}-\d{2})\.pdf$/.exec(path);
      if (m) { await putPdf('payslip', m[1], blob); continue; }
      m = /^statements\/statement-(\d{4}-\d{2}-\d{2})\.pdf$/.exec(path);
      if (m) await putPdf('statement', m[1], blob);
    }
    changed();
    return n;
  }
  async function clear() { pay = null; slips = null; }
  /** Clear data on this device: pay settings, payslips and every payslip/statement PDF. */
  async function wipe() {
    await load();
    for (const p of payslips()) await deletePdf('payslip', p.date).catch(() => {});
    for (const st of settings().statements) await deletePdf('statement', st.end).catch(() => {});
    await S().deleteMeta(K_PAY); await S().deleteMeta(K_SLIPS);
    pay = null; slips = null; changed();
  }

  global.AsPayStore = { load, onChange, settings, payslips, saveSettings, addPayslips, removePayslips, putPdf, getPdf, deletePdf,
    pots, periodResults, estimates, forBackup, restore, clear, wipe, get version() { return version; } };
})(typeof window !== 'undefined' ? window : globalThis);
