/**
 * Record payload encryption — step 4 of the vault key hierarchy.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy step 4): "the data
 * key encrypts record payloads with AES-256-GCM, a random 12-byte IV per record
 * stored alongside the ciphertext. The GCM auth tag provides tamper detection."
 * The §Table field allowlist requires everything sensitive to live in a
 * **single encrypted blob field** per record, which is what {@link encryptRecord}
 * returns.
 *
 * ## Envelope layout
 *
 * ```
 *  offset  size  field
 *  0       1     version         (currently 0x01)
 *  1       12    IV              (fresh CSPRNG bytes per call)
 *  13      n     ciphertext
 *  13+n    16    AES-GCM auth tag (appended by Web Crypto)
 * ```
 *
 * The blob is raw bytes, not base64 or JSON: IndexedDB stores `Uint8Array`
 * natively through the structured clone algorithm, so there is nothing to gain
 * from a text encoding and a third of the stored size to lose.
 *
 * ## Authenticated context
 *
 * Every record is bound to its location by AES-GCM additional authenticated
 * data (AAD): the envelope version, the table name, and the record's primary
 * key. Without that binding an attacker with write access to the IndexedDB file
 * could move a valid blob from one row to another — swapping the amount of one
 * transaction onto another, or replaying a deleted record — and the auth tag
 * would still verify, because GCM authenticates the payload and not where it
 * was found. The AAD is reconstructed at decryption time from the row being
 * read, so a relocated blob simply fails to authenticate.
 *
 * Pure TypeScript. Per the layer contract it imports neither React nor Dexie.
 * Serialization is deliberately *not* handled here: this module moves bytes, and
 * the db layer (issue #6) owns turning a record's sensitive fields into them.
 */

import { asPrivateBytes } from './bytes';
import { DATA_KEY_ALGORITHM_NAME, DATA_KEY_LENGTH_BITS } from './key-wrap';

/**
 * Envelope format version.
 *
 * One byte is cheap insurance. Re-encrypting a live vault to change format is
 * expensive and risky, so the format announces itself from the first record ever
 * written: a future migration can read a v1 blob, decrypt it, and re-emit v2
 * without guessing. The byte is covered by the AAD, so it cannot be edited to
 * steer a reader towards a weaker future format.
 */
export const RECORD_ENVELOPE_VERSION = 1;

/** IV length in bytes — 96 bits, the size AES-GCM is specified for. */
export const IV_LENGTH_BYTES = 12;

/** AES-GCM authentication tag length in bytes (128 bits, the Web Crypto default). */
export const GCM_TAG_LENGTH_BYTES = 16;

/** Bytes of envelope that precede the ciphertext: version byte plus IV. */
export const ENVELOPE_HEADER_LENGTH_BYTES = 1 + IV_LENGTH_BYTES;

/** Shortest structurally valid envelope: a header plus a tag, with no payload. */
export const MIN_ENVELOPE_LENGTH_BYTES =
  ENVELOPE_HEADER_LENGTH_BYTES + GCM_TAG_LENGTH_BYTES;

/**
 * Largest accepted record payload, in bytes. A record holds an amount, a
 * description, a category and notes; 16 MiB is orders of magnitude beyond that,
 * so exceeding it means a bug or hostile input, not a large transaction. AES-GCM
 * itself is safe far past this bound — the limit exists to stop a runaway buffer
 * being encrypted and written to the database.
 */
export const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;

/** Largest accepted table name or record id, in UTF-8 bytes. */
export const MAX_CONTEXT_FIELD_BYTES = 512;

/**
 * Where a record lives. Bound into the ciphertext as AAD, so a blob only
 * decrypts in the row it was written to.
 *
 * `recordId` is the record's primary key as a string. Cifra's records carry
 * client-generated string ids (Phase 8 sync needs stable, device-independent
 * keys), so the db layer always has this value before it writes.
 */
export interface RecordContext {
  /** Dexie table name, e.g. `transactions`. */
  readonly table: string;
  /** Primary key of the row this payload belongs to. */
  readonly recordId: string;
}

/** Machine-readable reason a record cipher call was rejected. */
export type RecordCipherErrorCode =
  | 'key/invalid'
  | 'plaintext/invalid'
  | 'plaintext/too-large'
  | 'context/invalid'
  | 'envelope/invalid'
  | 'envelope/too-short'
  | 'envelope/unsupported-version'
  | 'decrypt/failed'
  | 'environment/no-web-crypto';

/**
 * Error thrown for every rejected record cipher input.
 *
 * Messages describe the *shape* of the problem only. They never contain record
 * plaintext, ciphertext, IVs, or key material — the plaintext-leak guarantee has
 * to hold for logs and stack traces too, not just for the database.
 */
export class RecordCipherError extends Error {
  readonly code: RecordCipherErrorCode;

  constructor(code: RecordCipherErrorCode, message: string) {
    super(message);
    this.name = 'RecordCipherError';
    this.code = code;
  }
}

const textEncoder = new TextEncoder();

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new RecordCipherError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.subtle) is unavailable in this environment',
    );
  }
  return subtle;
}

/**
 * Asserts that `key` is a data key of the kind `createWrappedDataKey` mints:
 * non-extractable AES-256-GCM.
 *
 * Extractability is checked because a record must never be encrypted under a key
 * that page code could export. The wrapping layer never produces one; refusing
 * it here means a key smuggled in from elsewhere cannot quietly become the
 * vault's cipher key.
 *
 * @throws {RecordCipherError} with code `key/invalid`.
 */
function assertDataKey(
  key: unknown,
  usage: KeyUsage,
): asserts key is CryptoKey {
  const invalid = (reason: string) =>
    new RecordCipherError('key/invalid', `Data key ${reason}`);

  if (typeof CryptoKey !== 'undefined' ? !(key instanceof CryptoKey) : !key) {
    throw invalid('must be a CryptoKey');
  }
  const candidate = key as CryptoKey;
  if (candidate.algorithm?.name !== DATA_KEY_ALGORITHM_NAME) {
    throw invalid(`must use ${DATA_KEY_ALGORITHM_NAME}`);
  }
  if (
    (candidate.algorithm as AesKeyAlgorithm).length !== DATA_KEY_LENGTH_BITS
  ) {
    throw invalid(`must be ${DATA_KEY_LENGTH_BITS} bits`);
  }
  if (candidate.extractable) {
    throw invalid('must be non-extractable');
  }
  if (!candidate.usages?.includes(usage)) {
    throw invalid(`must carry usage '${usage}'`);
  }
}

function encodeContextField(value: unknown, field: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RecordCipherError(
      'context/invalid',
      `Record context ${field} must be a non-empty string`,
    );
  }
  const bytes = textEncoder.encode(value);
  if (bytes.length > MAX_CONTEXT_FIELD_BYTES) {
    throw new RecordCipherError(
      'context/invalid',
      `Record context ${field} must be at most ${MAX_CONTEXT_FIELD_BYTES} bytes`,
    );
  }
  return bytes;
}

/**
 * Builds the AES-GCM additional authenticated data for a record.
 *
 * Each variable-length field is preceded by its length as a big-endian uint32,
 * so the encoding is injective: `{table: 'ab', recordId: 'c'}` and
 * `{table: 'a', recordId: 'bc'}` produce different AAD. A plain concatenation
 * would collide, which would let a blob be moved between two rows whose names
 * and ids happen to run together the same way.
 *
 * @throws {RecordCipherError} with code `context/invalid`.
 */
function buildAdditionalData(
  version: number,
  context: RecordContext,
): Uint8Array<ArrayBuffer> {
  if (typeof context !== 'object' || context === null) {
    throw new RecordCipherError(
      'context/invalid',
      'Record context must be an object with a table and a recordId',
    );
  }
  const table = encodeContextField(context.table, 'table');
  const recordId = encodeContextField(context.recordId, 'recordId');

  const aad = new Uint8Array(
    new ArrayBuffer(1 + 4 + table.length + 4 + recordId.length),
  );
  const view = new DataView(aad.buffer);
  aad[0] = version;
  view.setUint32(1, table.length, false);
  aad.set(table, 5);
  view.setUint32(5 + table.length, recordId.length, false);
  aad.set(recordId, 9 + table.length);
  return aad;
}

/**
 * Encrypts a record payload into a single self-describing blob.
 *
 * A fresh 12-byte IV is drawn from `crypto.getRandomValues` on **every call**.
 * There is deliberately no parameter through which a caller could supply, pin,
 * or reuse an IV: IV reuse under one key destroys AES-GCM's confidentiality and
 * lets an attacker forge tags, so the only way to make that mistake impossible
 * is to leave no seat for it in the API.
 *
 * With random 96-bit IVs the collision probability stays negligible well past
 * any realistic vault size — NIST SP 800-38D bounds random-IV use at 2^32
 * invocations per key, which a personal finance database will not approach.
 *
 * @param dataKey non-extractable AES-256-GCM key from the wrapping layer.
 * @param plaintext the record's sensitive fields, already serialized to bytes by
 * the db layer.
 * @param context the table and primary key this payload belongs to; bound into
 * the ciphertext as AAD and required again, unchanged, to decrypt.
 * @returns the blob to store in the record's single encrypted field.
 * @throws {RecordCipherError} for an invalid key, a non-`Uint8Array` or
 * oversized plaintext, an invalid context, or a missing Web Crypto
 * implementation.
 */
export async function encryptRecord(
  dataKey: CryptoKey,
  plaintext: Uint8Array,
  context: RecordContext,
): Promise<Uint8Array<ArrayBuffer>> {
  const subtle = requireSubtleCrypto();
  assertDataKey(dataKey, 'encrypt');

  if (!(plaintext instanceof Uint8Array)) {
    throw new RecordCipherError(
      'plaintext/invalid',
      'Record plaintext must be a Uint8Array',
    );
  }
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new RecordCipherError(
      'plaintext/too-large',
      `Record plaintext must be at most ${MAX_PLAINTEXT_BYTES} bytes`,
    );
  }
  const additionalData = buildAdditionalData(RECORD_ENVELOPE_VERSION, context);

  if (!globalThis.crypto?.getRandomValues) {
    throw new RecordCipherError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.getRandomValues) is unavailable in this environment',
    );
  }
  const iv = new Uint8Array(new ArrayBuffer(IV_LENGTH_BYTES));
  globalThis.crypto.getRandomValues(iv);

  const sealed = new Uint8Array(
    await subtle.encrypt(
      { name: DATA_KEY_ALGORITHM_NAME, iv, additionalData },
      dataKey,
      asPrivateBytes(plaintext),
    ),
  );

  const envelope = new Uint8Array(
    new ArrayBuffer(ENVELOPE_HEADER_LENGTH_BYTES + sealed.length),
  );
  envelope[0] = RECORD_ENVELOPE_VERSION;
  envelope.set(iv, 1);
  envelope.set(sealed, ENVELOPE_HEADER_LENGTH_BYTES);
  return envelope;
}

/**
 * Decrypts a blob produced by {@link encryptRecord}.
 *
 * `context` must be the table and primary key of the row the blob was read
 * from. Any mismatch — a different row, a different table, a different key, a
 * flipped bit anywhere in the ciphertext, the tag, or the IV — fails with
 * `decrypt/failed` and no partial result. The single error code is intentional:
 * telling a caller *why* authentication failed leaks an oracle, and none of the
 * causes are separately actionable.
 *
 * @throws {RecordCipherError} for an invalid key, a malformed or truncated
 * envelope, an unrecognised version byte, an invalid context, a failed
 * authentication, or a missing Web Crypto implementation.
 */
export async function decryptRecord(
  dataKey: CryptoKey,
  envelope: Uint8Array,
  context: RecordContext,
): Promise<Uint8Array<ArrayBuffer>> {
  const subtle = requireSubtleCrypto();
  assertDataKey(dataKey, 'decrypt');

  if (!(envelope instanceof Uint8Array)) {
    throw new RecordCipherError(
      'envelope/invalid',
      'Encrypted record must be a Uint8Array',
    );
  }
  if (envelope.length < MIN_ENVELOPE_LENGTH_BYTES) {
    throw new RecordCipherError(
      'envelope/too-short',
      `Encrypted record must be at least ${MIN_ENVELOPE_LENGTH_BYTES} bytes`,
    );
  }
  const version = envelope[0];
  if (version !== RECORD_ENVELOPE_VERSION) {
    throw new RecordCipherError(
      'envelope/unsupported-version',
      `Unsupported encrypted record version ${version}`,
    );
  }
  const additionalData = buildAdditionalData(version, context);

  const bytes = asPrivateBytes(envelope);
  const iv = bytes.subarray(1, ENVELOPE_HEADER_LENGTH_BYTES);
  const sealed = bytes.subarray(ENVELOPE_HEADER_LENGTH_BYTES);

  try {
    return new Uint8Array(
      await subtle.decrypt(
        { name: DATA_KEY_ALGORITHM_NAME, iv, additionalData },
        dataKey,
        sealed,
      ),
    );
  } catch {
    // Web Crypto returns nothing on a failed tag check, so there is no partial
    // plaintext to leak here. The underlying error is not re-exposed: it carries
    // no useful detail and every cause maps to the same remedy.
    throw new RecordCipherError(
      'decrypt/failed',
      'Encrypted record failed authentication for this key and context',
    );
  }
}
