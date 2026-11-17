'use strict';

/**
 * Encryption of backup files: AES-256-GCM, streamed, one random nonce per file.
 *
 * File layout (format version 1):
 *
 *   offset  size  content
 *   0       8     magic "EROCRMBK"
 *   8       1     format version (1)
 *   9       8     key id: first 8 bytes of SHA-256("ero-crm-backup-key-id\0" || key)
 *   17      12    nonce (random, never reused)
 *   29      n     ciphertext
 *   29+n    16    GCM authentication tag
 *
 * The 29-byte header is authenticated as additional data, so changing any
 * byte of the file (header, ciphertext or tag) makes decryption fail. The key
 * id is not secret; it only lets us say "this backup was made with a different
 * key" instead of the vaguer "authentication failed".
 *
 * GCM releases plaintext before it has checked the tag, so decryption always
 * writes to a temporary file and renames it into place only after the tag has
 * been verified. A failed decryption never leaves output behind.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('EROCRMBK', 'ascii');
const FORMAT_VERSION = 1;
const KEY_ID_BYTES = 8;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + KEY_ID_BYTES + NONCE_BYTES;
const KEY_BYTES = 32;
const ALGORITHM = 'aes-256-gcm';

class BackupCryptoError extends Error {}

function keyId(key) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from('ero-crm-backup-key-id\0', 'ascii'))
    .update(key)
    .digest()
    .subarray(0, KEY_ID_BYTES);
}

/** Random suffix for temporary files; never matches the backup file name pattern. */
function tempName(finalPath) {
  return `${finalPath}.partial-${crypto.randomBytes(6).toString('hex')}`;
}

function fsyncDir(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (_err) {
    // Some file systems (e.g. certain network shares) do not support fsync on a directory.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function removeQuietly(file) {
  try {
    fs.unlinkSync(file);
  } catch (_err) {
    // already gone
  }
}

/** Create a new random 32-byte key encoded as base64. */
function generateKey() {
  return crypto.randomBytes(KEY_BYTES).toString('base64');
}

/**
 * Create a key file with mode 0600. Refuses to overwrite an existing file:
 * replacing a key makes every backup made with the old key unreadable.
 */
function createKeyFile(file) {
  const target = path.resolve(file);
  if (fs.existsSync(target)) {
    throw new BackupCryptoError(
      `${target} already exists. It was not changed: replacing a backup key makes every backup made with it unreadable.`
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const key = generateKey();
  const fd = fs.openSync(target, 'wx', 0o600);
  try {
    fs.writeSync(fd, `${key}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(target, 0o600);
  fsyncDir(path.dirname(target));
  return { path: target, keyId: keyId(Buffer.from(key, 'base64')).toString('hex') };
}

/**
 * Read a base64 key file and return the 32-byte key.
 * The file must not be readable by every user on the system.
 */
function readKeyFile(file) {
  const target = path.resolve(file);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (err) {
    throw new BackupCryptoError(`Cannot read the backup key file ${target}: ${err.code || err.message}`);
  }
  if (!stat.isFile()) throw new BackupCryptoError(`The backup key file ${target} is not a regular file.`);
  if (stat.mode & 0o007) {
    throw new BackupCryptoError(
      `The backup key file ${target} can be read by every user on this system (mode ${(stat.mode & 0o777).toString(8)}). ` +
        `Restrict it with: chmod 0640 ${target}`
    );
  }
  let text;
  try {
    text = fs.readFileSync(target, 'utf8').trim();
  } catch (err) {
    throw new BackupCryptoError(`Cannot read the backup key file ${target}: ${err.code || err.message}`);
  }
  const key = Buffer.from(text, 'base64');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || key.length !== KEY_BYTES || key.toString('base64') !== text) {
    throw new BackupCryptoError(
      `The backup key file ${target} does not contain a 32-byte key in base64. ` +
        'Create a key with: node scripts/ops/generate-backup-key.js <path>'
    );
  }
  return key;
}

/** True when the file starts with the encrypted-backup magic string. */
function isEncryptedFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    return read === MAGIC.length && head.equals(MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Encrypt `source` into `destination`. The output is written to a temporary
 * file, flushed to disk and renamed into place, so `destination` either does
 * not exist or is complete.
 *
 * @returns {Promise<{path: string, bytes: number, sha256: string, plainBytes: number, plainSha256: string}>}
 */
async function encryptFile(source, destination, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new BackupCryptoError('The backup key must be 32 bytes');
  if (fs.existsSync(destination)) throw new BackupCryptoError(`${destination} already exists; it was not overwritten.`);

  const nonce = crypto.randomBytes(NONCE_BYTES);
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), keyId(key), nonce]);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(header);

  const outHash = crypto.createHash('sha256');
  const plainHash = crypto.createHash('sha256');
  let plainBytes = 0;
  let bytes = 0;
  const temp = tempName(destination);
  let handle;
  try {
    handle = await fs.promises.open(temp, 'wx', 0o640);
    const write = async (buffer) => {
      if (!buffer.length) return;
      outHash.update(buffer);
      bytes += buffer.length;
      await handle.write(buffer);
    };
    await write(header);
    for await (const chunk of fs.createReadStream(source, { highWaterMark: 1024 * 1024 })) {
      plainHash.update(chunk);
      plainBytes += chunk.length;
      await write(cipher.update(chunk));
    }
    await write(cipher.final());
    await write(cipher.getAuthTag());
    await handle.sync();
    await handle.close();
    handle = undefined;
    fs.renameSync(temp, destination);
    fsyncDir(path.dirname(destination));
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    removeQuietly(temp);
    throw err;
  }
  return {
    path: destination,
    bytes,
    sha256: outHash.digest('hex'),
    plainBytes,
    plainSha256: plainHash.digest('hex'),
  };
}

/** Read and check the header and tag of an encrypted file. */
function readEnvelope(source, key) {
  const fd = fs.openSync(source, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < HEADER_BYTES + TAG_BYTES) {
      throw new BackupCryptoError(`${source} is too short to be an encrypted backup (it may be truncated).`);
    }
    const header = Buffer.alloc(HEADER_BYTES);
    fs.readSync(fd, header, 0, HEADER_BYTES, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new BackupCryptoError(`${source} is not an Employer Relations CRM encrypted backup.`);
    }
    const version = header[MAGIC.length];
    if (version !== FORMAT_VERSION) {
      throw new BackupCryptoError(
        `${source} uses encrypted-backup format ${version}; this version of the tools reads format ${FORMAT_VERSION}.`
      );
    }
    const fileKeyId = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + KEY_ID_BYTES);
    const expectedKeyId = keyId(key);
    if (!fileKeyId.equals(expectedKeyId)) {
      throw new BackupCryptoError(
        `${source} was encrypted with a different key (key id ${fileKeyId.toString('hex')}; ` +
          `the configured key has id ${expectedKeyId.toString('hex')}). Use the key that was in place when the backup was made.`
      );
    }
    const nonce = header.subarray(MAGIC.length + 1 + KEY_ID_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    fs.readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES);
    return { size, header, nonce, tag };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Stream-decrypt `source`. With a destination, the plaintext is written to a
 * temporary file beside it and renamed into place only after the
 * authentication tag has been verified. Without one (null), the plaintext is
 * only hashed: used to verify a freshly encrypted file.
 *
 * @returns {Promise<{path: string|null, bytes: number, sha256: string}>}
 */
async function decryptFile(source, destination, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new BackupCryptoError('The backup key must be 32 bytes');
  if (destination && fs.existsSync(destination)) {
    throw new BackupCryptoError(`${destination} already exists; it was not overwritten.`);
  }
  const { size, header, nonce, tag } = readEnvelope(source, key);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const temp = destination ? tempName(destination) : null;
  let handle;
  try {
    if (temp) handle = await fs.promises.open(temp, 'wx', 0o600);
    const write = async (buffer) => {
      if (!buffer.length) return;
      hash.update(buffer);
      bytes += buffer.length;
      if (handle) await handle.write(buffer);
    };
    const end = size - TAG_BYTES - 1;
    if (end >= HEADER_BYTES) {
      for await (const chunk of fs.createReadStream(source, { start: HEADER_BYTES, end, highWaterMark: 1024 * 1024 })) {
        await write(decipher.update(chunk));
      }
    }
    try {
      await write(decipher.final());
    } catch (_err) {
      throw new BackupCryptoError(
        `${source} failed authentication: the file has been modified, damaged or truncated. Nothing was restored from it.`
      );
    }
    if (handle) {
      await handle.sync();
      await handle.close();
      handle = undefined;
      fs.renameSync(temp, destination);
      fsyncDir(path.dirname(destination));
    }
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    if (temp) removeQuietly(temp);
    throw err;
  }
  return { path: destination || null, bytes, sha256: hash.digest('hex') };
}

module.exports = {
  encryptFile,
  decryptFile,
  readKeyFile,
  createKeyFile,
  generateKey,
  isEncryptedFile,
  keyId,
  BackupCryptoError,
  HEADER_BYTES,
  TAG_BYTES,
  MAGIC,
};
