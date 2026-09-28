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

  global.AsOffshoreDays = {
    DayTypeKey,
    daysInMonth,
    periodContaining,
    periodStartingMarch,
    tallyFromTimesheets,
  };
})(window);
