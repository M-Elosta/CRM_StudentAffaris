'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  todayInTimeZone,
  isRealIsoDate,
  isoDateFromUtcDate,
  addDaysToIsoDate,
  normalizeTimestamp,
  isDatabaseTimestamp,
} = require('../../src/lib/dates');

describe('lib/dates', () => {
  describe('todayInTimeZone', () => {
    it('returns the Qatar date, which is ahead of UTC late in the UTC evening', () => {
      // 22:30 UTC is already 01:30 the next day in Qatar (UTC+3).
      const lateEvening = new Date(Date.UTC(2025, 2, 31, 22, 30));
      assert.equal(todayInTimeZone('Asia/Qatar', lateEvening), '2025-04-01');
      assert.equal(todayInTimeZone('UTC', lateEvening), '2025-03-31');
    });

    it('agrees with UTC when both are on the same day', () => {
      const noon = new Date(Date.UTC(2024, 1, 29, 12, 0));
      assert.equal(todayInTimeZone('Asia/Qatar', noon), '2024-02-29');
    });

    it('defaults to the current time and returns YYYY-MM-DD', () => {
      assert.match(todayInTimeZone('Asia/Qatar'), /^\d{4}-\d{2}-\d{2}$/);
    });

    it('throws for an unknown time zone', () => {
      assert.throws(() => todayInTimeZone('Mars/Olympus_Mons'), RangeError);
    });
  });

  describe('isRealIsoDate', () => {
    it('accepts real calendar dates, including leap days', () => {
      for (const value of ['2025-01-01', '2024-02-29', '2000-02-29', '1999-12-31']) {
        assert.equal(isRealIsoDate(value), true, value);
      }
    });

    it('rejects impossible dates', () => {
      for (const value of ['2024-13-45', '2025-02-30', '2025-02-29', '1900-02-29', '2025-04-31', '2025-00-10']) {
        assert.equal(isRealIsoDate(value), false, value);
      }
    });

    it('rejects anything that is not exactly YYYY-MM-DD', () => {
      for (const value of ['2025/01/01', '2025-1-1', ' 2025-01-01', '2025-01-01T00:00', '', null, 20250101]) {
        assert.equal(isRealIsoDate(value), false, String(value));
      }
    });
  });

  describe('date arithmetic', () => {
    it('isoDateFromUtcDate formats the UTC calendar date', () => {
      assert.equal(isoDateFromUtcDate(new Date(Date.UTC(2025, 0, 5, 23, 59))), '2025-01-05');
    });

    it('addDaysToIsoDate crosses month and year boundaries', () => {
      assert.equal(addDaysToIsoDate('2024-12-31', 1), '2025-01-01');
      assert.equal(addDaysToIsoDate('2024-03-01', -1), '2024-02-29');
      assert.equal(addDaysToIsoDate('2025-07-31', 7), '2025-08-07');
    });
  });

  describe('timestamps', () => {
    it('normalizeTimestamp brings ISO strings to the database form', () => {
      assert.equal(normalizeTimestamp('2025-01-02T03:04:05.000Z'), '2025-01-02 03:04:05');
      assert.equal(normalizeTimestamp('2025-01-02 03:04:05'), '2025-01-02 03:04:05');
      assert.equal(normalizeTimestamp(''), null);
      assert.equal(normalizeTimestamp(undefined), null);
    });

    it('isDatabaseTimestamp accepts only the database form', () => {
      assert.equal(isDatabaseTimestamp('2025-01-02 03:04:05'), true);
      assert.equal(isDatabaseTimestamp('2025-01-02T03:04:05'), false);
      assert.equal(isDatabaseTimestamp('yesterday'), false);
      assert.equal(isDatabaseTimestamp(null), false);
    });
  });
});
