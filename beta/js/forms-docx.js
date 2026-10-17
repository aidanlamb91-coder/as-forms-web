/**
 * 1.2.1-web Word side of Other forms (port of Android FormDocxFiller.kt + FormImporter.kt).
 *
 * Filling: every box in a template holds one {{key}} marker in a single run, so filling is a
 * plain text swap inside word/document.xml:
 *  - text / dates / numbers: the value (blank when empty; new lines become line breaks),
 *  - pick-one groups: {{field.option}} prints ☒ when chosen, ☐ when not (✔ / blank for "check" groups),
 *  - {{sig.employee}}: the signature PNG as an inline picture (blank when there's none).
 *
 * Importing (Option B): reads answers back out of an already-filled copy so it can be finished here.
 *  - a copy made from the same template: template paragraphs are lined up with the copy's, and
 *    whatever sits where a marker was becomes the answer (exact line-up = "sure"),
 *  - any other Word copy or typed PDF text: "Label: answer" lines (always "unsure", amber).
 * The signature is never imported. Every regex brace is escaped (the Android build broke on a bare one).
 */
(function (global) {
  const MARKER = /\{\{([^\{\}]+)\}\}/g;
  /** Same pattern without the capture group, for split() (a captured group would be kept in the parts). */
  const MARKER_SPLIT = /\{\{[^\{\}]+\}\}/;
  const SIG_KEY = 'sig.employee';
  const SIG_REL = 'rIdAsFormsSig';
  const R = () => global.AsFormRules;

  const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const unXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');

  async function documentXml(docx) {
    const zip = await global.JSZip.loadAsync(docx);
    const f = zip.file('word/document.xml');
    return f ? f.async('string') : null;
  }

  /** Marker keys found in a template (used by the revision check). */
  async function markers(template) {
    const xml = (await documentXml(template)) || '';
    return new Set(Array.from(xml.matchAll(MARKER), (m) => m[1]));
  }

  /** What one marker prints. */
  function valueFor(key, spec, values) {
    if (key === SIG_KEY) return '';
    const f = R().field(spec, key);
    if (f) return R().tidy(f.validate, values[key] == null ? '' : values[key]);
    const i = key.lastIndexOf('.');
    const g = R().field(spec, key.slice(0, i));
    if (g && g.type === 'radio') {
      const on = values[g.key] === key.slice(i + 1);
      return g.mark === 'check' ? (on ? '✔' : '') : (on ? '☒' : '☐');
    }
    return '';
  }

  /** Width and height from a PNG header. */
  function pngSize(png) {
    const b = png;
    const int = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
    return [int(16), int(20)];
  }

  /** Swaps the whole run holding {{sig.employee}} for a picture run. */
  function replaceSignatureRun(xml, png) {
    const at = xml.indexOf('{{' + SIG_KEY + '}}');
    if (at < 0) return xml;
    const runs = Array.from(xml.slice(0, at).matchAll(/<w:r[ >]/g));
    if (!runs.length) return xml;
    const start = runs[runs.length - 1].index;
    const endAt = xml.indexOf('</w:r>', at);
    if (endAt < 0) return xml;
    const end = endAt + 6;
    const [w, h] = pngSize(png);
    const heightEmu = 457200; // 1.27 cm tall
    const widthEmu = Math.min(Math.round(heightEmu * w / Math.max(h, 1)), 2286000);
    const hEmu = widthEmu === 2286000 ? Math.round(2286000 * h / Math.max(w, 1)) : heightEmu;
    const drawing = '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + widthEmu + '" cy="' + hEmu + '"/><wp:docPr id="9001" name="Signature"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9001" name="signature.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="' + SIG_REL + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + widthEmu + '" cy="' + hEmu + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    return xml.slice(0, start) + drawing + xml.slice(end);
  }

  /** Fills a template. Returns the new .docx as a Uint8Array. */
  async function fill(template, spec, values, signaturePng) {
    const zip = await global.JSZip.loadAsync(template);
    let xml = await zip.file('word/document.xml').async('string');
    const sig = signaturePng && signaturePng.length > 24 ? signaturePng : null;
    if (sig) xml = replaceSignatureRun(xml, sig);
    xml = xml.replace(MARKER, (_, key) => escXml(valueFor(key, spec, values || {})).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">'));
    // markers sit inside <w:t>; make sure leading / trailing spaces survive
    xml = xml.replace(/<w:t>/g, '<w:t xml:space="preserve">');
    zip.file('word/document.xml', xml);
    if (sig) {
      zip.file('word/media/as_forms_signature.png', sig);
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      if (!rels.includes(SIG_REL)) {
        zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>',
          '<Relationship Id="' + SIG_REL + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/as_forms_signature.png"/></Relationships>'));
      }
      const ct = await zip.file('[Content_Types].xml').async('string');
      if (!ct.includes('Extension="png"')) {
        zip.file('[Content_Types].xml', ct.replace(/(<Types [^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>'));
      }
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  /** Paragraph texts of word/document.xml (line breaks kept as \n). */
  async function paragraphs(docx) {
    let xml = null;
    try { xml = await documentXml(docx); } catch (_) { xml = null; }
    if (!xml) return [];
    return xml.split('</w:p>').map((p) => unXml(p.replace(/<w:br[^>]*\/>/g, '\n').replace(/<w:tab[^>]*\/>/g, ' ').replace(/<[^>]+>/g, '')));
  }

  /** Plain text of a .docx (search). */
  async function docxText(docx) {
    const xml = (await documentXml(docx)) || '';
    return unXml(xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''));
  }

  /** One marker's text → answer (pick-one groups: ☒ / ✔ / x means chosen). */
  function put(spec, key, raw, into) {
    if (key === SIG_KEY) return;
    const v = String(raw).trim();
    if (R().field(spec, key)) { if (v) into[key] = v; return; }
    const i = key.lastIndexOf('.');
    const f = R().field(spec, key.slice(0, i));
    if (f && f.type === 'radio' && (v === '☒' || v === '✔' || v.toLowerCase() === 'x')) into[f.key] = key.slice(i + 1);
  }

  /**
   * Lines the template up with the filled copy. Paragraphs without markers act as anchors; a
   * paragraph with markers becomes a pattern ("Name: (.*?)") matched near the current spot.
   * Returns null when nothing lines up (not made from this template).
   */
  async function fromTemplate(spec, template, filled) {
    const t = await paragraphs(template);
    const f = await paragraphs(filled);
    if (!f.length) return null;
    const exact = t.length === f.length;
    const values = {};
    let j = 0; let matched = 0;
    const WINDOW = 60;
    const near = (test) => { for (let k = j; k < Math.min(f.length, j + WINDOW); k++) if (test(f[k])) return k; return -1; };
    for (const tp of t) {
      const keys = Array.from(tp.matchAll(MARKER), (m) => m[1]);
      if (!keys.length) {
        if (!tp.trim()) { if (exact) j++; continue; }
        const at = near((x) => x.trim() === tp.trim());
        if (at >= 0) j = at + 1; else if (exact) j++;
        continue;
      }
      const literal = tp.replace(MARKER, '').trim().length > 0;
      const pattern = new RegExp('^' + tp.split(MARKER_SPLIT).map(escRe).join('([\\s\\S]*?)') + '$');
      const at = literal ? near((x) => pattern.test(x)) : (j < f.length ? j : -1);
      if (at < 0) { if (exact) j++; continue; }
      const m = pattern.exec(f[at]);
      if (!m) { j = at + 1; continue; }
      matched++;
      keys.forEach((key, i) => put(spec, key, m[i + 1], values));
      j = at + 1;
    }
    if (!matched) return null;
    return { values, unsure: exact ? new Set() : new Set(Object.keys(values)) };
  }

  /** "Label: answer" on one line. Always unsure. */
  function byLabels(spec, text) {
    const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = {};
    for (const fld of R().fields(spec)) {
      if (fld.type === 'signature' || fld.type === 'radio') continue;
      const label = fld.label.trim().replace(/:+$/, '');
      if (label.length < 3) continue;
      const line = lines.find((l) => l.toLowerCase().startsWith(label.toLowerCase()));
      if (!line) continue;
      const v = line.slice(label.length).replace(/^[ :\t]+/, '').trim();
      if (v && v.length < 200) out[fld.key] = v;
    }
    return { values: out, unsure: new Set(Object.keys(out)) };
  }

  /** Keeps real boxes only and counts them: { values, unsure, filled, total, signatureSkipped }. */
  function result(spec, found) {
    const boxes = R().fields(spec).filter((f) => f.type !== 'signature');
    const keys = new Set(boxes.map((f) => f.key));
    const values = {};
    for (const [k, v] of Object.entries(found.values)) if (keys.has(k) && String(v).trim()) values[k] = v;
    const unsure = Array.from(found.unsure).filter((k) => k in values);
    return { values, unsure, filled: Object.keys(values).length, total: boxes.length, signatureSkipped: R().hasSignature(spec) };
  }

  /** Import a filled .docx. */
  async function importDocx(spec, template, bytes) {
    const viaTemplate = template ? await fromTemplate(spec, template, bytes) : null;
    if (viaTemplate) return result(spec, viaTemplate);
    const paras = await paragraphs(bytes);
    if (!paras.length) throw new Error("Couldn't import");
    return result(spec, byLabels(spec, paras.join('\n')));
  }

  global.AsFormDocx = { markers, fill, valueFor, pngSize, paragraphs, docxText, fromTemplate, byLabels, result, importDocx, SIG_KEY, MARKER };
})(typeof window !== 'undefined' ? window : globalThis);
