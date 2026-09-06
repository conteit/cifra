import { describe, expect, it } from 'vitest';

import {
  assertVaultRecord,
  createVault,
  type VaultRecord,
} from '../../../app/crypto/vault';
import {
  readVaultRecord,
  VAULT_META_KEY,
  writeVaultRecord,
} from '../../../app/db/vault-record-store';
import { recordingKdfWorkerFactory } from '../../support/kdf-worker-port';
import { openTestVault, rawDump } from './support';

/**
 * The `meta` row round trip (#9).
 *
 * `app/crypto/vault.ts` hands back a `VaultRecord` and persists nothing; this
 * is the module that stores it, and the property that matters is not "a write
 * happened" but **"the record that comes back still opens the vault"**. IndexedDB
 * structured-clones what it stores, so a `Uint8Array` that came back as a plain
 * object, or a frozen `kdfParams` that lost its fields, would be a vault nobody
 * could ever open again — and nothing in the type system would notice, because
 * the read side is typed `unknown` by design.
 *
 * One derivation is shared across the suite: at 64 MiB × 3 passes each
 * `createVault` costs ~100 ms, and this file is about storage, not the KDF.
 */

const PASSWORD = 'un cavallo corretto batteria graffetta';

let cached: Promise<VaultRecord> | undefined;

/** A real record from the real creation path, made once. */
function aRecord(): Promise<VaultRecord> {
  cached ??= createVault(PASSWORD, {
    createWorker: recordingKdfWorkerFactory(),
  }).then((created) => created.record);
  return cached;
}

describe('the vault meta row', () => {
  it('reports absence as undefined, which is what routes a first run to setup', async () => {
    const vault = await openTestVault();
    try {
      expect(await readVaultRecord(vault.db)).toBeUndefined();
    } finally {
      vault.close();
    }
  });

  it('survives the round trip intact enough to still be a vault', async () => {
    const record = await aRecord();
    const vault = await openTestVault();
    try {
      await writeVaultRecord(vault.db, record);
      const read = await readVaultRecord(vault.db);

      // The load-bearing assertion: the crypto layer's own gate accepts what
      // came back out of IndexedDB. A `Uint8Array` degraded to `{0:1,1:2,…}`
      // by structured clone fails here, which is the failure this test exists
      // to catch.
      expect(() => assertVaultRecord(read)).not.toThrow();

      const stored = read as VaultRecord;
      expect(stored.version).toBe(record.version);
      expect(stored.kdfParams).toEqual(record.kdfParams);
      expect([...stored.kdfSalt]).toEqual([...record.kdfSalt]);
      expect([...stored.wrappedDataKey]).toEqual([...record.wrappedDataKey]);
      expect([...stored.recoverySalt]).toEqual([...record.recoverySalt]);
      expect([...stored.recoveryWrappedDataKey]).toEqual([
        ...record.recoveryWrappedDataKey,
      ]);
    } finally {
      vault.close();
    }
  });

  it('stores both wrapped copies in ONE row, under one key', async () => {
    const record = await aRecord();
    const vault = await openTestVault();
    try {
      await writeVaultRecord(vault.db, record);
      // Read through a second, plain IndexedDB connection: no Dexie, no
      // middleware. A record split across rows could be half-written, and half
      // a vault is an unopenable one (D26 — the two copies are created together
      // precisely so they cannot be interleaved).
      const dump = await rawDump(vault.name);
      expect(dump.meta).toHaveLength(1);
      const row = dump.meta[0] as Record<string, unknown>;
      expect(row.key).toBe(VAULT_META_KEY);
      expect(row.wrappedDataKey).toBeInstanceOf(Uint8Array);
      expect(row.recoveryWrappedDataKey).toBeInstanceOf(Uint8Array);
    } finally {
      vault.close();
    }
  });

  it('replaces the row whole rather than merging into it', async () => {
    // A password change rewrites `kdfSalt` and `wrappedDataKey` together. A
    // merge that kept the old salt beside the new wrapped key would produce a
    // row that validates and never opens.
    const record = await aRecord();
    const vault = await openTestVault();
    try {
      await writeVaultRecord(vault.db, record);
      await writeVaultRecord(vault.db, {
        ...record,
        kdfSalt: new Uint8Array(record.kdfSalt.length).fill(0x5a),
      });

      const dump = await rawDump(vault.name);
      expect(dump.meta).toHaveLength(1);
      const stored = (await readVaultRecord(vault.db)) as VaultRecord;
      expect([...stored.kdfSalt]).toEqual(
        Array.from({ length: record.kdfSalt.length }, () => 0x5a),
      );
    } finally {
      vault.close();
    }
  });

  it('is stored in plaintext, because it must be readable before a key exists', async () => {
    // §Table field allowlist: `meta` is "plaintext by design". Encrypting the
    // row under the key it is used to obtain is circular, and the middleware
    // must therefore leave it alone — asserted here rather than assumed,
    // because a change to the allowlist would silently make every vault
    // unopenable on the next cold start.
    const record = await aRecord();
    const vault = await openTestVault({ unlocked: false });
    try {
      // No data key held at all, and the write still succeeds: the middleware
      // has nothing to do on this table.
      await writeVaultRecord(vault.db, record);
      const read = await readVaultRecord(vault.db);
      expect(() => assertVaultRecord(read)).not.toThrow();
    } finally {
      vault.close();
    }
  });
});
