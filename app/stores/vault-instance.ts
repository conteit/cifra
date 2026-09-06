import { getVaultService } from '../services/vault/vault-instance';
import { getSessionStore } from './session-instance';
import { createVaultStore, type VaultStore } from './vault';

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
 * **What is deliberately not here: the idle auto-lock.** FOUN-10 also asks for
 * a 30-minute idle timeout and a wipe on tab close; both are #10, along with
 * the lock screen's presentation. This file ships the sign-out edge only,
 * because a session that ends while the data key stays live is a security
 * defect rather than a missing feature, and #9 is the change that first makes a
 * data key exist.
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
    store.getState().lock();
  });

  return instance;
}
