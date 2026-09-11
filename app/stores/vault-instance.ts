import {
  startIdleLock,
  VAULT_IDLE_TIMEOUT_MS,
} from '../services/vault/idle-lock';
import { getVaultService } from '../services/vault/vault-instance';
import { getSessionStore } from './session-instance';
import { createVaultStore, type VaultStore } from './vault';
import { wireIdleLock } from './vault-idle-lock';

/**
 * The composition root for the live vault store — and the one place identity
 * and the vault are allowed to know about each other.
 *
 * `app/stores/session.ts` describes the seam this uses:
 *
 * > Dependency direction: this store knows nothing about the vault. The wiring
 * > (`onSessionEnded(() => vault.lock())`) belongs to the composition root at
 * > the pages layer, which is allowed to import both.
 *
 * That is what FOUN-10's "vault key wiped on sign-out" reduces to once the two
 * stores exist, and it is wired here rather than in a component so it cannot be
 * lost by unmounting one. The event carries no identity payload by design, so
 * nothing here can bind key material to an account.
 *
 * The other two FOUN-10 edges live here too, since #10: the 30-minute idle
 * timeout and the wipe on leaving the page. Both are one watcher
 * (`app/services/vault/idle-lock.ts`) that runs only while a data key is held
 * and ends in the same `lock()` the sign-out edge and the header button call,
 * each with its own reason so the unlock screen can say which it was.
 *
 * Constructed lazily so importing the module has no side effect: the service
 * behind it opens IndexedDB on first use.
 */
let instance: VaultStore | undefined;

export function getVaultStore(): VaultStore {
  if (instance !== undefined) return instance;

  const store = createVaultStore(getVaultService());
  instance = store;

  // Registered once, for the life of the page. Subscribing here rather than in
  // a component is the point: a signed-out session must drop the data key even
  // if nothing is mounted to notice.
  getSessionStore().onSessionEnded(() => {
    store.getState().lock('session-ended');
  });

  // `window`, not `document`: input events bubble up to it, `visibilitychange`
  // arrives there from the document, and `pagehide` fires nowhere else.
  wireIdleLock(store, {
    start: (onIdle) =>
      startIdleLock({
        target: window,
        timeoutMs: VAULT_IDLE_TIMEOUT_MS,
        visibilityState: () => document.visibilityState,
        onIdle,
      }),
  });

  return instance;
}
