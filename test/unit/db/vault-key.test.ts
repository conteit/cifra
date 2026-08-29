/**
 * The session data-key holder.
 *
 * Governed by `docs/architecture.md` §Session lifetime ("The data key lives in
 * module-scoped memory only. Locking drops the reference … The key is never
 * written to any storage") and FOUN-10.
 */

import { describe, expect, it } from 'vitest';
import { createWrappedDataKey } from '../../../app/crypto/key-wrap';
import { DbEncryptionError } from '../../../app/db/db-error';
import { vaultKey, VaultKeyHolder } from '../../../app/db/vault-key';
import { makeDataKey } from './support';

const subtle = globalThis.crypto.subtle;

async function expectVaultError(run: () => unknown, code: string) {
  let thrown: unknown;
  try {
    await run();
  } catch (caught) {
    thrown = caught;
  }
  expect(
    thrown,
    `expected a DbEncryptionError with code ${code}`,
  ).toBeInstanceOf(DbEncryptionError);
  expect((thrown as DbEncryptionError).code).toBe(code);
}

describe('VaultKeyHolder', () => {
  it('starts locked', () => {
    const holder = new VaultKeyHolder();
    expect(holder.isUnlocked).toBe(false);
  });

  it('reports vault/locked rather than an opaque crypto failure', async () => {
    const holder = new VaultKeyHolder();
    await expectVaultError(() => holder.require(), 'vault/locked');
  });

  it('holds and returns the key while unlocked', async () => {
    const holder = new VaultKeyHolder();
    const dataKey = await makeDataKey();

    holder.unlock(dataKey);

    expect(holder.isUnlocked).toBe(true);
    expect(holder.require()).toBe(dataKey);
  });

  it('drops the reference on lock, idempotently', async () => {
    const holder = new VaultKeyHolder();
    holder.unlock(await makeDataKey());

    holder.lock();
    holder.lock();

    expect(holder.isUnlocked).toBe(false);
    await expectVaultError(() => holder.require(), 'vault/locked');
  });

  it('keeps the key out of reach of enumeration and serialization', async () => {
    const holder = new VaultKeyHolder();
    holder.unlock(await makeDataKey());

    // A `#private` field is not an own property, so the key cannot be picked up
    // by a spread, a JSON dump, or a structured clone into IndexedDB.
    expect(Object.keys(holder)).toEqual([]);
    expect(JSON.stringify(holder)).toBe('{}');
  });

  describe('rejects a key that is not the one unwrapDataKey returns', () => {
    it('rejects an extractable key', async () => {
      const holder = new VaultKeyHolder();
      const extractable = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );

      await expectVaultError(
        () => holder.unlock(extractable),
        'vault/invalid-key',
      );
      expect(holder.isUnlocked).toBe(false);
    });

    it('rejects the wrong algorithm', async () => {
      const holder = new VaultKeyHolder();
      const masterKey = await subtle.generateKey(
        { name: 'AES-KW', length: 256 },
        false,
        ['wrapKey', 'unwrapKey'],
      );

      await expectVaultError(
        () => holder.unlock(masterKey),
        'vault/invalid-key',
      );
    });

    it('rejects the wrong key length', async () => {
      const holder = new VaultKeyHolder();
      const short = await subtle.generateKey(
        { name: 'AES-GCM', length: 128 },
        false,
        ['encrypt', 'decrypt'],
      );

      await expectVaultError(() => holder.unlock(short), 'vault/invalid-key');
    });

    it('rejects anything that is not a CryptoKey', async () => {
      const holder = new VaultKeyHolder();
      await expectVaultError(
        () => holder.unlock({} as CryptoKey),
        'vault/invalid-key',
      );
    });

    it('accepts exactly what createWrappedDataKey produces', async () => {
      const holder = new VaultKeyHolder();
      const masterKey = await subtle.generateKey(
        { name: 'AES-KW', length: 256 },
        false,
        ['wrapKey', 'unwrapKey'],
      );
      const { dataKey } = await createWrappedDataKey(masterKey);

      expect(() => holder.unlock(dataKey)).not.toThrow();
    });
  });
});

describe('the module-scoped holder', () => {
  it('exists and starts locked, as §Session lifetime requires', () => {
    expect(vaultKey).toBeInstanceOf(VaultKeyHolder);
    expect(vaultKey.isUnlocked).toBe(false);
  });
});
