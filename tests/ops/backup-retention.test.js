'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { planRetention, applyRetention, parseBackupName } = require('../../src/db/backup-retention');
const { makeTempDir } = require('../helpers/tmp');

/** Backup file name for a UTC instant, e.g. name('2026-03-01T22:30:00Z'). */
function name(iso, label = 'nightly', ext = '.db.enc') {
  return `employer-${iso.replace(/:/g, '-').replace(/\.\d+Z$/, 'Z')}-${label}${ext}`;
}

/** One nightly backup per day at 01:30 Qatar time (22:30 UTC the day before), for `days` days ending on `lastUtcDay`. */
function nightly(lastUtcDay, days) {
  const end = Date.parse(`${lastUtcDay}T22:30:00Z`);
  return Array.from({ length: days }, (_, i) => name(new Date(end - i * 86400000).toISOString()));
}

const NOW = Date.parse('2026-11-17T06:00:00Z'); // 09:00 in Doha, Tuesday 17 November 2026

describe('backup retention plan', () => {
  const cases = [
    {
      title: 'an empty directory keeps and removes nothing',
      names: [],
      options: {},
      keep: 0,
      check: (plan) => assert.deepEqual(plan.remove, []),
    },
    {
      title: 'a single old backup is always kept, however old',
      names: [name('2020-01-01T00:00:00Z')],
      options: { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 },
      keep: 1,
      check: (plan) => assert.deepEqual(plan.keep[0].reasons, ['most recent']),
    },
    {
      title: 'daily: only the newest backup of each day is kept',
      names: [name('2026-11-16T05:00:00Z', 'manual'), name('2026-11-16T09:00:00Z', 'manual')],
      options: { keepDaily: 7, keepWeekly: 0, keepMonthly: 0 },
      keep: 1,
      check: (plan) => assert.deepEqual(plan.remove, [name('2026-11-16T05:00:00Z', 'manual')]),
    },
    {
      title: 'days are Qatar days: 21:30 UTC and 20:30 UTC on the same UTC date are different Doha days',
      names: [name('2026-11-15T20:30:00Z'), name('2026-11-15T21:30:00Z')],
      options: { keepDaily: 7, keepWeekly: 0, keepMonthly: 0 },
      keep: 2,
    },
    {
      title: 'daily keeps exactly keepDaily days of nightly backups',
      names: nightly('2026-11-16', 10),
      options: { keepDaily: 7, keepWeekly: 0, keepMonthly: 0 },
      keep: 7,
    },
    {
      title: 'weekly: ISO weeks start on Monday (Sunday 01:30 and Monday 01:30 Doha are in different weeks)',
      // Sunday 15 Nov 01:30 Doha = 14 Nov 22:30 UTC; Monday 16 Nov 01:30 Doha = 15 Nov 22:30 UTC.
      names: [name('2026-11-14T22:30:00Z'), name('2026-11-15T22:30:00Z')],
      options: { keepDaily: 0, keepWeekly: 4, keepMonthly: 0 },
      keep: 2,
    },
    {
      title: 'weekly: 60 nightly backups and 4 weeks keep the newest of each of 4 weeks',
      names: nightly('2026-11-16', 60),
      options: { keepDaily: 0, keepWeekly: 4, keepMonthly: 0 },
      keep: 4,
      check: (plan) => assert.ok(plan.keep.every((k) => k.reasons.some((r) => /weekly|most recent/.test(r)))),
    },
    {
      title: 'monthly: month boundary follows Qatar time (31 Oct 22:30 UTC is 1 Nov in Doha)',
      names: [name('2026-10-31T20:00:00Z'), name('2026-10-31T22:30:00Z')],
      options: { keepDaily: 0, keepWeekly: 0, keepMonthly: 12 },
      keep: 2,
    },
    {
      title: 'monthly: 400 nightly backups and 12 months keep 12 files',
      names: nightly('2026-11-16', 400),
      options: { keepDaily: 0, keepWeekly: 0, keepMonthly: 12 },
      keep: 12,
    },
    {
      title: 'defaults (7 daily, 4 weekly, 12 monthly) on 400 nightly backups',
      names: nightly('2026-11-16', 400),
      options: {},
      // Newest is Tue 17 Nov (Doha). Daily: 11-17 Nov. Weekly adds Sun 8 Nov and Sun 1 Nov (the two weeks
      // before the daily ones). Monthly adds the last day of each of the 11 earlier months.
      keep: 7 + 2 + 11,
    },
    {
      title: 'pre-change backups younger than keepPreChangeDays are kept in addition',
      names: [
        name('2026-11-16T22:30:00Z'),
        name('2026-11-16T10:00:00Z', 'pre-deploy'),
        name('2026-11-16T09:00:00Z', 'pre-migration-0004'),
        name('2026-10-01T09:00:00Z', 'pre-deploy'),
      ],
      options: { keepDaily: 1, keepWeekly: 0, keepMonthly: 0, keepPreChangeDays: 30 },
      keep: 3,
      check: (plan) => assert.deepEqual(plan.remove, [name('2026-10-01T09:00:00Z', 'pre-deploy')]),
    },
    {
      title: 'files that are not backups are ignored, never removed',
      names: [
        'last-success.json',
        'employer.db',
        'notes.txt',
        'employer-2026-11-16T22-30-00Z-x.db.enc.partial-abc123',
        name('2026-11-16T22:30:00Z'),
        'employer-2026-13-45T22-30-00Z-bad-date.db.enc',
      ],
      options: { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 },
      keep: 1,
      check: (plan) => {
        assert.equal(plan.ignored.length, 5);
        assert.deepEqual(plan.remove, []);
      },
    },
    {
      title: 'plain and encrypted backups are treated alike',
      names: [name('2026-11-16T22:30:00Z', 'nightly', '.db'), name('2026-11-15T22:30:00Z')],
      options: { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 },
      keep: 1,
      check: (plan) => assert.deepEqual(plan.remove, [name('2026-11-15T22:30:00Z')]),
    },
  ];

  for (const testCase of cases) {
    it(testCase.title, () => {
      const plan = planRetention(testCase.names, { now: NOW, ...testCase.options });
      assert.equal(plan.keep.length, testCase.keep, JSON.stringify(plan.keep.map((k) => k.name)));
      for (const removed of plan.remove) assert.ok(parseBackupName(removed), `${removed} is a backup name`);
      if (testCase.check) testCase.check(plan);
    });
  }

  it('always keeps the newest backup, whatever the order of the input', () => {
    const names = nightly('2026-11-16', 30).reverse();
    const plan = planRetention(names, { now: NOW, keepDaily: 0, keepWeekly: 0, keepMonthly: 0 });
    assert.deepEqual(
      plan.keep.map((k) => k.name),
      [name('2026-11-16T22:30:00Z')]
    );
  });
});

describe('applyRetention', () => {
  it('deletes only planned backup files and leaves everything else alone', (t) => {
    const dir = makeTempDir(t);
    const names = [...nightly('2026-11-16', 10), 'last-success.json', 'readme.txt'];
    for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
    fs.mkdirSync(path.join(dir, name('2026-01-01T00:00:00Z'))); // a directory with a backup-like name
    const result = applyRetention(dir, { now: NOW, keepDaily: 3, keepWeekly: 0, keepMonthly: 0 });
    assert.equal(result.removed.length, 7);
    const left = fs.readdirSync(dir).sort();
    assert.ok(left.includes('last-success.json'));
    assert.ok(left.includes('readme.txt'));
    assert.ok(left.includes(name('2026-01-01T00:00:00Z')));
    assert.equal(left.filter((n) => n.endsWith('.db.enc')).length, 4); // 3 files + the directory
  });
});
