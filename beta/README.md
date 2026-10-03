# AS Forms — Web beta (`1.0.0-web beta`)

Beta of **1.0.0-web**: feature parity with Android 1.0.0, installable to the Home Screen (PWA).
The site root stays on stable **0.3.15-web** until this beta is approved.

- https://aidanlamb91-coder.github.io/as-forms-web/beta/

New: 3 bottom tabs (Expenses / Timesheets / Settings); tally-year (Mar–Feb) collapsible groups on
Completed expenses (five category tiles) and Completed timesheets (Days worked banner); Days worked
**Print summary** PDF grouped by trip then project; Settings banner sub-pages; press-and-hold swipes;
expense categories (`Travel - …` prefix); receipt/statement thumbnails + full-screen zoom viewer;
in-app timesheet preview + "Open file" (.odt); web app manifest + offline service worker with
"New version available — Reload"; Install app button (Chrome prompt / iOS Share → Add to Home Screen).

The beta service worker is scoped to `/as-forms-web/beta/` and uses its own cache names, so it
does not control the root site. Data (IndexedDB/localStorage) is shared with the root site in the
same browser (same origin). On iPhone, the Home Screen app has its own storage separate from
Safari — use Settings → Backup & restore to move data across.
