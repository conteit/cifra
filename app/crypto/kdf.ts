/**
 * Argon2id key derivation — step 2 of the vault key hierarchy.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy) and FOUN-02 /
 * FOUN-03. Turns a master password plus a per-user random 16-byte salt into a
 * 256-bit master key, imported as a **non-extractable** `CryptoKey`.
 *
 * The master key exists only to wrap and unwrap the randomly generated data key
 * (step 3, AES-KW). It is therefore imported with `algorithm: 'AES-KW'`,
 * `usages: ['wrapKey', 'unwrapKey']` and `extractable: false`: the raw bytes
 * never enter the page at all, and the only operations the key can perform are
 * the two the hierarchy needs.
 *
 * ## This module is the main thread's half, and it does no hashing
 *
 * Since #61 (D22) Argon2id runs in a dedicated Web Worker. What is left here is
 * the public API, the salt generator, and input validation:
 *
 * ```
 * kdf.ts ──────────────► kdf-worker-client.ts ══(new URL)══► kdf-worker.ts
 *   │  validation, API      port + message contract              │ adapter
 *   └──► kdf-params.ts ◄────────────────────────────────────── kdf-worker-body.ts
 *          shared policy                                          hash-wasm
 * ```
 *
 * The double line is a bundler-resolved worker URL, not an import: nothing on
 * the main thread's module graph can reach `hash-wasm`, and
 * `test/unit/crypto/kdf-worker-boundary.test.ts` asserts exactly that by
 * walking the graph with that edge removed. It is the mechanical reason
 * derivation cannot quietly move back onto the main thread.
 *
 * Pure TypeScript. Per the layer contract it imports neither React nor Dexie,
 * and it persists nothing — callers own the salt and the parameters, which live
 * in the plaintext `meta` table.
 */

import {
  ARGON2ID_DEFAULT_PARAMS,
  type Argon2idParams,
  assertDeriveInputs,
  KdfError,
  SALT_LENGTH_BYTES,
} from './kdf-params';
import {
  createBrowserKdfWorker,
  deriveInWorker,
  type KdfDerivationState,
  type KdfWorkerFactory,
} from './kdf-worker-client';

export {
  ARGON2ID_DEFAULT_PARAMS,
  type Argon2idParams,
  assertArgon2idParams,
  KdfError,
  type KdfErrorCode,
  MASTER_KEY_LENGTH_BYTES,
  MAX_PASSWORD_LENGTH,
  SALT_LENGTH_BYTES,
} from './kdf-params';
export type {
  KdfDerivationState,
  KdfWorkerFactory,
  KdfWorkerPort,
} from './kdf-worker-client';

/**
 * Generates a fresh per-user salt: {@link SALT_LENGTH_BYTES} bytes straight from
 * the platform CSPRNG. A salt is never derived from the user id, the email, or
 * any other predictable value (see §Decisions V1-2) — that is what stops a
 * single precomputed table from covering more than one vault.
 */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH_BYTES);
  if (!globalThis.crypto?.getRandomValues) {
    throw new KdfError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.getRandomValues) is unavailable in this environment',
    );
  }
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

/** Optional wiring for one {@link deriveMasterKey} call. */
export interface DeriveMasterKeyOptions {
  /**
   * An honest busy signal for the unlock screen, in three steps: `starting`
   * when the worker is being spawned, `deriving` once the worker reports the
   * digest has actually begun, `settled` when the worker has been terminated —
   * on success and on failure alike.
   *
   * There is no percentage, because `hash-wasm` exposes no progress hook (see
   * {@link KdfDerivationState}). A spinner with a truthful label is what this
   * supports; a fabricated bar is not.
   */
  readonly onStateChange?: (state: KdfDerivationState) => void;
  /**
   * The worker factory. Defaults to a real dedicated module worker.
   *
   * It is injectable so that the browser-free `unit` Vitest project can drive
   * the real message contract through an in-process port
   * (`test/support/kdf-worker-port.ts`) — Node 24 has `node:worker_threads`, not
   * the DOM `Worker`, and CLAUDE.md requires that nothing in that project need
   * Playwright. The real `Worker` is covered in Chromium by
   * `test/e2e/kdf-worker.spec.ts`.
   */
  readonly createWorker?: KdfWorkerFactory;
}

/**
 * Derives the 256-bit vault master key from a master password and the vault's
 * per-user salt, on a worker thread.
 *
 * The returned `CryptoKey` is **non-extractable** and scoped to `AES-KW`
 * `wrapKey` / `unwrapKey`: it can only wrap and unwrap the data key (step 3 of
 * the hierarchy), never encrypt records directly and never be exported. It is
 * imported inside the worker and arrives here by structured clone, so the 32
 * raw digest bytes never exist in this realm — which is *stronger* than the
 * pre-#61 behaviour, where they sat in the page's heap until collected.
 *
 * `params` must be the parameters stored with the vault. Omit them only when
 * creating a new vault, in which case {@link ARGON2ID_DEFAULT_PARAMS} is used
 * and the caller must persist them alongside the salt.
 *
 * Every input is validated **here, before a worker is even spawned**, and again
 * inside the worker. That is what keeps D19's cost ceiling a denial-of-service
 * defence: a hostile `meta` row costs a thrown error in microseconds, not a
 * thread and a 36-second burn.
 *
 * @throws {KdfError} for an empty or absurdly long password, a salt that is not
 * exactly {@link SALT_LENGTH_BYTES} bytes, out-of-bounds parameters, a missing
 * Web Crypto or `Worker` implementation, or a worker that failed or answered
 * with anything other than the expected key. No error carries key material.
 */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: Argon2idParams = ARGON2ID_DEFAULT_PARAMS,
  options: DeriveMasterKeyOptions = {},
): Promise<CryptoKey> {
  assertDeriveInputs(password, salt, params);

  return await deriveInWorker(
    { kind: 'derive', password, salt, params },
    options.createWorker ?? createBrowserKdfWorker,
    options.onStateChange,
  );
}
