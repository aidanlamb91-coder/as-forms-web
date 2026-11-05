/**
 * Smoke-test Android-parity expense zip entry names (no browser).
 * Mocks AsStorage.getReceipt + AsDocxFiller.fillExpenseClaim.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load JSZip from vendored UMD via vm-ish eval in a fake window
const jszipSrc = fs.readFileSync(path.join(__dirname, 'lib/jszip.min.js'), 'utf8');
const fakeWindow = { JSZip: undefined };
const sandbox = { window: fakeWindow, self: fakeWindow, module: { exports: {} }, exports: {}, define: undefined };
const fn = new Function('window', 'self', 'module', 'exports', jszipSrc + '\n; return window.JSZip || module.exports;');
const JSZip = fn(fakeWindow, fakeWindow, sandbox.module, sandbox.exports);
if (!JSZip || typeof JSZip !== 'function') throw new Error('JSZip failed to load');

globalThis.JSZip = JSZip;
globalThis.AsStorage = {
  getReceipt: async (id) => {
    if (id === 'r1') return { name: 'photo.JPG', type: 'image/jpeg', blob: Buffer.from('fake-jpg') };
    if (id === 'r3') return { name: 'scan.pdf', type: 'application/pdf', blob: Buffer.from('%PDF-fake') };
    return null;
  },
  getSettings: () => ({ displayName: 'Aidan Lamb', expenseTo: 'invoice@andrewssurvey.com', sendTo: 'invoice@andrewssurvey.com' }),
};
globalThis.AsDocxFiller = {
  fillExpenseClaim: async (claim) => {
    // Assert claim job forced onto every line
    for (const l of claim.lines || []) {
      if (l.jobNo !== 'P5503') throw new Error('Expected line.jobNo P5503 got ' + l.jobNo);
    }
    return Buffer.from('PK-fake-docx');
  },
};

// Evaluate export.js IIFE against our globals
const exportSrc = fs.readFileSync(path.join(__dirname, 'js/export.js'), 'utf8');
const g = globalThis;
const run = new Function('window', 'JSZip', 'AsStorage', 'AsDocxFiller', exportSrc + '\n; return window.AsExport;');
const AsExport = run(g, JSZip, g.AsStorage, g.AsDocxFiller);

const claim = {
  id: 'c1',
  jobNo: 'P5503',
  name: 'Aidan Lamb',
  sendTo: 'invoice@andrewssurvey.com',
  dateFrom: '2026-07-20',
  dateTo: '2026-07-22',
  completed: false,
  lines: [
    { id: 'l1', date: '2026-07-20', jobNo: 'WRONG', description: 'Taxi', net: 10, vat: 0, total: 10, receiptId: 'r1', receiptMeta: { name: 'photo.JPG' } },
    { id: 'l2', date: '2026-07-21', jobNo: '', description: 'No receipt', net: 5, vat: 0, total: 5, receiptId: null },
    { id: 'l3', date: '2026-07-22', jobNo: 'P9999', description: 'Hotel', net: 100, vat: 20, total: 120, receiptId: 'r3', receiptMeta: { name: 'scan.pdf' } },
  ],
};

const blob = await AsExport.buildClaimZipBlob(claim);
const buf = Buffer.from(await blob.arrayBuffer());
const zip = await JSZip.loadAsync(buf);
const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();

const expected = ['1.jpg', '3.pdf', 'ExpenseClaim_2026-07-20.docx'].sort();
const ok = JSON.stringify(names) === JSON.stringify(expected);
const hasJson = names.some((n) => n.includes('claim.json') || n.endsWith('.json'));
console.log('entries:', names);
console.log('expected:', expected);
console.log('line jobs after sync:', claim.lines.map((l) => l.jobNo));
if (!ok) {
  console.error('FAIL: zip entry names mismatch');
  process.exit(1);
}
if (hasJson) {
  console.error('FAIL: expense zip must not contain claim.json');
  process.exit(1);
}
if (!claim.lines.every((l) => l.jobNo === 'P5503')) {
  console.error('FAIL: lines not synced to claim job');
  process.exit(1);
}
console.log('PASS: Android-parity expense zip');
