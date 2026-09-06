import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARGON2ID_DEFAULT_PARAMS,
  SALT_LENGTH_BYTES,
} from '../../../app/crypto/kdf';
import { WRAPPED_DATA_KEY_LENGTH_BYTES } from '../../../app/crypto/key-wrap';
import {
  decodeRecoveryPhrase,
  RECOVERY_SALT_LENGTH_BYTES,
} from '../../../app/crypto/recovery-phrase';
import {
  type CreatedVault,
  changeMasterPassword,
  createVault,
  regenerateRecoveryPhrase,
  unlockVault,
  VAULT_RECORD_VERSION,
  type VaultOptions,
  type VaultRecord,
} from '../../../app/crypto/vault';
import { recordingKdfWorkerFactory } from '../../support/kdf-worker-port';

/**
 * The vault lifecycle (#68, D26).
 *
 * Everything here is written against one question: **can the user still get to
 * their money after X?** — where X is a forgotten password, a changed password,
 * a rotated phrase, or a hostile `meta` row. So the assertions are almost never
 * "the bytes changed"; they are "this secret still opens this vault, and yields
 * the *same* data key", proved by decrypting with one handle what was encrypted
 * with the other. A test that only compared wrapped blobs would pass for a
 * vault that had quietly become two different vaults.
 *
 * Argon2id runs in a worker since #61 and this is the browser-free `unit`
 * project, so every call injects the in-process port from
 * `test/support/kdf-worker-port.ts` — the shipping worker body across a real
 * `structuredClone` boundary. The recovery path deliberately spawns no worker
 * at all (HKDF, not Argon2id), which is itself asserted below.
 */

const PASSWORD = 'un cavallo corretto batteria graffetta';
const NEXT_PASSWORD = 'una password nuova di zecca';

/** Fresh worker wiring per call, so port counts are per-assertion. */
function wiring(): VaultOptions & {
  ports: ReturnType<typeof recordingKdfWorkerFactory>['ports'];
} {
  const factory = recordingKdfWorkerFactory();
  return { createWorker: factory, ports: factory.ports };
}

const utf8 = new TextEncoder();
const CANARY = utf8.encode('CANARY-vault-6f21');
const IV = new Uint8Array(12).fill(0x2b);

/**
 * Whether two handles are the same AES-GCM key: encrypt under one, decrypt
 * under the other. Both are non-extractable, so this is the only honest way to
 * ask — and it is also exactly what the vault promises, since every record in
 * the database was encrypted under the key an earlier unlock produced.
 */
async function isSameDataKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: IV },
    a,
    CANARY,
  );
  try {
    const plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: IV },
        b,
        ciphertext,
      ),
    );
    return plaintext.every((byte, index) => byte === CANARY[index]);
  } catch {
    return false;
  }
}

async function unlockedKey(
  record: VaultRecord,
  secret: Parameters<typeof unlockVault>[1],
): Promise<CryptoKey> {
  const result = await unlockVault(record, secret, wiring());
  if (!result.ok) {
    expect.unreachable(`expected an unlock, got ${result.reason}`);
  }
  return result.dataKey;
}

const password = (value: string) =>
  ({ kind: 'password', password: value }) as const;
const phrase = (value: string) =>
  ({ kind: 'recovery-phrase', phrase: value }) as const;

describe('createVault mints one data key and two ways in', () => {
  let vault: CreatedVault;

  beforeAll(async () => {
    vault = await createVault(PASSWORD, wiring());
  });

  it('returns a record holding both wrapped copies', () => {
    const { record } = vault;
    expect(record.version).toBe(VAULT_RECORD_VERSION);
    expect(record.kdfSalt).toHaveLength(SALT_LENGTH_BYTES);
    expect(record.recoverySalt).toHaveLength(RECOVERY_SALT_LENGTH_BYTES);
    expect(record.wrappedDataKey).toHaveLength(WRAPPED_DATA_KEY_LENGTH_BYTES);
    expect(record.recoveryWrappedDataKey).toHaveLength(
      WRAPPED_DATA_KEY_LENGTH_BYTES,
    );
    // Two independent wrappings of the same key: different key-encryption keys
    // produce different blobs, and a record where they matched would mean the
    // recovery path had quietly become the password path.
    expect(record.recoveryWrappedDataKey).not.toEqual(record.wrappedDataKey);
  });

  it('always creates with ARGON2ID_DEFAULT_PARAMS', () => {
    // D19: the creation path must never inherit parameters from anywhere. There
    // is no argument to pass them in, and this pins that.
    expect(vault.record.kdfParams).toEqual(ARGON2ID_DEFAULT_PARAMS);
  });

  it('returns a session data key that cannot be exported', () => {
    expect(vault.dataKey.extractable).toBe(false);
    expect(vault.dataKey.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    expect([...vault.dataKey.usages].sort()).toEqual(['decrypt', 'encrypt']);
  });

  it('returns a well-formed recovery phrase, exactly once', () => {
    expect(decodeRecoveryPhrase(vault.recoveryPhrase)).toHaveLength(20);
    // There is no getter: the record cannot yield the phrase back, by
    // construction rather than by convention.
    expect(Object.values(vault.record)).not.toContain(vault.recoveryPhrase);
    expect(vault).not.toHaveProperty('readRecoveryPhrase');
  });

  it('produces a record that survives structured cloning into IndexedDB', () => {
    const cloned = structuredClone(vault.record) as VaultRecord;
    expect(cloned).toEqual(vault.record);
  });

  it('shares nothing between two vaults', async () => {
    const other = await createVault(PASSWORD, wiring());
    expect(other.recoveryPhrase).not.toBe(vault.recoveryPhrase);
    expect(other.record.kdfSalt).not.toEqual(vault.record.kdfSalt);
    expect(other.record.recoverySalt).not.toEqual(vault.record.recoverySalt);
    expect(other.record.wrappedDataKey).not.toEqual(
      vault.record.wrappedDataKey,
    );

    // The same password on another vault is another data key.
    expect(await isSameDataKey(other.dataKey, vault.dataKey)).toBe(false);
  });
});

describe('unlockVault accepts either secret', () => {
  let vault: CreatedVault;

  beforeAll(async () => {
    vault = await createVault(PASSWORD, wiring());
  });

  it('opens with the master password', async () => {
    const key = await unlockedKey(vault.record, password(PASSWORD));
    expect(await isSameDataKey(vault.dataKey, key)).toBe(true);
  });

  it('opens with the recovery phrase, and yields the same data key', async () => {
    const key = await unlockedKey(vault.record, phrase(vault.recoveryPhrase));
    expect(await isSameDataKey(vault.dataKey, key)).toBe(true);
  });

  it('opens with a phrase transcribed loosely', async () => {
    const retyped = vault.recoveryPhrase.toLowerCase().replaceAll('-', ' ');
    const key = await unlockedKey(vault.record, phrase(retyped));
    expect(await isSameDataKey(vault.dataKey, key)).toBe(true);
  });

  it('reports the method it was asked for', async () => {
    const byPassword = await unlockVault(
      vault.record,
      password(PASSWORD),
      wiring(),
    );
    const byPhrase = await unlockVault(
      vault.record,
      phrase(vault.recoveryPhrase),
      wiring(),
    );
    expect(byPassword.method).toBe('password');
    expect(byPhrase.method).toBe('recovery-phrase');
  });

  it('rejects a wrong password without throwing', async () => {
    const result = await unlockVault(
      vault.record,
      password(`${PASSWORD} `),
      wiring(),
    );
    expect(result).toMatchObject({
      ok: false,
      method: 'password',
      reason: 'secret/rejected',
    });
  });

  it("rejects another vault's recovery phrase", async () => {
    const other = await createVault(PASSWORD, wiring());
    const result = await unlockVault(
      vault.record,
      phrase(other.recoveryPhrase),
      wiring(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'secret/rejected' });
  });

  it('tells a mistyped phrase apart from a wrong one, and spawns no worker', async () => {
    const wired = wiring();
    const result = await unlockVault(
      vault.record,
      phrase('ZZZZ-not-a-phrase'),
      wired,
    );
    expect(result).toMatchObject({
      ok: false,
      method: 'recovery-phrase',
      reason: 'phrase/malformed',
    });
    expect(wired.ports).toHaveLength(0);
  });

  it('never runs Argon2id on the recovery path at all', async () => {
    // The phrase carries its own 160 bits, so the recovery unlock is one HKDF:
    // no worker, no 64 MiB allocation, no ~100 ms. A future refactor that
    // routed the phrase through the KDF would also route it through a
    // `postMessage`, which is what this guards.
    const wired = wiring();
    const result = await unlockVault(
      vault.record,
      phrase(vault.recoveryPhrase),
      wired,
    );
    expect(result.ok).toBe(true);
    expect(wired.ports).toHaveLength(0);
  });

  it('refuses a malformed record before deriving anything', async () => {
    const hostile: Array<[string, unknown]> = [
      ['not an object', null],
      ['a future version', { ...vault.record, version: 99 }],
      [
        'a truncated wrapped key',
        { ...vault.record, wrappedDataKey: new Uint8Array(8) },
      ],
      [
        'a truncated recovery copy',
        { ...vault.record, recoveryWrappedDataKey: new Uint8Array(8) },
      ],
      ['a short salt', { ...vault.record, kdfSalt: new Uint8Array(4) }],
      [
        'a short recovery salt',
        { ...vault.record, recoverySalt: new Uint8Array(4) },
      ],
      [
        // D19: a rewritten `meta` row is the denial-of-service path. It must
        // cost microseconds, not a worker and a 36-second burn.
        'parameters past the cost ceiling',
        {
          ...vault.record,
          kdfParams: {
            memorySizeKib: 1_048_576,
            iterations: 64,
            parallelism: 1,
          },
        },
      ],
      [
        'parameters below the strength floor',
        {
          ...vault.record,
          kdfParams: { memorySizeKib: 8, iterations: 1, parallelism: 1 },
        },
      ],
    ];

    for (const [label, record] of hostile) {
      const wired = wiring();
      const result = await unlockVault(
        record as VaultRecord,
        password(PASSWORD),
        wired,
      );
      expect(result, label).toMatchObject({
        ok: false,
        reason: 'record/invalid',
      });
      expect(wired.ports, label).toHaveLength(0);
    }
  });

  it('keeps the two copies independent when one is corrupted', async () => {
    // A recovery blob rewritten by an attacker with file access costs the
    // recovery path, not the vault.
    const corrupted: VaultRecord = {
      ...vault.record,
      recoveryWrappedDataKey: new Uint8Array(
        WRAPPED_DATA_KEY_LENGTH_BYTES,
      ).fill(0xaa),
    };
    const byPhrase = await unlockVault(
      corrupted,
      phrase(vault.recoveryPhrase),
      wiring(),
    );
    expect(byPhrase).toMatchObject({ ok: false, reason: 'secret/rejected' });

    const key = await unlockedKey(corrupted, password(PASSWORD));
    expect(await isSameDataKey(vault.dataKey, key)).toBe(true);
  });
});

describe('changeMasterPassword leaves the recovery phrase working', () => {
  it('rewrites only the password copy', async () => {
    const vault = await createVault(PASSWORD, wiring());
    const changed = await changeMasterPassword(
      vault.record,
      password(PASSWORD),
      NEXT_PASSWORD,
      wiring(),
    );
    if (!changed.ok) expect.unreachable('the password change must succeed');

    // The recovery half is carried across byte for byte.
    expect(changed.record.recoverySalt).toEqual(vault.record.recoverySalt);
    expect(changed.record.recoveryWrappedDataKey).toEqual(
      vault.record.recoveryWrappedDataKey,
    );
    // The password half is new: a fresh salt and a fresh wrapping.
    expect(changed.record.kdfSalt).not.toEqual(vault.record.kdfSalt);
    expect(changed.record.wrappedDataKey).not.toEqual(
      vault.record.wrappedDataKey,
    );
    expect(changed.record.kdfParams).toEqual(ARGON2ID_DEFAULT_PARAMS);

    // And all three of the properties that matter hold at once.
    const byNew = await unlockedKey(changed.record, password(NEXT_PASSWORD));
    expect(await isSameDataKey(vault.dataKey, byNew)).toBe(true);

    const byPhrase = await unlockedKey(
      changed.record,
      phrase(vault.recoveryPhrase),
    );
    expect(await isSameDataKey(vault.dataKey, byPhrase)).toBe(true);

    const byOld = await unlockVault(
      changed.record,
      password(PASSWORD),
      wiring(),
    );
    expect(byOld).toMatchObject({ ok: false, reason: 'secret/rejected' });
  });

  it('accepts the recovery phrase as the current secret', async () => {
    // The whole point of #68: "I forgot my password" ends in a new password,
    // not in a vault that can only ever be opened by a piece of paper.
    const vault = await createVault(PASSWORD, wiring());
    const changed = await changeMasterPassword(
      vault.record,
      phrase(vault.recoveryPhrase),
      NEXT_PASSWORD,
      wiring(),
    );
    if (!changed.ok) expect.unreachable('recovery must allow a password reset');

    const key = await unlockedKey(changed.record, password(NEXT_PASSWORD));
    expect(await isSameDataKey(vault.dataKey, key)).toBe(true);
    expect(changed.record.recoveryWrappedDataKey).toEqual(
      vault.record.recoveryWrappedDataKey,
    );
  });

  it('re-wraps at the current defaults, never at the stored parameters', async () => {
    const vault = await createVault(PASSWORD, wiring());
    // A vault created under weaker (but still admissible) parameters — what a
    // future default change leaves behind. The rewrap must not inherit them.
    const legacy: VaultRecord = {
      ...vault.record,
      kdfParams: { memorySizeKib: 19_456, iterations: 3, parallelism: 1 },
    };
    // The legacy record does not open with the original password (different
    // parameters, different master key), so change the password using the
    // recovery phrase, which is parameter-independent.
    const changed = await changeMasterPassword(
      legacy,
      phrase(vault.recoveryPhrase),
      NEXT_PASSWORD,
      wiring(),
    );
    if (!changed.ok) expect.unreachable('the password change must succeed');
    expect(changed.record.kdfParams).toEqual(ARGON2ID_DEFAULT_PARAMS);
  });

  it('rejects a wrong current secret and changes nothing', async () => {
    const vault = await createVault(PASSWORD, wiring());
    const result = await changeMasterPassword(
      vault.record,
      password('not the password'),
      NEXT_PASSWORD,
      wiring(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'secret/rejected' });

    const key = await unlockedKey(vault.record, password(PASSWORD));
    expect(await isSameDataKey(vault.dataKey, key)).toBe(true);
  });
});

describe('regenerateRecoveryPhrase leaves the password working', () => {
  it('rewrites only the recovery copy', async () => {
    const vault = await createVault(PASSWORD, wiring());
    const rotated = await regenerateRecoveryPhrase(
      vault.record,
      password(PASSWORD),
      wiring(),
    );
    if (!rotated.ok) expect.unreachable('the rotation must succeed');

    expect(rotated.recoveryPhrase).not.toBe(vault.recoveryPhrase);
    expect(rotated.record.kdfSalt).toEqual(vault.record.kdfSalt);
    expect(rotated.record.kdfParams).toEqual(vault.record.kdfParams);
    expect(rotated.record.wrappedDataKey).toEqual(vault.record.wrappedDataKey);
    expect(rotated.record.recoverySalt).not.toEqual(vault.record.recoverySalt);

    const byNewPhrase = await unlockedKey(
      rotated.record,
      phrase(rotated.recoveryPhrase),
    );
    expect(await isSameDataKey(vault.dataKey, byNewPhrase)).toBe(true);

    const byPassword = await unlockedKey(rotated.record, password(PASSWORD));
    expect(await isSameDataKey(vault.dataKey, byPassword)).toBe(true);

    const byOldPhrase = await unlockVault(
      rotated.record,
      phrase(vault.recoveryPhrase),
      wiring(),
    );
    expect(byOldPhrase).toMatchObject({ ok: false, reason: 'secret/rejected' });
  });

  it('can be driven by the old phrase itself', async () => {
    const vault = await createVault(PASSWORD, wiring());
    const rotated = await regenerateRecoveryPhrase(
      vault.record,
      phrase(vault.recoveryPhrase),
      wiring(),
    );
    if (!rotated.ok) expect.unreachable('the rotation must succeed');

    const key = await unlockedKey(
      rotated.record,
      phrase(rotated.recoveryPhrase),
    );
    expect(await isSameDataKey(vault.dataKey, key)).toBe(true);
  });

  it('rejects a wrong secret and leaves the old phrase working', async () => {
    const vault = await createVault(PASSWORD, wiring());
    const result = await regenerateRecoveryPhrase(
      vault.record,
      password('not the password'),
      wiring(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'secret/rejected' });

    const key = await unlockedKey(vault.record, phrase(vault.recoveryPhrase));
    expect(await isSameDataKey(vault.dataKey, key)).toBe(true);
  });
});

describe('the data key outlives every key change', () => {
  it('decrypts records written before a password change and a rotation', async () => {
    const vault = await createVault(PASSWORD, wiring());
    // A "record" written at setup time, under the original data key.
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: IV },
      vault.dataKey,
      CANARY,
    );

    const changed = await changeMasterPassword(
      vault.record,
      password(PASSWORD),
      NEXT_PASSWORD,
      wiring(),
    );
    if (!changed.ok) expect.unreachable('the password change must succeed');
    const rotated = await regenerateRecoveryPhrase(
      changed.record,
      password(NEXT_PASSWORD),
      wiring(),
    );
    if (!rotated.ok) expect.unreachable('the rotation must succeed');

    const key = await unlockedKey(
      rotated.record,
      phrase(rotated.recoveryPhrase),
    );
    const plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: IV },
        key,
        ciphertext,
      ),
    );
    // Nothing was re-encrypted: this is the same ciphertext bytes, read back
    // after both key changes, through the recovery path.
    expect(plaintext).toEqual(CANARY);
  });
});
