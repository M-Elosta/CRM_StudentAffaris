#!/usr/bin/env node
'use strict';

/**
 * Create a new backup encryption key file (32 random bytes, base64, mode 0600).
 *
 *   node scripts/ops/generate-backup-key.js /etc/ero-crm/backup.key
 *
 * Refuses to overwrite an existing file. The key itself is never printed.
 */

const { createKeyFile } = require('../../src/db/backup-crypto');

function main() {
  const target = process.argv[2];
  if (!target || target.startsWith('-')) {
    console.error('Usage: node scripts/ops/generate-backup-key.js <path-of-new-key-file>');
    process.exit(2);
  }
  try {
    const result = createKeyFile(target);
    console.log(`Created backup key ${result.path} (mode 0600, key id ${result.keyId}).`);
    console.log(
      'Store a copy of this file somewhere other than this server (for example the IT password vault). ' +
        'Without it, no backup can ever be restored.'
    );
  } catch (err) {
    console.error(`Key not created: ${err.message}`);
    process.exit(1);
  }
}

main();
