'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { openDatabase, tableCounts } = require('../../src/db/connection');
const { migrate, migrationStatus, listMigrations, MIGRATIONS_DIR } = require('../../src/db/migrate');
const { makeTempDir } = require('../helpers/tmp');
const { createSilentLogger } = require('../helpers/app');

const EXPECTED_TABLES = [
  'AcademicClassroomEngagement',
  'CareerEvent',
  'Company',
  'Contact',
  'HiringFeedback',
  'OutreachEngagement',
  'PotentialCollaboration',
  'PotentialCollaboration_Opportunities',
  'Recruitment',
  'Recruitment_ClassLevel',
  'Recruitment_CollectApplications',
  'Recruitment_OpportunityType',
  'Recruitment_TargetMajors',
  'SavedReports',
  'StudentLedEvent',
  'Users',
  'schema_migrations',
];

const quiet = () => ({ logger: createSilentLogger() });

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

function columns(db, table) {
  return db.pragma(`table_info(${table})`).map((info) => info.name);
}

function appliedVersions(db) {
  return db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => row.version);
}

/** Copy the real migrations into a temporary directory the test may change. */
function copyRealMigrations(t) {
  const dir = makeTempDir(t);
  for (const file of fs.readdirSync(MIGRATIONS_DIR)) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
  }
  return dir;
}

function writeMigration(dir, file, content) {
  fs.writeFileSync(path.join(dir, file), content);
}

/** A database with one table holding three rows, outside any migration. */
function databaseWithRows() {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE Thing (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  db.exec("INSERT INTO Thing (name) VALUES ('one'), ('two'), ('three')");
  return db;
}

/**
 * The schema as created by versions of the application before versioned
 * migrations: no UpdatedAt on five activity tables, and Users without Role
 * or MustChangePassword.
 */
const OLD_SCHEMA_SQL = `
  CREATE TABLE Company (
    CompanyID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyName TEXT NOT NULL,
    DateAdded DATE NOT NULL DEFAULT (date('now')),
    Industry TEXT NOT NULL,
    Sector TEXT NOT NULL,
    Country TEXT NOT NULL,
    Address TEXT, Website TEXT, LinkedInURL TEXT, HandshakeURL TEXT,
    SignedMoU INTEGER DEFAULT 0, FavoriteEmployer INTEGER DEFAULT 0, Blacklisted INTEGER DEFAULT 0,
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now')),
    UpdatedAt DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE Contact (
    ContactID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    FirstName TEXT NOT NULL, LastName TEXT NOT NULL,
    DateAdded DATE NOT NULL DEFAULT (date('now')),
    JobTitle TEXT, EmailAddress TEXT NOT NULL, Address TEXT, Country TEXT, WorkPhone TEXT, Mobile TEXT,
    LinkedInURL TEXT, HandshakeURL TEXT, CMUQGraduate INTEGER DEFAULT 0, Major TEXT, GraduationYear INTEGER,
    PrimaryContact INTEGER DEFAULT 0, Status TEXT NOT NULL DEFAULT 'Mailable',
    ResumeBook INTEGER DEFAULT 0, EventInvitation INTEGER DEFAULT 0, ExcludeFromMailing INTEGER DEFAULT 0,
    CreatedAt DATETIME DEFAULT (datetime('now')),
    UpdatedAt DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE PotentialCollaboration (
    PotentialCollaborationID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE HiringFeedback (
    HiringFeedbackID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    FeedbackProvider TEXT NOT NULL, HiredStudentAlumni TEXT NOT NULL, DateReported DATE NOT NULL,
    HiredStudentName TEXT, Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE CareerEvent (
    CareerEventID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    EventName TEXT NOT NULL, EventDate DATE NOT NULL, RegisteredStatus TEXT NOT NULL,
    CMUQAlumniAtBooth INTEGER DEFAULT 0, Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE StudentLedEvent (
    StudentLedEventID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    ProposalDate DATE NOT NULL, OrganizationName TEXT NOT NULL, StudentName TEXT NOT NULL,
    StudentEmail TEXT NOT NULL, StudentPhoneNumber TEXT NOT NULL,
    CollaborationOutcome TEXT NOT NULL DEFAULT 'Pending', EventDate DATE, EventTitle TEXT, Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE AcademicClassroomEngagement (
    EngagementID INTEGER PRIMARY KEY AUTOINCREMENT,
    CompanyID INTEGER NOT NULL REFERENCES Company(CompanyID) ON DELETE CASCADE,
    ContactID INTEGER NOT NULL REFERENCES Contact(ContactID) ON DELETE CASCADE,
    EngagementType TEXT NOT NULL, GuestSpeakerName TEXT NOT NULL, GuestTitle TEXT NOT NULL,
    Email TEXT, PhoneNumber TEXT, FacultyName TEXT NOT NULL, CourseNumber TEXT NOT NULL,
    CourseTitle TEXT NOT NULL, TopicTheme TEXT NOT NULL, SessionDate DATE NOT NULL, SessionTime TEXT NOT NULL,
    Comment TEXT,
    CreatedAt DATETIME DEFAULT (datetime('now'))
  );
  CREATE TABLE Users (
    UserID INTEGER PRIMARY KEY AUTOINCREMENT,
    Username TEXT UNIQUE NOT NULL,
    PasswordHash TEXT NOT NULL,
    CreatedAt DATETIME DEFAULT (datetime('now'))
  );
`;

const OLD_CREATED_AT = '2023-03-04 05:06:07';

function buildOldDatabase() {
  const db = openDatabase(':memory:');
  db.exec(OLD_SCHEMA_SQL);
  db.exec(`
    INSERT INTO Company (CompanyName, Industry, Sector, Country) VALUES
      ('Old Co One', 'Energy', 'Private', 'Qatar'),
      ('شركة قديمة', 'Banking', 'Government', 'قطر');
    INSERT INTO Contact (CompanyID, FirstName, LastName, EmailAddress) VALUES
      (1, 'Old', 'Contact', 'old@example.com'),
      (2, 'محمد', 'آل ثاني', 'm@example.qa');
    INSERT INTO PotentialCollaboration (CompanyID, Comment, CreatedAt) VALUES (1, 'old idea', '${OLD_CREATED_AT}');
    INSERT INTO HiringFeedback (CompanyID, ContactID, FeedbackProvider, HiredStudentAlumni, DateReported, CreatedAt)
      VALUES (1, 1, 'Company', 'Yes', '2023-03-01', '${OLD_CREATED_AT}');
    INSERT INTO CareerEvent (CompanyID, ContactID, EventName, EventDate, RegisteredStatus, CreatedAt)
      VALUES (1, 1, 'Fair 2023', '2023-03-02', 'Attended', '${OLD_CREATED_AT}'),
             (2, 2, 'Fair 2023', '2023-03-02', 'No-Show', '${OLD_CREATED_AT}');
    INSERT INTO StudentLedEvent (CompanyID, ContactID, ProposalDate, OrganizationName, StudentName, StudentEmail,
      StudentPhoneNumber, CreatedAt)
      VALUES (1, 1, '2023-02-01', 'ACM', 'Student', 's@example.edu', '5555', '${OLD_CREATED_AT}');
    INSERT INTO AcademicClassroomEngagement (CompanyID, ContactID, EngagementType, GuestSpeakerName, GuestTitle,
      FacultyName, CourseNumber, CourseTitle, TopicTheme, SessionDate, SessionTime, CreatedAt)
      VALUES (1, 1, 'Guest Lecture', 'Speaker', 'CTO', 'Faculty', '15-112', 'Course', 'Topic', '2023-01-15', '10:00',
              '${OLD_CREATED_AT}');
    INSERT INTO Users (Username, PasswordHash) VALUES ('legacy-admin', 'x'), ('legacy-two', 'y');
  `);
  return db;
}

const OLD_TABLES_WITHOUT_UPDATED_AT = [
  'PotentialCollaboration',
  'HiringFeedback',
  'CareerEvent',
  'StudentLedEvent',
  'AcademicClassroomEngagement',
];

describe('migrate', () => {
  describe('a fresh database', () => {
    it('gets every table and records both migrations', async () => {
      const db = openDatabase(':memory:');
      const result = await migrate(db, quiet());
      assert.deepEqual(result.applied, ['0001_baseline.js', '0002_foreign_key_indexes.sql']);
      assert.deepEqual(tableNames(db), EXPECTED_TABLES);
      assert.deepEqual(appliedVersions(db), [1, 2]);
      const rows = db.prepare('SELECT version, name, checksum, applied_at FROM schema_migrations').all();
      for (const row of rows) {
        assert.match(row.checksum, /^[0-9a-f]{64}$/);
        assert.ok(row.applied_at);
      }
      db.close();
    });

    it('creates the foreign key indexes from 0002', async () => {
      const db = openDatabase(':memory:');
      await migrate(db, quiet());
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_outreach_company'")
        .all();
      assert.equal(indexes.length, 1);
      db.close();
    });

    it('applies nothing when run a second time', async () => {
      const db = openDatabase(':memory:');
      await migrate(db, quiet());
      const countsBefore = tableCounts(db);
      const second = await migrate(db, quiet());
      assert.deepEqual(second.applied, []);
      assert.deepEqual(appliedVersions(db), [1, 2]);
      assert.deepEqual(tableCounts(db), countsBefore);
      assert.equal(migrationStatus(db).pending.length, 0);
      db.close();
    });

    it('does not call the backup function when the database is empty', async () => {
      const db = openDatabase(':memory:');
      let calls = 0;
      await migrate(db, {
        ...quiet(),
        backup: async () => {
          calls += 1;
          return '/nowhere';
        },
      });
      assert.equal(calls, 0);
      db.close();
    });
  });

  describe('a database created by an older version', () => {
    it('keeps every row', async () => {
      const db = buildOldDatabase();
      const before = tableCounts(db);
      const result = await migrate(db, quiet());
      assert.equal(result.applied.length, 2);
      const after = tableCounts(db);
      for (const [table, count] of Object.entries(before)) {
        assert.equal(after[table], count, table);
      }
      assert.equal(db.prepare('SELECT CompanyName FROM Company WHERE CompanyID = 2').get().CompanyName, 'شركة قديمة');
      assert.equal(db.prepare('SELECT LastName FROM Contact WHERE ContactID = 2').get().LastName, 'آل ثاني');
      db.close();
    });

    it('adds the missing columns and creates the missing tables', async () => {
      const db = buildOldDatabase();
      await migrate(db, quiet());
      for (const table of OLD_TABLES_WITHOUT_UPDATED_AT) {
        assert.ok(columns(db, table).includes('UpdatedAt'), `${table}.UpdatedAt`);
      }
      assert.ok(columns(db, 'Users').includes('Role'));
      assert.ok(columns(db, 'Users').includes('MustChangePassword'));
      assert.deepEqual(tableNames(db), EXPECTED_TABLES);
      db.close();
    });

    it('gives existing users the admin role and no forced rotation', async () => {
      const db = buildOldDatabase();
      await migrate(db, quiet());
      const users = db.prepare('SELECT Username, Role, MustChangePassword FROM Users ORDER BY UserID').all();
      assert.deepEqual(users, [
        { Username: 'legacy-admin', Role: 'admin', MustChangePassword: 0 },
        { Username: 'legacy-two', Role: 'admin', MustChangePassword: 0 },
      ]);
      db.close();
    });

    it('backfills UpdatedAt on every existing row', async () => {
      const db = buildOldDatabase();
      await migrate(db, quiet());
      for (const table of OLD_TABLES_WITHOUT_UPDATED_AT) {
        const missing = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE UpdatedAt IS NULL`).get().n;
        assert.equal(missing, 0, table);
      }
      db.close();
    });

    it('backfills UpdatedAt from CreatedAt', async () => {
      const db = buildOldDatabase();
      await migrate(db, quiet());
      for (const table of OLD_TABLES_WITHOUT_UPDATED_AT) {
        const rows = db.prepare(`SELECT CreatedAt, UpdatedAt FROM ${table}`).all();
        for (const row of rows) assert.equal(row.UpdatedAt, OLD_CREATED_AT, table);
      }
      db.close();
    });

    it('calls the backup function exactly once before migrating', async () => {
      const db = buildOldDatabase();
      const calls = [];
      const result = await migrate(db, {
        ...quiet(),
        backup: async (label) => {
          // The backup must see the database before any migration ran.
          calls.push({ label, migrated: db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n });
          return '/backups/pre.db';
        },
      });
      assert.deepEqual(calls, [{ label: 'pre-migration-0001', migrated: 0 }]);
      assert.equal(result.backupPath, '/backups/pre.db');
      db.close();
    });

    it('does not migrate if the backup fails', async () => {
      const db = buildOldDatabase();
      await assert.rejects(
        migrate(db, {
          ...quiet(),
          backup: async () => {
            throw new Error('disk full');
          },
        }),
        /disk full/
      );
      assert.deepEqual(appliedVersions(db), []);
      assert.ok(!columns(db, 'Users').includes('Role'));
      db.close();
    });

    it('calls the backup function once for a later migration on a migrated database', async (t) => {
      const dir = copyRealMigrations(t);
      const db = openDatabase(':memory:');
      await migrate(db, { ...quiet(), dir });
      writeMigration(dir, '0003_add_note.sql', 'ALTER TABLE Company ADD COLUMN Note TEXT;');
      const labels = [];
      await migrate(db, { ...quiet(), dir, backup: async (label) => labels.push(label) });
      assert.deepEqual(labels, ['pre-migration-0003']);
      db.close();
    });
  });

  describe('safety rules', () => {
    it('refuses to run when an applied migration file was edited', async (t) => {
      const dir = copyRealMigrations(t);
      const db = openDatabase(':memory:');
      await migrate(db, { ...quiet(), dir });
      fs.appendFileSync(path.join(dir, '0002_foreign_key_indexes.sql'), '\n-- an innocent-looking edit\n');
      await assert.rejects(
        migrate(db, { ...quiet(), dir }),
        /0002_foreign_key_indexes\.sql was changed after it was applied/
      );
      assert.throws(() => migrationStatus(db, dir), /changed after it was applied/);
      db.close();
    });

    it('refuses to run when the database has a migration this version does not include', async (t) => {
      const dir = copyRealMigrations(t);
      const db = openDatabase(':memory:');
      await migrate(db, { ...quiet(), dir });
      fs.unlinkSync(path.join(dir, '0002_foreign_key_indexes.sql'));
      await assert.rejects(migrate(db, { ...quiet(), dir }), /older than the database/);
      db.close();
    });

    it('refuses a new migration numbered below one already applied', async (t) => {
      const dir = makeTempDir(t);
      writeMigration(dir, '0001_first.sql', 'CREATE TABLE A (id INTEGER PRIMARY KEY);');
      writeMigration(dir, '0003_third.sql', 'CREATE TABLE C (id INTEGER PRIMARY KEY);');
      const db = openDatabase(':memory:');
      await migrate(db, { ...quiet(), dir });
      writeMigration(dir, '0002_second.sql', 'CREATE TABLE B (id INTEGER PRIMARY KEY);');
      await assert.rejects(migrate(db, { ...quiet(), dir }), /0002_second\.sql is numbered below an already-applied/);
      assert.ok(!tableNames(db).includes('B'));
      assert.deepEqual(appliedVersions(db), [1, 3]);
      db.close();
    });

    it('rolls back a migration that deletes rows and leaves data and history unchanged', async (t) => {
      const dir = makeTempDir(t);
      writeMigration(dir, '0001_prune.sql', 'CREATE TABLE Other (id INTEGER);\nDELETE FROM Thing WHERE id > 1;');
      const db = databaseWithRows();
      await assert.rejects(migrate(db, { ...quiet(), dir }), /0001_prune\.sql would lose data and was rolled back/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Thing').get().n, 3);
      assert.ok(!tableNames(db).includes('Other'), 'the whole migration is rolled back');
      assert.deepEqual(appliedVersions(db), []);
      assert.equal(db.inTransaction, false);
      db.close();
    });

    it('rolls back a migration that drops a table holding rows', async (t) => {
      const dir = makeTempDir(t);
      writeMigration(dir, '0001_drop.sql', 'DROP TABLE Thing;');
      const db = databaseWithRows();
      await assert.rejects(migrate(db, { ...quiet(), dir }), /table Thing was dropped \(3 rows\)/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Thing').get().n, 3);
      db.close();
    });

    it('allows row loss when the migration declares -- migrate:allow-row-loss', async (t) => {
      const dir = makeTempDir(t);
      writeMigration(dir, '0001_prune.sql', '-- migrate:allow-row-loss\nDELETE FROM Thing WHERE id > 1;');
      const db = databaseWithRows();
      const result = await migrate(db, { ...quiet(), dir });
      assert.deepEqual(result.applied, ['0001_prune.sql']);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Thing').get().n, 1);
      assert.deepEqual(appliedVersions(db), [1]);
      db.close();
    });

    it('allows row loss for a JS migration that exports allowRowLoss', async (t) => {
      const dir = makeTempDir(t);
      writeMigration(
        dir,
        '0001_prune.js',
        "'use strict';\nmodule.exports = { allowRowLoss: true, up(db) { db.exec('DELETE FROM Thing'); } };\n"
      );
      const db = databaseWithRows();
      await migrate(db, { ...quiet(), dir });
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Thing').get().n, 0);
      db.close();
    });

    it('rolls back a foreign-keys-off migration that leaves a violation and re-enables foreign keys', async (t) => {
      const dir = makeTempDir(t);
      const db = openDatabase(':memory:');
      db.exec(`
        CREATE TABLE Parent (id INTEGER PRIMARY KEY);
        CREATE TABLE Child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES Parent(id));
        INSERT INTO Parent (id) VALUES (1);
        INSERT INTO Child (parent_id) VALUES (1);
      `);
      writeMigration(
        dir,
        '0001_orphan.sql',
        '-- migrate:foreign-keys-off\nINSERT INTO Child (parent_id) VALUES (999);'
      );
      await assert.rejects(migrate(db, { ...quiet(), dir }), /left 1 foreign key violation\(s\) and was rolled back/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Child').get().n, 1);
      assert.deepEqual(appliedVersions(db), []);
      assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
      assert.throws(() => db.prepare('INSERT INTO Child (parent_id) VALUES (999)').run(), /FOREIGN KEY/);
      db.close();
    });

    it('lets a foreign-keys-off migration rebuild a referenced table', async (t) => {
      const dir = makeTempDir(t);
      const db = openDatabase(':memory:');
      db.exec(`
        CREATE TABLE Parent (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE Child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES Parent(id));
        INSERT INTO Parent (id, name) VALUES (1, 'p');
        INSERT INTO Child (parent_id) VALUES (1);
      `);
      writeMigration(
        dir,
        '0001_rebuild.sql',
        [
          '-- migrate:foreign-keys-off',
          "CREATE TABLE Parent_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '');",
          'INSERT INTO Parent_new (id, name) SELECT id, name FROM Parent;',
          'DROP TABLE Parent;',
          'ALTER TABLE Parent_new RENAME TO Parent;',
        ].join('\n')
      );
      await migrate(db, { ...quiet(), dir });
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Parent').get().n, 1);
      assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
      db.close();
    });

    it('stops at the first failing migration and keeps the ones before it', async (t) => {
      const dir = makeTempDir(t);
      writeMigration(dir, '0001_ok.sql', 'CREATE TABLE Good (id INTEGER);');
      writeMigration(dir, '0002_broken.sql', 'CREATE TABLE ;');
      writeMigration(dir, '0003_never.sql', 'CREATE TABLE Never (id INTEGER);');
      const db = openDatabase(':memory:');
      await assert.rejects(migrate(db, { ...quiet(), dir }));
      assert.deepEqual(appliedVersions(db), [1]);
      assert.ok(tableNames(db).includes('Good'));
      assert.ok(!tableNames(db).includes('Never'));
      db.close();
    });
  });

  describe('listMigrations', () => {
    it('lists the real migrations in order with checksums', () => {
      const migrations = listMigrations();
      assert.deepEqual(
        migrations.map((m) => [m.version, m.name, m.type]),
        [
          [1, 'baseline', 'js'],
          [2, 'foreign_key_indexes', 'sql'],
        ]
      );
      for (const migration of migrations) assert.match(migration.checksum, /^[0-9a-f]{64}$/);
    });

    for (const badName of ['1_short.sql', '0003-dashes.sql', '0003_Upper.sql', '0003_has space.js', '0003.sql']) {
      it(`rejects a badly named migration file: "${badName}"`, (t) => {
        const dir = makeTempDir(t);
        writeMigration(dir, '0001_fine.sql', 'SELECT 1;');
        writeMigration(dir, badName, 'SELECT 1;');
        assert.throws(() => listMigrations(dir), /is not named NNNN_description/);
      });
    }

    it('rejects two migrations with the same version', (t) => {
      const dir = makeTempDir(t);
      writeMigration(dir, '0001_one.sql', 'SELECT 1;');
      writeMigration(dir, '0001_other.sql', 'SELECT 1;');
      assert.throws(() => listMigrations(dir), /Two migrations share version 0001/);
    });

    it('ignores files that are not migrations', (t) => {
      const dir = makeTempDir(t);
      writeMigration(dir, '0001_fine.sql', 'SELECT 1;');
      writeMigration(dir, 'README.md', '# notes');
      assert.equal(listMigrations(dir).length, 1);
    });

    it('rejects a JS migration without an up function', async (t) => {
      const dir = makeTempDir(t);
      writeMigration(dir, '0001_empty.js', "'use strict';\nmodule.exports = {};\n");
      const db = openDatabase(':memory:');
      await assert.rejects(migrate(db, { ...quiet(), dir }), /must export an up\(db\) function/);
      db.close();
    });
  });
});
