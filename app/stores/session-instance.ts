import { createFirebaseAuthPort } from '../services/auth/firebase-auth-port';
import { createSessionStore, type SessionStore } from './session';

/**
 * The composition root for the live session store.
 *
 * This is the one place where the pure store meets the Firebase-backed port.
 * Keeping the wiring here (and not inside `session.ts`) is what lets the
 * boundary test prove that the store itself has no path to the Firebase SDK —
 * and it is where #10 will wire `onSessionEnded` to the vault lock, since the
 * composition root is allowed to depend on both sides while neither layer
 * depends on the other.
 *
 * Constructed lazily so that merely importing the module has no side effects:
 * no Firebase app is created during SSR-less prerender, during Storybook, or in
 * a test that only touches types.
 */
let instance: SessionStore | undefined;

export function getSessionStore(): SessionStore {
  instance ??= createSessionStore(createFirebaseAuthPort());
  return instance;
}
