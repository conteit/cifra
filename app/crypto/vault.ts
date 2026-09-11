/**
 * The vault lifecycle — create, unlock, change the password, rotate the
 * recovery phrase.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy step 3) and D26.
 * This is the **one entry point** each of those operations has. `kdf.ts`,
 * `key-wrap.ts` and `recovery-phrase.ts` are primitives; composing them in the
 * wrong order mints a vault that cannot be opened, so nothing above this layer
 * should ever compose them itself.
 *
 * ## The two wrapped copies
 *
 * ```
 *   master password ──Argon2id(kdfSalt, kdfParams)──► master key ──┐
 *                                                                  ├─AES-KW─► data key
 *   recovery phrase ──HKDF-SHA-256(recoverySalt)──► recovery key ──┘
 * ```
 *
 * One randomly generated, non-extractable data key; **two independent
 * key-encryption keys**, each wrapping its own 40-byte copy of it. Both copies
 * live in the plaintext `meta` row, as {@link VaultRecord}. That is why:
 *
 * - **a forgotten master password is not data loss** — the recovery copy opens
 *   the same data key, and no record is re-encrypted;
 * - **changing the password does not invalidate the recovery phrase**, and
 *   rotating the recovery phrase does not touch the password copy: each
 *   operation rewrites exactly one of the two copies;
 * - **losing both is unrecoverable**, and nothing in this module can soften
 *   that. There is no third copy, no escrow, and no server-side anything —
 *   which is the whole privacy claim (FOUN-01..03).
 *
 * ## What this module does not do
 *
 * It **persists nothing**. `createVault` hands back a `VaultRecord`; writing it
 * to the `meta` table (as one atomic row) is the caller's job, and #9 owns that
 * write. A record whose password copy and recovery copy come from different
 * calls is an unopenable vault, so they are created together and returned
 * together, never as separate steps a caller could interleave.
 *
 * It also never sees the phrase again after creation: `createVault` returns it
 * exactly once, and **there is no getter that reads a phrase back out of a
 * vault**. A user who has lost the phrase can only unlock and rotate to a new
 * one ({@link regenerateRecoveryPhrase}).
 *
 * Pure TypeScript. Per the layer contract it imports neither React nor Dexie.
 */

import {
  ARGON2ID_DEFAULT_PARAMS,
  type Argon2idParams,
  assertArgon2idParams,
  type DeriveMasterKeyOptions,
  deriveMasterKey,
  generateSalt,
  KdfError,
  SALT_LENGTH_BYTES,
} from './kdf';
import {
  createWrappedDataKey,
  KeyWrapError,
  rewrapDataKey,
  unwrapDataKey,
  WRAPPED_DATA_KEY_LENGTH_BYTES,
} from './key-wrap';
import {
  deriveRecoveryKey,
  generateRecoveryPhrase,
  generateRecoverySalt,
  RECOVERY_SALT_LENGTH_BYTES,
  RecoveryPhraseError,
} from './recovery-phrase';

/**
 * Version of the {@link VaultRecord} shape.
 *
 * It exists so that the fields below are a *closed, ordered* set rather than an
 * open bag: #32 will authenticate the `meta` row by MACing a canonical encoding
 * of exactly these fields, and a canonical encoding needs to know when the field
 * list changed. Adding, removing or re-typing a field means bumping this
 * constant in the same change.
 */
export const VAULT_RECORD_VERSION = 1;

/**
 * Everything the plaintext `meta` row must hold for a vault to be openable.
 *
 * None of it is secret: it is a salt, public cost parameters, and two AES-KW
 * blobs that are useless without a secret the user holds. All of it is
 * **untrusted on read** — the row is plaintext and, until #32, unauthenticated —
 * so every field is validated by {@link assertVaultRecord} before it reaches
 * Web Crypto, and the Argon2id parameters additionally go through D19's bounds.
 *
 * Every field is structured-cloneable, so the record stores into IndexedDB as
 * it stands.
 */
export interface VaultRecord {
  /** {@link VAULT_RECORD_VERSION} at the time the record was written. */
  readonly version: number;
  /** Per-vault Argon2id salt for the master-password path (§Decisions V1-2). */
  readonly kdfSalt: Uint8Array;
  /** Argon2id parameters this vault's master key was derived with. */
  readonly kdfParams: Argon2idParams;
  /** The data key wrapped under the master key. 40 bytes (RFC 3394). */
  readonly wrappedDataKey: Uint8Array;
  /** Per-vault HKDF salt for the recovery path. */
  readonly recoverySalt: Uint8Array;
  /** The same data key wrapped under the recovery key. 40 bytes. */
  readonly recoveryWrappedDataKey: Uint8Array;
}

/** Which secret an operation was asked to open the vault with. */
export type VaultUnlockMethod = 'password' | 'recovery-phrase';

/**
 * The secret a caller is offering. A discriminated union rather than two
 * functions so that an unlock screen with two tabs has one call site and cannot
 * accidentally route a phrase into the password path.
 */
export type VaultSecret =
  | { readonly kind: 'password'; readonly password: string }
  | { readonly kind: 'recovery-phrase'; readonly phrase: string };

/**
 * Why an operation did not open the vault. Every one of these is a condition
 * the *user* can act on, which is exactly what separates them from the thrown
 * errors below.
 *
 * - `secret/rejected` — the secret is well-formed but does not open this vault.
 *   Deliberately one code for both methods and for a tampered `meta` row: AES-KW
 *   cannot tell them apart, and pretending otherwise would be a guess presented
 *   as a diagnosis.
 * - `phrase/malformed` — the input is not a recovery phrase at all (wrong
 *   length, a character outside the alphabet). Distinct from `secret/rejected`
 *   because "you mistyped it" and "that is not this vault's phrase" are
 *   different things to say to someone who has already lost their password, and
 *   because the phrase is the user's own input, so saying so reveals nothing.
 * - `password/malformed` — the password path's twin of `phrase/malformed`: an
 *   empty password, or one past `MAX_PASSWORD_LENGTH`. The KDF refuses both
 *   before deriving anything (#91). Reported as a rejection because "type a
 *   password" is something the user can act on, and rendering it as an
 *   environment failure told them to reload the page instead.
 * - `record/invalid` — the `meta` row is not a usable vault record. Not the
 *   user's fault and not fixable by retyping; it means restore-from-backup.
 */
export type VaultRejection =
  | 'secret/rejected'
  | 'phrase/malformed'
  | 'password/malformed'
  | 'record/invalid';

/**
 * Whether a thrown error is the KDF refusing the *shape* of a password —
 * empty or over-long — as opposed to failing to run. The one predicate both
 * the unlock path here and the service's create path use, so the two cannot
 * disagree about which codes are the user's to fix.
 */
export function isPasswordInputError(error: unknown): error is KdfError {
  return (
    error instanceof KdfError &&
    (error.code === 'password/empty' || error.code === 'password/too-long')
  );
}

/** Machine-readable reason a vault call was rejected outright. */
export type VaultErrorCode = 'record/invalid';

/**
 * Error thrown for a structurally impossible vault record.
 *
 * Messages describe the shape of the problem only; they never contain key
 * material, wrapped bytes, a password or a recovery phrase.
 */
export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

/** Optional wiring shared by every operation that derives a master key. */
export type VaultOptions = DeriveMasterKeyOptions;

/**
 * A newly created vault. The three parts have three different lifetimes, and
 * the type is shaped so that is hard to miss:
 *
 * - `record` — **persist this**, as one atomic `meta` row.
 * - `dataKey` — session state. Hand it to the `VaultKeyHolder`; never store it.
 * - `recoveryPhrase` — **show it once**. It is not stored anywhere by this
 *   module and cannot be read back out of the vault afterwards, so a setup
 *   screen must not continue until the user confirms they have written it down
 *   (`recoveryPhrasesMatch` supports that step) and must make plain that losing
 *   both it and the password destroys the data.
 */
export interface CreatedVault {
  readonly record: VaultRecord;
  readonly dataKey: CryptoKey;
  readonly recoveryPhrase: string;
}

/** The vault opened, or a reason the caller can show a user. */
export type VaultUnlockResult =
  | {
      readonly ok: true;
      readonly method: VaultUnlockMethod;
      /** Non-extractable AES-256-GCM key. Session-scoped; never persisted. */
      readonly dataKey: CryptoKey;
    }
  | {
      readonly ok: false;
      readonly method: VaultUnlockMethod;
      readonly reason: VaultRejection;
      readonly message: string;
    };

/** A rewritten record, or a reason the caller can show a user. */
export type VaultRecordResult =
  | { readonly ok: true; readonly record: VaultRecord }
  | {
      readonly ok: false;
      readonly method: VaultUnlockMethod;
      readonly reason: VaultRejection;
      readonly message: string;
    };

/** A rotated recovery phrase with the record that now accepts it. */
export type VaultRecoveryResult =
  | {
      readonly ok: true;
      readonly record: VaultRecord;
      /** Shown once, exactly like {@link CreatedVault.recoveryPhrase}. */
      readonly recoveryPhrase: string;
    }
  | {
      readonly ok: false;
      readonly method: VaultUnlockMethod;
      readonly reason: VaultRejection;
      readonly message: string;
    };

function assertBytes(
  value: unknown,
  length: number,
  field: string,
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new VaultError(
      'record/invalid',
      `Vault record field '${field}' must be exactly ${length} bytes`,
    );
  }
}

/**
 * Validates a `meta` row before any of it reaches Web Crypto or Argon2id.
 *
 * The row is plaintext and unauthenticated (#32), so this is an untrusted-input
 * gate, not a type assertion for convenience. It runs *before* derivation on
 * every path, which is what keeps D19's cost ceiling a denial-of-service
 * defence: a hostile row costs microseconds, not a 64 MiB allocation.
 *
 * @throws {VaultError} `record/invalid`, or {@link KdfError} `params/invalid`
 * for parameters outside D19's bounds.
 */
export function assertVaultRecord(
  record: unknown,
): asserts record is VaultRecord {
  if (typeof record !== 'object' || record === null) {
    throw new VaultError('record/invalid', 'Vault record must be an object');
  }
  const candidate = record as Record<keyof VaultRecord, unknown>;
  if (candidate.version !== VAULT_RECORD_VERSION) {
    throw new VaultError(
      'record/invalid',
      `Vault record version must be ${VAULT_RECORD_VERSION}`,
    );
  }
  assertBytes(candidate.kdfSalt, SALT_LENGTH_BYTES, 'kdfSalt');
  assertBytes(
    candidate.wrappedDataKey,
    WRAPPED_DATA_KEY_LENGTH_BYTES,
    'wrappedDataKey',
  );
  assertBytes(
    candidate.recoverySalt,
    RECOVERY_SALT_LENGTH_BYTES,
    'recoverySalt',
  );
  assertBytes(
    candidate.recoveryWrappedDataKey,
    WRAPPED_DATA_KEY_LENGTH_BYTES,
    'recoveryWrappedDataKey',
  );
  assertArgon2idParams(candidate.kdfParams);
}

function methodOf(secret: VaultSecret): VaultUnlockMethod {
  return secret.kind === 'password' ? 'password' : 'recovery-phrase';
}

function rejected(
  method: VaultUnlockMethod,
  reason: VaultRejection,
  message: string,
): {
  ok: false;
  method: VaultUnlockMethod;
  reason: VaultRejection;
  message: string;
} {
  return { ok: false, method, reason, message };
}

/** The vault opened under one secret, with the material every caller needs. */
interface OpenedVault {
  readonly method: VaultUnlockMethod;
  /** The key-encryption key the secret produced. AES-KW, non-extractable. */
  readonly keyEncryptionKey: CryptoKey;
  /** The copy of the wrapped data key that this secret opens. */
  readonly wrappedDataKey: Uint8Array;
  /** The data key itself, non-extractable. */
  readonly dataKey: CryptoKey;
}

type OpenAttempt =
  | { readonly ok: true; readonly opened: OpenedVault }
  | {
      readonly ok: false;
      readonly method: VaultUnlockMethod;
      readonly reason: VaultRejection;
      readonly message: string;
    };

/**
 * The single place a secret is turned into an open vault. Every public
 * operation goes through it, so "which copy does this secret open" is answered
 * once.
 *
 * Failures split in two, deliberately. Anything the user can retype comes back
 * as an `ok: false` result; anything else — no Web Crypto, no `Worker`, a
 * worker that died — **throws**, because it is not a wrong password and an
 * unlock screen that rendered it as one would send the user hunting for a
 * mistake they did not make.
 */
async function openVault(
  record: VaultRecord,
  secret: VaultSecret,
  options: VaultOptions,
): Promise<OpenAttempt> {
  const method = methodOf(secret);

  let keyEncryptionKey: CryptoKey;
  let wrappedDataKey: Uint8Array;
  if (secret.kind === 'password') {
    // The parameters come from the record — never from ARGON2ID_DEFAULT_PARAMS —
    // because they are what makes derivation reproducible for a vault created
    // under older defaults. They were bounded by `assertVaultRecord` above.
    try {
      keyEncryptionKey = await deriveMasterKey(
        secret.password,
        record.kdfSalt,
        record.kdfParams,
        options,
      );
    } catch (error) {
      if (isPasswordInputError(error)) {
        return rejected(method, 'password/malformed', error.message);
      }
      throw error;
    }
    wrappedDataKey = record.wrappedDataKey;
  } else {
    try {
      keyEncryptionKey = await deriveRecoveryKey(
        secret.phrase,
        record.recoverySalt,
      );
    } catch (error) {
      if (
        error instanceof RecoveryPhraseError &&
        error.code !== 'environment/no-web-crypto'
      ) {
        return rejected(method, 'phrase/malformed', error.message);
      }
      throw error;
    }
    wrappedDataKey = record.recoveryWrappedDataKey;
  }

  try {
    const dataKey = await unwrapDataKey(keyEncryptionKey, wrappedDataKey);
    return {
      ok: true,
      opened: { method, keyEncryptionKey, wrappedDataKey, dataKey },
    };
  } catch (error) {
    if (error instanceof KeyWrapError && error.code === 'unwrap/failed') {
      return rejected(
        method,
        'secret/rejected',
        'The secret offered does not open this vault',
      );
    }
    throw error;
  }
}

/**
 * Guards the public entry points: a malformed record is a *result*, not an
 * exception, because it arrives from storage rather than from a programmer.
 */
function checkRecord(
  record: unknown,
  method: VaultUnlockMethod,
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly method: VaultUnlockMethod;
      readonly reason: VaultRejection;
      readonly message: string;
    } {
  try {
    assertVaultRecord(record);
    return { ok: true };
  } catch (error) {
    if (error instanceof VaultError || error instanceof KdfError) {
      return rejected(method, 'record/invalid', error.message);
    }
    throw error;
  }
}

function freezeRecord(record: VaultRecord): VaultRecord {
  return Object.freeze({
    ...record,
    kdfParams: Object.freeze({ ...record.kdfParams }),
  });
}

/**
 * Creates a vault: one data key, wrapped twice, plus the phrase that opens the
 * second copy. **This is the only way to mint a vault.**
 *
 * Both wrapped copies are produced here, in one call, and returned in one
 * record — a caller cannot persist a vault that has a password copy and no
 * recovery copy, which is the failure mode this design exists to prevent.
 *
 * Derivation always uses {@link ARGON2ID_DEFAULT_PARAMS}. It never reads
 * parameters back from an existing record, and there is no parameter argument
 * to pass some in: creation is the one path where weak parameters would be a
 * real weakness rather than a failed unlock (D19), so the strength floor is
 * enforced against a constant this module chooses.
 *
 * Nothing is written anywhere. The caller persists `record` as one atomic `meta`
 * row, adopts `dataKey` into the session key holder, and shows `recoveryPhrase`
 * exactly once.
 *
 * @throws {KdfError} for an empty or absurdly long password, or a missing
 * `Worker` / Web Crypto implementation; {@link KeyWrapError} or
 * {@link RecoveryPhraseError} for a Web Crypto failure. No error carries key
 * material.
 */
export async function createVault(
  password: string,
  options: VaultOptions = {},
): Promise<CreatedVault> {
  const kdfSalt = generateSalt();
  const masterKey = await deriveMasterKey(
    password,
    kdfSalt,
    ARGON2ID_DEFAULT_PARAMS,
    options,
  );
  const { dataKey, wrappedDataKey } = await createWrappedDataKey(masterKey);

  const recoveryPhrase = generateRecoveryPhrase();
  const recoverySalt = generateRecoverySalt();
  const recoveryKey = await deriveRecoveryKey(recoveryPhrase, recoverySalt);
  const recoveryWrappedDataKey = await rewrapDataKey(
    masterKey,
    recoveryKey,
    wrappedDataKey,
  );

  return {
    record: freezeRecord({
      version: VAULT_RECORD_VERSION,
      kdfSalt,
      kdfParams: ARGON2ID_DEFAULT_PARAMS,
      wrappedDataKey,
      recoverySalt,
      recoveryWrappedDataKey,
    }),
    dataKey,
    recoveryPhrase,
  };
}

/**
 * Opens a vault with **either** secret. This is the only unlock entry point:
 * the two methods differ in which copy they unwrap, not in what the caller
 * does with the answer.
 *
 * The result is a discriminated union rather than a thrown error for every
 * outcome a user can act on — a wrong password, a mistyped phrase, an
 * unusable record. Environment failures still throw (see {@link openVault}).
 *
 * @throws {KdfError} for a missing `Worker` or Web Crypto implementation, or a
 * worker that failed; {@link KeyWrapError} for a Web Crypto failure that is not
 * a rejected secret.
 */
export async function unlockVault(
  record: VaultRecord,
  secret: VaultSecret,
  options: VaultOptions = {},
): Promise<VaultUnlockResult> {
  const method = methodOf(secret);
  const checked = checkRecord(record, method);
  if (!checked.ok) return checked;

  const attempt = await openVault(record, secret, options);
  if (!attempt.ok) return attempt;
  return { ok: true, method, dataKey: attempt.opened.dataKey };
}

/**
 * Changes the master password, leaving the recovery phrase working.
 *
 * Only the password copy is rewritten: a fresh salt, {@link
 * ARGON2ID_DEFAULT_PARAMS} again, and the same data key wrapped under the new
 * master key. `recoverySalt` and `recoveryWrappedDataKey` are carried across
 * untouched, so the phrase the user wrote down at setup still opens the vault —
 * which is the property the architecture asks for and the reason the two copies
 * are independent rather than chained.
 *
 * No record is re-encrypted, because the data key does not change.
 *
 * The current secret may be *either* the old password or the recovery phrase,
 * so "I forgot my password" can end in a new password rather than in a vault
 * that can only ever be opened by a piece of paper.
 *
 * The returned record replaces the stored one **atomically**: the new wrapped
 * key beside the old salt is an unopenable vault.
 */
export async function changeMasterPassword(
  record: VaultRecord,
  currentSecret: VaultSecret,
  nextPassword: string,
  options: VaultOptions = {},
): Promise<VaultRecordResult> {
  const method = methodOf(currentSecret);
  const checked = checkRecord(record, method);
  if (!checked.ok) return checked;

  const attempt = await openVault(record, currentSecret, options);
  if (!attempt.ok) return attempt;

  const kdfSalt = generateSalt();
  const nextMasterKey = await deriveMasterKey(
    nextPassword,
    kdfSalt,
    ARGON2ID_DEFAULT_PARAMS,
    options,
  );
  const wrappedDataKey = await rewrapDataKey(
    attempt.opened.keyEncryptionKey,
    nextMasterKey,
    attempt.opened.wrappedDataKey,
  );

  return {
    ok: true,
    record: freezeRecord({
      ...record,
      version: VAULT_RECORD_VERSION,
      kdfSalt,
      kdfParams: ARGON2ID_DEFAULT_PARAMS,
      wrappedDataKey,
    }),
  };
}

/**
 * Issues a new recovery phrase, leaving the master password working.
 *
 * The mirror image of {@link changeMasterPassword}: only the recovery copy is
 * rewritten, under a new phrase and a new HKDF salt. `kdfSalt`, `kdfParams` and
 * `wrappedDataKey` are carried across untouched.
 *
 * The old phrase stops working the moment the returned record is stored —
 * that is what makes this the answer to a phrase that was lost, photographed,
 * or written into a chat window. As at setup, the new phrase is returned
 * exactly once and cannot be read back afterwards.
 */
export async function regenerateRecoveryPhrase(
  record: VaultRecord,
  secret: VaultSecret,
  options: VaultOptions = {},
): Promise<VaultRecoveryResult> {
  const method = methodOf(secret);
  const checked = checkRecord(record, method);
  if (!checked.ok) return checked;

  const attempt = await openVault(record, secret, options);
  if (!attempt.ok) return attempt;

  const recoveryPhrase = generateRecoveryPhrase();
  const recoverySalt = generateRecoverySalt();
  const recoveryKey = await deriveRecoveryKey(recoveryPhrase, recoverySalt);
  const recoveryWrappedDataKey = await rewrapDataKey(
    attempt.opened.keyEncryptionKey,
    recoveryKey,
    attempt.opened.wrappedDataKey,
  );

  return {
    ok: true,
    record: freezeRecord({
      ...record,
      version: VAULT_RECORD_VERSION,
      recoverySalt,
      recoveryWrappedDataKey,
    }),
    recoveryPhrase,
  };
}
