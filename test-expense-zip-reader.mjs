/**
 * Parse smoke test against JVM-produced P5503.zip (+ optional fill round-trip).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { parseHTML } = require('/tmp/as-test/node_modules/linkedom');

const { window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.window = window;
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;
globalThis.document = window.document;

const jszipSrc = fs.readFileSync(path.join(__dirname, 'lib/jszip.min.js'), 'utf8');
const fakeWin = { JSZip: undefined };
const JSZip = new Function('window', 'self', 'module', 'exports', jszipSrc + '\n; return window.JSZip || module.exports;')(fakeWin, fakeWin, { exports: {} }, {});
globalThis.JSZip = JSZip;
window.JSZip = JSZip;

function loadIife(file) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  new Function('window', 'globalThis', 'JSZip', 'DOMParser', 'XMLSerializer', src)(
    window, globalThis, JSZip, window.DOMParser, window.XMLSerializer
  );
}

loadIife('js/docx-filler.js');
loadIife('js/expense-zip-reader.js');

const AsDocxFiller = window.AsDocxFiller;
const AsExpenseZipReader = window.AsExpenseZipReader;

if (AsExpenseZipReader.parseHeaderDate('20th Jul 2026') !== '2026-07-20') throw new Error('header date');
if (AsExpenseZipReader.parseHeaderDate('1st March 2026') !== '2026-03-01') throw new Error('header date2');
if (AsExpenseZipReader.parseMoney('£12.50') !== 12.5) throw new Error('money');

const docxBuf = fs.readFileSync('/tmp/ExpenseClaim_2026-07-01.docx');
const extracted = await AsDocxFiller.extractSummary(docxBuf);
if (extracted.name !== 'Aidan Lamb') throw new Error('name ' + extracted.name);
if (!String(extracted.dateFrom).includes('2026')) throw new Error('dateFrom ' + extracted.dateFrom);
if (extracted.lines.length < 2) throw new Error('lines ' + extracted.lines.length);

const zipBuf = fs.readFileSync('/tmp/P5503.zip');
const parsed = await AsExpenseZipReader.parse(zipBuf, 'P5503.zip');
if (parsed.jobNumber !== 'P5503') throw new Error('job ' + parsed.jobNumber);
if (parsed.dateFrom !== '2026-07-01') throw new Error('from ' + parsed.dateFrom);
if (parsed.dateTo !== '2026-07-20') throw new Error('to ' + parsed.dateTo);
if (parsed.lines.length !== 2) throw new Error('lines ' + parsed.lines.length);
if (parsed.lines[0].description !== 'Taxi') throw new Error('desc');
if (parsed.lines[0].total !== 12) throw new Error('total ' + parsed.lines[0].total);
if (parsed.receipts.length !== 2) throw new Error('receipts');
if (parsed.receipts[0].mime !== 'image/jpeg') throw new Error('mime jpg');
if (parsed.receipts[1].mime !== 'application/pdf') throw new Error('mime pdf');

console.log('PASS', {
  job: parsed.jobNumber,
  from: parsed.dateFrom,
  to: parsed.dateTo,
  lines: parsed.lines.length,
  receipts: parsed.receipts.length,
  name: parsed.name,
});
