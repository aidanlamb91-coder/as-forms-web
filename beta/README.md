# AS Forms — Web (`0.3.0-web-beta`)

Free, **static**, browser-only port of AS Forms for Aidan Lamb / Andrews Survey.
No paid APIs, no build step, no auto-send email.

This folder is the **OCR beta** source (`0.3.0-web-beta`). Production GitHub Pages keeps
stable **0.2.9-web** at the site root and serves this build under `/beta/`.

## Open it

**Stable (no OCR):**  
https://aidanlamb91-coder.github.io/as-forms-web/

**OCR beta:**  
https://aidanlamb91-coder.github.io/as-forms-web/beta/?v=0.3.0-web-beta

**Local HTTP** (needed for Word/ODT template fetch):

```bash
cd web
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/

### Receipt reading (beta)

- On-device OCR via **Tesseract.js** (+ **pdf.js** for PDFs), lazy-loaded from pinned jsDelivr CDN.
- Receipts are **not** uploaded to a third-party OCR API.
- First load may download a language model (needs network once; may be slow on mobile).
- After attach: status “Reading receipt…”, then a confirm panel (Use these / Dismiss). Fields are only filled on **Use these**.
- HEIC phone photos often need re-save as JPG/PNG.

## What matches Android / prior web

Expenses, Timesheets, Days worked, Settings — same as 0.2.9-web, plus optional receipt suggestions.

## Files

| Path | Role |
|------|------|
| `index.html` | Shell + views |
| `css/app.css` | Mobile-first styles |
| `js/app.js` | UI / navigation / OCR confirm |
| `js/receipt-parse.js` | UK receipt text heuristics |
| `js/receipt-ocr.js` | Lazy Tesseract + pdf.js |
| `js/storage.js` | IndexedDB + localStorage |
| `lib/jszip.min.js` | Vendored JSZip |
| `templates/*` | Word / ODT / logo |

## Dist zip

`/workspace/receipt-app-dist/as-forms-web.zip` — Pages layout: stable at zip root, OCR under `beta/`.
