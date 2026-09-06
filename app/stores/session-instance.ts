import { createFirebaseAuthPort } from '../services/auth/firebase-auth-port';
import { createSessionStore, type SessionStore } from './session';

/**
 * The composition root for the live session store.
 *
 * This is the one place where the pure store meets the Firebase-backed port.
 * Keeping the wiring here (and not inside `session.ts`) is what lets the
 * boundary test prove that the store itself has no path to the Firebase SDK.
 *
 * The vault-lock edge hangs off this store's `onSessionEnded` and is wired one
 * level up, in `app/stores/vault-instance.ts`, which is allowed to import both
 * while neither store depends on the other.
 *
 * Constructed lazily so that merely importing the module has no side effects:
 * no Firebase app is created during SSR-less prerender, during Storybook, or in
 * a test that only touches types.
 *
 * ## What used to be here
 *
 * A build-gated `window` handle publishing this store to page context, so that
 * #44's Playwright spec had something to drive when there was no sign-in UI to
 * click. #9 shipped the sign-in screen, the spec clicks it, and the handle, its
 * module and its entry in `vite.config.ts`'s bundle guard were deleted in the
 * same change — which is the lifetime that module was written with.
 *
 * `test/unit/auth-emulator.test.ts` asserts that neither the handle nor a
 * build-mode comparison has come back.
 */
let instance: SessionStore | undefined;

export function getSessionStore(): SessionStore {
  instance ??= createSessionStore(createFirebaseAuthPort());
  return instance;
}
