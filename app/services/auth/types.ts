/**
 * Identity contract for the auth layer.
 *
 * Governed by docs/architecture.md §Crypto and data layer — key hierarchy
 * step 1: "Identity — Firebase Google sign-in. Identity only; it never touches
 * encryption material."
 *
 * Nothing in this file, or in anything that implements `AuthPort`, may produce,
 * derive, hold, or persist encryption key material. `AuthUser` deliberately
 * carries only display-level identity: a uid, an email, a name, a photo. The
 * uid in particular is NOT a secret and must never be fed to a KDF, used as a
 * salt, or used to address a key — the vault master key comes from the master
 * password via Argon2id (key hierarchy step 2) and from nowhere else.
 */

/** The identity of the signed-in person. Display data only. */
export interface AuthUser {
  /** Firebase account id. Public identifier — never key material, never a salt. */
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly photoURL: string | null;
}

/**
 * Provider-neutral failure taxonomy. The store surfaces these codes; the UI
 * layer maps a code to localised copy (see the PR for the rationale of keeping
 * copy out of the store).
 */
export type AuthErrorCode =
  /** The user closed the Google popup before finishing. Not an error to shout about. */
  | 'popup-closed'
  /** The browser blocked the popup. The UI should offer a retry / explain popups. */
  | 'popup-blocked'
  /** A newer sign-in attempt superseded this one, or the user aborted. Silent. */
  | 'cancelled'
  /** Offline or the request failed in transit. Retryable. */
  | 'network'
  /** Same email already linked to a different provider. Needs an account-linking flow. */
  | 'account-exists-with-different-credential'
  /** The current origin is not in the Firebase Auth authorized-domains list. Config bug. */
  | 'unauthorized-domain'
  /** Google sign-in is not enabled in the Firebase console. Config bug. */
  | 'operation-not-allowed'
  /** The account was disabled in the Firebase console. */
  | 'user-disabled'
  /** Rate limited by Firebase. Retryable after a wait. */
  | 'too-many-requests'
  /** Missing/invalid Firebase web config, or the SDK failed to initialise. */
  | 'configuration'
  /** Browser storage is unavailable (hard-partitioned or disabled). */
  | 'storage-unsupported'
  /** Anything unrecognised. */
  | 'unknown';

/** A failure surfaced by the session store. Carries no provider-specific detail. */
export interface AuthError {
  readonly code: AuthErrorCode;
}

/**
 * The seam the session store is built against. Implemented for real by
 * `firebase-auth-port.ts`; implemented by a fake in the unit tests. The store
 * never imports Firebase, which is what makes it testable as pure TS
 * (docs/architecture.md §Workflow §Testing).
 */
export interface AuthPort {
  /**
   * Subscribe to identity changes. The listener is called once with the
   * resolved initial state (`null` when signed out) and again on every change.
   * Returns an unsubscribe function.
   */
  observe(listener: (user: AuthUser | null) => void): () => void;

  /** Start the Google sign-in flow. Resolves with the signed-in identity. */
  signInWithGoogle(): Promise<AuthUser>;

  /** End the identity session. */
  signOut(): Promise<void>;
}
