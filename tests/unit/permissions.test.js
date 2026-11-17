'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ROLES,
  PERMISSIONS: P,
  ALL_PERMISSIONS,
  RECORD_TYPES,
  normalizeRole,
  can,
  canAccessRecord,
  redactRecord,
  redactRecords,
  readableRecordTypes,
  assignableRoles,
} = require('../../src/security/permissions');

/**
 * The expected matrix is written out in full on purpose. Changing who may do
 * what must be a deliberate edit in two places, never a side effect.
 */
const EXPECTED = {
  [P.RECORD_READ]: ['admin', 'staff', 'readonly', 'student_worker'],
  [P.RECORD_CREATE]: ['admin', 'staff', 'student_worker'],
  [P.RECORD_UPDATE]: ['admin', 'staff', 'student_worker'],
  [P.RECORD_DELETE]: ['admin', 'staff'],
  [P.RECORD_RESTORE]: ['admin', 'staff'],
  [P.RECORD_PURGE]: ['admin'],
  [P.SENSITIVE_READ]: ['admin', 'staff', 'readonly'],
  [P.HISTORY_VIEW]: ['admin', 'staff', 'readonly'],
  [P.TRASH_VIEW]: ['admin', 'staff'],
  [P.REPORTS_VIEW]: ['admin', 'staff', 'readonly', 'student_worker'],
  [P.EXPORT_RUN]: ['admin', 'staff', 'readonly'],
  [P.IMPORT_RUN]: ['admin', 'staff'],
  [P.DUPLICATES_MERGE]: ['admin'],
  [P.USERS_MANAGE]: ['admin'],
  [P.AUDIT_VIEW]: ['admin'],
  [P.SETTINGS_MANAGE]: ['admin'],
  [P.PRIVACY_MANAGE]: ['admin'],
};

const ALL_ROLES = Object.values(ROLES);

describe('permissions', () => {
  it('has an expectation for every permission', () => {
    assert.deepEqual(Object.keys(EXPECTED).sort(), [...ALL_PERMISSIONS].sort());
  });

  for (const permission of ALL_PERMISSIONS) {
    for (const role of ALL_ROLES) {
      const allowed = EXPECTED[permission].includes(role);
      it(`${role} ${allowed ? 'may' : 'may not'} ${permission}`, () => {
        assert.equal(can({ role, isActive: true }, permission), allowed);
        assert.equal(can(role, permission), allowed);
      });
    }
  }

  it('a deactivated user has no permissions, whatever the role', () => {
    for (const role of ALL_ROLES) {
      for (const permission of ALL_PERMISSIONS) {
        assert.equal(can({ role, isActive: false }, permission), false, `${role} ${permission}`);
      }
    }
  });

  it('a missing user has no permissions', () => {
    assert.equal(can(null, P.RECORD_READ), false);
    assert.equal(can(undefined, P.RECORD_READ), false);
  });

  describe('role names', () => {
    it('maps the legacy "viewer" role to read-only', () => {
      assert.equal(normalizeRole('viewer'), ROLES.READONLY);
    });

    it('maps anything unknown to the least privileged role', () => {
      for (const value of ['', 'root', 'ADMIN', 'Admin ', null, undefined, 42, {}]) {
        assert.equal(normalizeRole(value), ROLES.STUDENT_WORKER, String(value));
      }
    });

    it('keeps the four known roles', () => {
      for (const role of ALL_ROLES) assert.equal(normalizeRole(role), role);
    });

    it('offers all four roles for assignment, most privileged first', () => {
      assert.deepEqual(assignableRoles(), ['admin', 'staff', 'readonly', 'student_worker']);
    });
  });

  describe('student worker limits by record type', () => {
    const worker = { role: ROLES.STUDENT_WORKER, isActive: true };

    it('cannot read hiring feedback or student-led events at all', () => {
      assert.equal(canAccessRecord(worker, P.RECORD_READ, 'hiring-feedback'), false);
      assert.equal(canAccessRecord(worker, P.RECORD_READ, 'student-events'), false);
      assert.deepEqual(
        readableRecordTypes(worker),
        RECORD_TYPES.filter((type) => !['hiring-feedback', 'student-events'].includes(type))
      );
    });

    it('can add and edit interactions, postings, career events, tasks and notes only', () => {
      const writable = ['outreach', 'recruitment', 'career-events', 'tasks', 'notes'];
      for (const type of RECORD_TYPES) {
        const expected = writable.includes(type);
        assert.equal(canAccessRecord(worker, P.RECORD_CREATE, type), expected, `create ${type}`);
        assert.equal(canAccessRecord(worker, P.RECORD_UPDATE, type), expected, `update ${type}`);
      }
    });

    it('cannot delete, restore or purge any record type', () => {
      for (const type of RECORD_TYPES) {
        for (const permission of [P.RECORD_DELETE, P.RECORD_RESTORE, P.RECORD_PURGE]) {
          assert.equal(canAccessRecord(worker, permission, type), false, `${permission} ${type}`);
        }
      }
    });
  });

  describe('other roles by record type', () => {
    it('staff and admin can read, create, update and delete every record type', () => {
      for (const role of [ROLES.ADMIN, ROLES.STAFF]) {
        for (const type of RECORD_TYPES) {
          for (const permission of [P.RECORD_READ, P.RECORD_CREATE, P.RECORD_UPDATE, P.RECORD_DELETE]) {
            assert.equal(canAccessRecord(role, permission, type), true, `${role} ${permission} ${type}`);
          }
        }
      }
    });

    it('read-only can read every record type and change none', () => {
      for (const type of RECORD_TYPES) {
        assert.equal(canAccessRecord(ROLES.READONLY, P.RECORD_READ, type), true);
        for (const permission of [P.RECORD_CREATE, P.RECORD_UPDATE, P.RECORD_DELETE, P.RECORD_RESTORE]) {
          assert.equal(canAccessRecord(ROLES.READONLY, permission, type), false, `${permission} ${type}`);
        }
      }
    });

    it('nobody has access to a record type that does not exist', () => {
      for (const role of ALL_ROLES) {
        assert.equal(canAccessRecord(role, P.RECORD_READ, 'constructor'), false);
        assert.equal(canAccessRecord(role, P.RECORD_READ, 'invoices'), false);
      }
    });
  });

  describe('sensitive fields', () => {
    const contact = {
      ContactID: 7,
      FirstName: 'نورة',
      LastName: 'الهاجري',
      JobTitle: 'HR Manager',
      EmailAddress: 'noura@employer.example',
      WorkPhone: '+974 5550 0101',
      Mobile: '+974 5550 0102',
      Address: 'Doha',
      LinkedInURL: 'https://www.linkedin.example/in/noura',
      HandshakeURL: null,
    };

    it('withholds contact details from a student worker and says which', () => {
      const safe = redactRecord(ROLES.STUDENT_WORKER, 'contacts', contact);
      assert.equal(safe.FirstName, 'نورة');
      assert.equal(safe.JobTitle, 'HR Manager');
      for (const field of ['EmailAddress', 'WorkPhone', 'Mobile', 'Address', 'LinkedInURL', 'HandshakeURL']) {
        assert.equal(safe[field], null, field);
      }
      assert.deepEqual(safe._withheld, [
        'EmailAddress',
        'WorkPhone',
        'Mobile',
        'Address',
        'LinkedInURL',
        'HandshakeURL',
      ]);
    });

    it('does not modify the original record', () => {
      redactRecord(ROLES.STUDENT_WORKER, 'contacts', contact);
      assert.equal(contact.EmailAddress, 'noura@employer.example');
      assert.equal('_withheld' in contact, false);
    });

    it('returns the record unchanged for roles that may read sensitive fields', () => {
      for (const role of [ROLES.ADMIN, ROLES.STAFF, ROLES.READONLY]) {
        assert.equal(redactRecord(role, 'contacts', contact), contact, role);
      }
    });

    it('withholds internal comments on employers from a student worker', () => {
      const safe = redactRecord(ROLES.STUDENT_WORKER, 'companies', { CompanyName: 'Zayvora Digital', Comment: 'x' });
      assert.equal(safe.Comment, null);
      assert.equal(safe.CompanyName, 'Zayvora Digital');
    });

    it('withholds student details and hired student names', () => {
      const event = redactRecord(ROLES.STUDENT_WORKER, 'student-events', {
        StudentName: 'A',
        StudentEmail: 'a@students.university.example',
        StudentPhoneNumber: '1',
        EventTitle: 'Hack night',
      });
      assert.deepEqual(
        [event.StudentName, event.StudentEmail, event.StudentPhoneNumber, event.EventTitle],
        [null, null, null, 'Hack night']
      );
      const feedback = redactRecord(ROLES.STUDENT_WORKER, 'hiring-feedback', { HiredStudentName: 'B', Comment: 'c' });
      assert.equal(feedback.HiredStudentName, null);
      assert.equal(feedback.Comment, null);
    });

    it('leaves records without sensitive fields untouched', () => {
      const posting = { RecruitmentID: 1, OpportunityTitle: 'Intern' };
      assert.equal(redactRecord(ROLES.STUDENT_WORKER, 'recruitment', posting), posting);
    });

    it('redacts every record in a list', () => {
      const list = redactRecords(ROLES.STUDENT_WORKER, 'contacts', [contact, { ...contact, ContactID: 8 }]);
      assert.equal(list.length, 2);
      assert.ok(list.every((row) => row.EmailAddress === null));
    });

    it('withholds from a deactivated user even with a privileged role', () => {
      const safe = redactRecord({ role: ROLES.ADMIN, isActive: false }, 'contacts', contact);
      assert.equal(safe.EmailAddress, null);
    });

    it('handles a missing record', () => {
      assert.equal(redactRecord(ROLES.STUDENT_WORKER, 'contacts', null), null);
    });
  });
});
