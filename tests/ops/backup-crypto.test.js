'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  encryptFile,
  decryptFile,
  readKeyFile,
  createKeyFile,
  isEncryptedFile,
  HEADER_BYTES,
  TAG_BYTES,
} = require('../../src/db/backup-crypto');
const { makeTempDir } = require('../helpers/tmp');

const ROOT = path.resolve(__dirname, '..', '..');

function setup(t, size = 3 * 1024 * 1024 + 17) {
  const dir = makeTempDir(t);
  const plain = path.join(dir, 'plain.db');
  fs.writeFileSync(plain, crypto.randomBytes(size));
  const key = crypto.randomBytes(32);
  return { dir, plain, key };
}

function onlyFiles(dir) {
  return fs.readdirSync(dir).sort();
}

describe('backup encryption', () => {
  it('round-trips a multi-megabyte file and writes a header, ciphertext and tag', async (t) => {
    const { dir, plain, key } = setup(t);
    const enc = path.join(dir, 'x.db.enc');
    const result = await encryptFile(plain, enc, key);
    assert.equal(result.bytes, fs.statSync(plain).size + HEADER_BYTES + TAG_BYTES);
    assert.ok(isEncryptedFile(enc));
    assert.ok(!fs.readFileSync(enc).includes(fs.readFileSync(plain).subarray(0, 64)));

    const out = path.join(dir, 'out.db');
    const decrypted = await decryptFile(enc, out, key);
    assert.ok(fs.readFileSync(out).equals(fs.readFileSync(plain)));
    assert.equal(decrypted.sha256, result.plainSha256);
  });

  it('uses a fresh nonce for every file', async (t) => {
    const { dir, plain, key } = setup(t, 1000);
    await encryptFile(plain, path.join(dir, 'a.enc'), key);
    await encryptFile(plain, path.join(dir, 'b.enc'), key);
    const a = fs.readFileSync(path.join(dir, 'a.enc'));
    const b = fs.readFileSync(path.join(dir, 'b.enc'));
    assert.notDeepEqual(a.subarray(HEADER_BYTES - 12, HEADER_BYTES), b.subarray(HEADER_BYTES - 12, HEADER_BYTES));
    assert.notDeepEqual(a, b);
  });

  it('round-trips an empty file', async (t) => {
    const { dir, key } = setup(t, 0);
    const plain = path.join(dir, 'empty');
    fs.writeFileSync(plain, '');
    await encryptFile(plain, path.join(dir, 'e.enc'), key);
    await decryptFile(path.join(dir, 'e.enc'), path.join(dir, 'e.out'), key);
    assert.equal(fs.statSync(path.join(dir, 'e.out')).size, 0);
  });

  const failures = [
    {
      title: 'a wrong key',
      mutate: () => {},
      key: () => crypto.randomBytes(32),
      message: /different key/,
    },
    {
      title: 'a flipped byte in the ciphertext',
      mutate: (file) => {
        const data = fs.readFileSync(file);
        data[HEADER_BYTES + 1000] ^= 0x01;
        fs.writeFileSync(file, data);
      },
      message: /failed authentication/,
    },
    {
      title: 'a flipped byte in the nonce',
      mutate: (file) => {
        const data = fs.readFileSync(file);
        data[HEADER_BYTES - 1] ^= 0x80;
        fs.writeFileSync(file, data);
      },
      message: /failed authentication/,
    },
    {
      title: 'a truncated file',
      mutate: (file) => fs.truncateSync(file, fs.statSync(file).size - 100),
      message: /failed authentication/,
    },
    {
      title: 'a file cut down to less than a header',
      mutate: (file) => fs.truncateSync(file, 10),
      message: /too short/,
    },
    {
      title: 'a file that is not an encrypted backup',
      mutate: (file) => fs.writeFileSync(file, Buffer.alloc(200, 7)),
      message: /not an Employer Relations CRM encrypted backup/,
    },
  ];

  for (const failure of failures) {
    it(`fails loudly on ${failure.title} and leaves no output behind`, async (t) => {
      const { dir, plain, key } = setup(t);
      const enc = path.join(dir, 'x.db.enc');
      await encryptFile(plain, enc, key);
      failure.mutate(enc);
      const before = onlyFiles(dir);
      const out = path.join(dir, 'restored.db');
      await assert.rejects(decryptFile(enc, out, failure.key ? failure.key() : key), failure.message);
      assert.equal(fs.existsSync(out), false);
      assert.deepEqual(onlyFiles(dir), before);
    });
  }

  it('never overwrites an existing output file', async (t) => {
    const { dir, plain, key } = setup(t, 100);
    const enc = path.join(dir, 'x.enc');
    await encryptFile(plain, enc, key);
    await assert.rejects(encryptFile(plain, enc, key), /already exists/);
    fs.writeFileSync(path.join(dir, 'taken'), 'keep me');
    await assert.rejects(decryptFile(enc, path.join(dir, 'taken'), key), /already exists/);
    assert.equal(fs.readFileSync(path.join(dir, 'taken'), 'utf8'), 'keep me');
  });
});

describe('backup key files', () => {
  it('generate-backup-key.js creates a 0600 key and refuses to overwrite it', (t) => {
    const dir = makeTempDir(t);
    const file = path.join(dir, 'keys', 'backup.key');
    const script = path.join(ROOT, 'scripts', 'ops', 'generate-backup-key.js');
    const first = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const key = readKeyFile(file);
    assert.equal(key.length, 32);
    assert.ok(!first.stdout.includes(key.toString('base64')), 'the key is never printed');

    const second = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists/);
    assert.ok(readKeyFile(file).equals(key));
  });

  it('rejects a key file readable by everyone or with the wrong length', (t) => {
    const dir = makeTempDir(t);
    const file = createKeyFile(path.join(dir, 'k')).path;
    fs.chmodSync(file, 0o644);
    assert.throws(() => readKeyFile(file), /every user/);
    const short = path.join(dir, 'short');
    fs.writeFileSync(short, crypto.randomBytes(16).toString('base64'), { mode: 0o600 });
    assert.throws(() => readKeyFile(short), /32-byte key/);
    assert.throws(() => readKeyFile(path.join(dir, 'missing')), /Cannot read/);
  });
});
