import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { VaultState } from './vault';
import { getVaultStore } from './vault-instance';

/**
 * React bindings for the vault store. As with the session and locale stores,
 * this is the only vault module that imports React — `vault.ts` is plain
 * `zustand/vanilla` so the state machine is unit-testable without a DOM
 * (docs/architecture.md §Workflow §Testing).
 */

/** Subscribe a component to a slice of vault state. */
export function useVault<T>(selector: (state: VaultState) => T): T {
  return useStore(getVaultStore(), selector);
}

/** The store's actions, for the setup and unlock screens. */
export function useVaultActions(): Pick<
  VaultState,
  | 'create'
  | 'unlock'
  | 'lock'
  | 'matchRecoveryPhrase'
  | 'acknowledgeRecoveryPhrase'
  | 'clearError'
> {
  const store = getVaultStore();
  return {
    create: useStore(store, (s) => s.create),
    unlock: useStore(store, (s) => s.unlock),
    lock: useStore(store, (s) => s.lock),
    matchRecoveryPhrase: useStore(store, (s) => s.matchRecoveryPhrase),
    acknowledgeRecoveryPhrase: useStore(
      store,
      (s) => s.acknowledgeRecoveryPhrase,
    ),
    clearError: useStore(store, (s) => s.clearError),
  };
}

/**
 * Resolves `unknown` into `absent` or `locked` once an identity exists.
 *
 * Gated on `enabled` rather than run unconditionally, because probing opens
 * IndexedDB: a visitor who never signs in should not have a database created
 * for them, and the sign-in screen must render without one.
 */
export function useVaultProbe(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void getVaultStore().getState().probe();
  }, [enabled]);
}
