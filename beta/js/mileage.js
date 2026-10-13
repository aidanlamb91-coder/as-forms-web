/**
 * 1.1.0-web — Mileage claims: the plain rules (ports of Android mileage/*.kt).
 *
 * Nothing here touches the screen or the database, so it can all be unit tested
 * (tests/test-mileage.mjs). The screens live in js/mileage-ui.js.
 *
 *  - Math:      miles × rate (pence per mile), rounding, "87.5 mi", "£47.85", "55p".
 *  - Postcodes: tidy up / check UK postcodes ("ab115pq" → "AB11 5PQ").
 *  - Linking:   an expense claim and a mileage claim with the same job number belong together
 *               (the mileage card is nested under the expense card, swipes act on both,
 *               export makes one zip).
 *  - Route:     road miles between two postcodes using two FREE services with no key:
 *               postcodes.io (postcode → map position) and the public OSRM server (road distance).
 *               Any failure gives a friendly message so the user can type the miles instead.
 *  - Trips:     offshore trips from timesheets → "Add travel to port?" suggestions.
 */
(function (global) {
  // ——— Defaults (Android MileageDefaults) ———
  const RATE_PENCE = 55;
  const ROWS_PER_SHEET = 16;
  const METRES_PER_MILE = 1609.344;
  const PURPOSE_CHIPS = ['Travel to vessel', 'Collect kit', 'Site visit'];

  // ——— Math (MileageMath.kt) ———
  /** Round half-up to `dp` decimal places without binary-fraction surprises (1.005 → 1.01). */
  function roundHalfUp(v, dp) {
    const f = Math.pow(10, dp);
    return Math.round((Number(v) + Number.EPSILON) * f * (1 + Number.EPSILON)) / f;
  }
  const round1 = (v) => roundHalfUp(v, 1);
  const metresToMiles = (m) => round1(m / METRES_PER_MILE);
  /** One-way miles, doubled for a return trip. */
  const claimedMiles = (oneWay, returnTrip) => round1(returnTrip ? Number(oneWay || 0) * 2 : Number(oneWay || 0));
  const journeyMiles = (j) => claimedMiles(j.oneWayMiles, j.returnTrip);
  /** Pounds for miles at ratePence, to the penny. Uses whole tenths of a mile × pence to avoid float drift. */
  function amount(miles, ratePence) {
    const tenths = Math.round(Number(miles) * 10); // miles are always 1 dp
    const tenthPence = tenths * Number(ratePence); // in 1/10 pence
    return Math.round(tenthPence / 10) / 100; // half-up for positives
  }
  const totalMiles = (journeys) => round1((journeys || []).reduce((s, j) => s + journeyMiles(j), 0));
  /** Total = sum of each row's rounded amount, so the form's total matches the rows above it. */
  const totalAmount = (journeys, rate) =>
    roundHalfUp((journeys || []).reduce((s, j) => s + amount(journeyMiles(j), rate), 0), 2);
  const isWhole = (m) => Math.floor(m) === m;
  const formatMiles = (m) => (isWhole(m) ? String(m) : Number(m).toFixed(1)) + ' mi';
  const formatMilesPlain = (m) => (isWhole(m) ? String(m) : Number(m).toFixed(1));
  const formatPounds = (a) => '£' + Number(a).toFixed(2);
  const formatRate = (p) => (p < 100 ? p + 'p' : '£' + (p / 100).toFixed(2));

  // ——— Postcodes (Postcodes.kt) ———
  const UK = /^(GIR ?0AA|[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2})$/;
  /** Upper case, spaces removed, then one space before the last 3 characters. */
  function normalizePostcode(input) {
    const c = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 5) return c;
    return c.slice(0, -3) + ' ' + c.slice(-3);
  }
  const isValidPostcode = (input) => UK.test(normalizePostcode(input));
  const compactPostcode = (input) => normalizePostcode(input).replace(/ /g, '');

  // ——— Job linking (JobLinking.kt) ———
  /** Comparison key: no spaces, upper case ("p 5503" = "P5503"). */
  const jobKey = (j) => String(j || '').replace(/\s+/g, '').toUpperCase();
  const sameJob = (a, b) => { const k = jobKey(a); return !!k && k === jobKey(b); };

  /**
   * Group expense claims and mileage claims into list rows:
   *   { expense, mileage: [...] }  (expense may be null for a mileage claim on its own).
   * Each mileage claim joins the FIRST expense claim (in list order) with the same job number,
   * unless it was "Unlinked". Rows are ordered by their newest updatedAt.
   */
  function groupJobs(expenses, mileage) {
    const attached = new Map();
    const loose = [];
    for (const m of mileage || []) {
      const k = jobKey(m.jobNo);
      const idx = !k || m.unlinked ? -1 : (expenses || []).findIndex((e) => jobKey(e.jobNo) === k);
      if (idx >= 0) {
        if (!attached.has(idx)) attached.set(idx, []);
        attached.get(idx).push(m);
      } else loose.push(m);
    }
    const rows = [];
    (expenses || []).forEach((e, i) => {
      const ms = attached.get(i) || [];
      const sort = Math.max(e.updatedAt || 0, ...ms.map((m) => m.updatedAt || 0));
      rows.push({ group: { expense: e, mileage: ms }, sort, order: rows.length });
    });
    loose.forEach((m) => rows.push({ group: { expense: null, mileage: [m] }, sort: m.updatedAt || 0, order: rows.length }));
    rows.sort((a, b) => (b.sort - a.sort) || (a.order - b.order));
    return rows.map((r) => r.group);
  }

  // ——— Claim dates ———
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** Claim period: earliest → latest journey date; the creation day when there are none. */
  function claimDates(claim) {
    const ds = (claim.journeys || []).map((j) => j.date).filter(Boolean).sort();
    if (ds.length) return { dateFrom: ds[0], dateTo: ds[ds.length - 1] };
    const c = claim.createdAt ? new Date(claim.createdAt) : new Date();
    const iso = c.getFullYear() + '-' + String(c.getMonth() + 1).padStart(2, '0') + '-' + String(c.getDate()).padStart(2, '0');
    return { dateFrom: claim.dateFrom || iso, dateTo: claim.dateTo || iso };
  }
  /** Journeys in form order: by date, then the order they were added. */
  function sortedJourneys(claim) {
    return (claim.journeys || []).map((j, i) => ({ j, i }))
      .sort((a, b) => String(a.j.date).localeCompare(String(b.j.date)) || ((a.j.sortOrder ?? a.i) - (b.j.sortOrder ?? b.i)))
      .map((x) => x.j);
  }
  /** "MileageClaim_2026-09-01.docx" (like ExpenseClaim_…). */
  const docxFileName = (claim) => 'MileageClaim_' + claimDates(claim).dateFrom + '.docx';
  /** Zip name for a mileage claim on its own: "P5520_Mileage.zip". */
  const soloZipName = (claim) => (claim.jobNo ? claim.jobNo.trim() + '_Mileage.zip' : 'Mileage.zip');

  // ——— Route service (RouteService.kt) ———
  const POSTCODES_BASE = 'https://api.postcodes.io';
  const OSRM_BASE = 'https://router.project-osrm.org';

  class NotFound extends Error {}
  class Busy extends Error {}
  class Offline extends Error {}

  /** GET JSON with a timeout; 404/400 → NotFound, 429/5xx → Busy, network failure → Offline. */
  async function getJson(url, fetchFn) {
    const f = fetchFn || global.fetch.bind(global);
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
    let res;
    try {
      // cache: 'no-store' — route answers must never be served from the offline cache
      res = await f(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctl && ctl.signal });
    } catch (e) {
      throw new Offline(String(e && e.message || e));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 404 || res.status === 400) throw new NotFound(url);
    if (res.status === 429 || res.status >= 500) throw new Busy('HTTP ' + res.status);
    if (!res.ok) throw new NotFound(url);
    return res.json();
  }

  async function lookupPostcode(pc, fetchFn) {
    try {
      const j = await getJson(POSTCODES_BASE + '/postcodes/' + encodeURIComponent(compactPostcode(pc)), fetchFn);
      const r = j && j.result;
      if (!r || r.latitude == null || r.longitude == null) return null;
      return { lat: r.latitude, lon: r.longitude };
    } catch (e) {
      if (e instanceof NotFound) return null;
      throw e;
    }
  }

  /** Nearest postcode to a map position (used by "Use my location"). */
  async function reversePostcode(lat, lon, fetchFn) {
    try {
      const j = await getJson(POSTCODES_BASE + '/postcodes?lon=' + lon.toFixed(6) + '&lat=' + lat.toFixed(6) + '&limit=1', fetchFn);
      const arr = j && j.result;
      if (!arr || !arr.length || !arr[0].postcode) return null;
      return normalizePostcode(arr[0].postcode);
    } catch (e) {
      if (e instanceof NotFound) return null;
      throw e;
    }
  }

  async function drivingMetres(a, b, fetchFn) {
    const url = OSRM_BASE + '/route/v1/driving/' + a.lon.toFixed(6) + ',' + a.lat.toFixed(6) + ';' +
      b.lon.toFixed(6) + ',' + b.lat.toFixed(6) + '?overview=false';
    const j = await getJson(url, fetchFn);
    if (!j || j.code !== 'Ok' || !j.routes || !j.routes.length) return null;
    const d = j.routes[0].distance;
    return typeof d === 'number' ? d : null;
  }

  /**
   * Calculate button: one-way road miles between two postcodes.
   * Never throws: returns { ok:true, miles, metres } or { ok:false, message }.
   */
  async function roadMiles(from, to, fetchFn) {
    if (!isValidPostcode(from)) return { ok: false, message: 'From: not a UK postcode' };
    if (!isValidPostcode(to)) return { ok: false, message: 'To: not a UK postcode' };
    try {
      const a = await lookupPostcode(from, fetchFn);
      if (!a) return { ok: false, message: 'Postcode ' + normalizePostcode(from) + ' not found. Enter miles manually.' };
      const b = await lookupPostcode(to, fetchFn);
      if (!b) return { ok: false, message: 'Postcode ' + normalizePostcode(to) + ' not found. Enter miles manually.' };
      const metres = await drivingMetres(a, b, fetchFn);
      if (metres == null) return { ok: false, message: 'No road route found. Enter miles manually.' };
      return { ok: true, miles: metresToMiles(metres), metres };
    } catch (e) {
      if (e instanceof Offline) return { ok: false, message: "You're offline — enter the miles manually." };
      if (e instanceof Busy) return { ok: false, message: 'Route service is busy — try again shortly or enter miles manually.' };
      return { ok: false, message: "Couldn't calculate the distance — enter the miles manually." };
    }
  }

  // ——— Trip suggestions (TripSuggestions.kt) ———
  function isoOf(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function addDaysIso(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  /** Offshore trips from timesheets; a trip that runs over a month end (same job) is joined up. */
  function tripsFrom(timesheets) {
    const raw = [];
    for (const ts of timesheets || []) {
      const len = new Date(ts.year, ts.month, 0).getDate();
      for (const e of ts.entries || []) {
        const job = e.jobNumber || e.jobNo || '';
        if (e.dayType !== 'OFFSHORE' || !job.trim()) continue;
        const s = Math.min(Math.max(1, e.startDay), len);
        const en = Math.min(Math.max(s, e.endDay), len);
        raw.push({ jobNumber: job, start: isoOf(ts.year, ts.month, s), end: isoOf(ts.year, ts.month, en) });
      }
    }
    raw.sort((a, b) => a.start.localeCompare(b.start));
    const out = [];
    for (const t of raw) {
      const last = out[out.length - 1];
      if (last && sameJob(last.jobNumber, t.jobNumber) && t.start <= addDaysIso(last.end, 1)) {
        if (t.end > last.end) last.end = t.end;
      } else out.push({ ...t });
    }
    return out;
  }
  const suggestionKey = (claimId, date, isStart) => claimId + '|' + date + '|' + (isStart ? 'S' : 'E');
  /** Suggestions for one claim. period = {from,to} ISO or null for any date. */
  function suggest(claimId, jobNumber, trips, period, journeyDates, dismissed) {
    if (!jobKey(jobNumber)) return [];
    const have = new Set(journeyDates || []);
    const gone = new Set(dismissed || []);
    const out = [];
    for (const t of (trips || []).filter((x) => sameJob(x.jobNumber, jobNumber))) {
      for (const [date, isStart] of [[t.start, true], [t.end, false]]) {
        if (period && (date < period.from || date > period.to)) continue;
        if (have.has(date)) continue;
        const key = suggestionKey(claimId, date, isStart);
        if (gone.has(key) || out.some((o) => o.key === key)) continue;
        out.push({ key, jobNumber, date, isStart });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  /** The "port": the saved place used most in journeys (not Home); ties → listed first. */
  function mostUsedPlace(places, usedPostcodes, homePostcode) {
    const home = normalizePostcode(homePostcode);
    const cands = (places || []).filter((p) => normalizePostcode(p.postcode) !== home);
    if (!cands.length) return null;
    const counts = {};
    (usedPostcodes || []).forEach((pc) => { const k = normalizePostcode(pc); counts[k] = (counts[k] || 0) + 1; });
    let best = cands[0], bestN = counts[normalizePostcode(cands[0].postcode)] || 0;
    for (const p of cands.slice(1)) {
      const n = counts[normalizePostcode(p.postcode)] || 0;
      if (n > bestN) { best = p; bestN = n; }
    }
    return best;
  }

  global.AsMileage = {
    RATE_PENCE, ROWS_PER_SHEET, METRES_PER_MILE, PURPOSE_CHIPS,
    round1, metresToMiles, claimedMiles, journeyMiles, amount, totalMiles, totalAmount,
    formatMiles, formatMilesPlain, formatPounds, formatRate,
    normalizePostcode, isValidPostcode, compactPostcode,
    jobKey, sameJob, groupJobs,
    todayIso, claimDates, sortedJourneys, docxFileName, soloZipName,
    lookupPostcode, reversePostcode, drivingMetres, roadMiles, POSTCODES_BASE, OSRM_BASE,
    tripsFrom, suggest, suggestionKey, mostUsedPlace,
  };
})(typeof window !== 'undefined' ? window : globalThis);
