import type { AuthUser } from './types';

/**
 * The narrowing that keeps identity out of the crypto layer's way.
 *
 * `docs/architecture.md` §Crypto key hierarchy step 1: identity is "identity
 * only; it never touches encryption material". A Firebase `User` carries far
 * more than a name — an ID token, a refresh handle, provider payloads, a
 * `reload()` that can re-fetch all of it. None of that may reach the session
 * store, where any component in the app can read it.
 *
 * ## Why this is its own module
 *
 * It used to live inside `firebase-auth-port.ts`, where the only thing that
 * proved the narrowing worked was an assertion in `test/e2e/auth-emulator.spec.ts`
 * reading the store out of a `window` handle. #9 deletes that handle (the spec
 * now clicks a real sign-in screen), so the guarantee needed a home that does
 * not depend on a debug seam to be checked. Here it is a pure function over a
 * structural type, unit-tested against a deliberately fat fake user in
 * `test/unit/auth-user.test.ts` — a stronger check than the e2e ever was,
 * because it runs on every `verify` rather than only when an emulator is up.
 *
 * The parameter is structural rather than Firebase's `User` so this module
 * imports no SDK: `test/unit/auth-boundary.test.ts` holds it to that.
 */
export interface ProviderUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly photoURL: string | null;
}

/**
 * Copies exactly the four display fields onto a fresh object.
 *
 * Field-by-field, never a spread: a spread would carry whatever else the
 * provider put on the object, which is the failure this function exists to
 * prevent.
 */
export function toAuthUser(user: ProviderUser): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}
