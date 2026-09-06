import { describe, expect, it } from 'vitest';

import { toAuthUser } from '../../app/services/auth/auth-user';

/**
 * Key hierarchy step 1: identity is "identity only; it never touches encryption
 * material" (`docs/architecture.md` §Crypto).
 *
 * The concrete risk is not that someone writes `masterKey = user.uid`. It is
 * that a Firebase `User` — which carries an ID token, a refresh handle, the
 * provider payloads and a `getIdToken()` that can fetch more — reaches the
 * session store whole, where any component in the app can read it and a future
 * change can quietly start depending on it.
 *
 * This assertion used to live in `test/e2e/auth-emulator.spec.ts`, reading the
 * store out of the `window` handle #44 added. #9 deleted that handle, so the
 * guarantee moved here rather than being dropped — and it is stronger here: it
 * runs on every `npm run verify` instead of only when an emulator is up, and it
 * tests the narrowing itself rather than one identity that happened to pass
 * through it.
 */
describe('toAuthUser', () => {
  /**
   * Deliberately fat. Every extra field is one a real Firebase `User` carries,
   * and the test is worthless if the input is already narrow.
   */
  const providerUser = {
    uid: 'uid-123',
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    photoURL: 'https://example.invalid/ada.png',
    // Everything below must not survive.
    accessToken: 'ya29.a0-not-a-real-token',
    refreshToken: 'AMf-refresh-handle',
    emailVerified: true,
    phoneNumber: '+390000000000',
    providerId: 'google.com',
    providerData: [{ providerId: 'google.com', uid: 'google-uid' }],
    stsTokenManager: { accessToken: 'ya29.inner', expirationTime: 1 },
    tenantId: null,
    metadata: { creationTime: 'now', lastSignInTime: 'now' },
    getIdToken: () => Promise.resolve('ya29.on-demand'),
    reload: () => Promise.resolve(),
    toJSON: () => ({ everything: 'again' }),
  };

  it('keeps exactly the four display fields and nothing else', () => {
    const user = toAuthUser(providerUser);

    expect(Object.keys(user).sort()).toEqual([
      'displayName',
      'email',
      'photoURL',
      'uid',
    ]);
    expect(user).toEqual({
      uid: 'uid-123',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      photoURL: 'https://example.invalid/ada.png',
    });
  });

  it('carries no token, credential or callable back into the app', () => {
    // Belt and braces over the key-set assertion above: a rename that widened
    // the result would have to also rename these, which is a change nobody
    // makes by accident.
    const serialized = JSON.stringify(toAuthUser(providerUser));
    for (const secret of [
      'ya29',
      'AMf-refresh-handle',
      'stsTokenManager',
      'providerData',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    for (const value of Object.values(toAuthUser(providerUser))) {
      expect(typeof value).not.toBe('function');
    }
  });

  it('passes a null name or photo through rather than inventing one', () => {
    // Google accounts without a profile photo or display name are ordinary.
    // A placeholder invented here would be indistinguishable from a real one
    // at the screen layer, which is where the fallback belongs.
    expect(
      toAuthUser({
        uid: 'uid-456',
        email: null,
        displayName: null,
        photoURL: null,
      }),
    ).toEqual({
      uid: 'uid-456',
      email: null,
      displayName: null,
      photoURL: null,
    });
  });
});
