/**
 * Typed failures for the encrypted db layer.
 *
 * Every code here is a *machine-readable* reason. There are deliberately no
 * user-facing strings and no i18n keys in this layer: the db layer has no view,
 * and copy for the two codes a user can actually provoke (`vault/locked` and
 * `record/corrupt`) belongs to the lock screen (#10) and the vault setup flow
 * (#9), which own their own EN/IT keys. Adding strings here would put the same
 * message in two places and make the parity test guard the wrong file.
 *
 * Messages describe the *shape* of the problem and name fields, never values.
 * The plaintext-leak guarantee has to hold for logs and stack traces too, so an
 * amount, a description or a note must never reach an error message.
 *
 * This mirrors the taxonomy the crypto layer already uses (`KdfError`,
 * `KeyWrapError`, `RecordCipherError`). Issue #33 tracks unifying the three
 * crypto classes; this is a fourth sibling in the same style rather than a
 * pre-emptive merge, so that #33 can decide once for all of them.
 */

/** Machine-readable reason a db-layer operation was rejected. */
export type DbEncryptionErrorCode =
  /** No data key is held: the vault is locked (or was never unlocked). */
  | 'vault/locked'
  /** A key was offered to the holder that is not a usable vault data key. */
  | 'vault/invalid-key'
  /** The allowlist itself is malformed — a construction-time programming error. */
  | 'schema/invalid-allowlist'
  /** The database declares a table the allowlist does not cover. Fail closed. */
  | 'schema/unknown-table'
  /** A field is declared both indexed and encrypted, or an index is missing. */
  | 'schema/index-conflict'
  /** An encrypted table's primary key is not an inbound, non-auto string key. */
  | 'schema/invalid-primary-key'
  /** A written value is not a plain object at all. */
  | 'record/invalid-value'
  /** A written record carries a field the table's allowlist does not name. */
  | 'record/unknown-field'
  /** A written record omits an encrypted field the allowlist marks required. */
  | 'record/missing-required-field'
  /** A record's primary key is absent or not a string at write time. */
  | 'record/invalid-primary-key'
  /** A money field is not a safe integer number of cents. */
  | 'record/invalid-cents'
  /** A stored row failed authentication or could not be parsed back. */
  | 'record/corrupt'
  /** A value-bearing cursor was opened on an encrypted table. */
  | 'read/cursor-unsupported';

/**
 * Error thrown for every rejected db-layer operation.
 *
 * `code` is the contract; `message` is for developers. Callers switch on `code`.
 */
export class DbEncryptionError extends Error {
  readonly code: DbEncryptionErrorCode;

  constructor(code: DbEncryptionErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DbEncryptionError';
    this.code = code;
  }
}
