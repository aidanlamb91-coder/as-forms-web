# AS Forms — Web (`0.3.7-web-beta`)

Free, **static**, browser-only port of AS Forms for Aidan Lamb / Andrews Survey.
No paid APIs, no build step, no auto-send email.

This folder is the **OCR beta** source (`0.3.7-web-beta`). Production GitHub Pages keeps
stable **0.2.15-web** at the site root and serves this build under `/beta/`.

## Open it

**Stable:**  
https://aidanlamb91-coder.github.io/as-forms-web/?v=0.2.15-web

**OCR beta:**  
https://aidanlamb91-coder.github.io/as-forms-web/beta/?v=0.3.7-web-beta

**Local HTTP** (needed for Word/ODT template fetch):

```bash
cd web
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/

### Data folder sync (Chrome / Edge desktop)

Settings → Backup:

1. **Choose data folder…** — pick a directory the site may write to.
2. **Sync now** — writes `as-forms-backup.json`, `receipts/`, plus human-friendly `Active/`, `Archive/`, and `Timesheets/`.
3. **Auto-sync** (default on when a folder is connected) — after saves/exports, syncs in the background (~1s debounce).
4. **Restore from folder…** — after clearing site data, re-pick the same folder to reload settings, claims, receipts, and timesheets.
5. **Export / Import backup zip** — universal fallback (Safari, Firefox, and phones).

Data still lives in the browser for speed; the folder (or zip) is the durable copy. Folder buttons are disabled with a short hint where the File System Access API is unavailable (Safari/Firefox; limited on Android Chrome).

### Receipt reading (beta)

- On-device OCR via **Tesseract.js** (+ **pdf.js** for PDFs), **vendored** under `vendor/tesseract/` and `vendor/pdfjs/` (no CDN language hang).
- Receipts are **not** uploaded to a third-party OCR API.
- Hard timeout (~120s) if worker/language load stalls; Cancel clears the status.
- After attach: status “Reading receipt…”, then a confirm panel (Use these / Dismiss). Fields are only filled on **Use these**.
- HEIC phone photos often need re-save as JPG/PNG.

## What matches Android / prior web

Expenses, Timesheets, Days worked, Settings — same as 0.2.15-web, plus optional receipt suggestions and data-folder sync.

## Files

| Path | Role |
|------|------|
| `index.html` | Shell + views |
| `css/app.css` | Mobile-first styles |
| `js/app.js` | UI / navigation / OCR confirm |
| `js/folder-sync.js` | File System Access data-folder sync |
| `js/receipt-parse.js` | UK receipt text heuristics |
| `js/receipt-ocr.js` | Lazy Tesseract + pdf.js (local vendor) |
| `vendor/tesseract/` | tesseract + eng.traineddata.gz |
| `vendor/pdfjs/` | pdf.js + worker |
| `js/storage.js` | IndexedDB + localStorage |
| `js/export.js` | Claim/timesheet/backup export |
| `lib/jszip.min.js` | Vendored JSZip |
| `templates/*` | Word / ODT / logo |

## Dist zip

`/workspace/receipt-app-dist/as-forms-web.zip` — Pages layout: stable at zip root, OCR under `beta/`.

## Send to Invoice / Timesheets (web)

Browsers cannot attach files via `mailto:`. Send builds the zip/ODT, auto-downloads it, and offers:
- **Download** (also auto-started)
- **Open mail app (attach yourself)** — To/subject/body only; attach the downloaded file in the mail app
