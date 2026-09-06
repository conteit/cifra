/**
 * The composition root for the live vault service.
 *
 * The one place the pure service meets Dexie and the process-wide key holder —
 * the same shape `app/stores/session-instance.ts` uses for identity, and for
 * the same reason: it lets `vault-service.ts` be unit-tested against in-memory
 * seams while the app still runs against the real database.
 *
 * Constructed lazily so that importing this module has no side effect.
 * `getDatabase()` calls `new Dexie(...)`, which touches `indexedDB`; that must
 * not happen during the SPA prerender, in Storybook, or in a test that only
 * needs a type.
 */

import { getDatabase } from '../../db/database';
import { vaultKey } from '../../db/vault-key';
import { readVaultRecord, writeVaultRecord } from '../../db/vault-record-store';
import type { VaultRecord, VaultRecordStore, VaultService } from './types';
import { createVaultService } from './vault-service';

const dexieRecords: VaultRecordStore = {
  read: () => readVaultRecord(getDatabase()),
  write: (record: VaultRecord) => writeVaultRecord(getDatabase(), record),
};

let instance: VaultService | undefined;

export function getVaultService(): VaultService {
  instance ??= createVaultService({ records: dexieRecords, keys: vaultKey });
  return instance;
}
