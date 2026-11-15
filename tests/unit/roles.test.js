'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { ROLES, normalizeRole } = require('../../src/lib/roles');
const { isInsecurePassword } = require('../../src/lib/password-policy');

describe('roles', () => {
  it('defines admin and viewer', () => {
    assert.deepEqual({ ...ROLES }, { ADMIN: 'admin', VIEWER: 'viewer' });
    assert.ok(Object.isFrozen(ROLES));
  });

  it('keeps admin as admin', () => {
    assert.equal(normalizeRole('admin'), 'admin');
  });

  it('treats every other value as viewer', () => {
    for (const value of ['viewer', 'Admin', 'ADMIN', ' admin', 'root', '', null, undefined, 1, {}]) {
      assert.equal(normalizeRole(value), 'viewer', String(value));
    }
  });
});

describe('password policy', () => {
  it('flags the old default password regardless of case and surrounding spaces', () => {
    assert.equal(isInsecurePassword('admin123'), true);
    assert.equal(isInsecurePassword(' ADMIN123 '), true);
  });

  it('does not flag other passwords or non-strings', () => {
    assert.equal(isInsecurePassword('admin1234'), false);
    assert.equal(isInsecurePassword('a-strong-password'), false);
    assert.equal(isInsecurePassword(undefined), false);
    assert.equal(isInsecurePassword(123), false);
  });
});
