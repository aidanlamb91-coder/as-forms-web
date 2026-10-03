/**
 * Expense line category — port of Android util/ExpenseCategory.kt (0.3.8 / 1.0.0).
 *
 * Web storage model (1.0.0-web): a line keeps `category` (TRAVEL / FOOD / EQUIPMENT /
 * TRAINING / MISC) AND `description` holding the composed text ("Travel - Taxi").
 * Keeping the composed text in `description` means older web builds that share the same
 * browser storage (and old backups) still see and export the category text.
 * The UI shows the category as a fixed, non-editable prefix and the user edits only the detail.
 */
(function (global) {
  const SEPARATOR = ' - ';
  const CATEGORIES = [
    { key: 'TRAVEL', label: 'Travel' },
    { key: 'FOOD', label: 'Food' },
    { key: 'EQUIPMENT', label: 'Equipment' },
    { key: 'TRAINING', label: 'Training' },
    { key: 'MISC', label: 'Misc' },
  ];
  const KEYS = CATEGORIES.map((c) => c.key);
  const DEFAULT = 'MISC';

  function labelOf(key) {
    const c = CATEGORIES.find((x) => x.key === key);
    return c ? c.label : 'Misc';
  }

  /** Fixed prefix, e.g. "Travel - ". */
  function prefix(key) {
    return labelOf(key) + SEPARATOR;
  }

  /** Lookup by key or label (case-insensitive). Unknown/blank → null. */
  function fromName(value) {
    const t = String(value == null ? '' : value).trim();
    if (!t) return null;
    if (t.toLowerCase() === 'miscellaneous') return 'MISC';
    const lower = t.toLowerCase();
    const c = CATEGORIES.find((x) => x.key.toLowerCase() === lower || x.label.toLowerCase() === lower);
    return c ? c.key : null;
  }

  /** Stored value → category key (unknown → MISC). */
  function fromStored(value) {
    return fromName(value) || DEFAULT;
  }

  // Same regex as Android: label, then -, –, — or : with a space on at least one side.
  const PREFIX_RE = /^\s*(Travel|Food|Equipment|Training|Misc|Miscellaneous)(?:\s+[-–—:]\s*|\s*[-–—:]\s+)([\s\S]*)$/i;

  /**
   * Parse a known "Category - " prefix. Bare label ("Food") → that category, empty detail.
   * Anything else → MISC with the text unchanged (trimmed). "Food-court lunch" is not a prefix.
   * @returns {{category:string, detail:string, hadPrefix:boolean}}
   */
  function parse(description) {
    const text = description == null ? '' : String(description);
    const m = PREFIX_RE.exec(text);
    if (m) {
      return { category: fromName(m[1]) || DEFAULT, detail: m[2].trim(), hadPrefix: true };
    }
    const bare = fromName(text);
    if (bare) return { category: bare, detail: '', hadPrefix: true };
    return { category: DEFAULT, detail: text.trim(), hadPrefix: false };
  }

  /** "Travel - detail"; blank detail → just the label ("Travel"). Accepts key or stored value. */
  function compose(category, detail) {
    const key = fromStored(category);
    const d = String(detail == null ? '' : detail).trim();
    return d ? prefix(key) + d : labelOf(key);
  }

  /** Avoid "Travel - Travel - taxi": strip the same category's own prefix; others left as typed. */
  function stripOwnPrefix(category, detail) {
    const key = fromStored(category);
    const s = parse(detail);
    return s.hadPrefix && s.category === key ? s.detail : String(detail == null ? '' : detail).trim();
  }

  /**
   * Backup / import: explicit stored category wins (its own prefix stripped from description);
   * otherwise parse the description (known prefix → that category, else MISC).
   * @returns {[string, string]} [categoryKey, detail]
   */
  function fromImport(storedCategory, description) {
    const explicit = fromName(storedCategory);
    if (explicit) return [explicit, stripOwnPrefix(explicit, description == null ? '' : description)];
    const s = parse(description);
    return [s.category, s.detail];
  }

  // ——— Web line helpers ———

  /**
   * Category + detail for a stored web line. A recognised prefix in `description` wins
   * (that is the text older builds would export); else the `category` field (else MISC).
   */
  function splitLine(line) {
    const desc = line && line.description != null ? String(line.description) : '';
    const s = parse(desc);
    if (s.hadPrefix) return { category: s.category, detail: s.detail };
    return { category: fromStored(line && line.category), detail: s.detail };
  }

  /**
   * Text stored in `line.description` and written to the Word form:
   * "Travel - Taxi"; Misc with blank detail → "" (matches Android export of an empty line).
   */
  function composeForStorage(category, detail) {
    const key = fromStored(category);
    const d = String(detail == null ? '' : detail).trim();
    if (!d && key === 'MISC') return '';
    return compose(key, d);
  }

  /** Word-form / display text for a stored line. */
  function lineText(line) {
    const s = splitLine(line);
    return composeForStorage(s.category, s.detail);
  }

  /** Normalise a line in place (category + composed description). Returns the line. */
  function normalizeLine(line) {
    if (!line) return line;
    const s = splitLine(line);
    line.category = s.category;
    line.description = composeForStorage(s.category, s.detail);
    return line;
  }

  const KEYWORDS = [
    ['TRAINING', ['training', 'course', 'bosiet', 'foet', 'huet', 'opito', 'gwo', 'cpd',
      'exam', 'tuition', 'seminar', 'certificate', 'certification', 'first aid']],
    ['EQUIPMENT', ['screwfix', 'toolstation', 'b&q', 'argos', 'currys', 'maplin', 'halfords',
      'equipment', 'tool', 'tools', 'battery', 'batteries', 'cable', 'charger',
      'adapter', 'adaptor', 'ppe', 'hardware', 'laptop', 'usb', 'hi-vis', 'gloves']],
    ['TRAVEL', ['taxi', 'cab', 'uber', 'bolt', 'train', 'rail', 'railway', 'lner', 'scotrail',
      'avanti', 'gwr', 'northern', 'flight', 'airline', 'airport', 'airways',
      'easyjet', 'ryanair', 'loganair', 'klm', 'jet2', 'parking', 'car park',
      'fuel', 'petrol', 'diesel', 'unleaded', 'esso', 'texaco', 'shell', 'bp',
      'bus', 'coach', 'stagecoach', 'ferry', 'toll', 'mileage', 'car hire',
      'hotel', 'travelodge', 'premier inn', 'ibis', 'hilton', 'holiday inn']],
    ['FOOD', ['restaurant', 'cafe', 'café', 'coffee', 'costa', 'starbucks', 'greggs',
      'pret', 'mcdonald', 'mcdonalds', 'burger', 'pizza', 'nando', 'subway',
      'kfc', 'lunch', 'dinner', 'breakfast', 'meal', 'food', 'bar', 'pub',
      'grill', 'kitchen', 'bistro', 'deli', 'bakery', 'takeaway', 'sandwich']],
  ];

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Light keyword guess from OCR text. Null when nothing matches. Whole words (simple plurals);
   * highest hit count wins; ties go Training > Equipment > Travel > Food.
   */
  function guess(text) {
    const t = String(text == null ? '' : text).toLowerCase();
    if (!t.trim()) return null;
    let best = null;
    let bestHits = 0;
    for (const [cat, words] of KEYWORDS) {
      let hits = 0;
      for (const w of words) {
        // No lookbehind (unsupported before iOS Safari 16.4)
        const re = new RegExp('(?:^|[^a-z0-9])' + escapeRe(w) + '(?:s|es)?(?![a-z0-9])');
        if (re.test(t)) hits++;
      }
      if (hits > bestHits) {
        best = cat;
        bestHits = hits;
      }
    }
    return best;
  }

  global.AsExpenseCategory = {
    SEPARATOR,
    CATEGORIES,
    KEYS,
    DEFAULT,
    labelOf,
    prefix,
    fromName,
    fromStored,
    parse,
    compose,
    stripOwnPrefix,
    fromImport,
    splitLine,
    composeForStorage,
    lineText,
    normalizeLine,
    guess,
  };
})(typeof window !== 'undefined' ? window : globalThis);
