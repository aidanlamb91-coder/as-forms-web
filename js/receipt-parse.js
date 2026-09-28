/**
 * UK-oriented receipt text heuristics for AS Forms web OCR beta.
 * Pure functions — no DOM / network. Safe to unit-test with fixture strings.
 */
(function (global) {
  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  const SKIP_MERCHANT = /^(tel|telephone|phone|vat|tax|total|net|subtotal|sub-total|amount|due|change|cash|card|visa|mastercard|debit|credit|thank|thanks|www\.|http|receipt|invoice|order|till|store|branch|served|cashier|date|time|qty|item|price|gbp|eur|usd|#)/i;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toIso(day, month, year) {
    const d = Number(day);
    const m = Number(month);
    let y = Number(year);
    if (!d || !m || !y) return null;
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (y < 1990 || y > 2100) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function parseMoneyToken(raw) {
    if (raw == null) return null;
    let s = String(raw).replace(/[£€$]/g, '').replace(/\s/g, '').replace(/,/g, '');
    // OCR often reads 12.34 as 12,34 already handled; also 12.3A
    s = s.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
    return Math.round(n * 100) / 100;
  }

  function findAmountsNearLabels(text, labels) {
    const lines = text.split(/\r?\n/);
    const found = [];
    const labelRe = new RegExp('(' + labels.join('|') + ')', 'i');
    const moneyRe = /(?:£|GBP\s*)?\s*(\d{1,5}(?:[.,]\d{2})?)/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!labelRe.test(line)) continue;
      // Prefer amount on same line after the label
      const after = line.replace(labelRe, '|||').split('|||')[1] || '';
      let m;
      moneyRe.lastIndex = 0;
      const sameLine = [];
      while ((m = moneyRe.exec(after)) !== null) {
        const v = parseMoneyToken(m[1].replace(',', '.'));
        if (v != null) sameLine.push(v);
      }
      if (sameLine.length) {
        found.push(sameLine[sameLine.length - 1]);
        continue;
      }
      // Next line
      if (i + 1 < lines.length) {
        moneyRe.lastIndex = 0;
        const nm = moneyRe.exec(lines[i + 1]);
        if (nm) {
          const v = parseMoneyToken(nm[1].replace(',', '.'));
          if (v != null) found.push(v);
        }
      }
    }
    return found;
  }

  function extractDate(text) {
    const candidates = [];

    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (and 2-digit year)
    const slash = /(\b|^)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(\b|$)/g;
    let m;
    while ((m = slash.exec(text)) !== null) {
      const iso = toIso(m[2], m[3], m[4]);
      if (iso) candidates.push({ iso, score: 3 });
    }

    // DD Mon YYYY / DD Month YYYY
    const named = /(\b|^)(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[\s\-]+(\d{2,4})(\b|$)/gi;
    while ((m = named.exec(text)) !== null) {
      const mon = MONTHS[m[3].toLowerCase()];
      if (!mon) continue;
      const iso = toIso(m[2], mon, m[4]);
      if (iso) candidates.push({ iso, score: 4 });
    }

    // YYYY-MM-DD (ISO on some receipts)
    const isoRe = /(\b|^)(20\d{2})-(\d{2})-(\d{2})(\b|$)/g;
    while ((m = isoRe.exec(text)) !== null) {
      const iso = toIso(m[4], m[3], m[2]);
      if (iso) candidates.push({ iso, score: 2 });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].iso;
  }

  function extractTotal(text) {
    const preferred = findAmountsNearLabels(text, [
      'grand\\s*total', 'amount\\s*due', 'balance\\s*due', 'total\\s*due',
      'amount\\s*payable', 'total\\s*to\\s*pay', 'total\\s*gbp', '\\btotal\\b',
    ]);
    if (preferred.length) return preferred[preferred.length - 1];

    // Last £amount on receipt as weak fallback
    const all = [];
    const moneyRe = /£\s*(\d{1,5}(?:[.,]\d{2})?)/g;
    let m;
    while ((m = moneyRe.exec(text)) !== null) {
      const v = parseMoneyToken(m[1].replace(',', '.'));
      if (v != null) all.push(v);
    }
    if (all.length) return all[all.length - 1];
    return null;
  }

  function extractVat(text) {
    const vals = findAmountsNearLabels(text, [
      'vat\\s*amount', 'total\\s*vat', 'vat\\s*@', 'vat', 'tax',
    ]);
    // Prefer smaller VAT-like amounts if multiple
    if (!vals.length) return null;
    return vals[vals.length - 1];
  }

  function extractNet(text) {
    const vals = findAmountsNearLabels(text, [
      'net\\s*total', 'net\\s*amount', 'sub-?total', 'subtotal', 'nett?',
    ]);
    if (!vals.length) return null;
    return vals[vals.length - 1];
  }

  function extractMerchant(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      let line = lines[i].replace(/\s+/g, ' ').trim();
      if (line.length < 2 || line.length > 60) continue;
      if (SKIP_MERCHANT.test(line)) continue;
      if (/^\d+([\/\-.]\d+){1,2}/.test(line)) continue; // date-like
      if (/^[\d\s£$€.,:%+\-]+$/.test(line)) continue; // numbers only
      if (/@/.test(line) && line.length > 20) continue;
      if (/^\+?\d[\d\s\-()]{6,}$/.test(line)) continue; // phone
      // Strip common noise suffixes
      line = line.replace(/\s{2,}.*$/, '').trim();
      if (line.length < 2) continue;
      if (line.length > 40) line = line.slice(0, 40).trim();
      return line;
    }
    return null;
  }

  function extractJobNo(text) {
    // Only clear P+digits (Aidan's job style). Do not invent.
    const re = /\bP\s*([0-9]{3,8})\b/gi;
    const hits = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push('P' + m[1]);
    }
    if (!hits.length) return null;
    // Prefer first occurrence
    return hits[0];
  }

  /**
   * @param {string} text
   * @returns {{ date: string|null, description: string|null, total: number|null, net: number|null, vat: number|null, jobNo: string|null, rawLength: number }}
   */
  function parseReceiptText(text) {
    const cleaned = String(text || '')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!cleaned) {
      return { date: null, description: null, total: null, net: null, vat: null, jobNo: null, rawLength: 0 };
    }

    let date = extractDate(cleaned);
    let description = extractMerchant(cleaned);
    let total = extractTotal(cleaned);
    let net = extractNet(cleaned);
    let vat = extractVat(cleaned);
    let jobNo = extractJobNo(cleaned);

    // Consistency: if net+vat ≈ total, keep; if only total+vat, derive net; etc.
    if (total != null && net != null && vat == null) {
      const derived = Math.round((total - net) * 100) / 100;
      if (derived >= 0 && derived < total) vat = derived;
    }
    if (total != null && vat != null && net == null) {
      const derived = Math.round((total - vat) * 100) / 100;
      if (derived >= 0) net = derived;
    }
    if (total == null && net != null && vat != null) {
      total = Math.round((net + vat) * 100) / 100;
    }

    // Drop weak VAT/net if labels were ambiguous and values look like the total
    if (vat != null && total != null && vat === total) vat = null;
    if (net != null && total != null && net === total && vat == null) {
      // keep net as optional duplicate — better leave net null if no clear label
      // Actually extractNet already required a label; keep it.
    }

    return {
      date,
      description,
      total,
      net,
      vat,
      jobNo,
      rawLength: cleaned.length,
    };
  }

  function hasUsefulSuggestions(parsed) {
    if (!parsed) return false;
    return !!(parsed.date || parsed.description || parsed.total != null ||
      parsed.net != null || parsed.vat != null || parsed.jobNo);
  }

  global.AsReceiptParse = {
    parseReceiptText,
    hasUsefulSuggestions,
    parseMoneyToken,
    extractDate,
    extractTotal,
    extractMerchant,
    extractJobNo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
