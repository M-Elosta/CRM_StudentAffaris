#!/usr/bin/env node
'use strict';

/**
 * Small checks used by deploy/deploy.sh. Not meant to be run by hand.
 *
 *   deploy-helper.js engines <package.json>     exit 1 unless this Node.js satisfies engines.node
 *   deploy-helper.js version <package.json>     print the package version
 *   deploy-helper.js db-version                 print the database's migration version ("none" if no database)
 *   deploy-helper.js wait-healthy <seconds>     poll /healthz until it answers 200 (exit 1 on timeout)
 *   deploy-helper.js last-backup                print the file recorded in BACKUP_DIR/last-success.json
 *   deploy-helper.js health-url                 print the health URL from HOST and PORT
 *
 * Dependencies are loaded per command, so `engines` and `version` work
 * before `npm ci` has run.
 */

const fs = require('node:fs');
const path = require('node:path');

function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(String(text).trim());
  if (!match) throw new Error(`Cannot read the version "${text}"`);
  const part = (value) => (value === undefined || value === 'x' || value === '*' ? null : Number(value));
  return [Number(match[1]), part(match[2]), part(match[3])];
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** Minimal semver range check: comparators (>=, >, <=, <, =), ^, ~, x-ranges, || alternatives. */
function satisfies(version, range) {
  const v = parseVersion(version);
  return range.split('||').some((set) =>
    set
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((comparator) => {
        const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comparator);
        const op = match[1] || '';
        const target = parseVersion(match[2]);
        const filled = target.map((n) => n ?? 0);
        const c = compare(v, filled);
        if (op === '>=') return c >= 0;
        if (op === '>') return c > 0;
        if (op === '<=') return c <= 0;
        if (op === '<') return c < 0;
        if (op === '^') return c >= 0 && v[0] === filled[0] && (filled[0] !== 0 || v[1] === filled[1]);
        if (op === '~') return c >= 0 && v[0] === filled[0] && (target[1] === null || v[1] === filled[1]);
        // "=" or bare version, possibly with x-ranges
        return target.every((n, i) => n === null || n === v[i]);
      })
  );
}

function readPackage(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case 'engines': {
      const range = readPackage(arg).engines?.node;
      if (!range) return console.log(`No engines.node in ${arg}; continuing.`);
      if (!satisfies(process.versions.node, range)) {
        console.error(`This release needs Node.js ${range}, but ${process.versions.node} is installed.`);
        process.exit(1);
      }
      return console.log(`Node.js ${process.versions.node} satisfies ${range}.`);
    }
    case 'version':
      return console.log(readPackage(arg).version);
    case 'db-version': {
      const { loadConfig } = require('../../src/config');
      const config = loadConfig();
      if (config.databasePath === ':memory:' || !fs.existsSync(config.databasePath)) return console.log('none');
      const Database = require('better-sqlite3');
      const { migrationVersion } = require('./lib/common');
      const db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
      try {
        return console.log(String(migrationVersion(db)));
      } finally {
        db.close();
      }
    }
    case 'health-url': {
      const { loadConfig } = require('../../src/config');
      const { healthUrl } = require('./lib/common');
      return console.log(healthUrl(loadConfig()));
    }
    case 'wait-healthy': {
      const { loadConfig } = require('../../src/config');
      const { healthUrl, checkHealth } = require('./lib/common');
      const url = healthUrl(loadConfig());
      const deadline = Date.now() + Number(arg || 60) * 1000;
      let last;
      while (Date.now() < deadline) {
        last = await checkHealth(url, 3000);
        if (last.ok) return console.log(`${url} answered 200.`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      console.error(`${url} did not answer 200 within ${arg || 60} s (last result: ${last?.status || last?.error}).`);
      process.exit(1);
      break;
    }
    case 'last-backup': {
      const { loadConfig } = require('../../src/config');
      const record = JSON.parse(fs.readFileSync(path.join(loadConfig().backupDir, 'last-success.json'), 'utf8'));
      return console.log(record.file);
    }
    default:
      console.error('Usage: deploy-helper.js engines|version|db-version|wait-healthy|last-backup|health-url [arg]');
      process.exit(2);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { satisfies };
