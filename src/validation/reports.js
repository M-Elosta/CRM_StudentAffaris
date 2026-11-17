'use strict';

const { z } = require('zod');
const v = require('./common');

const SEMESTER_RE = /^(\d{4})-(fall|spring|summer)$/i;
const ACADEMIC_YEAR_RE = /^(\d{4})-(\d{2}|\d{4})$/;
const VIEW_MODES = new Set(['date', 'semester', 'academic-year']);

/** A semester key such as '2024-fall', returned in lower case; blank becomes null. */
const semesterKey = v
  .optionalText('Semester', { max: 16 })
  .refine((value) => value === null || SEMESTER_RE.test(value), {
    error: 'Semester must be in YYYY-fall, YYYY-spring, or YYYY-summer format',
  })
  .transform((value) => (value === null ? null : value.toLowerCase()));

function academicYearProblem(value) {
  const match = ACADEMIC_YEAR_RE.exec(value);
  if (!match) return 'Academic year must be in YYYY-YY format';
  const startYear = Number(match[1]);
  const endYear = match[2].length === 2 ? Number(`${match[1].slice(0, 2)}${match[2]}`) : Number(match[2]);
  return endYear === startYear + 1 ? null : 'Academic year must span consecutive years';
}

/** An academic year key such as '2024-25' (or '2024-2025'); blank becomes null. */
const academicYearKey = v.optionalText('Academic year', { max: 16 }).superRefine((value, context) => {
  if (value === null) return;
  const problem = academicYearProblem(value);
  if (problem) context.addIssue({ code: 'custom', message: problem });
});

/** Query of GET /api/reports/quick/:type. */
const quickReportQuerySchema = z
  .object({
    ...v.dateRangeQuery(),
    semester: semesterKey,
    academicYear: academicYearKey,
    viewMode: z.preprocess((value) => (VIEW_MODES.has(value) ? value : null), z.string().nullable()),
    export: z.preprocess((value) => value === '1', z.boolean()),
  })
  .superRefine((query, context) => {
    if ((query.semester || query.academicYear) && (query.from || query.to)) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'Use either custom dates or a semester or academic year filter, not both',
      });
    }
    if (query.semester && query.academicYear) {
      context.addIssue({
        code: 'custom',
        path: ['semester'],
        message: 'Choose either a semester or an academic year filter',
      });
    }
    if (query.from && query.to && query.from > query.to) {
      context.addIssue({ code: 'custom', path: ['from'], message: 'From date must be on or before the to date' });
    }
  });

module.exports = { quickReportQuerySchema };
