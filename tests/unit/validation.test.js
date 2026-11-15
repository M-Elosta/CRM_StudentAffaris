'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const v = require('../../src/routes/_validation');
const { STALE_RECORD_MESSAGE, ensureRecordNotStale } = require('../../src/routes/_records');
const { openDatabase } = require('../../src/db/connection');

/** Assert that fn throws a validation error with the given status and message. */
function assertRejects(fn, pattern, statusCode = 400) {
  assert.throws(fn, (err) => {
    assert.equal(err.statusCode, statusCode);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

describe('_validation', () => {
  describe('error helpers', () => {
    it('validationError carries status 400 and conflictError status 409', () => {
      assert.equal(v.validationError('bad').statusCode, 400);
      assert.equal(v.conflictError('stale').statusCode, 409);
      assert.ok(v.validationError('bad') instanceof Error);
    });

    it('sendValidationError writes the status and message as JSON', () => {
      const sent = {};
      const res = {
        status(code) {
          sent.status = code;
          return this;
        },
        json(body) {
          sent.body = body;
          return this;
        },
      };
      v.sendValidationError(res, v.conflictError('changed'));
      assert.deepEqual(sent, { status: 409, body: { error: 'changed' } });
      v.sendValidationError(res, new Error('plain'));
      assert.equal(sent.status, 400);
    });
  });

  describe('requirePositiveInt / optionalPositiveInt', () => {
    it('accepts positive integers given as numbers or strings', () => {
      assert.equal(v.requirePositiveInt(7, 'id'), 7);
      assert.equal(v.requirePositiveInt('42', 'id'), 42);
    });

    for (const bad of [0, -1, 1.5, '1.5', 'abc', '', null, undefined, NaN, Infinity, '1e400']) {
      it(`rejects ${JSON.stringify(bad) ?? String(bad)}`, () => {
        assertRejects(() => v.requirePositiveInt(bad, 'Thing ID'), /Thing ID must be a positive integer/);
      });
    }

    it('optionalPositiveInt returns null for empty values', () => {
      assert.equal(v.optionalPositiveInt(undefined, 'x'), null);
      assert.equal(v.optionalPositiveInt(null, 'x'), null);
      assert.equal(v.optionalPositiveInt('', 'x'), null);
      assert.equal(v.optionalPositiveInt('3', 'x'), 3);
      assertRejects(() => v.optionalPositiveInt('0', 'x'));
    });
  });

  describe('strings', () => {
    it('requireTrimmedString trims and enforces presence and length', () => {
      assert.equal(v.requireTrimmedString('  Acme  ', 'Name'), 'Acme');
      assert.equal(v.requireTrimmedString('شركة', 'Name'), 'شركة');
      assertRejects(() => v.requireTrimmedString('   ', 'Name'), /Name is required/);
      assertRejects(() => v.requireTrimmedString(undefined, 'Name'), /Name is required/);
      assertRejects(() => v.requireTrimmedString(123, 'Name'), /Name is required/);
      assertRejects(() => v.requireTrimmedString('abcdef', 'Name', 5), /5 characters or fewer/);
      assert.equal(v.requireTrimmedString(`  ${'a'.repeat(5)}  `, 'Name', 5), 'aaaaa');
    });

    it('requireTrimmedString defaults to a 255 character limit', () => {
      assert.equal(v.requireTrimmedString('a'.repeat(255), 'Name').length, 255);
      assertRejects(() => v.requireTrimmedString('a'.repeat(256), 'Name'));
    });

    it('optionalTrimmedString returns null for empty or blank values', () => {
      assert.equal(v.optionalTrimmedString(undefined, 'C'), null);
      assert.equal(v.optionalTrimmedString(null, 'C'), null);
      assert.equal(v.optionalTrimmedString('', 'C'), null);
      assert.equal(v.optionalTrimmedString('   ', 'C'), null);
      assert.equal(v.optionalTrimmedString(' note ', 'C'), 'note');
      assertRejects(() => v.optionalTrimmedString(5, 'C'), /C must be a string/);
      assertRejects(() => v.optionalTrimmedString('abc', 'C', 2), /2 characters or fewer/);
    });

    it('requireString keeps whitespace but enforces presence and length', () => {
      assert.equal(v.requireString('  pass  ', 'Password'), '  pass  ');
      assertRejects(() => v.requireString('', 'Password'), /Password is required/);
      assertRejects(() => v.requireString(undefined, 'Password'));
      assertRejects(() => v.requireString('x'.repeat(1025), 'Password'), /1024 characters or fewer/);
    });
  });

  describe('enums', () => {
    const SECTORS = ['Government', 'Private'];

    it('requireEnum accepts only exact matches', () => {
      assert.equal(v.requireEnum('Private', 'Sector', SECTORS), 'Private');
      assertRejects(() => v.requireEnum('private', 'Sector', SECTORS), /Sector must be one of: Government, Private/);
      assertRejects(() => v.requireEnum(undefined, 'Sector', SECTORS));
    });

    it('optionalEnum returns null for empty values', () => {
      assert.equal(v.optionalEnum('', 'Sector', SECTORS), null);
      assert.equal(v.optionalEnum(null, 'Sector', SECTORS), null);
      assert.equal(v.optionalEnum('Government', 'Sector', SECTORS), 'Government');
      assertRejects(() => v.optionalEnum('NGO', 'Sector', SECTORS));
    });
  });

  describe('dates and times', () => {
    it('requireIsoDate accepts YYYY-MM-DD only', () => {
      assert.equal(v.requireIsoDate('2025-09-01', 'Date'), '2025-09-01');
      assert.equal(v.requireIsoDate(' 2025-09-01 ', 'Date'), '2025-09-01');
      for (const bad of ['2025/09/01', '01-09-2025', '2025-9-1', 'tomorrow', '2025-09-01T10:00']) {
        assertRejects(() => v.requireIsoDate(bad, 'Date'), undefined);
      }
      assertRejects(() => v.requireIsoDate('', 'Date'), /Date is required/);
    });

    it(
      'requireIsoDate rejects dates that do not exist',
      { todo: 'requireIsoDate in src/routes/_validation.js only checks the shape, not the calendar' },
      () => {
        assertRejects(() => v.requireIsoDate('2025-02-30', 'Date'));
        assertRejects(() => v.requireIsoDate('2025-13-01', 'Date'));
      }
    );

    it('optionalIsoDate returns null for empty values', () => {
      assert.equal(v.optionalIsoDate(undefined, 'Date'), null);
      assert.equal(v.optionalIsoDate('', 'Date'), null);
      assert.equal(v.optionalIsoDate('2024-02-29', 'Date'), '2024-02-29');
      assertRejects(() => v.optionalIsoDate('29/02/2024', 'Date'));
    });

    it('requireIsoTime accepts HH:MM only', () => {
      assert.equal(v.requireIsoTime('09:30', 'Time'), '09:30');
      for (const bad of ['9:30', '09:30:00', '0930', 'noon', '']) {
        assertRejects(() => v.requireIsoTime(bad, 'Time'));
      }
    });
  });

  describe('email, URL, username and password', () => {
    it('requireEmail accepts plausible addresses and rejects others', () => {
      assert.equal(v.requireEmail(' a.b@example.qa ', 'Email'), 'a.b@example.qa');
      for (const bad of ['plainaddress', 'a@b', '@example.com', 'a b@example.com', '']) {
        assertRejects(() => v.requireEmail(bad, 'Email'));
      }
      assertRejects(() => v.requireEmail(`${'a'.repeat(250)}@x.co`, 'Email'), /254 characters/);
    });

    it('optionalHttpUrl accepts http and https URLs and normalises them', () => {
      assert.equal(v.optionalHttpUrl('https://example.com', 'Website'), 'https://example.com/');
      assert.equal(v.optionalHttpUrl('http://example.com/a?b=1', 'Website'), 'http://example.com/a?b=1');
      assert.equal(v.optionalHttpUrl('', 'Website'), null);
      assert.equal(v.optionalHttpUrl(undefined, 'Website'), null);
    });

    it('optionalHttpUrl rejects other schemes and garbage', () => {
      for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,hi', 'example.com', 'not a url']) {
        assertRejects(() => v.optionalHttpUrl(bad, 'Website'), /valid http or https URL/);
      }
      assertRejects(() => v.optionalHttpUrl(`https://example.com/${'a'.repeat(300)}`, 'Website', 255));
    });

    it('requireUsername allows letters, digits, dot, underscore and hyphen, 3 to 64 characters', () => {
      assert.equal(v.requireUsername('j.doe_2-x'), 'j.doe_2-x');
      assert.equal(v.requireUsername(' abc '), 'abc');
      for (const bad of ['ab', 'a'.repeat(65), 'has space', 'semi;colon', 'محمد', '']) {
        assertRejects(() => v.requireUsername(bad));
      }
    });

    it('requirePassword requires at least 12 characters', () => {
      assert.equal(v.requirePassword('123456789012'), '123456789012');
      assertRejects(() => v.requirePassword('12345678901'), /Password must be at least 12 characters/);
      assertRejects(() => v.requirePassword(undefined, 'New password'), /New password must be at least 12/);
      assertRejects(() => v.requirePassword(123456789012345));
    });
  });

  describe('optionalStringArray', () => {
    it('returns an empty array for missing values', () => {
      assert.deepEqual(v.optionalStringArray(undefined, 'Tags'), []);
      assert.deepEqual(v.optionalStringArray(null, 'Tags'), []);
    });

    it('trims every value', () => {
      assert.deepEqual(v.optionalStringArray([' a ', 'b'], 'Tags'), ['a', 'b']);
    });

    it('rejects non-arrays, blank items, non-string items and too many items', () => {
      assertRejects(() => v.optionalStringArray('a', 'Tags'), /Tags must be an array/);
      assertRejects(() => v.optionalStringArray(['a', ' '], 'Tags'), /Tags is required/);
      assertRejects(() => v.optionalStringArray([1], 'Tags'));
      assertRejects(() => v.optionalStringArray(['a', 'b', 'c'], 'Tags', { maxItems: 2 }), /at most 2 values/);
      assertRejects(() => v.optionalStringArray(['abcd'], 'Tags', { maxItemLength: 3 }));
    });

    it('enforces allowed values when given', () => {
      const options = { allowedValues: ['Junior', 'Senior'] };
      assert.deepEqual(v.optionalStringArray(['Junior'], 'Levels', options), ['Junior']);
      assertRejects(() => v.optionalStringArray(['Freshman'], 'Levels', options), /invalid value: Freshman/);
    });
  });

  describe('parseBoolean', () => {
    it('treats true, "true", 1 and "1" as true', () => {
      for (const value of [true, 'true', 1, '1']) assert.equal(v.parseBoolean(value), true, String(value));
    });

    it('treats everything else as false', () => {
      for (const value of [false, 'false', 0, '0', '', 'yes', null, undefined, 2]) {
        assert.equal(v.parseBoolean(value), false, String(value));
      }
    });
  });
});

describe('_records: ensureRecordNotStale', () => {
  function database() {
    const db = openDatabase(':memory:');
    db.exec("CREATE TABLE Thing (ThingID INTEGER PRIMARY KEY, UpdatedAt TEXT DEFAULT '2025-01-02 03:04:05')");
    db.exec('INSERT INTO Thing (ThingID) VALUES (1)');
    return db;
  }

  it('passes when the loaded timestamp matches, in either SQL or ISO form', () => {
    const db = database();
    ensureRecordNotStale(db, 'Thing', 'ThingID', 1, '2025-01-02 03:04:05');
    ensureRecordNotStale(db, 'Thing', 'ThingID', 1, '2025-01-02T03:04:05');
    ensureRecordNotStale(db, 'Thing', 'ThingID', 1, '2025-01-02T03:04:05.000Z');
    db.close();
  });

  it('throws 409 with the reload message when the timestamps differ', () => {
    const db = database();
    assertRejects(() => ensureRecordNotStale(db, 'Thing', 'ThingID', 1, '2025-01-02 03:04:06'), /reload/i, 409);
    assert.match(STALE_RECORD_MESSAGE, /reload/i);
    db.close();
  });

  it('throws 404 with the given message when the record does not exist', () => {
    const db = database();
    assertRejects(
      () => ensureRecordNotStale(db, 'Thing', 'ThingID', 99, '2025-01-02 03:04:05', 'Thing not found'),
      /Thing not found/,
      404
    );
    db.close();
  });

  it('throws 400 when UpdatedAt is missing or malformed', () => {
    const db = database();
    assertRejects(() => ensureRecordNotStale(db, 'Thing', 'ThingID', 1, undefined), /UpdatedAt is required/);
    assertRejects(() => ensureRecordNotStale(db, 'Thing', 'ThingID', 1, ''), /UpdatedAt is required/);
    assertRejects(() => ensureRecordNotStale(db, 'Thing', 'ThingID', 1, 'yesterday'), /valid record timestamp/);
    db.close();
  });
});
