import { readFileSync } from 'fs';
import vm from 'vm';

const code = readFileSync(new URL('./js/receipt-parse.js', import.meta.url), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(code, sandbox);
const P = sandbox.AsReceiptParse;
if (!P) throw new Error('AsReceiptParse missing');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const tesco = `
TESCO STORES LTD
High Street
28/09/2026
Milk 1.20
Bread 1.50
Subtotal 2.70
VAT 0.54
TOTAL £3.24
Thank you
`;
const a = P.parseReceiptText(tesco);
console.log('tesco', a);
assert(a.date === '2026-09-28', 'date DD/MM/YYYY');
assert(a.total === 3.24, 'total');
assert(a.description && /tesco/i.test(a.description), 'merchant');
assert(a.vat === 0.54 || a.net === 2.7, 'vat or net');
assert(a.foreignCurrency == null, 'GBP receipt: no foreign');

const named = `Pret A Manger\n28 Sep 2026\nCoffee\nAmount Due £4.50\n`;
const b = P.parseReceiptText(named);
console.log('pret', b);
assert(b.date === '2026-09-28', 'named date');
assert(b.total === 4.5, 'amount due');
assert(/pret/i.test(b.description || ''), 'pret merchant');
assert(b.foreignCurrency == null, 'GBP pret: no foreign');

const job = `Shell Garage\n01-03-2025\nJob P5503 fuel\nTOTAL GBP 45.00\n`;
const c = P.parseReceiptText(job);
console.log('job', c);
assert(c.jobNo === 'P5503', 'job only when clear');
assert(c.total === 45, 'gbp total');
assert(c.foreignCurrency == null, 'GBP job: no foreign');

const empty = P.parseReceiptText('   \n\n');
assert(!P.hasUsefulSuggestions(empty), 'empty useless');

const noInvent = P.parseReceiptText('Random shop\n15/01/2026\nTOTAL £10.00');
assert(noInvent.jobNo == null, 'do not invent job');
assert(noInvent.foreignCurrency == null, 'GBP no invent foreign');

// ——— Foreign currency fixtures ———
const eur = `
Cafe de Paris
15/06/2026
Croissant
TOTAL €45.00
Merci
`;
const e = P.parseReceiptText(eur);
console.log('eur', e);
assert(e.foreignCurrency === '€45.00', 'EUR → €45.00 in foreign box');
assert(e.total == null, 'EUR: do not fill £ total');
assert(e.net == null, 'EUR: do not fill £ net');
assert(e.vat == null, 'EUR: do not fill £ vat');
assert(e.date === '2026-06-15', 'EUR date');
assert(P.hasUsefulSuggestions(e), 'EUR useful');

const usd = `
Starbucks NYC
03/04/2026
Latte
Amount Due $12.50
`;
const u = P.parseReceiptText(usd);
console.log('usd', u);
assert(u.foreignCurrency === '$12.50', 'USD → $12.50');
assert(u.total == null, 'USD: no £ total');

const nok = `
Narvesen Oslo
20/05/2026
Coffee
TOTAL NOK 89.00
`;
const n = P.parseReceiptText(nok);
console.log('nok', n);
assert(n.foreignCurrency === 'NOK 89.00', 'NOK → NOK 89.00');
assert(n.total == null, 'NOK: no £ total');

const eurCode = `
Hotel Berlin
10/02/2026
Room
Grand Total EUR 120.00
`;
const ec = P.parseReceiptText(eurCode);
console.log('eurCode', ec);
assert(ec.foreignCurrency === '€120.00', 'EUR code → € symbol format');
assert(ec.total == null, 'EUR code: no £ total');

// Mixed: £ payment total wins when labelled
const mixedGbp = `
Tax-free shop
Item EUR 10.00
TOTAL £8.50
`;
const mg = P.parseReceiptText(mixedGbp);
console.log('mixedGbp', mg);
assert(mg.total === 8.5, 'mixed with £ total → GBP');
assert(mg.foreignCurrency == null, 'mixed GBP mode: no foreign fill');

// Mixed: foreign dominant, no £ total label → foreign
const mixedFx = `
Oslo cafe
Menu shows £ for tourists
TOTAL 150.00 NOK
`;
const mf = P.parseReceiptText(mixedFx);
console.log('mixedFx', mf);
assert(mf.foreignCurrency === 'NOK 150.00', 'mixed foreign dominant');
assert(mf.total == null, 'mixed fx: no £ total');

console.log('ALL PARSER TESTS PASSED');
