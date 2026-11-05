# Before next update — queued items

> **Must ship before the next update:** Android after 1.2.8, and web after 1.2.10-web (1.2.8 and 1.2.10-web shipped the Sal Sac switch only, 4 Nov 2026).
> These items are queued only. Do not build them yet.

## 1. Payslip and pension statement PDFs: viewable in the app, encrypted at rest
Requested by Aidan on 29 Oct 2026.

**Goal:** imported payslip PDFs and pension annual statement PDFs stay viewable **inside the app**, but are stored **encrypted at rest**. They must never be readable as plain PDFs outside the app.

**Requirements**
- PDFs can be viewed inside the app on both Android and web.
- Stored encrypted at rest:
  - Android: in the app's storage.
  - Web: in IndexedDB.
- Local backups and cloud backup zips must not contain plain PDFs.
- Backup compatibility:
  - Older backups must still restore.
  - New backups must not silently break restore. If restore can't decrypt a backup, say so clearly.
- Both platforms should use the same approach where possible.
- Privacy rules are unchanged: synthetic fixtures only, no real figures or personal details in code, tests, docs or mockups, and no payslip or statement PDFs in the repo.

**Open decisions (to make with Aidan)**
- [ ] **Where to view the PDFs in the app.** Not decided, so don't design or build a viewer screen yet.
- [ ] **Backup encryption:** encrypt the whole backup zip, or encrypt each PDF inside it?
- [ ] **Key protection:** Android Keystore on Android, WebCrypto (a non-extractable key) on web, or a key derived from a passphrase or the existing lock?
- [ ] **Restore on another device or browser:** how does the key move with the backup (passphrase, export, or something else)? What happens when no key is available?
