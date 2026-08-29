import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSessionStore,
  selectIsAuthenticated,
  selectIsResolving,
  selectIsSigningIn,
  selectIsUnavailable,
  type SessionEndedEvent,
  type SessionStore,
} from '../../app/stores/session';
import { AuthConfigurationError } from '../../app/services/auth/auth-error';
import type { AuthPort, AuthUser } from '../../app/services/auth/types';

const ADA: AuthUser = {
  uid: 'uid-ada',
  email: 'ada@example.com',
  displayName: 'Ada',
  photoURL: null,
};

const GRACE: AuthUser = {
  uid: 'uid-grace',
  email: 'grace@example.com',
  displayName: 'Grace',
  photoURL: null,
};

/** A hand-rolled `AuthPort` double: the store never sees Firebase in tests. */
function createFakePort() {
  let listener: ((user: AuthUser | null) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    listener = null;
  });
  const observe = vi.fn((next: (user: AuthUser | null) => void) => {
    listener = next;
    return unsubscribe;
  });
  const signInWithGoogle = vi.fn<() => Promise<AuthUser>>(async () => ADA);
  const signOut = vi.fn<() => Promise<void>>(async () => {});

  return {
    port: { observe, signInWithGoogle, signOut } satisfies AuthPort,
    observe,
    unsubscribe,
    signInWithGoogle,
    signOut,
    /** Simulate the identity provider reporting a state. */
    emit(user: AuthUser | null) {
      if (listener === null) throw new Error('nothing is observing the port');
      listener(user);
    },
    get isObserving() {
      return listener !== null;
    },
  };
}

/** Firebase-shaped rejection: an object with an `auth/*` code. */
function firebaseError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe('session store', () => {
  let fake: ReturnType<typeof createFakePort>;
  let store: SessionStore;

  beforeEach(() => {
    fake = createFakePort();
    store = createSessionStore(fake.port);
  });

  describe('initial state', () => {
    it('starts in unknown, not signed-out', () => {
      const state = store.getState();
      expect(state.status).toBe('unknown');
      expect(state.user).toBeNull();
      expect(state.error).toBeNull();
    });

    it('reports resolving, and not authenticated, before the first callback', () => {
      store.getState().start();
      const state = store.getState();
      // The bug this guards: a guard that treats "still loading" as "signed
      // out" flashes the sign-in screen at a signed-in user.
      expect(selectIsResolving(state)).toBe(true);
      expect(selectIsAuthenticated(state)).toBe(false);
    });
  });

  describe('observation lifecycle', () => {
    it('start() subscribes, and is idempotent', () => {
      store.getState().start();
      store.getState().start();
      expect(fake.observe).toHaveBeenCalledTimes(1);
    });

    it('the disposer returned by start() unsubscribes', () => {
      const dispose = store.getState().start();
      dispose();
      expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
      expect(fake.isObserving).toBe(false);
    });

    it('re-subscribes cleanly after stop()', () => {
      store.getState().start();
      store.getState().stop();
      store.getState().start();
      expect(fake.observe).toHaveBeenCalledTimes(2);
      expect(fake.isObserving).toBe(true);
    });

    it('stop() does not pretend the user signed out', () => {
      store.getState().start();
      fake.emit(ADA);
      store.getState().stop();
      expect(store.getState().status).toBe('signed-in');
    });
  });

  describe('state machine: unknown -> signed-out -> signed-in -> signed-out', () => {
    it('resolves unknown to signed-out when nobody is signed in', () => {
      store.getState().start();
      fake.emit(null);
      expect(store.getState().status).toBe('signed-out');
      expect(selectIsResolving(store.getState())).toBe(false);
    });

    it('resolves unknown straight to signed-in for a restored session', () => {
      store.getState().start();
      fake.emit(ADA);
      expect(store.getState().status).toBe('signed-in');
      expect(store.getState().user).toEqual(ADA);
      expect(selectIsAuthenticated(store.getState())).toBe(true);
    });

    it('moves signed-out -> signing-in -> signed-in on a successful sign-in', async () => {
      store.getState().start();
      fake.emit(null);

      let resolveSignIn: ((user: AuthUser) => void) | undefined;
      fake.signInWithGoogle.mockImplementationOnce(
        () =>
          new Promise<AuthUser>((res) => {
            resolveSignIn = res;
          }),
      );

      const pending = store.getState().signIn();
      expect(selectIsSigningIn(store.getState())).toBe(true);

      resolveSignIn?.(ADA);
      await pending;

      expect(store.getState().status).toBe('signed-in');
      expect(store.getState().user).toEqual(ADA);
      expect(store.getState().error).toBeNull();
    });

    it('moves signed-in -> signed-out on signOut()', async () => {
      store.getState().start();
      fake.emit(ADA);

      await store.getState().signOut();

      expect(fake.signOut).toHaveBeenCalledTimes(1);
      expect(store.getState().status).toBe('signed-out');
      expect(store.getState().user).toBeNull();
    });

    it('follows the provider dropping the session in another tab', () => {
      store.getState().start();
      fake.emit(ADA);
      fake.emit(null);
      expect(store.getState().status).toBe('signed-out');
      expect(store.getState().user).toBeNull();
    });

    it('does not fall back to signed-out while a popup is open', () => {
      store.getState().start();
      // The initial "nobody is signed in" callback can land *after* the user
      // has already clicked the button; that must not cancel the flow.
      fake.signInWithGoogle.mockImplementationOnce(
        () => new Promise<AuthUser>(() => {}),
      );
      void store.getState().signIn();
      fake.emit(null);
      expect(store.getState().status).toBe('signing-in');
    });

    it('ignores a duplicate signIn() while one is in flight', async () => {
      store.getState().start();
      fake.emit(null);
      fake.signInWithGoogle.mockImplementationOnce(
        () => new Promise<AuthUser>(() => {}),
      );
      void store.getState().signIn();
      await store.getState().signIn();
      expect(fake.signInWithGoogle).toHaveBeenCalledTimes(1);
    });
  });

  describe('error paths', () => {
    beforeEach(() => {
      store.getState().start();
      fake.emit(null);
    });

    it.each([
      ['auth/popup-closed-by-user', 'popup-closed'],
      ['auth/popup-blocked', 'popup-blocked'],
      ['auth/cancelled-popup-request', 'cancelled'],
      ['auth/network-request-failed', 'network'],
      [
        'auth/account-exists-with-different-credential',
        'account-exists-with-different-credential',
      ],
      ['auth/unauthorized-domain', 'unauthorized-domain'],
      ['auth/operation-not-allowed', 'operation-not-allowed'],
      ['auth/too-many-requests', 'too-many-requests'],
      ['auth/user-disabled', 'user-disabled'],
      ['auth/some-code-we-have-never-seen', 'unknown'],
    ])(
      'maps %s to the %s code and returns to signed-out',
      async (raw, code) => {
        fake.signInWithGoogle.mockRejectedValueOnce(firebaseError(raw));

        await store.getState().signIn();

        expect(store.getState().error).toEqual({ code });
        // The critical part: a failed attempt never strands the UI in
        // 'signing-in' with a spinner nobody can dismiss.
        expect(store.getState().status).toBe('signed-out');
      },
    );

    it('maps a non-Firebase throw to unknown', async () => {
      fake.signInWithGoogle.mockRejectedValueOnce(new TypeError('boom'));
      await store.getState().signIn();
      expect(store.getState().error).toEqual({ code: 'unknown' });
    });

    it('signIn() never rejects — failures are state, not exceptions', async () => {
      fake.signInWithGoogle.mockRejectedValueOnce(
        firebaseError('auth/network-request-failed'),
      );
      await expect(store.getState().signIn()).resolves.toBeUndefined();
    });

    it('keeps an existing session when a second sign-in attempt fails', async () => {
      fake.emit(ADA);
      fake.signInWithGoogle.mockRejectedValueOnce(
        firebaseError('auth/popup-closed-by-user'),
      );

      await store.getState().signIn();

      expect(store.getState().status).toBe('signed-in');
      expect(store.getState().user).toEqual(ADA);
      expect(store.getState().error).toEqual({ code: 'popup-closed' });
    });

    it('clearError() drops the error without disturbing the status', async () => {
      fake.signInWithGoogle.mockRejectedValueOnce(
        firebaseError('auth/popup-blocked'),
      );
      await store.getState().signIn();

      store.getState().clearError();

      expect(store.getState().error).toBeNull();
      expect(store.getState().status).toBe('signed-out');
    });

    it('a successful sign-in clears a previous error', async () => {
      fake.signInWithGoogle.mockRejectedValueOnce(
        firebaseError('auth/popup-blocked'),
      );
      await store.getState().signIn();
      await store.getState().signIn();
      expect(store.getState().error).toBeNull();
      expect(store.getState().status).toBe('signed-in');
    });

    it('signs out locally even when the provider call fails', async () => {
      fake.emit(ADA);
      fake.signOut.mockRejectedValueOnce(
        firebaseError('auth/network-request-failed'),
      );

      await store.getState().signOut();

      // Fail closed: the local session goes regardless.
      expect(store.getState().status).toBe('signed-out');
      expect(store.getState().user).toBeNull();
      expect(store.getState().error).toEqual({ code: 'network' });
    });
  });

  describe('unavailable: the config is missing', () => {
    it('lands in unavailable rather than signed-out when observe() throws', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      fake.observe.mockImplementationOnce(() => {
        throw new AuthConfigurationError('Missing VITE_FIREBASE_API_KEY');
      });

      store.getState().start();

      expect(store.getState().status).toBe('unavailable');
      expect(store.getState().error).toEqual({ code: 'configuration' });
      expect(selectIsUnavailable(store.getState())).toBe(true);
      // "Signed out" would invite the user to click a sign-in button that can
      // never work; "unavailable" lets the UI say what is actually wrong.
      expect(selectIsAuthenticated(store.getState())).toBe(false);
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });

    it('refuses to attempt sign-in while unavailable', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      fake.observe.mockImplementationOnce(() => {
        throw new AuthConfigurationError('nope');
      });
      store.getState().start();

      await store.getState().signIn();

      expect(fake.signInWithGoogle).not.toHaveBeenCalled();
      expect(store.getState().status).toBe('unavailable');
      logged.mockRestore();
    });

    it('marks the store unavailable when sign-in itself reports a config fault', async () => {
      store.getState().start();
      fake.emit(null);
      fake.signInWithGoogle.mockRejectedValueOnce(
        firebaseError('auth/invalid-api-key'),
      );

      await store.getState().signIn();

      expect(store.getState().status).toBe('unavailable');
      expect(store.getState().error).toEqual({ code: 'configuration' });
    });
  });

  describe('session-end seam (the hook FOUN-10 / #10 will wipe the vault key from)', () => {
    it('fires on an explicit sign-out', async () => {
      const seen: SessionEndedEvent[] = [];
      store.onSessionEnded((e) => seen.push(e));

      store.getState().start();
      fake.emit(ADA);
      await store.getState().signOut();

      expect(seen).toEqual([{ reason: 'signed-out' }]);
    });

    it('fires exactly once when the provider also reports the sign-out', async () => {
      // This is what the real Firebase port does: signOut() resolves *and* the
      // auth-state observer fires with null. Both paths must not wipe twice.
      const seen: SessionEndedEvent[] = [];
      store.onSessionEnded((e) => seen.push(e));

      store.getState().start();
      fake.emit(ADA);
      fake.signOut.mockImplementationOnce(async () => {
        fake.emit(null);
      });

      await store.getState().signOut();

      expect(seen).toEqual([{ reason: 'signed-out' }]);
      expect(store.getState().status).toBe('signed-out');
      expect(store.getState().user).toBeNull();
    });

    it('fires when the provider drops the session', () => {
      const seen: SessionEndedEvent[] = [];
      store.onSessionEnded((e) => seen.push(e));

      store.getState().start();
      fake.emit(ADA);
      fake.emit(null);

      expect(seen).toEqual([{ reason: 'signed-out' }]);
    });

    it('fires when a different account takes over without signing out', () => {
      const seen: SessionEndedEvent[] = [];
      store.onSessionEnded((e) => seen.push(e));

      store.getState().start();
      fake.emit(ADA);
      fake.emit(GRACE);

      // Ada's vault key must not survive into Grace's session.
      expect(seen).toEqual([{ reason: 'account-changed' }]);
      expect(store.getState().user).toEqual(GRACE);
    });

    it('does not fire when the same account is re-reported', () => {
      const seen: SessionEndedEvent[] = [];
      store.onSessionEnded((e) => seen.push(e));

      store.getState().start();
      fake.emit(ADA);
      fake.emit({ ...ADA, displayName: 'Ada L.' });

      expect(seen).toEqual([]);
    });

    it('does not fire when no session was ever established', async () => {
      const seen: SessionEndedEvent[] = [];
      store.onSessionEnded((e) => seen.push(e));

      store.getState().start();
      fake.emit(null);
      await store.getState().signOut();

      expect(seen).toEqual([]);
    });

    it('carries no identity payload, so a listener cannot bind a key to a uid', async () => {
      const seen: SessionEndedEvent[] = [];
      store.onSessionEnded((e) => seen.push(e));

      store.getState().start();
      fake.emit(ADA);
      await store.getState().signOut();

      expect(Object.keys(seen[0])).toEqual(['reason']);
      expect(JSON.stringify(seen)).not.toContain(ADA.uid);
      expect(JSON.stringify(seen)).not.toContain(ADA.email);
    });

    it('unsubscribes cleanly, including from inside a listener', async () => {
      const first = vi.fn();
      const unsubscribeFirst = store.onSessionEnded(() => {
        first();
        unsubscribeFirst();
      });
      const second = vi.fn();
      store.onSessionEnded(second);

      store.getState().start();
      fake.emit(ADA);
      await store.getState().signOut();
      fake.emit(ADA);
      await store.getState().signOut();

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(2);
    });
  });

  describe('what the store is allowed to hold', () => {
    it('keeps only display identity — no tokens, no key material', () => {
      store.getState().start();
      fake.emit(ADA);

      expect(Object.keys(store.getState().user ?? {}).sort()).toEqual([
        'displayName',
        'email',
        'photoURL',
        'uid',
      ]);
    });

    it('exposes no field whose name suggests a secret', () => {
      store.getState().start();
      fake.emit(ADA);

      const keys = Object.keys(store.getState()).join(' ').toLowerCase();
      for (const banned of ['token', 'key', 'secret', 'password', 'salt']) {
        expect(keys).not.toContain(banned);
      }
    });
  });

  describe('store isolation', () => {
    it('two stores do not share state or listeners', async () => {
      const otherFake = createFakePort();
      const other = createSessionStore(otherFake.port);
      const seen = vi.fn();
      other.onSessionEnded(seen);

      store.getState().start();
      fake.emit(ADA);
      await store.getState().signOut();

      expect(other.getState().status).toBe('unknown');
      expect(seen).not.toHaveBeenCalled();
    });
  });
});
