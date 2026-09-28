# AS Forms Web (GitHub Pages)

- **Stable** `0.2.14-web` (site root): https://aidanlamb91-coder.github.io/as-forms-web/?v=0.2.14-web
- **OCR beta** `0.3.6-web-beta` (`/beta/`): https://aidanlamb91-coder.github.io/as-forms-web/beta/?v=0.3.6-web-beta

Claim/export matches Android: claim-level job number; zip = filled ExpenseClaim_YYYY-MM-DD.docx + line-indexed receipts (no claim.json).
Send to Invoice / Timesheets: builds zip/ODT, auto-downloads, then Open mail app — mailto cannot attach files; attach the downloaded file yourself.
Days worked: tap offshore total or Holiday/Sick/Office/Training tiles for a period breakdown.
First open: if Display name is empty, a welcome prompt asks for the name used on claims/timesheets (Skip leaves it blank; set later in Settings). Existing saved names are unchanged.
Receipt OCR (beta build) runs on-device (vendored Tesseract.js); receipts are not uploaded to a paid OCR API.
