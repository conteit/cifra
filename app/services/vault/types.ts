/**
 * The vault service's contract with the layers on either side of it.
 *
 * `docs/architecture.md` §Stack and layering:
 * `pages → stores → services → db → crypto`. The vault flow is the first thing
 * in the app that spans that whole chain, so the seams are named here rather
 * than left as concrete imports:
 *
 *   · {@link VaultRecordStore} is the db side — one row in `meta`, read and
 *     written. `app/services/vault/vault-instance.ts` binds the Dexie-backed
 *     implementation; the unit suite binds an in-memory one, which is what lets
 *     the whole flow be tested without opening a database.
 *   · {@link VaultKeySink} is the session key holder. `VaultKeyHolder` in
 *     `app/db/vault-key.ts` satisfies it structurally, so nothing is adapted.
 *
 * The crypto layer's own types are re-exported here so the store above never
 * imports `app/crypto` directly — the arrow points one way, and a store
 * reaching past two layers to name a crypto type is how that stops being true.
 */

import type {
  VaultOptions,
  VaultRecord,
  VaultRejection,
  VaultSecret,
  VaultUnlockMethod,
} from '../../crypto/vault';

export type {
  VaultOptions,
  VaultRecord,
  VaultRejection,
  VaultSecret,
  VaultUnlockMethod,
};

/**
 * Persistence for the single `meta` row that is the vault.
 *
 * `read` returns `unknown` on purpose: the row is plaintext and, until #32,
 * unauthenticated, so it is untrusted input right up to the moment
 * `app/crypto/vault.ts` validates it. Typing it as `VaultRecord` here would be
 * a claim this layer is in no position to make.
 */
export interface VaultRecordStore {
  /** The stored row, or `undefined` when no vault exists on this device. */
  read(): Promise<unknown | undefined>;
  /** Replaces the row, whole. */
  write(record: VaultRecord): Promise<void>;
}

/**
 * The session-scoped data key holder (§Session lifetime). Structurally
 * satisfied by `VaultKeyHolder`.
 */
export interface VaultKeySink {
  readonly isUnlocked: boolean;
  unlock(dataKey: CryptoKey): void;
  lock(): void;
}

/**
 * Why an operation did not end with an open vault. A superset of
 * {@link VaultRejection} by exactly one member.
 *
 * `vault/exists` is not a crypto condition — the crypto layer has no idea
 * whether a record is already stored — but it is the one refusal setup can hit
 * that a user must be told about rather than shielded from: a second tab (or a
 * second device syncing later) created the vault first, and creating another
 * over the top would orphan every record the first one encrypted. It is
 * recoverable by unlocking, which is exactly what the store does with it.
 */
export type VaultFailure = VaultRejection | 'vault/exists';

/** An operation that ended with the vault open, or a reason it did not. */
export type VaultOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: VaultFailure };

/** Vault creation: the phrase is returned here and nowhere else, ever (D26). */
export type VaultCreateOutcome =
  | {
      readonly ok: true;
      /**
       * Shown once. `createVault` does not persist it and no function reads it
       * back out of a vault, so this value is the only copy that will ever
       * exist outside the user's own notes.
       */
      readonly recoveryPhrase: string;
    }
  | { readonly ok: false; readonly reason: VaultFailure };

/** Whether this device already holds a vault. */
export type VaultPresence = 'absent' | 'present';

/**
 * The vault lifecycle as the store above sees it.
 *
 * Every method that can fail for a reason the *user* can act on returns an
 * outcome; everything else throws. That split is inherited deliberately from
 * `app/crypto/vault.ts`, where it exists so an unlock screen cannot render "no
 * Web Crypto in this browser" as "wrong password".
 */
export interface VaultService {
  /** True while a data key is held for this session. */
  readonly isUnlocked: boolean;
  /** Whether a vault row exists. Reads storage; validates nothing. */
  probe(): Promise<VaultPresence>;
  /** Mints a vault, persists it, and adopts its data key. */
  create(password: string, options?: VaultOptions): Promise<VaultCreateOutcome>;
  /** Opens the stored vault with either secret and adopts its data key. */
  unlock(secret: VaultSecret, options?: VaultOptions): Promise<VaultOutcome>;
  /** Drops the data key. Idempotent. */
  lock(): void;
  /**
   * Whether two written recovery phrases are the same secret, folding
   * Crockford's confusables and ignoring grouping and case.
   *
   * On the service rather than imported by the setup screen so the arrow keeps
   * pointing one way: `recoveryPhrasesMatch` lives in `app/crypto`, and a route
   * or a component reaching past two layers to call it is how
   * `pages -> stores -> services -> db -> crypto` stops being true.
   */
  matchRecoveryPhrase(expected: string, candidate: string): boolean;
}
