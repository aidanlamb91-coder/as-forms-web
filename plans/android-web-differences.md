# Android vs web — differences catalog

Written **27 Oct 2026** for future development. Compares:

- **Android** AS Forms **1.2.5** (versionCode 48)
- **Web PWA** AS Forms **1.2.2-web** (main site and `/beta/`)

No code was changed for this note. Sources: both codebases, Android `docs/changes-*.md`, `STATUS.md`, `AGENTS.md`, web-port notes, and the web `README.md` / `CODE_MAP.md`.

**Legend**

| Mark | Meaning |
|---|---|
| **Android only** | On the phone app; not on the web yet |
| **Web only** | On the browser app; not on Android yet |
| **Both** | Present on both (may still differ in detail) |
| **Partial** | One side has a thinner version |

**Free hosting reminder:** the web app stays a static GitHub Pages site (plus a free Cloudflare Worker for long-lived Google Drive sign-in). Ports must keep working offline in the browser, with no paid APIs. Avoid Google Maps, Cloud Vision, paid OCR, or anything that needs a server database unless Aidan later approves the multi-user hosting plan.

---

## 1. Expenses / receipts

| Feature | Status | Notes / porting |
|---|---|---|
| Expense claims, line items, categories, Active/Completed | **Both** | Shared idea; web uses IndexedDB, Android uses Room |
| Hold-then-swipe complete / delete / reopen + Undo | **Both** | Directions match |
| Receipt + bank-statement attach, merge / `N.1` `N.2` naming | **Both** | |
| On-device OCR + foreign currency | **Both** | Android: ML Kit via Play services. Web: Tesseract.js (slower on phones, larger cache). Keep free; no cloud OCR |
| Photo shrink on attach (~1600 px JPEG) | **Both** | |
| Receipt / statement thumbnails + full-screen viewer | **Both** | |
| Import expense zips, export Word + zip, Send via mail app | **Both** | Never auto-emails |
| Job-linked mileage under the expense claim | **Both** | Nested sub-card + combined job zip |
| "+" chooser (Expense / Mileage) | **Both** | |

**Gap size:** small. Day-to-day expenses are largely in parity.

---

## 2. Mileage

| Feature | Status | Notes / porting |
|---|---|---|
| Mileage claims + journeys, maths, rate, return trip | **Both** | Pure logic — already ported |
| `mileage.docx` fill, extra sheets, totals | **Both** | |
| Profile Home postcode, CC, rate, favourite places | **Both** | |
| Calculate road miles (postcodes.io + OSRM) | **Both** | Free demo servers; keep out of the service-worker cache; manual miles always allowed |
| Use current location → postcode | **Both** | Needs HTTPS + permission. Web uses postcodes.io reverse lookup (no native geocoder) |
| Trip suggestions from timesheets | **Both** | |
| Grouped swipe on linked expense + mileage | **Both** | |

**Gap size:** none of substance. Mileage is parity.

---

## 3. Timesheets

| Feature | Status | Notes / porting |
|---|---|---|
| Monthly timesheets, day types, import .odt/.docx | **Both** | |
| Preview grid + Open file | **Both** | Web downloads/shares; can't launch Word directly |
| Days worked (Mar–Feb) + Print summary PDF | **Both** | |
| Year picker (any year) + tab swipe | **Both** | |
| Non-work days without a job number | **Both** | |
| Live **pay estimate** strip on each timesheet (gross / net / season / tap for breakdown) | **Android only** | Needs the Pay engine + Settings → Pay (see §5). Port as pure JS; runs offline. Large piece of work |
| Estimate vs uploaded payslip on the timesheet | **Android only** | Depends on payslip import (see §4) |

**Gap size:** medium — the timesheet *form* matches; the pay estimate strip does not.

---

## 4. Insights / payslips / pension (biggest Android lead)

Android has a fourth bottom tab: **Expenses | Timesheets | Insights | Settings**.  
Web still has three: **Expenses | Timesheets | Settings**.

| Feature | Status | Notes / porting |
|---|---|---|
| Insights tab (hero totals, donut, monthly bars, progression chart) | **Android only** | Charts are Compose canvas. On web: Canvas / SVG / lightweight chart code, no paid charting SaaS |
| Stat cards (Basic, Offshore, Bonus, Tax UK/Non-UK, Total pension, Employer pension, …) | **Android only** | |
| Long-press reorder of Insights cards (saved + backed up) | **Android only** | Pointer events + stored order |
| Tap a card → month-by-month breakdown sheet | **Android only** | |
| Pinch-zoom monthly chart; slide-a-dot on progression lines | **Android only** | |
| Import payslip PDFs (PdfBox parse), Manage payslips, detail view | **Android only** | Web: pdf.js / pdf-lib text extract, or a WASM PDF parser. Keep parsing on-device. Store PDFs in IndexedDB / cloud backup zip — watch the free storage quota |
| Shared month resolver (payslip beats estimate; pay-month labelling) | **Android only** | Pure logic — ports cleanly once payslips exist |
| Pension chart (contributions area + pot line) | **Android only** | |
| "Forecast ›" link on the Pension card | **Android only** | Opens the forecast window (§5) |

**Privacy:** real payslip figures and PDFs must never go into the repo, tests, docs or mockups. Use made-up fixtures only (same rule as Android).

**Gap size:** large. This whole area is Android-only.

---

## 5. Statement import and forecast

| Feature | Status | Notes / porting |
|---|---|---|
| Aviva annual statement PDF import (preview, adds-up, chain, payments vs payslips) | **Android only** | PdfBox today. Web needs an on-device PDF text extract. Reject non-Aviva; "Import anyway" when checks fail |
| Statement PDFs in local + cloud backups | **Android only** | Same backup zip layout as payslips; unencrypted zip is a known issue |
| Yearly performance by tax year (* = split) | **Android only** | Pure maths once statements are stored |
| Settings › Pay bars: Pot values / Tax code / Private healthcare / Annual statements (dated history) | **Android only** | |
| Forecast window to age 100 (state pension under private income, pot line on top, Advanced settings, saved scenarios) | **Android only** | Pure Kotlin today (`PensionForecast`) — ports cleanly to JS. Label stays "Estimate, not financial advice". No paid data feeds |
| Salary growth: From my payslips (average) / Fixed % | **Android only** | Needs enough full tax years of payslips |

**Gap size:** large. Depends on Insights + Pay settings landing first (or alongside).

---

## 6. Settings / Pay / Profile

| Feature | Status | Notes / porting |
|---|---|---|
| Profile (name, Mileage, Favourite locations, HR details, Signature) | **Both** | |
| Other forms (fill-in + policies download, search, New/History, Import) | **Both** | Shared encrypted library on this site under `/forms/` |
| Email & addresses (Invoice, Timesheets, Payroll, HR) + templates | **Both** | |
| Year starts in | **Both** | |
| Tutorial / About / Import | **Both** | |
| **Settings → Pay** (rates, pension %, student loan, tax codes, fixed deductions, pay rises, pot values, healthcare, statements) | **Android only** | Required before the timesheet estimate and Insights make sense on web |
| Install app (PWA / Add to Home Screen) | **Web only** | Not applicable on Android |
| Clear data on this device (scoped so beta ≠ main site) | **Web only** | Useful on shared computers; Android could add a similar "clear this phone" later if wanted |

**Gap size:** Pay settings is the main missing Settings page on web.

---

## 7. Sync and backup

| Feature | Status | Notes / porting |
|---|---|---|
| Google Drive + OneDrive sync (same "AS Forms" folder layout) | **Both** | Web needs its own OAuth clients (already set). Google on web uses a free Cloudflare Worker (`as-forms-auth`) so sign-in lasts weeks; OneDrive uses PKCE refresh tokens |
| Sync and Backup screen (cloud card, sizes, archive rows, download backup) | **Both** | |
| Shared backup zip format (claims, timesheets, mileage, forms profile, …) | **Both** | Aimed so a backup from one side restores on the other. Pay / Insights / statement fields are Android-only extras today — web should ignore unknown fields until ported, then round-trip them |
| Pending badge / tap cloud icon to upload now | **Both** | |
| Automatic background sync (Wi-Fi only / Always) | **Partial** | Android can sync quietly in the background. Browsers cannot do this reliably — web syncs on open, after a change, and from the cloud icon. Keep it that way |
| Payslip + statement PDFs inside the backup zip | **Android only** | Add when Insights lands on web. Remains unencrypted unless Aidan asks for encrypted backups |

**Gap size:** small for day-to-day sync; medium once pay PDFs need to travel with backups.

---

## 8. Archives

| Feature | Status | Notes / porting |
|---|---|---|
| Yearly `AS-Forms-YYYY.zip`, auto-archive, Local / Cloud sizes + Clear | **Both** | Shared markers so either app knows a receipt was archived |
| Confirm-before-delete (every copy present) | **Both** | |

**Gap size:** none of substance.

---

## 9. Sign-in / security

| Feature | Status | Notes / porting |
|---|---|---|
| Cloud OAuth (Google / OneDrive) | **Both** | Different client IDs per platform; same folders |
| **Lock personal details** (passkey / passphrase, recovery key, auto-lock, Bank & NI never stored) | **Web only** (Android planned) | Agreed plan lives in Android `docs/security-plan-next.md`. Web shipped it in 1.2.2-web. Android still to build (Keystore + device lock / Credential Manager). Ask Aidan before starting the Android lock |
| Forms access code | **Both** | Comes only from the `FORMS_CODE` env var at build/test time — never in code, repos, docs or logs |
| Google client secret | **Web Worker only** | Lives in Cloudflare secret storage for `as-forms-auth`. Never printed or committed |

**Gap size:** security lock is the one place the **web is ahead**.

---

## 10. UI / animations / platform

| Feature | Status | Notes / porting |
|---|---|---|
| Shared top bar + splash (logo glide, radial reveal) | **Both** | Web is CSS/`clip-path`; no OS splash |
| Tab swipe + Settings swipe-back | **Both** | Web must not fight the browser's own back gesture |
| Keyboard never covers a text field | **Both** | Web uses `visualViewport` |
| Dates as dd/MM/yyyy | **Both** | |
| Guided tour | **Both** | |
| Bottom nav: Insights as 4th tab | **Android only** | Add when Insights is ported |
| Camera capture (vs file picker) | Neither really | Both use the file picker; OCR runs after attach |
| Offline install | **Both** | Android APK; web service worker + manifest |
| iPhone / Safari limits | **Web only concern** | No File System Access; Home Screen storage separate from Safari; OAuth redirects awkward in standalone. Test on a real iPhone after any big web port |

**Parked (neither side active):** AUV Insights animation (`docs/parked/auv/` on Android).

---

## 11. Anything else

| Topic | Notes |
|---|---|
| Version naming | Android `1.2.5` / web `1.2.2-web`. Numbers are not meant to match one-for-one after the split |
| Beta vs main (web) | Web changes go to `/beta/` first; promote only with Aidan's approval. Beta storage is kept apart (`beta:` names) |
| Multi-user hosting plan | Discussed separately (Cloudflare Pages + Workers, Neon, Resend, R2, GitHub — free tiers, Docker for local testing only). Not built. Would matter if shared accounts are wanted later; not required for the ports above |
| Encrypted backups | Known follow-up (payslip/statement PDFs currently sit in an unencrypted zip at Aidan's request) |
| Holiday pay estimate / web pay estimate | Deferred earlier; now part of the Insights / Pay port if Aidan wants them |

---

## Suggested porting priority

Aimed at closing the biggest user-visible gaps while staying free and offline-friendly. Order can change with Aidan's say-so.

1. **Settings → Pay on web** (rates, pension %, tax codes, deductions, rises) — foundation for everything below. Pure logic + localStorage / backup fields.
2. **Payslip import + store PDFs** (on-device parse, Manage list, backup zip entries) — still no real figures in tests/docs.
3. **Live pay estimate strip on Timesheets** — port `PayEstimate` to JS; reuse Pay settings.
4. **Insights tab** (hero, donut, bars, cards, reorder, breakdown sheets) — largest UI piece; add the 4th nav item.
5. **Pension pot values + pension chart** on Insights.
6. **Aviva statement import** (chain + payslip reconciliation) + yearly performance.
7. **Forecast window** (age 100, state pension, Advanced settings, saved scenarios).
8. **Android security lock** (mirror web 1.2.2-web) — only when Aidan asks to start it; web already has it.
9. **Polish / parity tidy-ups** as they come up: backup round-trip of the new Pay fields, encrypted backup option, any remaining wording.

Rough effort feel (one developer, free stack only): steps 1–3 are a few days each of careful porting and tests; steps 4–7 are a larger multi-day chunk (charts + PDF parsing + forecast UI); step 8 is its own Android project.

---

## How this file is hosted

This note lives in the public Pages repo (`as-forms-web`) under `plans/`, on the `main` branch. It is **docs only** — it does not change `index.html`, `js/`, `css/` or `beta/`, so the live app and beta keep the same behaviour. GitHub Pages may still rebuild the site after the push; that is expected and harmless.

