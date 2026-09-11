import { describe, expect, it } from 'vitest';
import type {
  VaultCreateOutcome,
  VaultOutcome,
  VaultPresence,
  VaultService,
} from '../../../app/services/vault/types';
import { createVaultService } from '../../../app/services/vault/vault-service';
import { createVaultStore } from '../../../app/stores/vault';
import {
  keySink,
  memoryRecordStore,
  OTHER_PASSWORD,
  PASSWORD,
  workerOptions,
} from './support';

/**
 * The vault store (#9) — the state machine the gate routes on.
 *
 * Two kinds of case here, and the split is deliberate.
 *
 * **Against the real service**, for anything where the answer depends on
 * cryptography actually having happened: creation really derives a key, unlock
 * really unwraps one, and the status the gate reads is the status a user would
 * have got. A stubbed service could not tell a vault that opened from one that
 * did not.
 *
 * **Against a hand-built service**, for the paths a real one cannot be made to
 * take on demand — a browser with no `Worker`, a `probe` that throws. Those are
 * environment failures, and the property under test is that the store keeps
 * them apart from "you typed the wrong password", which is exactly what
 * `app/crypto/vault.ts` splits its own failures for.
 */

function realStore() {
  const records = memoryRecordStore();
  const keys = keySink();
  const service = createVaultService({
    records,
    keys,
    options: workerOptions(),
  });
  return { records, keys, service, store: createVaultStore(service) };
}

/** A service that answers however the case needs it to. */
function stubService(overrides: Partial<VaultService>): VaultService {
  return {
    isUnlocked: false,
    probe: async (): Promise<VaultPresence> => 'absent',
    create: async (): Promise<VaultCreateOutcome> => ({
      ok: false,
      reason: 'vault/exists',
    }),
    unlock: async (): Promise<VaultOutcome> => ({
      ok: false,
      reason: 'secret/rejected',
    }),
    lock: () => {},
    matchRecoveryPhrase: () => false,
    ...overrides,
  };
}

describe('the initial state', () => {
  it('is unknown, which a guard must wait on rather than redirect from', () => {
    const { store } = realStore();
    const state = store.getState();
    expect(state.status).toBe('unknown');
    expect(state.pending).toBe('idle');
    expect(state.derivation).toBeNull();
    expect(state.error).toBeNull();
    expect(state.recoveryPhrase).toBeNull();
  });
});

describe('probing', () => {
  it('resolves to absent on a fresh device and locked once a vault exists', async () => {
    const { store } = realStore();
    await store.getState().probe();
    expect(store.getState().status).toBe('absent');

    await store.getState().create(PASSWORD);
    store.getState().lock('manual');
    await store.getState().probe();
    expect(store.getState().status).toBe('locked');
  });

  it('does not close a vault that is already open', async () => {
    // A second mount, or sign-in completing after setup, re-probes. Treating
    // that as a reason to re-lock would throw the user back to the unlock
    // screen seconds after they left it.
    const { store } = realStore();
    await store.getState().create(PASSWORD);
    await store.getState().probe();
    expect(store.getState().status).toBe('unlocked');
  });

  it('lands in unavailable when storage itself throws', async () => {
    const store = createVaultStore(
      stubService({
        probe: async () => {
          throw new Error('IndexedDB is disabled in this browser');
        },
      }),
    );
    await store.getState().probe();
    expect(store.getState().status).toBe('unavailable');
    expect(store.getState().error).toBe('environment');
  });
});

describe('creating a vault', () => {
  it('unlocks and surfaces the phrase exactly once', async () => {
    const { store } = realStore();
    expect(await store.getState().create(PASSWORD)).toBe(true);

    const state = store.getState();
    expect(state.status).toBe('unlocked');
    expect(state.error).toBeNull();
    expect(state.recoveryPhrase).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);

    // Acknowledging is the end of the phrase's life in memory. There is no
    // getter anywhere that can bring it back (D26), which is what makes the
    // type-it-back step meaningful rather than decorative.
    store.getState().acknowledgeRecoveryPhrase();
    expect(store.getState().recoveryPhrase).toBeNull();
  });

  it('reports the three-state derivation signal while it works', async () => {
    // D22: `starting` while the worker is spawned, `deriving` once the digest
    // has begun, and nothing at all once settled. No percentage — hash-wasm
    // exposes no progress hook, so a bar would be invented.
    const { store } = realStore();
    const seen: Array<string | null> = [];
    const unsubscribe = store.subscribe((state) => {
      seen.push(state.derivation);
    });

    await store.getState().create(PASSWORD);
    unsubscribe();

    expect(seen).toContain('starting');
    expect(seen).toContain('deriving');
    expect(store.getState().derivation).toBeNull();
    expect(store.getState().pending).toBe('idle');
  });

  it('sends a lost race to unlock rather than overwriting the vault', async () => {
    // Another tab created the vault first. The honest next screen is unlock:
    // the vault is real and closed, and creating a second one over the top
    // would orphan everything the first encrypted.
    const { store } = realStore();
    await store.getState().create(PASSWORD);
    store.getState().lock('manual');

    expect(await store.getState().create(OTHER_PASSWORD)).toBe(false);
    expect(store.getState().status).toBe('locked');
    expect(store.getState().error).toBe('vault/exists');
  });

  it('keeps an environment failure out of the user-error channel', async () => {
    const store = createVaultStore(
      stubService({
        create: async () => {
          throw new Error('Worker is not defined');
        },
      }),
    );
    expect(await store.getState().create(PASSWORD)).toBe(false);
    expect(store.getState().error).toBe('environment');
    // Not `absent → locked`: a browser that cannot derive a key has not
    // created a vault, and has not lost one either.
    expect(store.getState().status).toBe('unknown');
    expect(store.getState().pending).toBe('idle');
  });

  it('ignores a second attempt while the first is still running', async () => {
    // Argon2id takes long enough on a phone for a second tap to land. Two
    // concurrent creations would race on the `vault/exists` check and could
    // write two different vaults.
    const { store, records } = realStore();
    const [first, second] = await Promise.all([
      store.getState().create(PASSWORD),
      store.getState().create(OTHER_PASSWORD),
    ]);
    expect([first, second]).toEqual([true, false]);
    expect(records.writes()).toBe(1);
  });
});

describe('unlocking', () => {
  it('opens with the password and clears the previous failure', async () => {
    const { store } = realStore();
    await store.getState().create(PASSWORD);
    store.getState().lock('manual');

    expect(
      await store
        .getState()
        .unlock({ kind: 'password', password: OTHER_PASSWORD }),
    ).toBe(false);
    expect(store.getState().status).toBe('locked');
    expect(store.getState().error).toBe('secret/rejected');

    expect(
      await store.getState().unlock({ kind: 'password', password: PASSWORD }),
    ).toBe(true);
    expect(store.getState().status).toBe('unlocked');
    expect(store.getState().error).toBeNull();
  });

  it('opens with the recovery phrase', async () => {
    const { store } = realStore();
    await store.getState().create(PASSWORD);
    const phrase = store.getState().recoveryPhrase ?? '';
    store.getState().acknowledgeRecoveryPhrase();
    store.getState().lock('manual');

    expect(
      await store.getState().unlock({ kind: 'recovery-phrase', phrase }),
    ).toBe(true);
    expect(store.getState().status).toBe('unlocked');
  });
});

describe('locking', () => {
  it('closes an open vault and forgets any phrase still on screen', async () => {
    const { store, keys } = realStore();
    await store.getState().create(PASSWORD);
    expect(store.getState().recoveryPhrase).not.toBeNull();

    store.getState().lock('manual');

    expect(store.getState().status).toBe('locked');
    expect(store.getState().recoveryPhrase).toBeNull();
    expect(keys.isUnlocked).toBe(false);
  });

  it('leaves absent, unknown and unavailable exactly as they were', async () => {
    // Sign-out fires `lock()` unconditionally (FOUN-10), including for a user
    // who never created a vault. Moving `absent` to `locked` there would offer
    // an unlock screen for a vault that does not exist.
    const { store } = realStore();
    await store.getState().probe();
    expect(store.getState().status).toBe('absent');
    store.getState().lock('manual');
    expect(store.getState().status).toBe('absent');

    const fresh = realStore().store;
    fresh.getState().lock('manual');
    expect(fresh.getState().status).toBe('unknown');
  });

  it('records why it locked, so the unlock screen can say so', async () => {
    const { store } = realStore();
    await store.getState().create(PASSWORD);
    expect(store.getState().lockReason).toBeNull();

    store.getState().lock('idle');
    expect(store.getState().lockReason).toBe('idle');

    // A reason is about the *last* lock; a successful unlock ends it.
    await store.getState().unlock({ kind: 'password', password: PASSWORD });
    expect(store.getState().lockReason).toBeNull();

    store.getState().lock('manual');
    expect(store.getState().lockReason).toBe('manual');
  });

  it('keeps no reason when there was nothing to lock', async () => {
    // Sign-out locks unconditionally; an absent vault has no lock to explain.
    const { store } = realStore();
    await store.getState().probe();
    store.getState().lock('session-ended');
    expect(store.getState().lockReason).toBeNull();
  });
});

describe('matching the phrase back', () => {
  it('accepts the phrase in hand and refuses when there is none', async () => {
    const { store } = realStore();
    await store.getState().create(PASSWORD);
    const phrase = store.getState().recoveryPhrase ?? '';

    expect(store.getState().matchRecoveryPhrase(phrase)).toBe(true);
    expect(store.getState().matchRecoveryPhrase('ZZZZ-ZZZZ')).toBe(false);

    // No phrase in hand must never pass: a confirmation step that returned
    // `true` here would wave the user past a phrase they were never shown.
    store.getState().acknowledgeRecoveryPhrase();
    expect(store.getState().matchRecoveryPhrase(phrase)).toBe(false);
  });
});
