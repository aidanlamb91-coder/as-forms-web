# AS Forms — Web (`0.3.1-web-beta`)

Free, **static**, browser-only port of AS Forms for Aidan Lamb / Andrews Survey.
No paid APIs, no build step, no auto-send email.

This folder is the **OCR beta** source (`0.3.1-web-beta`). Production GitHub Pages keeps
stable **0.2.9-web** at the site root and serves this build under `/beta/`.

## Open it

**Stable (no OCR):**  
https://aidanlamb91-coder.github.io/as-forms-web/

**OCR beta:**  
https://aidanlamb91-coder.github.io/as-forms-web/beta/?v=0.3.1-web-beta

**Local HTTP** (needed for Word/ODT template fetch):

```bash
cd web
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/

### Receipt reading (beta)

- On-device OCR via **Tesseract.js** (+ **pdf.js** for PDFs), **vendored** under `vendor/tesseract/` and `vendor/pdfjs/` (no CDN language hang).
- Receipts are **not** uploaded to a third-party OCR API.
- Hard timeout (~120s) if worker/language load stalls; Cancel clears the status.
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
| `js/receipt-ocr.js` | Lazy Tesseract + pdf.js (local vendor) |
| `vendor/tesseract/` | tesseract + eng.traineddata.gz |
| `vendor/pdfjs/` | pdf.js + worker |
| `js/storage.js` | IndexedDB + localStorage |
| `lib/jszip.min.js` | Vendored JSZip |
| `templates/*` | Word / ODT / logo |

## Dist zip

`/workspace/receipt-app-dist/as-forms-web.zip` — Pages layout: stable at zip root, OCR under `beta/`.
