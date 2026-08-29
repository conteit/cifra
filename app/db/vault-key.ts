/**
 * The session-scoped data key holder.
 *
 * `docs/architecture.md` §Session lifetime: "The data key lives in module-scoped
 * memory only. Locking drops the reference; an idle timeout auto-locks. The key
 * is never written to any storage."
 *
 * The key itself is a non-extractable `CryptoKey` produced by `unwrapDataKey`
 * (`app/crypto/key-wrap.ts`), so even a reference leak yields no key material —
 * but the reference is still the difference between a locked and an unlocked
 * vault, so it is kept behind a `#private` field that only {@link
 * VaultKeyHolder.require} reads.
 *
 * A class rather than bare module state, for one reason: the middleware takes a
 * holder as a parameter, so tests can drive an isolated vault per case instead
 * of sharing one global and becoming order-dependent. Production wires the
 * single module-scoped instance exported at the bottom of this file, which is
 * what satisfies §Session lifetime.
 *
 * Per the layer contract this imports crypto, never Dexie and never React.
 */

import {
  DATA_KEY_ALGORITHM_NAME,
  DATA_KEY_LENGTH_BITS,
} from '../crypto/key-wrap';
import { DbEncryptionError } from './db-error';

/**
 * Rejects anything that is not the key `unwrapDataKey` returns.
 *
 * Extractability is the load-bearing check: an extractable data key can be
 * exported to raw bytes by any code running in the page, which would hand over
 * the whole vault. `encryptRecord` refuses one too, but refusing it here means
 * a smuggled key never even becomes the session's key.
 *
 * @throws {DbEncryptionError} with code `vault/invalid-key`.
 */
function assertVaultDataKey(key: unknown): asserts key is CryptoKey {
  const invalid = (reason: string) =>
    new DbEncryptionError('vault/invalid-key', `Vault data key ${reason}`);

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
  if (
    !candidate.usages?.includes('encrypt') ||
    !candidate.usages.includes('decrypt')
  ) {
    throw invalid("must carry usages 'encrypt' and 'decrypt'");
  }
}

/**
 * Holds the unwrapped data key for the lifetime of an unlocked session.
 *
 * Nothing here persists: there is no serialization, no storage access, and the
 * holder is not enumerable state on any object that could be structured-cloned
 * into IndexedDB.
 */
export class VaultKeyHolder {
  #dataKey: CryptoKey | null = null;

  /** True while a data key is held — i.e. while the vault is unlocked. */
  get isUnlocked(): boolean {
    return this.#dataKey !== null;
  }

  /**
   * Adopts the data key for this session. Called by the unlock flow with the
   * result of `unwrapDataKey`.
   *
   * @throws {DbEncryptionError} `vault/invalid-key` for anything that is not a
   * non-extractable AES-256-GCM encrypt/decrypt key.
   */
  unlock(dataKey: CryptoKey): void {
    assertVaultDataKey(dataKey);
    this.#dataKey = dataKey;
  }

  /**
   * Drops the reference. Idempotent, so sign-out, tab-close and the idle
   * auto-lock can all call it without coordinating (FOUN-10).
   *
   * This is the whole of "wiping" a `CryptoKey` from JavaScript: the key
   * material lives in the browser's crypto implementation and was never
   * readable from the page. Dropping the last handle is what makes it
   * unusable — there is no buffer here to zero, and pretending otherwise
   * would be theatre.
   */
  lock(): void {
    this.#dataKey = null;
  }

  /**
   * The data key, or a typed failure when the vault is locked.
   *
   * Every read and write path in the middleware goes through this, so a locked
   * vault produces `vault/locked` rather than an opaque Web Crypto error and
   * never, under any branch, returns ciphertext to a caller.
   *
   * @throws {DbEncryptionError} with code `vault/locked`.
   */
  require(): CryptoKey {
    if (this.#dataKey === null) {
      throw new DbEncryptionError(
        'vault/locked',
        'The vault is locked: no data key is held for this session',
      );
    }
    return this.#dataKey;
  }
}

/**
 * The process-wide holder — the module-scoped memory §Session lifetime calls
 * for. The lock screen (#10) and the sign-in / vault setup flow (#9) drive it;
 * `app/db/database.ts` binds it into the middleware.
 */
export const vaultKey = new VaultKeyHolder();
