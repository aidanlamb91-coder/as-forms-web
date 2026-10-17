/**
 * 1.2.1-web Other forms: the plain rules (port of Android forms/FormRules.kt, FormModels.kt and
 * the HR details layout in HrDetails.kt). No browser code, so it's all covered by quick node
 * tests (tests/test-forms-121.mjs).
 *
 * A form "spec" is the JSON made by the Android repo's scripts/make-form-templates.py:
 *   { number, rev, title, short, sendTo: payroll|hr|hseq, note, sections: [{ title, note, collapsed,
 *     fields: [{ key, label, type: text|number|date|longtext|radio|signature, options, prefill,
 *     validate, sensitive, noBackup, half, mark }] }], pdfFields: { markerKey: pdfBoxName } }
 * Dates are kept as dd/mm/yyyy, the same as on Android, so drafts move between the two.
 */
(function (global) {
  const NI = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/;
  const pad = (n) => String(n).padStart(2, '0');

  // ——— Spec helpers ———
  const fields = (spec) => (spec && spec.sections ? spec.sections.flatMap((s) => s.fields || []) : []);
  const field = (spec, key) => fields(spec).find((f) => f.key === key) || null;
  const isPdf = (spec) => !!(spec && spec.pdfFields && Object.keys(spec.pdfFields).length);
  const hasSignature = (spec) => fields(spec).some((f) => f.type === 'signature');
  /** Marker keys a field fills in the template (pick-one groups: one per option). */
  const markerKeys = (f) => (f.type === 'radio' ? (f.options || []).map((o) => f.key + '.' + o.key) : [f.key]);
  const allMarkerKeys = (spec) => new Set(fields(spec).flatMap(markerKeys));

  /** Returns a short error, or null when the value is fine. Blank is always fine (fields are optional). */
  function check(rule, value) {
    const v = String(value == null ? '' : value).trim();
    if (!v || !rule) return null;
    switch (rule) {
      case 'ni': return NI.test(v.replace(/ /g, '').toUpperCase()) ? null : 'Format AB123456C';
      case 'percent': {
        const t = v.replace(/%$/, '').trim();
        const n = /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
        if (Number.isNaN(n)) return 'Enter a number';
        if (n < 0 || n > 100) return '0 to 100';
        if (v.includes('.') && v.split('.')[1].replace(/%$/, '').length > 1) return 'One decimal place';
        return null;
      }
      case 'sort': return (v.replace(/\D/g, '').length === 6 && /^[\d\- ]+$/.test(v)) ? null : '6 digits';
      case 'account': return /^\d{8}$/.test(v) ? null : '8 digits';
      case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Not an email';
      default: return null;
    }
  }

  /** Tidies a value for printing: NI upper case, sort code as 00-00-00, % sign dropped. */
  function tidy(rule, value) {
    const v = String(value == null ? '' : value);
    if (rule === 'ni') return v.replace(/ /g, '').toUpperCase();
    if (rule === 'sort') { const d = v.replace(/\D/g, ''); return d.length === 6 ? d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4) : v; }
    if (rule === 'percent') return v.replace(/%$/, '').trim();
    return v;
  }

  /** True when the new pension percentage is lower than the last saved one. */
  function pensionLowered(previous, now) {
    const a = parseFloat(String(previous == null ? '' : previous).replace(/%$/, ''));
    const b = parseFloat(String(now == null ? '' : now).replace(/%$/, ''));
    return !Number.isNaN(a) && !Number.isNaN(b) && b < a;
  }

  const ukDate = (d) => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  const fileDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  /** dd/mm/yyyy ⇄ yyyy-mm-dd (the browser's date box). */
  const toIso = (uk) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(uk || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
  const fromIso = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };

  /** Where a box's starting value comes from. s = { name, hr, lastJob, today: Date }. */
  function prefillValue(source, s) {
    if (!source) return '';
    const today = s.today || new Date();
    if (source === 'profile.name') return s.name || '';
    if (source === 'today') return ukDate(today);
    if (source === 'yearAgo') { const d = new Date(today); d.setFullYear(d.getFullYear() - 1); return ukDate(d); }
    if (source === 'now') return ukDate(today) + ' ' + pad(today.getHours()) + ':' + pad(today.getMinutes());
    if (source === 'lastJob') return s.lastJob || '';
    if (source.startsWith('const:')) return source.slice(6);
    if (source.startsWith('hr.')) return hrValue(source.slice(3), s);
    return '';
  }

  /** HR value, with forename / surname worked out from the Profile name when not set. */
  function hrValue(key, s) {
    const v = (s.hr || {})[key];
    if (v && String(v).trim()) return v;
    const parts = String(s.name || '').trim().split(/\s+/).filter(Boolean);
    if (key === 'forename') return parts[0] || '';
    if (key === 'surname') return parts.length > 1 ? parts[parts.length - 1] : '';
    return '';
  }

  /** Starting answers for a new form. Pick-one prefill matches the option label (e.g. title "Mr"). */
  function prefill(spec, s) {
    const out = {};
    for (const f of fields(spec)) {
      if (f.type === 'signature') continue;
      const v = prefillValue(f.prefill, s);
      if (!v || !String(v).trim()) continue;
      if (f.type === 'radio') {
        const o = (f.options || []).find((x) => x.label.toLowerCase() === v.toLowerCase() || x.key.toLowerCase() === v.toLowerCase());
        if (o) out[f.key] = o.key;
      } else out[f.key] = v;
    }
    return out;
  }

  /** HR details changed on the form that differ from the Profile: { hrKey: newValue }. */
  function changedHrDetails(spec, values, hr) {
    const out = {};
    for (const f of fields(spec)) {
      if (!f.prefill || !f.prefill.startsWith('hr.')) continue;
      const k = f.prefill.slice(3);
      let v = String(values[f.key] || '').trim();
      if (f.type === 'radio') { const o = (f.options || []).find((x) => x.key === v); v = o ? o.label : ''; }
      if (v && v !== String((hr || {})[k] || '')) out[k] = v;
    }
    return out;
  }

  /** "<FormNo>-<Rev> <Form> <Surname> <date>.<ext>" (same as Android). */
  function exportFileName(spec, surname, date, ext) {
    const safe = (t) => String(t || '').replace(/[\\/:*?"<>|]/g, '').trim();
    return spec.number + '-' + spec.rev + ' ' + safe(spec.title) + ' ' + (safe(surname) || 'Employee') + ' ' + fileDate(date || new Date()) + '.' + ext;
  }

  /** Surname for the file name: the form's surname box, else the last word of the name. */
  function surnameFor(values, profileName) {
    const s = values && values['hr.surname'];
    if (s && s.trim()) return s;
    const parts = String(profileName || '').trim().split(/\s+/);
    return parts[parts.length - 1] || '';
  }

  /**
   * Revision check. A form can be filled here only when its spec was made for the same number and
   * revision as the index lists AND every marker the spec needs is in the template (and no extras).
   * Returns true (OK), false (needs updating → Download) or null (unverified: the Word template
   * isn't on this device yet, so the marker check can't run; it runs as soon as it downloads).
   */
  function matches(item, spec, templateMarkers) {
    if (!spec) return false;
    if (spec.number !== item.number || spec.rev !== item.rev) return false;
    if (isPdf(spec)) return true;
    if (!templateMarkers) return null;
    const need = allMarkerKeys(spec);
    const have = templateMarkers instanceof Set ? templateMarkers : new Set(templateMarkers);
    for (const k of need) if (!have.has(k)) return false;
    for (const k of have) if (!need.has(k)) return false;
    return true;
  }

  /** Answers kept for "Edit as new copy": everything except the signature and signing date. */
  function forNewVersion(spec, values) {
    const dateKeys = new Set(fields(spec).filter((f) => f.type === 'date' && f.key.endsWith('.date')).map((f) => f.key));
    const out = {};
    for (const [k, v] of Object.entries(values || {})) if (!dateKeys.has(k) && !k.startsWith('sig.')) out[k] = v;
    return out;
  }

  const sendToName = (s) => ({ payroll: 'Payroll', hr: 'HR', hseq: 'HSEQ' }[String(s || '').toLowerCase()] || s);

  /** "10:42" today, otherwise dd/mm/yyyy. */
  function whenText(ms, now) {
    const d = new Date(ms); const n = now || new Date();
    return d.toDateString() === n.toDateString() ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : ukDate(d);
  }

  /**
   * History sub-line: what kind of copy, where it went and when. Never shows any answers.
   * "Draft · edited 14:32", "Word · emailed to Payroll", "Imported from X.docx".
   */
  function historyLine(d, now) {
    if (d.exportedAt) return [d.exportFormat || 'Exported', d.sentTo ? 'emailed to ' + d.sentTo : 'shared ' + whenText(d.exportedAt, now)].join(' · ');
    if (d.importedFrom) return 'Imported from ' + d.importedFrom;
    return (d.version > 1 ? 'Draft v' + d.version : 'Draft') + ' · edited ' + whenText(d.updatedAt, now);
  }

  /** "1.4 MB" style sizes. */
  function sizeText(b) {
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b >= 1e3) return Math.floor(b / 1e3) + ' KB';
    return b + ' B';
  }

  // ——— HR details (Profile) — same keys as Android, so backups move between the two ———
  /** Bank & NI: NEVER in any backup (cloud or downloaded). */
  const BANK_KEYS = ['ni', 'bankName', 'bankAddress', 'accountName', 'accountNo', 'sortCode', 'iban', 'swift', 'mainEmployment', 'taxCountry'];
  const I = (key, label, kind, o) => Object.assign({ key, label, kind: kind || 'text', half: true }, o || {});
  const nok = (n) => ({ title: 'Next of kin ' + n, items: [
    I('nok' + n + 'Forename', 'Forename'), I('nok' + n + 'Surname', 'Surname'),
    I('nok' + n + 'Relationship', 'Relationship', 'text', { half: false }),
    I('nok' + n + 'Addr1', 'Address line 1', 'text', { half: false }), I('nok' + n + 'Addr2', 'Address line 2', 'text', { half: false }),
    I('nok' + n + 'Town', 'Town'), I('nok' + n + 'County', 'County'), I('nok' + n + 'Country', 'Country'), I('nok' + n + 'Postcode', 'Postcode'),
    I('nok' + n + 'HomeTel', 'Home tel.', 'phone'), I('nok' + n + 'Mobile', 'Mobile', 'phone'),
    I('nok' + n + 'Language', 'First language', 'text', { half: false }),
  ] });
  const HR_CARDS = [
    { title: 'Personal', items: [
      I('title', 'Title'), I('titleOther', 'Other title'), I('forename', 'Forename'), I('middle', 'Middle name(s)'),
      I('surname', 'Surname'), I('knownAs', 'Known as'), I('empNo', 'Employee no.'), I('jobTitle', 'Job title'),
      I('dob', 'Date of birth', 'date'), I('startDate', 'Start date', 'date'), I('gender', 'Gender'), I('marital', 'Marital status'),
      I('placeOfBirth', 'Place of birth'), I('nationality', 'Nationality'), I('residency', 'Residency / citizenship', 'text', { half: false }),
      I('lineManager', 'Line manager'), I('lineManagerTitle', 'Manager job title'), I('pensionPercent', 'Pension %', 'number', { rule: 'percent' }),
    ] },
    { title: 'Contact', items: [
      I('addr1', 'Address line 1', 'text', { half: false }), I('addr2', 'Address line 2', 'text', { half: false }),
      I('town', 'Town'), I('county', 'County'), I('country', 'Country'), I('postcode', 'Postcode'),
      I('homeTel', 'Home tel.', 'phone'), I('mobile', 'Mobile', 'phone'), I('email', 'Email', 'email', { half: false, rule: 'email' }),
    ] },
    nok(1), nok(2),
    { title: 'Work kit', items: [I('coverall', 'Coverall size'), I('shoe', 'Shoe size'), I('airport', 'Nearest airport'), I('vantage', 'Vantage no.')] },
    { title: 'Passports & ID', items: [
      I('passport1No', 'Passport 1 no.', 'text', { masked: true }), I('passport1Expiry', 'Expiry', 'date'), I('passport1Issued', 'Issued', 'date', { half: false }),
      I('passport2No', 'Passport 2 no.', 'text', { masked: true }), I('passport2Expiry', 'Expiry', 'date'), I('passport2Issued', 'Issued', 'date', { half: false }),
      I('licenceNo', 'Driving licence', 'text', { masked: true }), I('licenceExpiry', 'Expiry', 'date'),
      I('sdbNo', 'Discharge Book', 'text', { masked: true }), I('sdbExpiry', 'Expiry', 'date'),
      I('bscNo', "Seaman's Card", 'text', { masked: true }), I('bscExpiry', 'Expiry', 'date'),
    ] },
    { title: 'Bank & NI', bank: true, items: [
      I('ni', 'NI number', 'text', { half: false, masked: true, rule: 'ni' }),
      I('sortCode', 'Sort code', 'number', { masked: true, rule: 'sort' }), I('accountNo', 'Account no.', 'number', { masked: true, rule: 'account' }),
      I('accountName', 'Account name', 'text', { half: false }), I('bankName', 'Bank name', 'text', { half: false }),
      I('bankAddress', 'Bank address', 'text', { half: false }), I('iban', 'IBAN', 'text', { masked: true }), I('swift', 'SWIFT / BIC'),
      I('mainEmployment', 'Main job? Y/N'), I('taxCountry', 'Tax country'),
    ] },
  ];

  /** HR details for a backup: Bank & NI removed. */
  const hrForBackup = (hr) => Object.fromEntries(Object.entries(hr || {}).filter(([k]) => !BANK_KEYS.includes(k)));
  /**
   * Bank & NI answers on the forms, by name. Always removed from backups, even if a form forgets
   * to mark the box "not in backups" (Coach review). Covers the bank card of the Payroll form and
   * the NI box of every form, plus anything else that looks like bank details or an NI number.
   */
  const BANK_FIELD_KEYS = ['pay.ni', 'pay.taxcountry', 'pay.main', 'pay.mainemployment', 'bank.name', 'bank.address', 'bank.accountname',
    'bank.account', 'bank.sort', 'bank.iban', 'bank.swift'];
  const BANK_LAST = new Set(['ni', 'nino', 'ninumber', 'nationalinsurance', 'sort', 'sortcode', 'account', 'accountno', 'accountnumber',
    'accountname', 'bankname', 'bankaddress', 'iban', 'swift', 'bic', 'taxcountry', 'mainemployment']);
  function isBankField(key) {
    const k = String(key || '').toLowerCase();
    const last = k.split('.').pop().replace(/[^a-z]/g, '');
    return BANK_FIELD_KEYS.includes(k) || k.startsWith('bank.') || BANK_LAST.has(last);
  }
  /** A draft for a backup: its Bank & NI answers removed (the form's own flags AND the fixed list). */
  function draftForBackup(d) {
    const priv = new Set(d.privateKeys || []);
    const values = Object.fromEntries(Object.entries(d.values || {}).filter(([k]) => !priv.has(k) && !isBankField(k)));
    return Object.assign({}, d, { values });
  }

  /**
   * "N of M filled" — the ONE count used by the import summary and the form editor, so both
   * always agree. Counts the boxes you can see: no signature, and an "Other …" box only when
   * "Other" is picked.
   */
  function countFilled(list, values) {
    const v = values || {};
    const boxes = (list || []).filter((f) => f.type !== 'signature' && (!/_other$/.test(f.key) || v[f.key.replace(/_other$/, '')] === 'other'));
    return { filled: boxes.filter((f) => String(v[f.key] == null ? '' : v[f.key]).trim()).length, total: boxes.length };
  }

  global.AsFormRules = {
    fields, field, isPdf, hasSignature, markerKeys, allMarkerKeys,
    check, tidy, pensionLowered, prefillValue, prefill, changedHrDetails, exportFileName, surnameFor,
    matches, forNewVersion, sendToName, whenText, historyLine, sizeText, ukDate, toIso, fromIso,
    BANK_KEYS, HR_CARDS, hrForBackup, draftForBackup, isBankField, BANK_FIELD_KEYS, countFilled,
  };
})(typeof window !== 'undefined' ? window : globalThis);
