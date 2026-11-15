'use strict';

/**
 * Reporting periods on the CMU-Q calendar.
 *
 * Semesters: Fall 1 Aug - 31 Dec, Spring 1 Jan - 31 May, Summer 1 Jun - 31 Jul.
 * Academic years run 1 Aug - 31 May; June and July belong to none.
 * A period is { kind, key, label, from, to, order, ... } where order sorts periods in time.
 */

const { addDaysToIsoDate } = require('../../lib/dates');

/** 'YYYY-MM-DD...' → 'DD/MM/YY'; anything else is returned unchanged. */
function formatDateOutput(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1].slice(-2)}`;
}

function yearAndMonth(dateStr) {
  return { year: Number(String(dateStr).slice(0, 4)), month: Number(String(dateStr).slice(5, 7)) };
}

function academicYearKey(startYear) {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/** The academic year that starts in August of startYear. */
function academicYearRange(startYear) {
  return {
    kind: 'academic-year',
    startYear,
    key: academicYearKey(startYear),
    label: `AY${academicYearKey(startYear)}`,
    from: `${startYear}-08-01`,
    to: `${startYear + 1}-05-31`,
    order: startYear,
  };
}

/** The start year of the academic year a date falls in (June and July count with the year before). */
function academicYearStartForDate(dateStr, fallbackYear) {
  const { year, month } = dateStr ? yearAndMonth(dateStr) : {};
  if (!month || !year) return fallbackYear;
  return month >= 8 ? year : year - 1;
}

/** The academic year containing a date, or null for June, July and unreadable dates. */
function academicYearOf(dateStr) {
  if (!dateStr) return null;
  const { year, month } = yearAndMonth(dateStr);
  if (!month || !year || (month >= 6 && month <= 7)) return null;
  return academicYearRange(month >= 8 ? year : year - 1);
}

/** The academic year for a validated key such as '2024-25' or '2024-2025', or null. */
function academicYearFromKey(key) {
  if (!key) return null;
  return academicYearRange(Number(key.slice(0, 4)));
}

function semesterRange(term, year) {
  if (term === 'fall') {
    return { kind: 'semester', term, year, key: `${year}-fall`, label: `Fall ${year}`, order: year * 3 + 2, from: `${year}-08-01`, to: `${year}-12-31` };
  }
  if (term === 'spring') {
    return { kind: 'semester', term, year, key: `${year}-spring`, label: `Spring ${year}`, order: year * 3 + 0, from: `${year}-01-01`, to: `${year}-05-31` };
  }
  return { kind: 'semester', term, year, key: `${year}-summer`, label: `Summer ${year}`, order: year * 3 + 1, from: `${year}-06-01`, to: `${year}-07-31` };
}

/** The semester for a validated key such as '2024-fall', or null. */
function semesterFromKey(key) {
  if (!key) return null;
  const [year, term] = key.split('-');
  return semesterRange(term, Number(year));
}

/** The semester containing a date, or null for an unreadable date. */
function semesterOf(dateStr) {
  if (!dateStr) return null;
  const { year, month } = yearAndMonth(dateStr);
  if (!month || !year) return null;
  if (month >= 8) return semesterRange('fall', year);
  if (month <= 5) return semesterRange('spring', year);
  return semesterRange('summer', year);
}

function nextSemesterOf(semester) {
  return semesterOf(addDaysToIsoDate(semester.to, 1));
}

function prevSemesterOf(semester) {
  return semesterOf(addDaysToIsoDate(semester.from, -1));
}

/** Every semester from start to end inclusive. */
function semesterSeries(startSemester, endSemester) {
  const semesters = [];
  let cursor = startSemester;
  while (cursor && cursor.order <= endSemester.order) {
    semesters.push(cursor);
    cursor = nextSemesterOf(cursor);
  }
  return semesters;
}

/**
 * The period a quick report covers, from the validated query.
 * @returns {{ mode: string, label: string, from: string|null, to: string|null, semester: string|null, academicYear: string|null, viewMode: string }}
 */
function resolveQuickReportPeriod(query) {
  const semester = semesterFromKey(query.semester);
  const academicYear = academicYearFromKey(query.academicYear);

  let mode = 'all';
  let label = 'All time';
  let from = query.from || null;
  let to = query.to || null;

  if (semester) {
    mode = 'semester';
    ({ label, from, to } = semester);
  } else if (academicYear) {
    mode = 'academic-year';
    ({ label, from, to } = academicYear);
  } else if (from || to) {
    mode = 'date';
    if (from && to) label = `${formatDateOutput(from)} - ${formatDateOutput(to)}`;
    else if (from) label = `From ${formatDateOutput(from)}`;
    else label = `To ${formatDateOutput(to)}`;
  }

  return {
    mode,
    label,
    from,
    to,
    semester: semester ? semester.key : null,
    academicYear: academicYear ? academicYear.key : null,
    viewMode: query.viewMode || mode,
  };
}

/**
 * The semesters and academic years the period picker offers: from the
 * earliest data (or today) to the latest data (or today), with defaults
 * pointing at the latest data.
 * @param {{ minDate: string|null, maxDate: string|null }} bounds
 * @param {string} today  YYYY-MM-DD in the office time zone
 */
function buildReportPeriods(bounds, today) {
  const fallbackYear = Number(today.slice(0, 4));
  const latestDataDate = bounds.maxDate || today;
  const currentSemester = semesterOf(today);
  const firstSemester = semesterOf(bounds.minDate || today) || currentSemester;
  const lastSemester = semesterOf(bounds.maxDate || today) || currentSemester;
  const startSemester = firstSemester.order <= currentSemester.order ? firstSemester : currentSemester;
  const endSemester = lastSemester.order >= currentSemester.order ? lastSemester : currentSemester;
  const semesters = semesterSeries(startSemester, endSemester).map(({ key, label, from, to }) => ({
    key,
    label,
    from,
    to,
  }));

  const startYear = Math.min(
    academicYearStartForDate(bounds.minDate || today, fallbackYear),
    academicYearStartForDate(today, fallbackYear)
  );
  const endYear = Math.max(
    academicYearStartForDate(bounds.maxDate || today, fallbackYear),
    academicYearStartForDate(today, fallbackYear)
  );
  const academicYears = [];
  for (let year = startYear; year <= endYear; year++) {
    const { key, label, from, to } = academicYearRange(year);
    academicYears.push({ key, label, from, to });
  }

  return {
    semesters,
    academicYears,
    defaults: {
      semester: (semesterOf(latestDataDate) || currentSemester).key,
      academicYear: academicYearRange(academicYearStartForDate(latestDataDate, fallbackYear)).key,
    },
  };
}

/** The semesters a trend report shows: the range asked for, else all data up to and including today. */
function reportSemesterSeries(bounds, from, to, today) {
  const currentSemester = semesterOf(today);
  if (from || to) {
    const start = semesterOf(from || to || today) || currentSemester;
    const end = semesterOf(to || from || today) || currentSemester;
    return semesterSeries(start.order <= end.order ? start : end, end.order >= start.order ? end : start);
  }
  const firstSemester = semesterOf(bounds.minDate || today) || currentSemester;
  const lastSemester = semesterOf(bounds.maxDate || today) || currentSemester;
  const startSemester = firstSemester.order <= currentSemester.order ? firstSemester : currentSemester;
  const endSemester = lastSemester.order >= currentSemester.order ? lastSemester : currentSemester;
  return semesterSeries(startSemester, endSemester);
}

/** The academic years a trend report shows: the range asked for, else all data up to and including today. */
function reportAcademicYearSeries(bounds, from, to, today) {
  const fallbackYear = Number(today.slice(0, 4));
  const currentYear = academicYearRange(academicYearStartForDate(today, fallbackYear));
  let startYear;
  let endYear;
  if (from || to) {
    const start = academicYearOf(from || to || today) || currentYear;
    const end = academicYearOf(to || from || today) || currentYear;
    startYear = Math.min(start.startYear, end.startYear);
    endYear = Math.max(start.startYear, end.startYear);
  } else {
    startYear = Math.min(academicYearStartForDate(bounds.minDate || today, fallbackYear), currentYear.startYear);
    endYear = Math.max(academicYearStartForDate(bounds.maxDate || today, fallbackYear), currentYear.startYear);
  }
  const years = [];
  for (let year = startYear; year <= endYear; year++) years.push(academicYearRange(year));
  return years;
}

/** The period a comparison report centres on: the chosen academic year or semester, else the anchor date's semester. */
function baseComparisonPeriod(period, anchorDate) {
  if (period?.mode === 'academic-year' && period.academicYear) return academicYearFromKey(period.academicYear);
  if (period?.mode === 'semester' && period.semester) return semesterFromKey(period.semester);
  return semesterOf(anchorDate);
}

/** The period just before: the previous academic year or the previous semester. */
function previousComparisonPeriod(period) {
  if (period.kind === 'academic-year') return academicYearRange(period.startYear - 1);
  return prevSemesterOf(period);
}

function academicYearForSemester(semester) {
  return academicYearRange(semester.term === 'fall' ? semester.year : semester.year - 1);
}

module.exports = {
  formatDateOutput,
  academicYearOf,
  academicYearFromKey,
  academicYearForSemester,
  semesterOf,
  semesterFromKey,
  resolveQuickReportPeriod,
  buildReportPeriods,
  reportSemesterSeries,
  reportAcademicYearSeries,
  baseComparisonPeriod,
  previousComparisonPeriod,
};
