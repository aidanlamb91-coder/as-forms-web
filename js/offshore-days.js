/**
 * Mar–Feb day tallies from completed timesheets — mirrors Android OffshoreDays.
 */
(function (global) {
  const DayTypeKey = {
    OFFSHORE: 'OFFSHORE',
    ANNUAL_LEAVE: 'ANNUAL_LEAVE',
    SICK: 'SICK',
    OFFICE: 'OFFICE',
    TRAINING: 'TRAINING',
    ROSTER_LEAVE: 'ROSTER_LEAVE',
  };

  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function daysInMonth(year, month /* 1-12 */) {
    return new Date(year, month, 0).getDate();
  }

  function periodStartingMarch(marchYear) {
    const start = { y: marchYear, m: 3, d: 1 };
    const endY = marchYear + 1;
    const end = { y: endY, m: 2, d: daysInMonth(endY, 2) }; // day before 1 Mar
    const endMonthName = MONTH_SHORT[end.m - 1];
    return {
      startMarchYear: marchYear,
      startInclusive: start,
      endInclusive: end,
      label: 'Mar ' + marchYear + ' – ' + endMonthName + ' ' + end.y,
    };
  }

  function periodContaining(date) {
    // date: {y,m,d} or Date
    let y, m;
    if (date instanceof Date) {
      y = date.getFullYear();
      m = date.getMonth() + 1;
    } else {
      y = date.y;
      m = date.m;
    }
    const startYear = m >= 3 ? y : y - 1;
    return periodStartingMarch(startYear);
  }

  function emptyCounts() {
    return { offshore: 0, holiday: 0, sick: 0, office: 0, training: 0 };
  }

  function increment(counts, typeKey) {
    const c = { ...counts };
    switch (typeKey) {
      case DayTypeKey.OFFSHORE: c.offshore++; break;
      case DayTypeKey.ANNUAL_LEAVE: c.holiday++; break;
      case DayTypeKey.SICK: c.sick++; break;
      case DayTypeKey.OFFICE: c.office++; break;
      case DayTypeKey.TRAINING: c.training++; break;
      default: break; // roster omitted
    }
    return c;
  }

  /**
   * Expand timesheet entries into typed calendar dates, then tally by Mar–Feb period.
   * @param {Array<{year,month,entries:[{startDay,endDay,dayType}]}>} completedTimesheets
   */
  function tallyFromTimesheets(completedTimesheets, asOf) {
    const now = asOf || new Date();
    const typedDates = [];

    for (const ts of completedTimesheets || []) {
      const last = daysInMonth(ts.year, ts.month);
      for (const e of ts.entries || []) {
        const start = Math.max(1, Math.min(e.startDay, last));
        const end = Math.max(start, Math.min(e.endDay, last));
        for (let d = start; d <= end; d++) {
          typedDates.push({ typeKey: e.dayType, y: ts.year, m: ts.month, d });
        }
      }
    }

    if (!typedDates.length) {
      const current = periodContaining(now);
      return [{ period: current, counts: emptyCounts() }];
    }

    let minY = typedDates[0].y, minM = typedDates[0].m, minD = typedDates[0].d;
    let maxY = minY, maxM = minM, maxD = minD;
    for (const t of typedDates) {
      if (t.y < minY || (t.y === minY && (t.m < minM || (t.m === minM && t.d < minD)))) {
        minY = t.y; minM = t.m; minD = t.d;
      }
      if (t.y > maxY || (t.y === maxY && (t.m > maxM || (t.m === maxM && t.d > maxD)))) {
        maxY = t.y; maxM = t.m; maxD = t.d;
      }
    }
    const asOfY = now.getFullYear(), asOfM = now.getMonth() + 1, asOfD = now.getDate();
    if (asOfY > maxY || (asOfY === maxY && (asOfM > maxM || (asOfM === maxM && asOfD > maxD)))) {
      maxY = asOfY; maxM = asOfM; maxD = asOfD;
    }

    const firstPeriodYear = periodContaining({ y: minY, m: minM, d: minD }).startMarchYear;
    const lastPeriodYear = periodContaining({ y: maxY, m: maxM, d: maxD }).startMarchYear;
    const counts = {};
    for (let y = firstPeriodYear; y <= lastPeriodYear; y++) counts[y] = emptyCounts();

    for (const t of typedDates) {
      const py = periodContaining(t).startMarchYear;
      counts[py] = increment(counts[py] || emptyCounts(), t.typeKey);
    }
    const currentYear = periodContaining(now).startMarchYear;
    if (!(currentYear in counts)) counts[currentYear] = emptyCounts();

    return Object.keys(counts)
      .map(Number)
      .sort((a, b) => b - a)
      .map((y) => ({ period: periodStartingMarch(y), counts: counts[y] }));
  }


  const COUNT_TO_TYPE = {
    offshore: DayTypeKey.OFFSHORE,
    holiday: DayTypeKey.ANNUAL_LEAVE,
    sick: DayTypeKey.SICK,
    office: DayTypeKey.OFFICE,
    training: DayTypeKey.TRAINING,
  };

  const TYPE_TO_LABEL = {
    OFFSHORE: 'Offshore',
    ANNUAL_LEAVE: 'Holiday',
    SICK: 'Sick',
    OFFICE: 'Office',
    TRAINING: 'Training',
  };

  const MONTH_LONG = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  function resolveTypeKey(countOrTypeKey) {
    if (COUNT_TO_TYPE[countOrTypeKey]) return COUNT_TO_TYPE[countOrTypeKey];
    return countOrTypeKey;
  }

  function labelForType(countOrTypeKey) {
    const tk = resolveTypeKey(countOrTypeKey);
    return TYPE_TO_LABEL[tk] || String(countOrTypeKey);
  }

  /**
   * Contributing entry segments for one Mar–Feb period + day type.
   * Each item is one timesheet entry clipped to days in that month (entries are month-scoped).
   * @returns {Array<{year,month,startDay,endDay,jobNumber,description,typeKey}>}
   */
  function contributionsForPeriod(completedTimesheets, startMarchYear, countOrTypeKey) {
    const typeKey = resolveTypeKey(countOrTypeKey);
    const out = [];
    for (const ts of completedTimesheets || []) {
      if (periodContaining({ y: ts.year, m: ts.month, d: 1 }).startMarchYear !== startMarchYear) {
        continue;
      }
      const last = daysInMonth(ts.year, ts.month);
      for (const e of ts.entries || []) {
        if (e.dayType !== typeKey) continue;
        const start = Math.max(1, Math.min(Number(e.startDay) || 1, last));
        const end = Math.max(start, Math.min(Number(e.endDay) || start, last));
        out.push({
          year: ts.year,
          month: ts.month,
          startDay: start,
          endDay: end,
          jobNumber: e.jobNumber || e.jobNo || '',
          description: e.description || '',
          typeKey: typeKey,
        });
      }
    }
    out.sort(function (a, b) {
      if (a.year !== b.year) return a.year - b.year;
      if (a.month !== b.month) return a.month - b.month;
      return a.startDay - b.startDay;
    });
    return out;
  }

  /** Collapse day numbers into "1–5, 20" style ranges. */
  function formatDayNumbers(days) {
    if (!days || !days.length) return '';
    const sorted = days.slice().sort(function (a, b) { return a - b; });
    const parts = [];
    let runStart = sorted[0];
    let runEnd = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const d = sorted[i];
      if (d === runEnd || d === runEnd + 1) {
        runEnd = d;
      } else {
        parts.push(runStart === runEnd ? String(runStart) : runStart + '–' + runEnd);
        runStart = runEnd = d;
      }
    }
    parts.push(runStart === runEnd ? String(runStart) : runStart + '–' + runEnd);
    return parts.join(', ');
  }

  function formatEntryDayRange(entry) {
    const mon = MONTH_SHORT[entry.month - 1] || '';
    if (entry.startDay === entry.endDay) return entry.startDay + ' ' + mon;
    return entry.startDay + '–' + entry.endDay + ' ' + mon;
  }

  /**
   * Group contributions by month for UI.
   * Offshore: one line per entry (job + desc + range).
   * Other types: one line per month with merged day list.
   * @returns {{ empty: boolean, months: Array<{year,month,label,lines:string[]}> }}
   */
  function breakdownGrouped(completedTimesheets, startMarchYear, countOrTypeKey) {
    const typeKey = resolveTypeKey(countOrTypeKey);
    const contribs = contributionsForPeriod(completedTimesheets, startMarchYear, typeKey);
    if (!contribs.length) {
      return { empty: true, months: [], typeKey: typeKey, label: labelForType(typeKey) };
    }
    const byMonth = {};
    const order = [];
    for (const c of contribs) {
      const key = c.year + '-' + c.month;
      if (!byMonth[key]) {
        byMonth[key] = {
          year: c.year,
          month: c.month,
          label: MONTH_LONG[c.month - 1] + ' ' + c.year,
          entries: [],
        };
        order.push(key);
      }
      byMonth[key].entries.push(c);
    }
    const months = order.map(function (key) {
      const g = byMonth[key];
      let lines;
      if (typeKey === DayTypeKey.OFFSHORE) {
        lines = g.entries.map(function (e) {
          const bits = [];
          if (e.jobNumber) bits.push(e.jobNumber);
          if (e.description) bits.push(e.description);
          const head = bits.length ? bits.join(' — ') : 'Offshore';
          return head + ' — ' + formatEntryDayRange(e);
        });
      } else {
        const days = [];
        g.entries.forEach(function (e) {
          for (let d = e.startDay; d <= e.endDay; d++) days.push(d);
        });
        // unique
        const uniq = Array.from(new Set(days));
        lines = [formatDayNumbers(uniq)];
      }
      return { year: g.year, month: g.month, label: g.label, lines: lines };
    });
    return { empty: false, months: months, typeKey: typeKey, label: labelForType(typeKey) };
  }

  global.AsOffshoreDays = {
    DayTypeKey,
    daysInMonth,
    periodContaining,
    periodStartingMarch,
    tallyFromTimesheets,
    contributionsForPeriod,
    breakdownGrouped,
    labelForType,
    formatDayNumbers,
  };
})(window);
