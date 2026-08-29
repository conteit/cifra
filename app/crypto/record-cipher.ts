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
 *  0       1     version         (currently 0x02)
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
 * data (AAD): the envelope version, the table name, the record's primary key,
 * and a caller-supplied, ordered list of **bound fields**. Without that binding
 * an attacker with write access to the IndexedDB file could move a valid blob
 * from one row to another — swapping the amount of one transaction onto
 * another, or replaying a deleted record — and the auth tag would still verify,
 * because GCM authenticates the payload and not where it was found. The AAD is
 * reconstructed at decryption time from the row being read, so a relocated blob
 * simply fails to authenticate.
 *
 * The bound fields exist because a record's *location* is not the only thing
 * that lives outside the ciphertext. A row also carries plaintext-indexed
 * columns — a transaction's `date` and `type` — that IndexedDB must be able to
 * range-query and that therefore cannot be encrypted. Before issue #51 those
 * columns sat outside the authenticated envelope: rewriting them directly in
 * the database produced a row that still decrypted cleanly, so a flipped `type`
 * silently moved money between the cash and electronic ledgers and a rewritten
 * `date` silently moved it between months. Binding them into the AAD makes such
 * a row fail authentication instead.
 *
 * This module still does not know the record schema. It is handed name/value
 * pairs and frames them; **which** columns are bound, in **which** order, and
 * how their values canonicalise is the db layer's allowlist decision
 * (`app/db/schema.ts`, `app/db/record-serialization.ts`).
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
 *
 * **Version 2 (issue #51)** added the bound-field section to the AAD. Version 1
 * bound only the table and the record id, so its AAD is a different byte string
 * and a v1 blob cannot authenticate under a v2 reader. That is exactly what the
 * version byte is for: a v1 envelope is rejected with
 * `envelope/unsupported-version` — a diagnosis — rather than with the
 * indistinguishable `decrypt/failed` a silent layout change would have produced.
 * No migration code ships with the bump because no vault exists to migrate:
 * Phase 1 shipped no user-facing write path (vault setup is #9, still open), so
 * the only v1 blobs that ever existed were written by tests. Doing this later,
 * against real vaults, would have meant a read-decrypt-re-encrypt pass over
 * every record while the user waits.
 */
export const RECORD_ENVELOPE_VERSION = 2;

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

/**
 * Largest accepted table name, record id, or bound field name/value, in UTF-8
 * bytes.
 */
export const MAX_CONTEXT_FIELD_BYTES = 512;

/**
 * Most bound fields one record may carry.
 *
 * A bound field is an *indexed* column, and IndexedDB indexes are a scarce,
 * hand-declared resource: a table with sixteen of them is a design error, not a
 * large record. The cap keeps AAD construction bounded no matter what a caller
 * passes, so a runaway list cannot be assembled into a multi-megabyte buffer on
 * the write path.
 */
export const MAX_BOUND_FIELDS = 16;

/**
 * One plaintext column authenticated alongside the record.
 *
 * The **name** is bound as well as the value, so renaming a column, or swapping
 * two columns' values, changes the AAD. `value` is the canonical string form
 * the db layer stores; this module neither parses nor normalises it.
 */
export interface BoundField {
  /** Column name, e.g. `date`. Non-empty. */
  readonly name: string;
  /** The column's stored value, canonicalised by the db layer. Non-empty. */
  readonly value: string;
}

/**
 * Where a record lives, and which of its plaintext columns are authenticated
 * with it. Bound into the ciphertext as AAD, so a blob only decrypts in the row
 * it was written to, with the column values it was written with.
 *
 * `recordId` is the record's primary key as a string. Cifra's records carry
 * client-generated string ids (Phase 8 sync needs stable, device-independent
 * keys), so the db layer always has this value before it writes.
 *
 * `boundFields` is **required, never optional**. An optional list would default
 * to "bind nothing", which is precisely the default that produced issue #51:
 * the safe choice has to be the one a caller cannot reach by omission. A table
 * with no bound columns passes an empty array and says so.
 */
export interface RecordContext {
  /** Dexie table name, e.g. `transactions`. */
  readonly table: string;
  /** Primary key of the row this payload belongs to. */
  readonly recordId: string;
  /**
   * Plaintext columns bound into the AAD, in the order the db layer's allowlist
   * declares them. The order is part of the encoding: the same fields supplied
   * in a different order produce a different AAD and will not authenticate, so
   * the db layer derives the order from the allowlist rather than from a call
   * site.
   */
  readonly boundFields: readonly BoundField[];
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
 * Encodes and validates the bound-field list, preserving the caller's order.
 *
 * @throws {RecordCipherError} with code `context/invalid`.
 */
function encodeBoundFields(
  boundFields: unknown,
): Array<[Uint8Array, Uint8Array]> {
  if (!Array.isArray(boundFields)) {
    throw new RecordCipherError(
      'context/invalid',
      'Record context boundFields must be an array; pass [] for a table with no bound columns',
    );
  }
  if (boundFields.length > MAX_BOUND_FIELDS) {
    throw new RecordCipherError(
      'context/invalid',
      `Record context must bind at most ${MAX_BOUND_FIELDS} fields`,
    );
  }

  const seen = new Set<string>();
  return boundFields.map((field, index) => {
    if (typeof field !== 'object' || field === null) {
      throw new RecordCipherError(
        'context/invalid',
        `Record context boundFields[${index}] must be an object with a name and a value`,
      );
    }
    const { name, value } = field as BoundField;
    const nameBytes = encodeContextField(name, `boundFields[${index}].name`);
    // A duplicate name would make the AAD ambiguous about which column carries
    // which value, and is always a db-layer bug — the allowlist derives the
    // list from a set of distinct column names.
    if (seen.has(name)) {
      throw new RecordCipherError(
        'context/invalid',
        `Record context binds the field '${name}' more than once`,
      );
    }
    seen.add(name);
    return [
      nameBytes,
      encodeContextField(value, `boundFields[${index}].value`),
    ];
  });
}

/**
 * Builds the AES-GCM additional authenticated data for a record.
 *
 * ## Layout
 *
 * ```
 *  version                                   1 byte
 *  u32be(len(table))    || table
 *  u32be(len(recordId)) || recordId
 *  u32be(count of bound fields)              4 bytes
 *  for each bound field, in order:
 *      u32be(len(name))  || name
 *      u32be(len(value)) || value
 * ```
 *
 * Every variable-length piece is preceded by its length as a big-endian uint32,
 * so the encoding is injective: `{table: 'ab', recordId: 'c'}` and
 * `{table: 'a', recordId: 'bc'}` produce different AAD, and so do
 * `{date: 'x', type: 'yz'}` and `{date: 'xy', type: 'z'}`. A plain
 * concatenation would collide, which would let a blob be moved between two rows
 * whose names, ids and column values happen to run together the same way.
 *
 * The count is framed too. Injectivity does not depend on it — the length
 * prefixes already carry the structure — but it authenticates the *arity* of
 * the bound list explicitly, so a future reader that binds fewer fields than
 * the writer did cannot be talked into believing it saw the whole list.
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
      'Record context must be an object with a table, a recordId and boundFields',
    );
  }
  const table = encodeContextField(context.table, 'table');
  const recordId = encodeContextField(context.recordId, 'recordId');
  const bound = encodeBoundFields(context.boundFields);

  let size = 1 + 4 + table.length + 4 + recordId.length + 4;
  for (const [name, value] of bound) {
    size += 4 + name.length + 4 + value.length;
  }

  const aad = new Uint8Array(new ArrayBuffer(size));
  const view = new DataView(aad.buffer);
  let offset = 0;

  const writeChunk = (bytes: Uint8Array): void => {
    view.setUint32(offset, bytes.length, false);
    offset += 4;
    aad.set(bytes, offset);
    offset += bytes.length;
  };

  aad[offset] = version;
  offset += 1;
  writeChunk(table);
  writeChunk(recordId);
  view.setUint32(offset, bound.length, false);
  offset += 4;
  for (const [name, value] of bound) {
    writeChunk(name);
    writeChunk(value);
  }
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
 * @param context the table, primary key and bound plaintext columns this
 * payload belongs to; bound into the ciphertext as AAD and required again,
 * unchanged and in the same order, to decrypt.
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
 * `context` must be the table, primary key and bound column values of the row
 * the blob was read from. Any mismatch — a different row, a different table, a
 * rewritten bound column, a different key, a flipped bit anywhere in the
 * ciphertext, the tag, or the IV — fails with
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
