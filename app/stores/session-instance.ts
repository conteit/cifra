import { createFirebaseAuthPort } from '../services/auth/firebase-auth-port';
import { createSessionStore, type SessionStore } from './session';
import { SESSION_TEST_HANDLE } from './session-test-handle';

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
  if (instance !== undefined) return instance;
  instance = createSessionStore(createFirebaseAuthPort());

  // Development and emulator builds only — see `session-test-handle.ts` for
  // what this is for and why it cannot reach production. The comparison is
  // written out in full rather than pulled from a constant so that Vite's
  // build-time substitution of `import.meta.env.MODE` folds it to `false` and
  // the bundler deletes the branch; `vite.config.ts` asserts the deletion
  // happened by reading the emitted bundle back.
  if (
    import.meta.env.MODE === 'development' ||
    import.meta.env.MODE === 'emulator'
  ) {
    (globalThis as unknown as Record<string, unknown>)[SESSION_TEST_HANDLE] =
      instance;
  }

  return instance;
}
