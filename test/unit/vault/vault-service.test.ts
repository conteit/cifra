import { describe, expect, it } from 'vitest';

import { ARGON2ID_DEFAULT_PARAMS } from '../../../app/crypto/kdf';
import { assertVaultRecord } from '../../../app/crypto/vault';
import type { VaultRecord } from '../../../app/services/vault/types';
import { createVaultService } from '../../../app/services/vault/vault-service';
import {
  keySink,
  memoryRecordStore,
  OTHER_PASSWORD,
  PASSWORD,
  workerOptions,
} from './support';

/**
 * The vault service (#9) — where `app/crypto/vault.ts`, the `meta` row and the
 * session key holder meet.
 *
 * Every case here is written against a question a user would ask: *can I still
 * get into my vault after X?* — so the assertions are about which secret opens
 * which vault and what is on disk afterwards, not about which functions were
 * called. The crypto is real throughout; only storage is in-memory.
 */

function service(store = memoryRecordStore(), keys = keySink()) {
  return {
    store,
    keys,
    vault: createVaultService({
      records: store,
      keys,
      options: workerOptions(),
    }),
  };
}

describe('probing', () => {
  it('is absent before anything is created and present after', async () => {
    const { vault } = service();
    expect(await vault.probe()).toBe('absent');
    await vault.create(PASSWORD);
    expect(await vault.probe()).toBe('present');
  });

  it('calls a row it cannot understand present, not absent', async () => {
    // The distinction routes the user: `absent` means "offer to create a
    // vault". Rounding a corrupt row down to `absent` would offer to create a
    // *second* vault over the top of the first, orphaning every record the
    // first one encrypted. `unlock` is where the row is judged, and where
    // `record/invalid` is a message the user can act on.
    const { vault, store } = service();
    store.poke({ key: 'vault', version: 99 });
    expect(await vault.probe()).toBe('present');
  });
});

describe('creating a vault', () => {
  it('persists one record and adopts the data key', async () => {
    const { vault, store, keys } = service();
    expect(keys.isUnlocked).toBe(false);

    const outcome = await vault.create(PASSWORD);

    expect(outcome.ok).toBe(true);
    expect(store.writes()).toBe(1);
    expect(() => assertVaultRecord(store.peek())).not.toThrow();
    expect(keys.isUnlocked).toBe(true);
    expect(vault.isUnlocked).toBe(true);
  });

  it('always uses ARGON2ID_DEFAULT_PARAMS, never anything read from meta', async () => {
    // D19's creation-path rule, and the one this issue's acceptance bullet
    // singles out. An *unlock* with substituted parameters merely derives a
    // different master key and fails; a *creation* that trusted `meta` would
    // mint a genuinely weak vault that unlocks perfectly for its owner and for
    // whoever brute-forces it.
    //
    // Staged as hostilely as the type system permits: a plausible-looking row
    // carrying the weakest parameters D19's floor still admits sits in storage
    // before setup runs. If any of it were consulted, the created record would
    // carry it.
    const { vault, store } = service();
    const weak = { memorySizeKib: 19 * 1024, iterations: 2, parallelism: 1 };
    store.poke({ key: 'vault', kdfParams: weak });

    // A row is present, so creation refuses outright rather than reading it.
    expect(await vault.create(PASSWORD)).toEqual({
      ok: false,
      reason: 'vault/exists',
    });

    // …and with no row at all, the parameters are the module's own constant.
    const fresh = service();
    await fresh.vault.create(PASSWORD);
    const record = fresh.store.peek() as VaultRecord;
    expect(record.kdfParams).toEqual(ARGON2ID_DEFAULT_PARAMS);
    expect(record.kdfParams).not.toEqual(weak);
  });

  it('refuses to overwrite an existing vault', async () => {
    // The two-tab race. Overwriting would leave every already-encrypted record
    // unreadable under a data key nobody holds any more.
    const { vault, store } = service();
    await vault.create(PASSWORD);
    const first = store.peek();

    expect(await vault.create(OTHER_PASSWORD)).toEqual({
      ok: false,
      reason: 'vault/exists',
    });
    expect(store.writes()).toBe(1);
    expect(store.peek()).toBe(first);
  });

  it('refuses an empty or over-long password as input, writing nothing', async () => {
    // #91: setup enforces the minimum length in the screen but not the
    // maximum, and the crypto layer threw for both. A throw reads as "creation
    // failed" — a result reads as "fix the password".
    const { vault, store, keys } = service();
    for (const candidate of ['', 'x'.repeat(1025)]) {
      expect(await vault.create(candidate)).toEqual({
        ok: false,
        reason: 'password/malformed',
      });
    }
    expect(store.writes()).toBe(0);
    expect(keys.isUnlocked).toBe(false);
  });

  it('writes both wrapped copies together, so a phrase always exists', async () => {
    // D26: a record with a password copy and no recovery copy is a vault whose
    // owner has exactly one route in and no way back from forgetting it.
    const { vault, store } = service();
    const outcome = await vault.create(PASSWORD);
    const record = store.peek() as VaultRecord;

    expect(record.wrappedDataKey).toHaveLength(40);
    expect(record.recoveryWrappedDataKey).toHaveLength(40);
    expect([...record.wrappedDataKey]).not.toEqual([
      ...record.recoveryWrappedDataKey,
    ]);
    expect(outcome.ok && outcome.recoveryPhrase).toMatch(
      /^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/,
    );
  });

  it('does not adopt a key when the record could not be written', async () => {
    // The ordering that matters. A live data key over a vault that was never
    // persisted would encrypt records under a key no password can reproduce:
    // silent, total loss at the next tab close.
    const store = memoryRecordStore();
    const failing = {
      ...store,
      write: async () => {
        throw new Error('quota exceeded');
      },
    };
    const keys = keySink();
    const vault = createVaultService({
      records: failing,
      keys,
      options: workerOptions(),
    });

    await expect(vault.create(PASSWORD)).rejects.toThrow('quota exceeded');
    expect(keys.isUnlocked).toBe(false);
  });
});

describe('unlocking', () => {
  it('opens with the master password and yields the same data key', async () => {
    const { vault, store, keys } = service();
    await vault.create(PASSWORD);
    vault.lock();
    expect(keys.isUnlocked).toBe(false);

    expect(
      await vault.unlock({ kind: 'password', password: PASSWORD }),
    ).toEqual({ ok: true });
    expect(keys.isUnlocked).toBe(true);
    expect(store.writes()).toBe(1); // unlocking rewrites nothing
  });

  it('opens with the recovery phrase — a forgotten password is not data loss', async () => {
    const { vault, keys } = service();
    const created = await vault.create(PASSWORD);
    const phrase = created.ok ? created.recoveryPhrase : '';
    vault.lock();

    expect(await vault.unlock({ kind: 'recovery-phrase', phrase })).toEqual({
      ok: true,
    });
    expect(keys.isUnlocked).toBe(true);
  });

  it('rejects the wrong password without opening anything', async () => {
    const { vault, keys } = service();
    await vault.create(PASSWORD);
    vault.lock();

    expect(
      await vault.unlock({ kind: 'password', password: OTHER_PASSWORD }),
    ).toEqual({ ok: false, reason: 'secret/rejected' });
    expect(keys.isUnlocked).toBe(false);
  });

  it('tells a mistyped phrase apart from a wrong one', async () => {
    // Different things to say to someone who has already lost their password,
    // and saying so reveals nothing: the input is their own.
    const { vault } = service();
    await vault.create(PASSWORD);
    vault.lock();

    expect(
      await vault.unlock({ kind: 'recovery-phrase', phrase: 'nonsense' }),
    ).toEqual({ ok: false, reason: 'phrase/malformed' });

    expect(
      await vault.unlock({
        kind: 'recovery-phrase',
        phrase: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
      }),
    ).toEqual({ ok: false, reason: 'secret/rejected' });
  });

  it('reports a corrupt row as record/invalid, not as a wrong password', async () => {
    const { vault } = service();
    vault.lock();
    const store = memoryRecordStore();
    store.poke({ key: 'vault', version: 1, kdfSalt: 'not bytes' });
    const corrupt = createVaultService({
      records: store,
      keys: keySink(),
      options: workerOptions(),
    });

    expect(
      await corrupt.unlock({ kind: 'password', password: PASSWORD }),
    ).toEqual({ ok: false, reason: 'record/invalid' });
  });

  it('reports an empty database as record/invalid rather than a bad secret', async () => {
    // Nothing to open. Telling someone their password is wrong when there is
    // no vault at all sends them hunting for a mistake they did not make.
    const { vault } = service();
    expect(
      await vault.unlock({ kind: 'password', password: PASSWORD }),
    ).toEqual({ ok: false, reason: 'record/invalid' });
  });

  it('bounds a hostile row before deriving anything from it', async () => {
    // D19: `meta` is plaintext and unauthenticated, so whoever can write that
    // row chooses what the next unlock costs. A cost far over the ceiling must
    // fail in microseconds rather than burning 36 seconds of main thread.
    const store = memoryRecordStore();
    const seed = service();
    await seed.vault.create(PASSWORD);
    const record = seed.store.peek() as VaultRecord;
    store.poke({
      ...record,
      kdfParams: { memorySizeKib: 1024 * 1024, iterations: 64, parallelism: 1 },
    });

    const hostile = createVaultService({
      records: store,
      keys: keySink(),
      options: workerOptions(),
    });
    const started = Date.now();
    expect(
      await hostile.unlock({ kind: 'password', password: PASSWORD }),
    ).toEqual({ ok: false, reason: 'record/invalid' });
    // Generous by three orders of magnitude against the 36 s the unbounded
    // version measured, so the assertion is about the bound existing rather
    // than about this machine's speed.
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('locking', () => {
  it('drops the key and is idempotent', async () => {
    const { vault, keys } = service();
    await vault.create(PASSWORD);
    vault.lock();
    vault.lock();
    expect(keys.isUnlocked).toBe(false);
    expect(vault.isUnlocked).toBe(false);
  });

  it('leaves the record alone, so the vault can be reopened', async () => {
    const { vault, store } = service();
    await vault.create(PASSWORD);
    const record = store.peek();
    vault.lock();
    expect(store.peek()).toBe(record);
    expect(await vault.probe()).toBe('present');
  });
});

describe('matching a recovery phrase', () => {
  it('accepts the phrase back in a different shape', async () => {
    const { vault } = service();
    const created = await vault.create(PASSWORD);
    const phrase = created.ok ? created.recoveryPhrase : '';

    expect(vault.matchRecoveryPhrase(phrase, phrase)).toBe(true);
    // Crockford folds case, grouping and the confusables — which is the point
    // of the encoding: most transcription slips still open the vault at the one
    // moment the user has no other way in.
    expect(
      vault.matchRecoveryPhrase(
        phrase,
        phrase.toLowerCase().replaceAll('-', ' '),
      ),
    ).toBe(true);
    expect(vault.matchRecoveryPhrase(phrase, 'not a phrase')).toBe(false);
  });
});
