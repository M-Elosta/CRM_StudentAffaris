'use strict';

const { workbookBufferFromJson } = require('../../lib/excel');

/**
 * A report's rows as an xlsx workbook with one sheet named "Report".
 * @param {object[]} rows  the formatted report rows
 * @param {string} name  file name stem, e.g. 'report-all-companies'
 * @param {() => number} [now]  clock for the timestamp in the file name
 * @returns {Promise<{ fileName: string, buffer: Buffer }>}
 */
async function reportWorkbook(rows, name, now = Date.now) {
  return { fileName: `${name}-${now()}.xlsx`, buffer: await workbookBufferFromJson('Report', rows) };
}

module.exports = { reportWorkbook };
