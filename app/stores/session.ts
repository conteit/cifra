import { createStore, type StoreApi } from 'zustand/vanilla';

import { mapAuthErrorCode } from '../services/auth/auth-error';
import type { AuthError, AuthPort, AuthUser } from '../services/auth/types';

/**
 * The session store: who is signed in, and nothing else.
 *
 * ## The boundary this file exists to hold
 *
 * This module must never import `app/crypto/*`, `app/db/*`, or the Firebase SDK,
 * directly or transitively. That is asserted mechanically by
 * `test/unit/auth-boundary.test.ts`, which walks this file's real import graph
 * — so the rule survives future edits instead of relying on a reviewer
 * remembering it. See docs/architecture.md §Stack and layering
 * (`pages → stores → services → db → crypto`) and §Crypto key hierarchy step 1:
 * identity "never touches encryption material".
 *
 * Practically: signing in tells Cifra *who you are*. It does not unlock
 * anything. The vault master key comes from the master password through
 * Argon2id (key hierarchy step 2) and lives only in memory. Firebase never sees
 * the master password, never sees a key, and never sees plaintext — so a
 * compromise of the identity provider yields an account name and nothing to
 * decrypt it with.
 *
 * ## Injection
 *
 * The store is a factory over `AuthPort`, never a module that reaches for
 * Firebase itself. Unit tests build one with a fake port; the app builds one
 * with the Firebase-backed port in `session-instance.ts`, which is the single
 * composition root.
 */

export type SessionStatus =
  /** Before the first auth-state callback. NOT signed out — guards must wait. */
  | 'unknown'
  /** Resolved: nobody is signed in. */
  | 'signed-out'
  /** A sign-in attempt is in flight. */
  | 'signing-in'
  /** Resolved: an identity is present. Says nothing about the vault being unlocked. */
  | 'signed-in'
  /** Auth cannot run at all (missing/invalid Firebase config). Terminal until reload. */
  | 'unavailable';

/** Why an established session ended. Consumed by the vault-lock seam. */
export type SessionEndReason =
  /** The user signed out, or the identity provider dropped the session. */
  | 'signed-out'
  /** A different account became active without an intervening signed-out state. */
  | 'account-changed';

export interface SessionEndedEvent {
  readonly reason: SessionEndReason;
}

/**
 * Notified when a session that *was* established has ended.
 *
 * This is the seam FOUN-10 ("vault key wiped on sign-out") hangs off, and the
 * event deliberately carries **no identity payload** — no uid, no email. A
 * listener therefore cannot bind key material to an account identifier even by
 * accident, which is exactly the mistake key hierarchy step 1 forbids.
 *
 * Dependency direction: this store knows nothing about the vault. The wiring
 * (`onSessionEnded(() => vault.lock())`) belongs to the composition root at the
 * pages layer, which is allowed to import both — the crypto layer must not
 * import a store, since that would run backwards through
 * `pages → stores → services → db → crypto`.
 */
export type SessionEndListener = (event: SessionEndedEvent) => void;

export interface SessionState {
  readonly status: SessionStatus;
  /** The signed-in identity, or null. Display data only — never key material. */
  readonly user: AuthUser | null;
  /** The last failure, if any. A code; the UI layer owns the copy. */
  readonly error: AuthError | null;

  /**
   * Begins observing identity changes. Idempotent — calling it twice keeps the
   * first subscription. Returns a disposer, and also parks it so `stop()` works.
   */
  start(): () => void;
  /** Stops observing. Leaves `status` untouched: unobserved is not signed out. */
  stop(): void;
  /** Runs the Google sign-in flow. Never throws; failures land in `error`. */
  signIn(): Promise<void>;
  /** Ends the session locally and at the provider. Never throws. */
  signOut(): Promise<void>;
  /** Dismisses the current error without changing the status. */
  clearError(): void;
}

export interface SessionStore extends StoreApi<SessionState> {
  /** Subscribe to session-end events. Returns an unsubscribe function. */
  onSessionEnded(listener: SessionEndListener): () => void;
}

/* -------------------------------------------------------------------------- */
/* Selectors — the surface routing and guards should use.                      */
/* -------------------------------------------------------------------------- */

/**
 * True while the initial auth state is still unresolved. A guard MUST render a
 * neutral pending state here and must not redirect: treating `'unknown'` as
 * signed-out flashes the sign-in screen at an already-signed-in user (and, once
 * #9 lands, bounces them out of a deep link).
 */
export const selectIsResolving = (s: SessionState): boolean =>
  s.status === 'unknown';

/** True only for a fully established identity. */
export const selectIsAuthenticated = (s: SessionState): boolean =>
  s.status === 'signed-in';

/** True while a sign-in attempt is in flight — drives the button's busy state. */
export const selectIsSigningIn = (s: SessionState): boolean =>
  s.status === 'signing-in';

/** True when auth is misconfigured; the app should say so, not offer sign-in. */
export const selectIsUnavailable = (s: SessionState): boolean =>
  s.status === 'unavailable';

export const selectUser = (s: SessionState): AuthUser | null => s.user;

export const selectError = (s: SessionState): AuthError | null => s.error;

/* -------------------------------------------------------------------------- */
/* Factory                                                                     */
/* -------------------------------------------------------------------------- */

export function createSessionStore(port: AuthPort): SessionStore {
  const endListeners = new Set<SessionEndListener>();
  let unsubscribe: (() => void) | null = null;

  function dispose(): void {
    unsubscribe?.();
    unsubscribe = null;
  }

  function emitSessionEnded(reason: SessionEndReason): void {
    const event: SessionEndedEvent = { reason };
    // Copy first: a listener may unsubscribe itself while we iterate.
    for (const listener of [...endListeners]) listener(event);
  }

  const store = createStore<SessionState>((set, get) => ({
    status: 'unknown',
    user: null,
    error: null,

    start() {
      if (unsubscribe !== null) return dispose;

      const handleUser = (user: AuthUser | null): void => {
        const previous = get().user;

        if (user === null) {
          // A null while a popup is open is the *initial* resolution racing the
          // sign-in, not a sign-out. Staying in 'signing-in' keeps the UI busy
          // instead of flickering back to the sign-in screen mid-flow.
          if (get().status === 'signing-in') return;

          set({ status: 'signed-out', user: null });
          if (previous !== null) emitSessionEnded('signed-out');
          return;
        }

        const accountChanged = previous !== null && previous.uid !== user.uid;
        set({ status: 'signed-in', user, error: null });
        if (accountChanged) emitSessionEnded('account-changed');
      };

      try {
        unsubscribe = port.observe(handleUser);
      } catch (error) {
        // Thrown by the Firebase port when the web config is missing: there is
        // no identity system to talk to, which is not the same as signed out.
        // Logged as well as typed — a missing env var should be obvious in the
        // console, not something a developer has to infer from a blank screen.
        console.error('[cifra] auth unavailable:', error);
        set({ status: 'unavailable', user: null, error: toAuthError(error) });
        return dispose;
      }

      return dispose;
    },

    stop() {
      dispose();
    },

    async signIn() {
      const status = get().status;
      if (status === 'signing-in' || status === 'unavailable') return;

      set({ status: 'signing-in', error: null });

      try {
        const user = await port.signInWithGoogle();
        set({ status: 'signed-in', user, error: null });
      } catch (error) {
        const authError = toAuthError(error);
        set({
          // A failed attempt must not strand the UI in 'signing-in'. If the
          // observer already delivered a user (a second attempt over a live
          // session), keep it.
          status:
            authError.code === 'configuration'
              ? 'unavailable'
              : get().user !== null
                ? 'signed-in'
                : 'signed-out',
          error: authError,
        });
      }
    },

    async signOut() {
      let error: AuthError | null = null;

      try {
        await port.signOut();
      } catch (caught) {
        // Fail closed. If the provider call fails we still drop the local
        // session and still fire the wipe seam — better a spurious lock than a
        // session that outlives the user's intent to end it.
        error = toAuthError(caught);
      }

      // Read *after* the await: a real provider fires its auth-state observer
      // as part of signing out, so `handleUser(null)` has usually already
      // cleared the user and emitted. Re-reading here keeps the wipe seam
      // firing exactly once per ended session instead of twice.
      const stillHeldSession = get().user !== null;

      set({ status: 'signed-out', user: null, error });
      if (stillHeldSession) emitSessionEnded('signed-out');
    },

    clearError() {
      set({ error: null });
    },
  }));

  function onSessionEnded(listener: SessionEndListener): () => void {
    endListeners.add(listener);
    return () => {
      endListeners.delete(listener);
    };
  }

  return Object.assign(store, { onSessionEnded });
}

function toAuthError(error: unknown): AuthError {
  return { code: mapAuthErrorCode(error) };
}
