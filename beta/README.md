# AS Forms — Web (`1.2.2-web`, beta)

Free, **static**, browser-only port of AS Forms for Aidan Lamb / Andrews Survey.
No paid APIs, no build step, no auto-send email (files download, then "Open mail app").

This folder is the **1.0.3-web** source — feature parity with Android 1.0.0, an installable
PWA, a first-run guided tour (new in 1.0.1, tweaked in 1.0.2), swipe between tabs and an unlimited timesheet Year picker (1.0.3). It is deployed to **`/beta/` only**; the site root stays on **0.3.15-web** until approved
(0.3.15 source backup: `/workspace/receipt-app-web-0.3.15-pre-1.0.0-backup.tgz`; 1.0.0 source backup before the tour:
`/workspace/receipt-app-web-1.0.0-pre-tutorial-backup.tgz`; 1.0.1 source backup before the tour tweaks:
`/workspace/receipt-app-1.0.1-pre-tour-tweaks-backup.tgz`; 1.0.2 source backup before swipe / years:
`/workspace/receipt-app-1.0.2-pre-swipe-years-backup.tgz`).

## Open it

**Beta (1.0.3-web):** https://aidanlamb91-coder.github.io/as-forms-web/beta/  
**Stable root (0.3.15-web):** https://aidanlamb91-coder.github.io/as-forms-web/?v=0.3.15-web

**Local HTTP** (needed for templates and the service worker):

```bash
cd web
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/

## Repositories
- Web app source + tests (private): `aidanlamb91-coder/as-forms-web-src` — this folder.
- Deployed site + public APK downloads: `aidanlamb91-coder/as-forms-web` (public; root = stable, `beta/` = beta).
- Android source: `aidanlamb91-coder/as-forms-android` (private); its `scripts/release-android.sh` publishes each APK to both repos.

## New in 1.2.2-web (beta) — personal details lock
- Profile asks **"Lock personal details?"** (first time, and once per session while no lock is set). The lock is a passkey (fingerprint, Face ID or device PIN). Browsers without the passkey PRF extension get an app passphrase instead, and are told so.
- Unlock once per session (closing or reloading the app locks again; it also re-locks after about 5 minutes in the background). Forgot it? **Use recovery key** on the unlock sheet, then set the lock again, or **Forgot? Reset personal details**. Settings → **Security**: Lock now, change or remove the lock, new recovery key, Remember name only.
- 1.2.1 users with saved HR details, signatures or forms are asked at the first start; locking re-seals them, No thanks moves them to memory only.
- **No thanks**: "Personal details won't be saved between sessions." (asked again each session unless **Don't ask again**; Settings → Security turns it on later) plus **Remember name only** (on by default). With it off, timesheet, expense and form exports ask for the name once per session.
- **Bank and NI are never stored or backed up**: typed on each form, kept for that form only, forgotten after export or on leaving. Saved 1.2.1 copies are deleted on upgrade (one-line notice).
- Backups: locked personal details go in encrypted (`personal.json`) only when a recovery key exists. Restoring on a new device: enter the recovery key, then set the passkey again; without it everything else restores.
- Backup: 1.2.1 source `/workspace/receipt-app-backups/web-1.2.1-web-pre-1.2.2-web-src-202610171124.tgz`.

## New in 1.2.1-web (beta) — Android 1.2.0 + 1.2.1 forms
- Settings → **Other forms**: company forms to fill in, then forms and policies to download. Unlock once with the access code (ask your admin); only a locked key is kept on the device.
- Fill in, Preview, Export as Word or PDF. Email opens the share sheet or mail app — the app never sends.
- New / History per form, Import a filled `.docx` or typed PDF (amber = check), delete with Undo, share again.
- Download all, Delete all (size shown), hold an item to delete it, offline search inside the documents.
- Profile: Name, Mileage, Favourite locations, HR details (Bank and NI no longer saved since 1.2.2-web), Signature (draw or upload, up to 3).
- Payroll and HR emails in Email & addresses (default jillian.robertson@andrewssurvey.com).
- Settings → **Clear data on this device** for shared computers — clears only this copy (beta or main site), never the other. (1.2.2-web adds the passkey lock.)
- The beta keeps its own storage (`beta:` names); the main site keeps its existing names, so nothing moves when it is promoted.
- Dates show as dd/mm/yyyy on every browser.
- Backup: 1.1.0 backup source `/workspace/receipt-app-backups/web-1.1.0-web-pre-1.2.1-web-src-202610170928.tgz`.

## New in 1.1.0-web (beta) — Android 1.1.0 parity
- Mileage claims (postcodes.io + OSRM road miles, manual miles always allowed, Home / saved places / location), nested under the expense claim with the same job; one zip with receipts, expense and mileage forms.
- Review & export with tap-to-preview. Nothing is ever emailed automatically.
- Google Drive / OneDrive sync with the Android app (same folder and file names). Set the IDs in `js/cloud-config.js`.
- Yearly receipt archive, "Year starts in", photo shrink, non-work days with no job number, swipe to reopen on Completed, shared top bar + splash, keyboard-safe fields.
- The Data folder option is gone; "Download backup" stays (same zip as Android).
See `CODE_MAP.md` for where things live.

## New in 1.0.3-web (beta) — swipe between tabs, any timesheet year

- **Why the Year list stopped at 2028**: `fillMonthYearSelects` in `js/app.js` built it as `cy − 2 … cy + 2` (2024–2028 in 2026). Opening a timesheet from another year showed — and on Save, stored — the first option (2024).
- **Year picker** (`js/year-picker.js`, `AsYearPicker`): ◀ / ▶ buttons ("Previous year" / "Next year") either side of the Year select step one year at a time (1900–2999); the select lists this year + 10 down to 2000 plus the selected year. New timesheet defaults to the current year; the editor shows the timesheet's real year (change it, then **Save month/year**). Duplicate-month checks, sorting, Days worked Mar–Feb years and Print summary work for any year.
- **Swipe between tabs** (`js/tab-swipe.js`, `AsTabSwipe`): on a phone, swipe left/right on blank space of Expenses / Timesheets / Settings to move to the next / previous tab (no wrap); it slides in from that side (0.26 s; reduced motion → short fade). Only clearly sideways swipes (≥ 72 px, vertical drift ≤ ½), one finger, not from the 16 px screen edges. Ignored when the swipe starts on a card (hold-then-swipe), form field, calendar, viewer, dialog / sheet, the bottom nav or anything that scrolls sideways; off on inner screens, Settings sub-pages and during the guided tour. Touch only — on a desktop use the nav buttons.
- Tests: `tests/test-year-picker-tab-swipe.mjs`, `tests/e2e-swipe-years.mjs` (Chromium real touch + WebKit). Screenshots: `/workspace/receipt-app/screenshots/1.0.3/web-*.png`.

## New in 1.0.2-web (beta) — tour tweaks

- **15 steps**: the tour now starts by spotlighting the **Expenses** tab in the bottom nav ("Expenses — your claims and receipts live here"; tap it, then + New …), and before the timesheet part it spotlights the **Timesheets** tab ("Timesheets — a separate section for your days worked"; tap it, then New timesheet is pressed for you and you pick the month). Progress bar = step / 15; long captions wrap.
- **Slower auto-filled parts** (`timings()` in `js/tutorial.js`, also `AsTutorial.timings(reduced)`): typing 140 ms/char (was 80), 650 ms before typing (320), 700 ms after (300), "Food - " hold 1300 (650), scan 2400 (1900), £ field gap 350 (170), fields → Save 900 (450), **450 ms pause before** every automatic press (new) and 600 after (260–320), 700 after a screen change (250–350), result spotlight 2000 (1300), month list/pick/set 900/800/800 (500/450/380), range 55 per day (28) + 1200 hold (650), Offshore 700 (350), toast 1100 (650). Reduced motion keeps fades only and shorter slide-ins (typing 60 ms/char).
- **◀ Back** (top-right, next to Skip; hidden on step 1): previous step; pressing it while a step is auto-playing restarts that step. Every step is rebuilt from its own start scene, so it looks right from either direction. **Browser / phone Back** = previous step too (on step 1 it skips). **Esc** = Skip.

## New in 1.0.1-web (beta) — guided tour

A quick, almost text-free **practice run** of the app (~45 s). It is a controlled simulation: the
tour draws its own mock screens with the app's own styles, so nothing is really created.

- **Spotlight**: the screen dims, one element is cut out with a pulsing red ring and a one-line label
  (“Tap +”, “Food”, “Attach a receipt”, “Accept”, “Hold, then swipe”, “Pick a month”, “Tap start”,
  “Tap end”, “Offshore”). Everything else is blocked; **Skip** (top right) is always there and ends it
  at once. Values type themselves (job `P1234`, description, amounts). Phone Back / Esc = Skip.
- **Steps as built** (13, progress bar on top):
  1. Expenses — tap **+ New** → claim opens, job number types `P1234`.
  2. Tap **+ Line** → 3. tap **Food** (prefix `Food - ` slides in) → 4. tap **Attach a receipt** → the
     bundled fake receipt (`img/demo-receipt.svg`: “Demo Café”, made-up address, 15/09/2026, Total £12.50,
     VAT £2.08, marked “DEMO — NOT A REAL RECEIPT”) slides in with a scanning shimmer, then the usual
     “Suggested from receipt” card appears with scripted values (no OCR runs).
  5. Tap **Use these** (“Accept”) → fields fill, Save line is pressed for you, the line appears in the claim,
     then Back to the list.
  6. **Hold, then swipe**: a ghost finger shows press-hold-drag-left on the claim (green “Completed”);
     do it yourself or tap **Next**.
  7. Timesheets — **Pick a month** (list drops, current month picked, Create + “+ Entry” pressed for you).
  8–9. Calendar: **Tap start** (6th), **Tap end** (19th) → the range lights up, job/description type in.
  10. Tap **Offshore** → entry “Days 6–19 · Offshore” appears.
  11–13. Timesheets → Completed: slides on the **big offshore number**, the **Holiday/Sick/Office/Training
     tiles**, and the **Mar–Feb year header** → **Done** (toast: “Replay any time: Settings → Tutorial”).
- **When it shows**: once, straight after the welcome name prompt on a first open. Existing users (name or
  data already saved) are not interrupted — they get a one-time dismissible **“New: take the tour”** banner.
  Flag: `localStorage['as-forms-tutorialSeen'] = '1'` (set when the tour starts, or the banner is dismissed).
- **Replay**: Settings → **Tutorial** (banner button) or Settings → About → **Replay tour**.
- **Sandbox**: `js/tutorial.js` never calls AsStorage / IndexedDB / folder sync; demo data lives in memory
  and is dropped on Done or Skip. The real app underneath is `inert`. Verified by e2e (IndexedDB +
  localStorage dumps identical before/after, zero AsStorage writes while open, with seeded real data).
- **Mobile + desktop**: spotlight re-measures every frame (resize, rotation, scrolling); `prefers-reduced-motion`
  swaps all movement for fades. Files: `js/tutorial.js`, `css/tutorial.css`, `img/demo-receipt.svg` (no
  libraries), precached by the service worker so the tour works offline.
- **Android**: the matching tour shipped in Android **1.0.1** (release `android-v1.0.1`).

## New in 1.0.0-web (beta)

1. **Navigation** — bottom tabs are Expenses, Timesheets, Settings (Days worked tab removed; its numbers live in Timesheets → Completed).
2. **Timesheets → Completed by tally year** (March–February, leap-aware). Every year is a collapsible header row, e.g. `Mar 2025 – Feb 2026 · 63 offshore days`; the current year starts expanded. Expanded: Days worked banner (big offshore number + Holiday/Sick/Office/Training tiles, tap for breakdown) and that year's timesheets.
3. **Print summary** — bottom-right of the Days worked breakdown. Builds a PDF client-side (vendored jsPDF, lazy-loaded) titled `Days worked summary — Mar 2025 – Feb 2026` with name, totals and rows grouped by **trip** (consecutive Offshore days, no date gap, across months) then **project** (A→B→A in one trip = three rows; same job across month end = one row). Columns Job no / Description / Start / End / Days. Logic ported from Android `DaysWorkedSummary`, with ported unit tests. Then Open / Download / Share.
4. **Settings sub-pages** — banner buttons (icon, title, subtitle, chevron): Profile, Email & addresses, Data folder, Backup & restore, Import, Install app, About. Every older setting moved, none removed. The browser Back button / swipe-back works between pages.
5. **Safer swipes** — press and hold ~400 ms (row lifts, short vibrate where supported) then drag: right = delete (red, Undo toast), left = complete (green). Quick swipes while scrolling do nothing; vertical scroll is untouched (`touch-action: pan-y`).
6. **Expense categories** — Travel / Food / Equipment / Training / Misc chips with a fixed `Travel - ` prefix in front of the detail. Changing category swaps the prefix and keeps the detail. Stored as `category`; Word export writes `Travel - detail`; old/imported lines without a known prefix become Misc. OCR suggests a category. Backup and zip import carry or infer it. **Expenses → Completed** grouped by tally year with five equal category £ tiles + total; tap a tile for a breakdown.
7. **Install to Home Screen (PWA)** — `manifest.webmanifest` (AS Forms, red AS icons 192/512 + maskable, apple-touch-icon 180, standalone, theme #0D0D0D, relative start_url/scope so the same files work at `/beta/` or root). `sw.js` precaches the app shell and the vendored OCR / pdf.js / jsPDF files, versioned caches (`as-forms:<scope>:shell:1.0.0-web`), and shows "New version available — Reload". Settings → Install app plus a one-time dismissible banner: Chrome/Edge use the install prompt; iPhone/iPad Safari get an illustrated Share → Add to Home Screen sheet. Hidden when already installed.
8. **Receipt/statement previews** — thumbnails on each line (images; PDFs render page 1 with vendored pdf.js), tap for a full-screen viewer with pinch / double-tap zoom and Open / Download / Share. Missing files show a clear "File missing" tile.
9. **Timesheet Preview** — read-only grid built with the same mapping as the .odt export (header, every day of month, ticks, totals line), zoomable. **Open file** builds the .odt and opens/downloads/shares it (web can't launch Word directly).
10. Default timesheet email stays `timesheet@andrewssurvey.com`.
11. Everything from 0.3.15 kept (OCR + foreign currency, bank statement merge / `N.1` `N.2` naming, job-named zip export, zip + timesheet import, autofill, folder sync, backup reminder, name prompt).

### iPhone / Safari notes

- iOS has no install prompt — use Share → **Add to Home Screen** (instructions in Settings → Install app).
- The Home Screen app has **separate storage** from Safari: data typed in Safari won't appear in the installed app. Move it with Settings → Backup & restore (Export backup zip in Safari → Restore in the app).
- In the installed iOS app, opening a generated file in a new tab is limited; use Download or Share (→ Word / Files).
- Data folder sync needs Chrome/Edge on desktop (File System Access API).

## Tests

```bash
cd web/tests
npm install            # first time only (playwright, jspdf, sharp, linkedom, xmldom)
npx playwright install chromium webkit   # first time only
node run-all.mjs       # all node unit/regression tests
node e2e-chromium.mjs  # headless Android-Chrome check (390x844), screenshots
node e2e-webkit.mjs    # headless WebKit/iPhone check, screenshots
node e2e-tutorial.mjs  # guided tour, Chromium + WebKit (or: chromium | webkit), screenshots + video
node e2e-swipe-years.mjs  # 1.0.3 swipe between tabs + year picker, Chromium + WebKit
```

Screenshots: `/workspace/receipt-app/screenshots/web-1.0.3/` (app), `/workspace/receipt-app/screenshots/1.0.3/web-*` (swipe / years) and `/workspace/receipt-app/screenshots/web-tutorial-1.0.3/`
(tour steps at 390×844, `webkit-*` for iPhone, plus `tour-chromium.mp4` / `.gif`). The `tests/` folder is dev-only and is **not** deployed.

## Deploy

Beta (current): copy this folder **without** `tests/`, `test-*.mjs` and `README.md` into
`/workspace/as-forms-web-pages/beta/` (keep `beta/README.md`), commit, `git push`, then check with curl
that `/beta/js/storage.js` says `1.1.0-web` and root `/js/storage.js` still says `0.3.15-web`.

Promote to root (only after approval): copy the same files to the pages repo root (leave `beta/`, `.nojekyll`
alone), update the root README, push. The version label drops "beta" automatically outside `/beta/`.
The root and beta service workers use separate scopes and cache names; the root worker ignores `/beta/`.

## New in 0.3.15-web

1. **Timesheet send-to default** is now `timesheet@andrewssurvey.com` (was `Timesheets@andrewssurvey.com`).
2. **Migration** — on load, a saved timesheet address equal to the old default (case-insensitive `timesheets@andrewssurvey.com`) is switched to the new default; any other address is left as typed. Backup zip import and data-folder restore apply the same migration.

## New in 0.3.14-web

1. **Timesheet autofill** — new entries prefill job / description / day type from the previous timesheet (prefers Offshore rows). Does not overwrite typed edits.
2. **Backup reminder** — if no successful backup export or folder sync in **28 days**, a dismissible banner appears (Settings → Backup shows a badge). “Export backup” opens Backup.
3. **Undo after swipe delete** — swipe-right delete shows an **Undo** toast (~6.5s) that restores claims, timesheets, lines, and entries.
4. **OCR promoted to stable** — root site is the former OCR beta; Apply / Dismiss unchanged.
5. **Bank statement per expense line** — optional statement image/PDF. Export merges receipt + statement into one tall JPEG when both are images; otherwise zip uses `N.1.ext` + `N.2.ext`. Import accepts multi-part. OCR only on receipt. Never auto-email.

## Swipe gestures

- **Press and hold, then slide right**: Delete (with Undo toast).
- **Active lists — press and hold, then slide left**: Completed.

## Data folder sync

Settings → Data folder: Choose data folder / Sync now / Auto-sync / Restore. Settings → Backup & restore: zip Export–Restore. Successful sync updates `lastBackupAt`.

## Files

| Path | Role |
|------|------|
| `index.html` | Shell + views |
| `css/app.css` | Mobile-first styles |
| `js/app.js` | UI |
| `js/image-merge.js` | Tall JPEG merge for receipt+statement |
| `js/export.js` | Zip/ODT/backup export |
| `js/expense-zip-reader.js` | Import claim zips (incl. multi-part) |
| `js/expense-category.js` | Category prefix / infer / compose |
| `js/expense-tally.js` | Expense tally-year totals by category |
| `js/offshore-days.js` | Day counts + tally-year grouping |
| `js/days-worked-summary.js` | Trip → project grouping (port of Android) |
| `js/summary-pdf.js` | Days worked summary PDF (jsPDF) |
| `js/timesheet-layout.js` | Shared timesheet grid mapping (.odt + preview) |
| `js/timesheet-preview.js` | In-app timesheet preview |
| `js/attachments.js`, `js/zoom-view.js` | Thumbnails + full-screen zoom viewer |
| `js/hold-swipe.js` | Press-and-hold swipe rows |
| `js/pwa.js`, `sw.js`, `manifest.webmanifest`, `icons/` | Install + offline |
| `js/tutorial.js`, `css/tutorial.css`, `img/demo-receipt.svg` | Guided tour (sandboxed simulation) |
| `vendor/` | Tesseract + pdf.js + jsPDF (bundled) |
| `tests/` | Dev-only node + Playwright tests (not deployed) |

Dist zip: `/workspace/receipt-app-dist/as-forms-web.zip`.
