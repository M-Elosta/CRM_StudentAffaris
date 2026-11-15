'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Create a temporary directory for one test and register its removal.
 * @param {import('node:test').TestContext} [t] when given, the directory is removed after the test
 */
function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ero-test-'));
  if (t) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

module.exports = { makeTempDir };
