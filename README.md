# AS Forms Web (GitHub Pages)

- **Stable** `0.2.16-web` (site root): https://aidanlamb91-coder.github.io/as-forms-web/?v=0.2.16-web
- **OCR beta** `0.3.8-web-beta` (`/beta/`): https://aidanlamb91-coder.github.io/as-forms-web/beta/?v=0.3.8-web-beta

Timesheet entry: start/end days locked to the timesheet month (typed values capped); **Pick dates…** opens a month-grid range calendar (tap start, tap end; order-independent; in-range highlight). Constrained to the current timesheet month.

Claim/export matches Android: claim-level job number; zip = filled ExpenseClaim_YYYY-MM-DD.docx + line-indexed receipts (no claim.json).
Send to Invoice / Timesheets: builds zip/ODT, auto-downloads, then Open mail app — mailto cannot attach files; attach the downloaded file yourself.
Days worked: tap offshore total or Holiday/Sick/Office/Training tiles for a period breakdown.
First open: if Display name is empty, a welcome prompt asks for the name used on claims/timesheets (Skip leaves it blank; set later in Settings). Existing saved names are unchanged.
**Data folder sync** (Chrome/Edge desktop): Settings → Backup → Choose data folder… / Sync now / Restore from folder…. Safari/Firefox: use Export/Import backup zip. Folder is the durable copy; browser storage stays for speed.
Receipt OCR (beta build) runs on-device (vendored Tesseract.js); receipts are not uploaded to a paid OCR API.
