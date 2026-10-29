# AS Forms — Web (GitHub Pages)

Stable **1.2.9-web** (build 6) at site root (promoted 29 Oct 2026 with Aidan's approval; was **1.2.8-web**, kept at `/old-1.2.8/` and tag `web-1.2.8-root`). 1.2.9-web adds the layout changes, the Settings section title change (no "Danger zone"), the Expenses tab fix and the single header cloud that shows a green tick in place after a sync.

Earlier: **1.2.8-web** at site root (promoted 29 Oct 2026 with Aidan's approval; was **1.2.2-web**, kept at `/old-1.2.2/` and tag `web-1.2.2-root`). 1.2.8-web adds Settings → Pay, the timesheet pay strip, Insights (cards, breakdowns, pension chart, earnings donut), payslip / pension statement import on the device, the Forecast with Tax savings and the Settings → Import page.

Earlier: 1.2.2-web (promoted 17 Oct 2026; was **1.1.0-web**, kept at `/old-1.1.0/` and tag `web-1.1.0-root`). 1.2.2-web adds Other forms, HR details, signatures, the personal details lock (passkey / passphrase, recovery key), Bank & NI never stored, Settings → Security and Clear data on this device.

- Main site: https://aidanlamb91-coder.github.io/as-forms-web/
- Beta: https://aidanlamb91-coder.github.io/as-forms-web/beta/ (own storage names, `beta:` prefix)
- Rollback copies: `/old-1.2.8/`, `/old-1.2.2/`, `/old-1.1.0/`, `/old-0.3.15/` (tags `web-1.2.8-root`, `web-1.2.2-root`, `web-1.1.0-root`, `web-0.3.15-root`). They are older builds that use the main site's storage names, so they show the same data as the main site; Clear data on the main site empties them too. The main site's service worker never answers for them.

## Repositories
- **This repo (public):** the web app served by GitHub Pages (root = stable, `beta/` = beta) **and the public Android APK downloads** — every `android-vX.Y.Z` release stays here so phone links keep working, e.g. https://github.com/aidanlamb91-coder/as-forms-web/releases/download/android-v1.1.0/AS-Forms-1.1.0.apk
- **Android source (private):** https://github.com/aidanlamb91-coder/as-forms-android — from 1.1.0 each release is published there too (`scripts/release-android.sh`). Its own release files need a GitHub login, so phones use the links here.
