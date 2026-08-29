/**
 * Turning a record's sensitive fields into bytes, and back.
 *
 * The contract handed over by #5 is explicit that this is the db layer's job:
 * `encryptRecord` / `decryptRecord` "take bytes, not objects … the crypto layer
 * deliberately does not know the record schema".
 *
 * ## Format
 *
 * A JSON object holding exactly the table's encrypted fields, in the order the
 * allowlist declares them, encoded as UTF-8. Nothing else — no table name, no
 * id, no version tag: the envelope from `encryptRecord` already carries a
 * version byte and binds the table and record id as AAD, so repeating them here
 * would be unauthenticated duplication of authenticated facts.
 *
 * ## Integer cents survive because nothing ever converts them
 *
 * CLAUDE.md: "Money is integer cents. No floats, anywhere, ever."
 *
 * `JSON.stringify(-123456)` is `"-123456"` and `JSON.parse("-123456")` is
 * exactly `-123456`. A JSON number literal with no fraction and no exponent
 * round-trips through IEEE-754 without loss for every value in the safe-integer
 * range, and this module performs no arithmetic on money at all — no division
 * by 100, no `toFixed`, no locale formatting. Parsing happens at the import
 * edge and formatting at the display edge; between them cents are only ever
 * copied.
 *
 * The guarantee is asserted rather than assumed: fields the allowlist marks
 * `cents` must satisfy `Number.isSafeInteger` on the way in *and* on the way
 * out. A float can therefore neither be written nor silently read back.
 *
 * Pure TypeScript. No Dexie, no React, no Web Crypto.
 */

import type { BoundField } from '../crypto/record-cipher';
import { DbEncryptionError } from './db-error';
import {
  aadBoundFieldNames,
  ENCRYPTED_BLOB_FIELD,
  type EncryptedTableSpec,
  type TableSpec,
} from './schema';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

/** Every field name a row of this table may carry, blob field excluded. */
export function allowedFields(spec: TableSpec): string[] {
  const fields = [spec.primaryKey, ...spec.indexes];
  if (spec.kind === 'encrypted') fields.push(...Object.keys(spec.encrypted));
  return fields;
}

/**
 * Rejects any property the table's allowlist does not name.
 *
 * This is the fail-closed half of the contract. Without it, a field added to a
 * row type without a matching allowlist entry would be dropped on write (data
 * loss) or, worse, passed through to IndexedDB in plaintext (a silent leak).
 * Both are failures a person notices months later; an exception is noticed on
 * the first run.
 *
 * @throws {DbEncryptionError} `record/unknown-field`.
 */
export function assertKnownFields(
  table: string,
  spec: TableSpec,
  value: Record<string, unknown>,
): void {
  const allowed = new Set(allowedFields(spec));
  for (const field of Object.keys(value)) {
    if (field === ENCRYPTED_BLOB_FIELD) {
      throw new DbEncryptionError(
        'record/unknown-field',
        `Record for table '${table}' carries the reserved field '${ENCRYPTED_BLOB_FIELD}'; the middleware owns that field`,
      );
    }
    if (!allowed.has(field)) {
      throw new DbEncryptionError(
        'record/unknown-field',
        `Field '${field}' is not in the allowlist for table '${table}'. Add it as plaintext-indexed or encrypted before writing it.`,
      );
    }
  }
}

/** The subset of a record that IndexedDB stores in the clear. */
export function plaintextProjection(
  spec: TableSpec,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const projection: Record<string, unknown> = {};
  for (const field of [spec.primaryKey, ...spec.indexes]) {
    if (Object.hasOwn(value, field) && value[field] !== undefined) {
      projection[field] = value[field];
    }
  }
  return projection;
}

/**
 * The plaintext columns bound into the record's AAD, in allowlist order.
 *
 * ## Canonicalisation: there is none, and that is the point
 *
 * A bound value is bound **exactly as IndexedDB stores it** — the same string,
 * byte for byte, on the write that seals the record and on the read that opens
 * it. Nothing is normalised, reformatted, lower-cased, parsed or re-serialized
 * on the way past. Canonicalisation is where a binding like this rots: a writer
 * that emits `2026-08-01` and a reader that emits `2026-8-1`, or a `Date` that
 * round-trips through a different timezone, produce different AAD and turn every
 * record in the vault into a decryption failure. The only encoding guaranteed
 * to agree with itself forever is the stored value itself.
 *
 * Which is why a bound column **must be a non-empty string**. A number would
 * need a decimal encoding, and every decimal encoding of a JavaScript number is
 * a judgement call that a later refactor can make differently (and, for money,
 * a float that CLAUDE.md forbids outright). So a non-string bound value is
 * rejected rather than stringified: a future numeric index has to decide on its
 * stored string form — `date` is already `YYYY-MM-DD` and `type` is already an
 * enum name — before it can be bound.
 *
 * Both the write path and the read path call this one function, so the values
 * and their order cannot diverge between them.
 *
 * @throws {DbEncryptionError} `record/invalid-bound-field`.
 */
export function aadBoundFields(
  table: string,
  spec: EncryptedTableSpec,
  source: Record<string, unknown>,
): BoundField[] {
  return aadBoundFieldNames(spec).map((name) => {
    const value = source[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new DbEncryptionError(
        'record/invalid-bound-field',
        `Field '${name}' on table '${table}' is authenticated with the record and must be a non-empty string`,
      );
    }
    return { name, value };
  });
}

function assertCents(table: string, field: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new DbEncryptionError(
      'record/invalid-cents',
      `Field '${field}' on table '${table}' must be an integer number of cents (a safe integer), never a float`,
    );
  }
}

/**
 * Serializes a record's sensitive fields to the bytes `encryptRecord` seals.
 *
 * ## Partial writes are rejected, not merged
 *
 * A required field that is absent fails with `record/missing-required-field`.
 * The blob is all-or-nothing, so the only alternatives would be to silently
 * drop the stored value (data loss on an innocent-looking `put`) or to
 * read-modify-write behind the caller's back — which would make encrypted
 * fields behave differently from the plaintext fields sitting in the same
 * object, where `put` already means "replace the whole record". Dexie's
 * `Table.update()` / `Collection.modify()` already provide a real
 * read-modify-write, and they route through `getMany` + a full-value `put`, so
 * partial *updates* remain fully supported through the API that means it.
 *
 * @throws {DbEncryptionError} `record/missing-required-field` or
 * `record/invalid-cents`.
 */
export function encodeSensitiveFields(
  table: string,
  spec: EncryptedTableSpec,
  value: Record<string, unknown>,
): Uint8Array {
  const payload: Record<string, unknown> = {};

  for (const [field, fieldSpec] of Object.entries(spec.encrypted)) {
    const present = Object.hasOwn(value, field) && value[field] !== undefined;
    if (!present) {
      if (fieldSpec.required) {
        throw new DbEncryptionError(
          'record/missing-required-field',
          `Record for table '${table}' omits required encrypted field '${field}'. Writes replace the whole record; use update()/modify() to change part of one.`,
        );
      }
      continue;
    }
    if (fieldSpec.cents) assertCents(table, field, value[field]);
    payload[field] = value[field];
  }

  return textEncoder.encode(JSON.stringify(payload));
}

/**
 * Parses the bytes `decryptRecord` returned back into fields.
 *
 * The bytes are already authenticated by AES-GCM at this point, so a failure
 * here means a format problem — an older writer, a truncated migration — not an
 * attacker. It is still surfaced as `record/corrupt` rather than tolerated: a
 * half-understood record is exactly what must not reach a balance.
 *
 * @throws {DbEncryptionError} `record/corrupt` or `record/invalid-cents`.
 */
export function decodeSensitiveFields(
  table: string,
  spec: EncryptedTableSpec,
  bytes: Uint8Array,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(bytes));
  } catch (cause) {
    throw new DbEncryptionError(
      'record/corrupt',
      `Decrypted payload for table '${table}' is not valid UTF-8 JSON`,
      cause,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DbEncryptionError(
      'record/corrupt',
      `Decrypted payload for table '${table}' is not a JSON object`,
    );
  }

  const source = parsed as Record<string, unknown>;
  for (const field of Object.keys(source)) {
    if (!Object.hasOwn(spec.encrypted, field)) {
      throw new DbEncryptionError(
        'record/corrupt',
        `Decrypted payload for table '${table}' carries field '${field}', which the allowlist does not name`,
      );
    }
  }

  const fields: Record<string, unknown> = {};
  for (const [field, fieldSpec] of Object.entries(spec.encrypted)) {
    if (!Object.hasOwn(source, field)) {
      if (fieldSpec.required) {
        throw new DbEncryptionError(
          'record/corrupt',
          `Decrypted payload for table '${table}' omits required field '${field}'`,
        );
      }
      continue;
    }
    if (fieldSpec.cents) assertCents(table, field, source[field]);
    fields[field] = source[field];
  }
  return fields;
}
