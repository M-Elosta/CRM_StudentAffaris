'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const v = require('../../src/validation/common');
const { ValidationError } = require('../../src/lib/errors');

/** Parse one value with a field schema and return the parsed value. */
function parse(schema, value) {
  return v.parseWith(z.object({ field: schema }), { field: value }).field;
}

/** Assert that parsing fails with a ValidationError whose message matches. */
function assertRejects(schema, value, pattern) {
  assert.throws(
    () => parse(schema, value),
    (err) => {
      assert.ok(err instanceof ValidationError, `expected ValidationError, got ${err}`);
      assert.equal(err.status, 400);
      if (pattern) assert.match(err.message, pattern);
      assert.equal(err.fields.field, err.message);
      return true;
    },
    `expected ${JSON.stringify(value)} to be rejected`
  );
}

describe('validation/common', () => {
  describe('positiveId / optionalPositiveId', () => {
    it('accepts positive integers given as numbers or strings', () => {
      assert.equal(parse(v.positiveId('Thing ID'), 7), 7);
      assert.equal(parse(v.positiveId('Thing ID'), '42'), 42);
    });

    for (const bad of [0, -1, 1.5, '1.5', 'abc', NaN, Infinity, '1e400']) {
      it(`rejects ${JSON.stringify(bad) ?? String(bad)}`, () => {
        assertRejects(v.positiveId('Thing ID'), bad, /Thing ID must be a positive integer/);
      });
    }

    for (const missing of ['', null, undefined]) {
      it(`reports ${JSON.stringify(missing) ?? 'undefined'} as missing`, () => {
        assertRejects(v.positiveId('Thing ID'), missing, /Thing ID is required/);
      });
    }

    it('optionalPositiveId returns null for empty values', () => {
      assert.equal(parse(v.optionalPositiveId('x'), undefined), null);
      assert.equal(parse(v.optionalPositiveId('x'), null), null);
      assert.equal(parse(v.optionalPositiveId('x'), ''), null);
      assert.equal(parse(v.optionalPositiveId('x'), '3'), 3);
      assertRejects(v.optionalPositiveId('x'), '0');
    });
  });

  describe('strings', () => {
    it('requiredText trims and enforces presence and length', () => {
      assert.equal(parse(v.requiredText('Name'), '  Acme  '), 'Acme');
      assert.equal(parse(v.requiredText('Name'), 'شركة'), 'شركة');
      assertRejects(v.requiredText('Name'), '   ', /Name is required/);
      assertRejects(v.requiredText('Name'), undefined, /Name is required/);
      assertRejects(v.requiredText('Name'), 123, /Name must be text/);
      assertRejects(v.requiredText('Name', { max: 5 }), 'abcdef', /5 characters or fewer/);
      assert.equal(parse(v.requiredText('Name', { max: 5 }), `  ${'a'.repeat(5)}  `), 'aaaaa');
    });

    it('requiredText defaults to a 255 character limit', () => {
      assert.equal(parse(v.requiredText('Name'), 'a'.repeat(255)).length, 255);
      assertRejects(v.requiredText('Name'), 'a'.repeat(256));
    });

    it('optionalText returns null for empty or blank values', () => {
      assert.equal(parse(v.optionalText('C'), undefined), null);
      assert.equal(parse(v.optionalText('C'), null), null);
      assert.equal(parse(v.optionalText('C'), ''), null);
      assert.equal(parse(v.optionalText('C'), '   '), null);
      assert.equal(parse(v.optionalText('C'), ' note '), 'note');
      assertRejects(v.optionalText('C'), 5, /C must be text/);
      assertRejects(v.optionalText('C', { max: 2 }), 'abc', /2 characters or fewer/);
    });

    it('exactText keeps whitespace but enforces presence and length', () => {
      assert.equal(parse(v.exactText('Password'), '  pass  '), '  pass  ');
      assertRejects(v.exactText('Password'), '', /Password is required/);
      assertRejects(v.exactText('Password'), undefined, /Password is required/);
      assertRejects(v.exactText('Password'), 'x'.repeat(1025), /1024 characters or fewer/);
    });
  });

  describe('enums', () => {
    const SECTORS = ['Government', 'Private'];

    it('enumOf accepts only exact matches and lists the allowed values', () => {
      assert.equal(parse(v.enumOf('Sector', SECTORS), 'Private'), 'Private');
      assertRejects(v.enumOf('Sector', SECTORS), 'private', /^Sector must be one of: Government, Private$/);
      assertRejects(v.enumOf('Sector', SECTORS), undefined, /Sector is required/);
    });

    it('optionalEnumOf returns null, or the default, for empty values', () => {
      assert.equal(parse(v.optionalEnumOf('Sector', SECTORS), ''), null);
      assert.equal(parse(v.optionalEnumOf('Sector', SECTORS), null), null);
      assert.equal(parse(v.optionalEnumOf('Sector', SECTORS), 'Government'), 'Government');
      assert.equal(parse(v.optionalEnumOf('Sector', SECTORS, 'Private'), undefined), 'Private');
      assert.equal(parse(v.optionalEnumOf('Sector', SECTORS, 'Private'), ''), 'Private');
      assertRejects(v.optionalEnumOf('Sector', SECTORS), 'NGO', /Sector must be one of/);
      assertRejects(v.optionalEnumOf('Sector', SECTORS, 'Private'), 'NGO', /Sector must be one of/);
    });
  });

  describe('dates and times', () => {
    it('isoDate accepts YYYY-MM-DD only', () => {
      assert.equal(parse(v.isoDate('Date'), '2025-09-01'), '2025-09-01');
      assert.equal(parse(v.isoDate('Date'), ' 2025-09-01 '), '2025-09-01');
      for (const bad of ['2025/09/01', '01-09-2025', '2025-9-1', 'tomorrow', '2025-09-01T10:00']) {
        assertRejects(
          v.isoDate('Interaction date'),
          bad,
          /^Interaction date must be a real date in YYYY-MM-DD format$/
        );
      }
      assertRejects(v.isoDate('Date'), '', /Date is required/);
    });

    it('isoDate rejects dates that do not exist', () => {
      assertRejects(v.isoDate('Date'), '2025-02-30', /real date/);
      assertRejects(v.isoDate('Date'), '2025-13-01', /real date/);
      assertRejects(v.isoDate('Date'), '2024-13-45', /real date/);
    });

    it('optionalIsoDate returns null for empty values and checks the calendar', () => {
      assert.equal(parse(v.optionalIsoDate('Date'), undefined), null);
      assert.equal(parse(v.optionalIsoDate('Date'), ''), null);
      assert.equal(parse(v.optionalIsoDate('Date'), '2024-02-29'), '2024-02-29');
      assertRejects(v.optionalIsoDate('Date'), '29/02/2024');
      assertRejects(v.optionalIsoDate('Date'), '2025-02-29');
      assertRejects(v.optionalIsoDate('Date'), 20250101);
    });

    it('timeOfDay accepts HH:MM only', () => {
      assert.equal(parse(v.timeOfDay('Time'), '09:30'), '09:30');
      assert.equal(parse(v.timeOfDay('Time'), '23:59'), '23:59');
      for (const bad of ['9:30', '09:30:00', '0930', 'noon', '24:00', '12:60']) {
        assertRejects(v.timeOfDay('Time'), bad, /Time must be a time in HH:MM format/);
      }
      assertRejects(v.timeOfDay('Time'), '', /Time is required/);
    });
  });

  describe('email, URL, username and password', () => {
    it('email accepts plausible addresses and rejects others', () => {
      assert.equal(parse(v.email('Email address'), ' a.b@example.qa '), 'a.b@example.qa');
      for (const bad of ['plainaddress', 'a@b', '@example.com', 'a b@example.com']) {
        assertRejects(v.email('Email address'), bad, /^Email address is not valid$/);
      }
      assertRejects(v.email('Email address'), '', /Email address is required/);
      assertRejects(v.email('Email address'), `${'a'.repeat(250)}@x.co`, /254 characters/);
    });

    it('optionalEmail allows a missing value', () => {
      assert.equal(parse(v.optionalEmail('Email'), ''), null);
      assert.equal(parse(v.optionalEmail('Email'), undefined), null);
      assert.equal(parse(v.optionalEmail('Email'), 'x@y.qa'), 'x@y.qa');
      assertRejects(v.optionalEmail('Email'), 'nope', /Email is not valid/);
    });

    it('optionalHttpUrl accepts http and https URLs and normalises them', () => {
      assert.equal(parse(v.optionalHttpUrl('Website'), 'https://example.com'), 'https://example.com/');
      assert.equal(parse(v.optionalHttpUrl('Website'), 'http://example.com/a?b=1'), 'http://example.com/a?b=1');
      assert.equal(parse(v.optionalHttpUrl('Website'), ''), null);
      assert.equal(parse(v.optionalHttpUrl('Website'), undefined), null);
    });

    it('optionalHttpUrl rejects other schemes and garbage', () => {
      for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,hi', 'example.com', 'not a url']) {
        assertRejects(v.optionalHttpUrl('Website'), bad, /Website must be a valid http or https URL/);
      }
      assertRejects(v.optionalHttpUrl('Website', { max: 255 }), `https://example.com/${'a'.repeat(300)}`);
    });

    it('username allows letters, digits, dot, underscore and hyphen, 3 to 64 characters', () => {
      assert.equal(parse(v.username(), 'j.doe_2-x'), 'j.doe_2-x');
      assert.equal(parse(v.username(), ' abc '), 'abc');
      for (const bad of ['ab', 'a'.repeat(65), 'has space', 'semi;colon', 'محمد', '']) {
        assertRejects(v.username(), bad);
      }
    });

    it('newPassword requires at least 12 characters', () => {
      assert.equal(parse(v.newPassword(), '123456789012'), '123456789012');
      assertRejects(v.newPassword(), '12345678901', /Password must be at least 12 characters/);
      assertRejects(v.newPassword('New password'), undefined, /New password must be at least 12/);
      assertRejects(v.newPassword(), 123456789012345);
    });
  });

  describe('stringArray', () => {
    it('returns an empty array for missing values', () => {
      assert.deepEqual(parse(v.stringArray('Tags'), undefined), []);
      assert.deepEqual(parse(v.stringArray('Tags'), null), []);
    });

    it('trims every value', () => {
      assert.deepEqual(parse(v.stringArray('Tags'), [' a ', 'b']), ['a', 'b']);
    });

    it('rejects non-arrays, blank items, non-string items and too many items', () => {
      assertRejects(v.stringArray('Tags'), 'a', /Tags must be an array/);
      assertRejects(v.stringArray('Tags'), ['a', ' '], /Tags cannot contain blank values/);
      assertRejects(v.stringArray('Tags'), [1], /Tags must contain only text/);
      assertRejects(v.stringArray('Tags', { maxItems: 2 }), ['a', 'b', 'c'], /at most 2 values/);
      assertRejects(v.stringArray('Tags', { maxItemLength: 3 }), ['abcd'], /3 characters or fewer/);
    });

    it('enforces allowed values when given', () => {
      const schema = v.stringArray('Levels', { allowedValues: ['Junior', 'Senior'] });
      assert.deepEqual(parse(schema, ['Junior']), ['Junior']);
      assertRejects(schema, ['Freshman'], /invalid value: Freshman/);
    });
  });

  describe('booleanFlag', () => {
    it('treats true, "true", 1 and "1" as 1', () => {
      for (const value of [true, 'true', 1, '1']) assert.equal(parse(v.booleanFlag(), value), 1, String(value));
    });

    it('treats everything else, including a missing value, as 0', () => {
      for (const value of [false, 'false', 0, '0', '', 'yes', null, undefined, 2]) {
        assert.equal(parse(v.booleanFlag(), value), 0, String(value));
      }
    });
  });

  describe('recordTimestamp', () => {
    it('accepts the database form and ISO strings, normalised', () => {
      assert.equal(parse(v.recordTimestamp(), '2025-01-02 03:04:05'), '2025-01-02 03:04:05');
      assert.equal(parse(v.recordTimestamp(), '2025-01-02T03:04:05'), '2025-01-02 03:04:05');
      assert.equal(parse(v.recordTimestamp(), '2025-01-02T03:04:05.000Z'), '2025-01-02 03:04:05');
    });

    it('rejects a missing or malformed timestamp', () => {
      assertRejects(v.recordTimestamp(), undefined, /UpdatedAt is required/);
      assertRejects(v.recordTimestamp(), '', /UpdatedAt is required/);
      assertRejects(v.recordTimestamp(), 'yesterday', /valid record timestamp/);
    });
  });

  describe('parseWith', () => {
    it('reports every failing field, with the first as the message', () => {
      const schema = z.object({
        Sector: v.enumOf('Sector', ['NGO', 'Private']),
        EmailAddress: v.email('Email address'),
        Name: v.requiredText('Name'),
      });
      assert.throws(
        () => v.parseWith(schema, { Sector: 'Corporate', EmailAddress: 'x', Name: 'ok' }),
        (err) => {
          assert.equal(err.message, 'Sector must be one of: NGO, Private');
          assert.deepEqual(err.fields, {
            Sector: 'Sector must be one of: NGO, Private',
            EmailAddress: 'Email address is not valid',
          });
          return true;
        }
      );
    });

    it('returns the parsed data on success', () => {
      assert.deepEqual(v.parseWith(z.object({ Name: v.requiredText('Name') }), { Name: ' A ', extra: 1 }), {
        Name: 'A',
      });
    });
  });
});
