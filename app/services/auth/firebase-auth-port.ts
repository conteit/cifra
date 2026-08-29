import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';

import { readFirebaseConfig } from './firebase-config';
import type { AuthPort, AuthUser } from './types';

/**
 * The **only** module in the app that imports the Firebase SDK. Everything
 * else — the session store, the guards, the pages — talks to `AuthPort`.
 * `test/unit/auth-boundary.test.ts` asserts that mechanically.
 *
 * Firebase is used for **auth only**. No Firestore, no Storage, no Analytics is
 * initialised here, and none may be added: CLAUDE.md, "Firebase is auth only.
 * No financial data in Firestore, ever, except the encrypted sync blobs
 * specified in docs/architecture.md §Roadmap Phase 8."
 *
 * ## Why `signInWithPopup` and not `signInWithRedirect`
 *
 * Since browsers began partitioning third-party storage (Safari ITP, Firefox
 * Total Cookie Protection, Chrome's third-party cookie work), Firebase's
 * redirect flow breaks unless the `/__/auth/handler` endpoint is reverse-proxied
 * onto the app's own origin — the redirect result is handed back through a
 * cross-origin iframe on `*.firebaseapp.com`, which those browsers now
 * partition away. The popup flow returns its credential by `postMessage` from a
 * top-level window instead, so it survives partitioning without any hosting
 * work. Cifra is deployed as a static SPA on Vercel (§Deployment), so we have no
 * Firebase Hosting rewrite to lean on. Popup it is.
 *
 * The known cost is installed-PWA and popup-blocker contexts. That is handled by
 * surfacing `'popup-blocked'` as a first-class error code so the sign-in screen
 * (#9) can react, and a redirect fallback behind a self-hosted auth handler is
 * filed as follow-up work rather than guessed at here.
 *
 * ## Why `browserLocalPersistence`
 *
 * This choice governs the **identity session only** and has nothing to do with
 * the vault key. Per docs/architecture.md §Session lifetime the data key "lives
 * in module-scoped memory only … never written to any storage", and FOUN-10
 * wipes it on sign-out, tab close, and 30-minute idle — all of that is enforced
 * by the crypto layer regardless of what happens here. Forcing the *identity*
 * session to be memory-only would only mean re-doing a Google popup on every
 * tab open while buying no confidentiality: a Firebase session token decrypts
 * nothing. So identity persists (`browserLocalPersistence`, in IndexedDB) and
 * the master password still gates every byte of financial data.
 */

const GOOGLE_SCOPES: readonly string[] = [];

let cachedAuth: Auth | undefined;

function getFirebaseApp(): FirebaseApp {
  const existing = getApps();
  if (existing.length > 0) return existing[0];
  return initializeApp(readFirebaseConfig(import.meta.env));
}

/**
 * Initialises Firebase Auth exactly once per page.
 *
 * `initializeAuth` is used instead of `getAuth` so the persistence and the
 * popup/redirect resolver are explicit dependencies: `getAuth` pulls every
 * persistence backend and the full resolver into the bundle, `initializeAuth`
 * lets the bundler drop what we do not name.
 *
 * @throws {AuthConfigurationError} when the Firebase env vars are missing.
 */
function getAuthClient(): Auth {
  if (cachedAuth !== undefined) return cachedAuth;
  cachedAuth = initializeAuth(getFirebaseApp(), {
    persistence: browserLocalPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  return cachedAuth;
}

/**
 * Narrows a Firebase `User` down to the display-level identity the app is
 * allowed to hold. Tokens, credentials, provider payloads and the refresh
 * handle are dropped here and never reach the store.
 */
function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

/** Builds the live `AuthPort`. Firebase is initialised lazily on first use. */
export function createFirebaseAuthPort(): AuthPort {
  return {
    observe(listener) {
      return onAuthStateChanged(getAuthClient(), (user) => {
        listener(user === null ? null : toAuthUser(user));
      });
    },

    async signInWithGoogle() {
      const provider = new GoogleAuthProvider();
      for (const scope of GOOGLE_SCOPES) provider.addScope(scope);
      // Always show the account chooser: a shared device must not silently
      // re-sign-in the previous person.
      provider.setCustomParameters({ prompt: 'select_account' });

      const credential = await signInWithPopup(getAuthClient(), provider);
      return toAuthUser(credential.user);
    },

    async signOut() {
      await firebaseSignOut(getAuthClient());
    },
  };
}
