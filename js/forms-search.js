/**
 * 1.2.1-web Other forms search: titles and what's inside the documents, fully offline
 * (port of Android FormsSearch.kt). Text comes from downloaded files (read once and kept on this
 * device by js/forms-library.js), otherwise from the built-in summaries (data/forms-summaries.bin,
 * encrypted with the library key, so it only opens once the access code is entered).
 */
(function (global) {
  /** "…text around the match…" (about 80 characters). */
  function snippet(text, words) {
    const low = String(text).toLowerCase();
    const hits = words.map((w) => low.indexOf(w)).filter((i) => i >= 0);
    if (!hits.length) return null;
    const at = Math.min(...hits);
    const from = Math.max(0, at - 30); const to = Math.min(text.length, at + 50);
    return (from > 0 ? '…' : '') + text.slice(from, to).trim() + (to < text.length ? '…' : '');
  }

  /**
   * Items matching EVERY word of the query in the title, number, document text or summary.
   * Title matches come first; others get a snippet. textFor(item) returns the text or null.
   */
  function search(items, query, textFor, summaries) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const item of items) {
      const head = (item.title + ' ' + item.number + ' ' + item.number + ' ' + item.rev).toLowerCase();
      const body = (textFor && textFor(item)) || (summaries && summaries[item.number]) || '';
      const all = head + ' ' + body.toLowerCase();
      if (!words.every((w) => all.includes(w))) continue;
      const inTitle = words.every((w) => head.includes(w));
      out.push({ item, inTitle, snippet: inTitle ? null : snippet(body, words) });
    }
    return out.sort((a, b) => (b.inTitle ? 1 : 0) - (a.inTitle ? 1 : 0));
  }

  const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();

  global.AsFormsSearch = { search, snippet, squash };
})(typeof window !== 'undefined' ? window : globalThis);
