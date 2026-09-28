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

  /** ISO codes we recognise as non-GBP (order matters for preferred display). */
  const FX_CODES = ['EUR', 'USD', 'NOK', 'SEK', 'DKK', 'CHF', 'CAD', 'AUD'];

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

  function countMatches(text, re) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const global = new RegExp(re.source, flags);
    let n = 0;
    while (global.exec(text) !== null) n++;
    return n;
  }

  /**
   * Format for the Foreign currency field — matches web placeholder (€12.50)
   * and free-text Android "FOREIGN CURRENCY TOTAL".
   */
  function formatForeignCurrency(code, amount) {
    if (amount == null || !code) return null;
    const n = (Math.round(amount * 100) / 100).toFixed(2);
    if (code === 'EUR') return '€' + n;
    if (code === 'USD') return '$' + n;
    if (code === 'kr') return 'kr ' + n;
    return code + ' ' + n;
  }

  /**
   * Detect GBP vs foreign currency markers and which foreign code dominates.
   */
  function detectCurrencySignals(text) {
    const gbpScore =
      countMatches(text, /£/g) * 3 +
      countMatches(text, /\bGBP\b/gi) * 3 +
      countMatches(text, /total\s*gbp/gi) * 4;

    const hasGbpTotalLabel = /(?:total\s*gbp|gbp\s*total|£\s*\d|(?:total|amount\s*due|balance\s*due|grand\s*total)[^\n]{0,40}£)/i.test(text);

    const fxCounts = {};
    let foreignScore = 0;
    let bestCode = null;
    let bestCount = 0;

    // Symbol / code hits
    const symbolMap = [
      { code: 'EUR', re: /€/g, weight: 3 },
      { code: 'EUR', re: /\bEUR\b/gi, weight: 3 },
      { code: 'USD', re: /\$/g, weight: 2 },
      { code: 'USD', re: /\bUSD\b/gi, weight: 3 },
      { code: 'NOK', re: /\bNOK\b/gi, weight: 4 },
      { code: 'SEK', re: /\bSEK\b/gi, weight: 4 },
      { code: 'DKK', re: /\bDKK\b/gi, weight: 4 },
      { code: 'CHF', re: /\bCHF\b/gi, weight: 4 },
      { code: 'CAD', re: /\bCAD\b/gi, weight: 4 },
      { code: 'AUD', re: /\bAUD\b/gi, weight: 4 },
    ];
    for (const { code, re, weight } of symbolMap) {
      const c = countMatches(text, re);
      if (!c) continue;
      fxCounts[code] = (fxCounts[code] || 0) + c * weight;
      foreignScore += c * weight;
    }

    // Bare "kr" / "KR" — Scandinavian kroner; attribute to NOK/SEK/DKK if already seen, else generic kr
    const krHits = countMatches(text, /(?:^|[^\w])kr(?:\b|(?=\s*\d))/gi);
    if (krHits) {
      const nordic = ['NOK', 'SEK', 'DKK'].filter((c) => fxCounts[c]);
      if (nordic.length === 1) {
        fxCounts[nordic[0]] += krHits * 2;
        foreignScore += krHits * 2;
      } else if (nordic.length === 0) {
        fxCounts.kr = (fxCounts.kr || 0) + krHits * 2;
        foreignScore += krHits * 2;
      } else {
        // ambiguous among several — still counts as foreign
        foreignScore += krHits;
      }
    }

    for (const code of Object.keys(fxCounts)) {
      if (fxCounts[code] > bestCount) {
        bestCount = fxCounts[code];
        bestCode = code;
      }
    }
    // Prefer ISO codes over generic kr when tied
    if (bestCode === 'kr') {
      for (const c of FX_CODES) {
        if (fxCounts[c] && fxCounts[c] === bestCount) {
          bestCode = c;
          break;
        }
      }
    }

    const hasForeignTotalLabel = !!(bestCode && (
      new RegExp(
        '(?:total|amount\\s*due|balance\\s*due|grand\\s*total|sum|à\\s*payer|gesamt)[^\\n]{0,40}' +
          (bestCode === 'EUR' ? '(?:€|EUR)' :
            bestCode === 'USD' ? '(?:\\$|USD)' :
              bestCode === 'kr' ? 'kr' : bestCode),
        'i',
      ).test(text) ||
      new RegExp(
        (bestCode === 'EUR' ? '(?:€|EUR)' :
          bestCode === 'USD' ? '(?:\\$|USD)' :
            bestCode === 'kr' ? 'kr' : bestCode) +
          '[^\\n]{0,20}(?:total|due|sum)',
        'i',
      ).test(text)
    ));

    return {
      gbpScore,
      foreignScore,
      foreignCode: bestCode,
      hasGbpTotalLabel,
      hasForeignTotalLabel,
    };
  }

  function extractForeignAmount(text, code) {
    if (!code) return null;
    const lines = text.split(/\r?\n/);
    const totalLabels = /grand\s*total|amount\s*due|balance\s*due|total\s*due|amount\s*payable|total\s*to\s*pay|\btotal\b|\bsum\b|gesamt|à\s*payer/i;

    let codePat;
    if (code === 'EUR') codePat = '(?:€|EUR)';
    else if (code === 'USD') codePat = '(?:\\$|USD)';
    else if (code === 'kr') codePat = 'kr';
    else codePat = code;

    // Amount with currency before or after: €45.00 / 45.00 EUR / NOK 45,00
    const paired = new RegExp(
      '(?:' + codePat + '\\s*[:=]?\\s*(\\d{1,5}(?:[.,]\\d{2})?)|(\\d{1,5}(?:[.,]\\d{2})?)\\s*' + codePat + ')',
      'gi',
    );

    const labelled = [];
    const any = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      paired.lastIndex = 0;
      let m;
      const lineAmounts = [];
      while ((m = paired.exec(line)) !== null) {
        const raw = (m[1] || m[2] || '').replace(',', '.');
        const v = parseMoneyToken(raw);
        if (v != null) lineAmounts.push(v);
      }
      // Also check next line after a total label with currency on label line
      if (!lineAmounts.length && totalLabels.test(line) && i + 1 < lines.length) {
        paired.lastIndex = 0;
        while ((m = paired.exec(lines[i + 1])) !== null) {
          const raw = (m[1] || m[2] || '').replace(',', '.');
          const v = parseMoneyToken(raw);
          if (v != null) lineAmounts.push(v);
        }
        // Or bare amount on next line when this line has currency + total
        if (!lineAmounts.length && new RegExp(codePat, 'i').test(line)) {
          const bare = /(\d{1,5}(?:[.,]\d{2})?)/.exec(lines[i + 1]);
          if (bare) {
            const v = parseMoneyToken(bare[1].replace(',', '.'));
            if (v != null) lineAmounts.push(v);
          }
        }
      }
      if (!lineAmounts.length) continue;
      const last = lineAmounts[lineAmounts.length - 1];
      any.push(last);
      if (totalLabels.test(line)) labelled.push(last);
    }
    if (labelled.length) return labelled[labelled.length - 1];
    if (any.length) return any[any.length - 1];
    return null;
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

  function applyGbpConsistency(total, net, vat) {
    let t = total;
    let n = net;
    let v = vat;
    if (t != null && n != null && v == null) {
      const derived = Math.round((t - n) * 100) / 100;
      if (derived >= 0 && derived < t) v = derived;
    }
    if (t != null && v != null && n == null) {
      const derived = Math.round((t - v) * 100) / 100;
      if (derived >= 0) n = derived;
    }
    if (t == null && n != null && v != null) {
      t = Math.round((n + v) * 100) / 100;
    }
    if (v != null && t != null && v === t) v = null;
    return { total: t, net: n, vat: v };
  }

  /**
   * Decide whether payment total is GBP or foreign.
   * @returns {'gbp'|'foreign'}
   */
  function chooseCurrencyMode(sig) {
    const { gbpScore, foreignScore, hasGbpTotalLabel, hasForeignTotalLabel } = sig;
    if (foreignScore > 0 && gbpScore === 0) return 'foreign';
    if (gbpScore > 0 && foreignScore === 0) return 'gbp';
    if (foreignScore === 0 && gbpScore === 0) return 'gbp'; // UK default
    // Both present: dominant currency; when unsure prefer GBP only if £/GBP total label
    if (foreignScore > gbpScore) return 'foreign';
    if (gbpScore > foreignScore) return 'gbp';
    if (hasGbpTotalLabel && !hasForeignTotalLabel) return 'gbp';
    if (hasForeignTotalLabel && !hasGbpTotalLabel) return 'foreign';
    if (hasGbpTotalLabel) return 'gbp';
    return 'foreign';
  }

  /**
   * @param {string} text
   * @returns {{ date: string|null, description: string|null, total: number|null, net: number|null, vat: number|null, foreignCurrency: string|null, jobNo: string|null, rawLength: number }}
   */
  function parseReceiptText(text) {
    const cleaned = String(text || '')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!cleaned) {
      return {
        date: null, description: null, total: null, net: null, vat: null,
        foreignCurrency: null, jobNo: null, rawLength: 0,
      };
    }

    const date = extractDate(cleaned);
    const description = extractMerchant(cleaned);
    const jobNo = extractJobNo(cleaned);
    const sig = detectCurrencySignals(cleaned);
    const mode = chooseCurrencyMode(sig);

    let total = null;
    let net = null;
    let vat = null;
    let foreignCurrency = null;

    if (mode === 'foreign' && sig.foreignCode) {
      const fxAmount = extractForeignAmount(cleaned, sig.foreignCode);
      if (fxAmount != null) {
        foreignCurrency = formatForeignCurrency(sig.foreignCode, fxAmount);
      }
      // Do not fill £ net/VAT/total from the foreign total
      total = null;
      net = null;
      vat = null;
    } else {
      total = extractTotal(cleaned);
      net = extractNet(cleaned);
      vat = extractVat(cleaned);
      const c = applyGbpConsistency(total, net, vat);
      total = c.total;
      net = c.net;
      vat = c.vat;
      foreignCurrency = null;
    }

    return {
      date,
      description,
      total,
      net,
      vat,
      foreignCurrency,
      jobNo,
      rawLength: cleaned.length,
    };
  }

  function hasUsefulSuggestions(parsed) {
    if (!parsed) return false;
    return !!(parsed.date || parsed.description || parsed.total != null ||
      parsed.net != null || parsed.vat != null || parsed.foreignCurrency ||
      parsed.jobNo);
  }

  global.AsReceiptParse = {
    parseReceiptText,
    hasUsefulSuggestions,
    parseMoneyToken,
    extractDate,
    extractTotal,
    extractMerchant,
    extractJobNo,
    formatForeignCurrency,
    detectCurrencySignals,
  };
})(typeof window !== 'undefined' ? window : globalThis);
