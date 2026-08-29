/**
 * Data-key wrapping — step 3 of the vault key hierarchy.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy step 3): "the
 * master key wraps a randomly generated data key with AES-KW. The wrapped data
 * key, the salt, and the Argon2id parameters live in a plaintext `meta` table.
 * This allows password changes without re-encrypting the database, and leaves
 * room for additional unlock methods (Phase 8 device pairing)."
 *
 * The master key comes from `deriveMasterKey` (issue #4): a **non-extractable
 * `AES-KW` `CryptoKey` with usages `['wrapKey', 'unwrapKey']`**. That shape is
 * asserted here rather than assumed, so a mismatch fails loudly at the seam
 * instead of producing an unopenable vault.
 *
 * Pure TypeScript. Per the layer contract it imports neither React nor Dexie,
 * and it persists nothing: the caller owns the `meta` row, and the data key
 * itself lives only in the caller's module-scoped memory (§Session lifetime).
 */

import { asPrivateBytes } from './bytes';

/** Algorithm the data key is minted for — it only ever encrypts records. */
export const DATA_KEY_ALGORITHM_NAME = 'AES-GCM' as const;

/** Data-key size in bits. */
export const DATA_KEY_LENGTH_BITS = 256;

/** Algorithm the master key wraps with. */
export const MASTER_KEY_ALGORITHM_NAME = 'AES-KW' as const;

/** Master-key size in bits, as produced by `deriveMasterKey`. */
export const MASTER_KEY_LENGTH_BITS = 256;

/**
 * Size of a wrapped data key: RFC 3394 AES-KW adds one 8-byte block of
 * integrity padding to the 32-byte key, so the blob is always 40 bytes.
 */
export const WRAPPED_DATA_KEY_LENGTH_BYTES = 40;

/** Machine-readable reason a wrapping call was rejected. */
export type KeyWrapErrorCode =
  | 'master-key/invalid'
  | 'wrapped-key/invalid'
  | 'wrapped-key/invalid-length'
  | 'unwrap/failed'
  | 'environment/no-web-crypto';

/**
 * Error thrown for every rejected wrapping input.
 *
 * Messages describe the *shape* of the problem only. They never contain key
 * material, wrapped bytes, or record plaintext.
 */
export class KeyWrapError extends Error {
  readonly code: KeyWrapErrorCode;

  constructor(code: KeyWrapErrorCode, message: string) {
    super(message);
    this.name = 'KeyWrapError';
    this.code = code;
  }
}

/** A freshly minted data key together with the blob that belongs in `meta`. */
export interface WrappedDataKey {
  /** Non-extractable AES-256-GCM key. Session-scoped; never persisted. */
  readonly dataKey: CryptoKey;
  /** 40-byte AES-KW blob to store in the plaintext `meta` table. */
  readonly wrappedDataKey: Uint8Array<ArrayBuffer>;
}

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new KeyWrapError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.subtle) is unavailable in this environment',
    );
  }
  return subtle;
}

/**
 * Asserts that `key` is exactly the master key `deriveMasterKey` produces.
 *
 * Extractability is part of the contract, not a nicety: an extractable master
 * key can be exported to raw bytes by any code running in the page, which would
 * hand an attacker the whole vault. A key that fails any of these checks is
 * rejected before it touches the data key.
 *
 * @throws {KeyWrapError} with code `master-key/invalid`.
 */
function assertMasterKey(
  key: unknown,
  label: string,
): asserts key is CryptoKey {
  const invalid = (reason: string) =>
    new KeyWrapError('master-key/invalid', `${label} ${reason}`);

  if (typeof CryptoKey !== 'undefined' ? !(key instanceof CryptoKey) : !key) {
    throw invalid('must be a CryptoKey');
  }
  const candidate = key as CryptoKey;
  if (candidate.algorithm?.name !== MASTER_KEY_ALGORITHM_NAME) {
    throw invalid(`must use ${MASTER_KEY_ALGORITHM_NAME}`);
  }
  if (
    (candidate.algorithm as AesKeyAlgorithm).length !== MASTER_KEY_LENGTH_BITS
  ) {
    throw invalid(`must be ${MASTER_KEY_LENGTH_BITS} bits`);
  }
  if (candidate.extractable) {
    throw invalid('must be non-extractable');
  }
  if (
    !candidate.usages?.includes('wrapKey') ||
    !candidate.usages.includes('unwrapKey')
  ) {
    throw invalid("must carry usages 'wrapKey' and 'unwrapKey'");
  }
}

/**
 * Asserts that `wrapped` is a plausible stored blob. The `meta` table is
 * plaintext and therefore attacker-writable on a stolen device, so its contents
 * are validated before being handed to Web Crypto.
 *
 * @throws {KeyWrapError} with code `wrapped-key/invalid` or
 * `wrapped-key/invalid-length`.
 */
function assertWrappedDataKey(wrapped: unknown): asserts wrapped is Uint8Array {
  if (!(wrapped instanceof Uint8Array)) {
    throw new KeyWrapError(
      'wrapped-key/invalid',
      'Wrapped data key must be a Uint8Array',
    );
  }
  if (wrapped.length !== WRAPPED_DATA_KEY_LENGTH_BYTES) {
    throw new KeyWrapError(
      'wrapped-key/invalid-length',
      `Wrapped data key must be exactly ${WRAPPED_DATA_KEY_LENGTH_BYTES} bytes`,
    );
  }
}

/**
 * Wraps `key` under `masterKey` and returns the blob as owned bytes.
 * `key` must be extractable, which is why no caller outside this module is ever
 * handed one.
 */
async function wrapUnder(
  subtle: SubtleCrypto,
  masterKey: CryptoKey,
  key: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const wrapped = await subtle.wrapKey(
    'raw',
    key,
    masterKey,
    MASTER_KEY_ALGORITHM_NAME,
  );
  return new Uint8Array(wrapped);
}

/**
 * Unwraps a stored blob under `masterKey`.
 *
 * `extractable` is a parameter because the two callers need different things:
 * production unwrapping produces a non-extractable session key, while
 * {@link rewrapDataKey} needs a momentarily extractable handle in order to wrap
 * the same key under a new master key. The extractable variant is never
 * reachable from outside this module.
 */
async function unwrapUnder(
  subtle: SubtleCrypto,
  masterKey: CryptoKey,
  wrapped: Uint8Array<ArrayBuffer>,
  extractable: boolean,
): Promise<CryptoKey> {
  try {
    return await subtle.unwrapKey(
      'raw',
      wrapped,
      masterKey,
      MASTER_KEY_ALGORITHM_NAME,
      { name: DATA_KEY_ALGORITHM_NAME, length: DATA_KEY_LENGTH_BITS },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    // AES-KW carries its own integrity check (the RFC 3394 initial value), so
    // this is reached for a wrong password, a wrong master key, or a tampered
    // `meta` row alike. The cause is deliberately not distinguished and the
    // underlying error is not re-exposed.
    throw new KeyWrapError(
      'unwrap/failed',
      'Wrapped data key could not be unwrapped with this master key',
    );
  }
}

/**
 * Creates a new vault's data key and its wrapped form in one step.
 *
 * The data key is generated by Web Crypto, wrapped under the master key, and
 * then re-materialised by unwrapping that blob as a **non-extractable** key.
 * Raw key bytes therefore never enter JavaScript at any point, and the only
 * data key any caller can hold is one that cannot be exported.
 *
 * Combining generation and wrapping is deliberate: Web Crypto refuses to wrap a
 * non-extractable key, so an API that returned a bare data key for the caller to
 * wrap later would have to hand back an extractable one. There is no exported
 * `wrapDataKey`, and that is the point.
 *
 * The caller must persist `wrappedDataKey` in the plaintext `meta` table
 * alongside the Argon2id salt and parameters. `dataKey` is session state and
 * must never be written to storage (§Session lifetime).
 *
 * @throws {KeyWrapError} for a master key that is not the shape
 * `deriveMasterKey` produces, or a missing Web Crypto implementation.
 */
export async function createWrappedDataKey(
  masterKey: CryptoKey,
): Promise<WrappedDataKey> {
  const subtle = requireSubtleCrypto();
  assertMasterKey(masterKey, 'Master key');

  const ephemeral = await subtle.generateKey(
    { name: DATA_KEY_ALGORITHM_NAME, length: DATA_KEY_LENGTH_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
  const wrappedDataKey = await wrapUnder(subtle, masterKey, ephemeral);
  const dataKey = await unwrapUnder(subtle, masterKey, wrappedDataKey, false);

  return { dataKey, wrappedDataKey };
}

/**
 * Unwraps the stored data key for a session.
 *
 * The returned key is **non-extractable** and scoped to AES-GCM
 * `encrypt` / `decrypt`, which is exactly what `encryptRecord` /
 * `decryptRecord` require.
 *
 * @throws {KeyWrapError} `master-key/invalid` for a bad master key,
 * `wrapped-key/invalid` or `wrapped-key/invalid-length` for a malformed blob,
 * and `unwrap/failed` when the blob does not authenticate under this master key
 * — which is the signal an unlock screen should treat as "wrong password".
 */
export async function unwrapDataKey(
  masterKey: CryptoKey,
  wrappedDataKey: Uint8Array,
): Promise<CryptoKey> {
  const subtle = requireSubtleCrypto();
  assertMasterKey(masterKey, 'Master key');
  assertWrappedDataKey(wrappedDataKey);

  return await unwrapUnder(
    subtle,
    masterKey,
    asPrivateBytes(wrappedDataKey),
    false,
  );
}

/**
 * Re-wraps the existing data key under a new master key — the password change
 * path the architecture calls for ("password changes without re-encrypting the
 * database"). Record ciphertext is untouched because the data key does not
 * change; only the 40-byte blob in `meta` does.
 *
 * This exists so that a password change never requires an extractable data key
 * in application code. The momentarily extractable handle is created from the
 * stored blob and dropped before this function returns; it is never observable
 * to a caller.
 *
 * The caller must replace the `meta` row's wrapped key, salt, and Argon2id
 * parameters together and atomically: a blob written under the new password
 * beside the old salt is an unopenable vault.
 *
 * @throws {KeyWrapError} as {@link unwrapDataKey}, validating both master keys.
 */
export async function rewrapDataKey(
  currentMasterKey: CryptoKey,
  nextMasterKey: CryptoKey,
  wrappedDataKey: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const subtle = requireSubtleCrypto();
  assertMasterKey(currentMasterKey, 'Current master key');
  assertMasterKey(nextMasterKey, 'Next master key');
  assertWrappedDataKey(wrappedDataKey);

  const rewrappable = await unwrapUnder(
    subtle,
    currentMasterKey,
    asPrivateBytes(wrappedDataKey),
    true,
  );
  return await wrapUnder(subtle, nextMasterKey, rewrappable);
}
