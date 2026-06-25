const ExcelJS = require('exceljs');

function excelSerialDateToISO(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const excelEpochMs = Date.UTC(1899, 11, 30);
  const date = new Date(excelEpochMs + Math.round(value * 24 * 60 * 60 * 1000));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeCellValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;

  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part?.text || '').join('');
    }
    if (value.hyperlink) return String(value.text || value.hyperlink);
    if (value.formula !== undefined) return normalizeCellValue(value.result);
    if (value.result !== undefined) return normalizeCellValue(value.result);
    if (value.text !== undefined) return String(value.text);
  }

  return String(value);
}

function collectHeaders(headerRow) {
  const headers = [];
  for (let index = 1; index <= headerRow.cellCount; index++) {
    const header = String(normalizeCellValue(headerRow.getCell(index).value) || '').trim();
    if (header) headers.push(header);
  }
  return headers;
}

async function readFirstWorksheet(buffer, { maxRows = 5000 } = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { headers: [], rows: [] };

  const headers = collectHeaders(worksheet.getRow(1));
  const totalDataRows = Math.max(0, worksheet.rowCount - 1);
  if (totalDataRows > maxRows) {
    throw new Error(`File exceeds the ${maxRows}-row import limit`);
  }

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const worksheetRow = worksheet.getRow(rowNumber);
    const row = Object.create(null);
    let hasData = false;

    headers.forEach((header, index) => {
      const cellValue = normalizeCellValue(worksheetRow.getCell(index + 1).value);
      const normalized = typeof cellValue === 'string' ? cellValue.trim() : cellValue;
      if (normalized !== '') hasData = true;
      row[header] = normalized;
    });

    if (hasData) rows.push(row);
  }

  return { headers, rows };
}

async function workbookBufferFromMatrix(sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.addRow(columns);
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function workbookBufferFromColumns(sheetName, columns) {
  return workbookBufferFromMatrix(sheetName, columns, []);
}

async function workbookBufferFromJson(sheetName, rows) {
  const headers = [];
  for (const row of rows) {
    Object.keys(row || {}).forEach((key) => {
      if (!headers.includes(key)) headers.push(key);
    });
  }
  const matrix = rows.map((row) => headers.map((header) => row?.[header] ?? ''));
  return workbookBufferFromMatrix(sheetName, headers, matrix);
}

async function workbookBase64FromJson(sheetName, rows) {
  const buffer = await workbookBufferFromJson(sheetName, rows);
  return buffer.toString('base64');
}

module.exports = {
  excelSerialDateToISO,
  readFirstWorksheet,
  workbookBufferFromColumns,
  workbookBufferFromJson,
  workbookBase64FromJson,
};
