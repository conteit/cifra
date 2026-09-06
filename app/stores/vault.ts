import { createStore, type StoreApi } from 'zustand/vanilla';

import type {
  VaultFailure,
  VaultSecret,
  VaultService,
} from '../services/vault/types';

/**
 * The vault store: whether this device has a vault, whether it is open, and
 * what to say when it will not open.
 *
 * ## Its relationship to the session store
 *
 * They are deliberately separate and neither imports the other. Signing in
 * tells Cifra *who you are*; unlocking is what makes your data readable
 * (`docs/architecture.md` §Crypto key hierarchy — identity "never touches
 * encryption material"). Keeping two stores is what makes "signed in but
 * locked" — the state the whole lock screen exists for — representable at all.
 * The one edge between them is wired at the composition root
 * (`vault-instance.ts`), where a session that ends drops the data key.
 *
 * ## Injection
 *
 * A factory over `VaultService`, never a module that reaches for Dexie itself,
 * so the unit suite drives the real state machine against an in-memory record
 * store and an in-process Argon2id port. Same shape as `session.ts`.
 *
 * ## The recovery phrase lives here, briefly
 *
 * `createVault` returns the phrase exactly once and no function reads it back
 * out of a vault (D26). Parking it in the store rather than in React state is
 * what lets the show-once screen survive a re-render or a remount inside the
 * same session; {@link VaultState.acknowledgeRecoveryPhrase} is the explicit
 * end of its life, and `lock()` drops it too. It is never persisted, never
 * logged, and never leaves this module except to be rendered.
 */

/** How far along a running Argon2id derivation is (D22). No percentage. */
export type VaultDerivationState = 'starting' | 'deriving';

/** Which long-running vault operation, if any, is in flight. */
export type VaultOperation = 'idle' | 'creating' | 'unlocking';

export type VaultStatus =
  /** Before the first probe resolves. NOT "no vault" — guards must wait. */
  | 'unknown'
  /** Resolved: this device holds no vault. Setup is the next screen. */
  | 'absent'
  /** A vault exists and no data key is held. */
  | 'locked'
  /** A data key is held for this session. */
  | 'unlocked'
  /** Storage or Web Crypto is unusable. Terminal until reload. */
  | 'unavailable';

/**
 * Why the last operation failed.
 *
 * `environment` is the odd one out and that is the point: every other member is
 * something the user can retype or act on, whereas `environment` means the
 * browser could not run the operation at all. `app/crypto/vault.ts` draws the
 * same line by throwing for one and returning for the other, and this store
 * keeps the two apart so an unlock screen never renders "no Web Crypto here" as
 * "wrong password".
 */
export type VaultErrorCode = VaultFailure | 'environment';

export interface VaultState {
  readonly status: VaultStatus;
  readonly pending: VaultOperation;
  /** Non-null only while an Argon2id derivation is actually running. */
  readonly derivation: VaultDerivationState | null;
  readonly error: VaultErrorCode | null;
  /** Set once by {@link VaultState.create}; never read back from a vault. */
  readonly recoveryPhrase: string | null;

  /** Resolves `unknown` into `absent` or `locked`. Idempotent and cheap. */
  probe(): Promise<void>;
  /** Creates and opens a vault. Resolves `true` when the vault is open. */
  create(password: string): Promise<boolean>;
  /** Opens the vault with either secret. Resolves `true` on success. */
  unlock(secret: VaultSecret): Promise<boolean>;
  /** Drops the data key and the pending recovery phrase. Idempotent. */
  lock(): void;
  /**
   * Whether what the user typed back is the phrase they were just shown.
   * `false` when there is no phrase in hand, so a confirmation step can never
   * pass by accident.
   */
  matchRecoveryPhrase(candidate: string): boolean;
  /** Forgets the shown-once phrase, ending setup. */
  acknowledgeRecoveryPhrase(): void;
  clearError(): void;
}

export type VaultStore = StoreApi<VaultState>;

/* -------------------------------------------------------------------------- */
/* Selectors — the surface routing and guards should use.                      */
/* -------------------------------------------------------------------------- */

/** True while the first probe is outstanding. A guard must wait, not redirect. */
export const selectIsResolving = (s: VaultState): boolean =>
  s.status === 'unknown';

export const selectNeedsSetup = (s: VaultState): boolean =>
  s.status === 'absent';

export const selectIsLocked = (s: VaultState): boolean => s.status === 'locked';

export const selectIsUnlocked = (s: VaultState): boolean =>
  s.status === 'unlocked';

export const selectIsBusy = (s: VaultState): boolean => s.pending !== 'idle';

/* -------------------------------------------------------------------------- */
/* Factory                                                                     */
/* -------------------------------------------------------------------------- */

export function createVaultStore(service: VaultService): VaultStore {
  return createStore<VaultState>((set, get) => {
    /** Feeds D22's three-state busy signal into the store. */
    const onStateChange = (state: 'starting' | 'deriving' | 'settled') => {
      set({ derivation: state === 'settled' ? null : state });
    };

    /**
     * Runs one operation with the pending/derivation bookkeeping, mapping a
     * thrown error — the environment half of the crypto layer's split — onto
     * `error: 'environment'` without inventing a status change. A browser that
     * cannot derive a key has not lost the vault; reloading may well fix it.
     */
    async function run<T>(
      operation: Exclude<VaultOperation, 'idle'>,
      body: () => Promise<T>,
      onError: T,
    ): Promise<T> {
      if (get().pending !== 'idle') return onError;
      set({ pending: operation, derivation: null, error: null });
      try {
        return await body();
      } catch (error) {
        // Logged as well as typed: a missing Worker or Web Crypto should be
        // obvious in the console, not inferred from a generic message.
        console.error('[cifra] vault operation failed:', error);
        set({ error: 'environment' });
        return onError;
      } finally {
        set({ pending: 'idle', derivation: null });
      }
    }

    return {
      status: 'unknown',
      pending: 'idle',
      derivation: null,
      error: null,
      recoveryPhrase: null,

      async probe() {
        try {
          const presence = await service.probe();
          set({
            // An unlocked vault stays unlocked: a re-probe (a second mount, a
            // sign-in completing) must not close a session that is already open.
            status: service.isUnlocked
              ? 'unlocked'
              : presence === 'absent'
                ? 'absent'
                : 'locked',
          });
        } catch (error) {
          console.error('[cifra] vault storage unavailable:', error);
          set({ status: 'unavailable', error: 'environment' });
        }
      },

      async create(password: string) {
        return await run(
          'creating',
          async () => {
            const outcome = await service.create(password, { onStateChange });
            if (!outcome.ok) {
              // `vault/exists` means another tab won the race. The vault is
              // real and closed, so the honest next screen is unlock.
              set({
                error: outcome.reason,
                status: outcome.reason === 'vault/exists' ? 'locked' : 'absent',
              });
              return false;
            }
            set({
              status: 'unlocked',
              recoveryPhrase: outcome.recoveryPhrase,
              error: null,
            });
            return true;
          },
          false,
        );
      },

      async unlock(secret: VaultSecret) {
        return await run(
          'unlocking',
          async () => {
            const outcome = await service.unlock(secret, { onStateChange });
            if (!outcome.ok) {
              set({ error: outcome.reason });
              return false;
            }
            set({ status: 'unlocked', error: null });
            return true;
          },
          false,
        );
      },

      lock() {
        service.lock();
        // Only an open vault becomes a locked one. Locking says nothing about
        // whether a vault *exists*, so `absent`, `unknown` and `unavailable`
        // are left exactly as they were — moving `absent` to `locked` would
        // send a first-time user to an unlock screen for a vault that is not
        // there, and moving `unlocked` to `absent` would offer to create a
        // second vault over the top of the first.
        set({
          status: get().status === 'unlocked' ? 'locked' : get().status,
          recoveryPhrase: null,
          error: null,
        });
      },

      matchRecoveryPhrase(candidate: string) {
        const expected = get().recoveryPhrase;
        if (expected === null) return false;
        return service.matchRecoveryPhrase(expected, candidate);
      },

      acknowledgeRecoveryPhrase() {
        set({ recoveryPhrase: null });
      },

      clearError() {
        set({ error: null });
      },
    };
  });
}
