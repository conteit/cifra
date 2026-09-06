/**
 * Shared fixtures for the vault-service and vault-store suites.
 *
 * Not a `*.test.ts` file, so Vitest's `test/unit/**\/*.test.ts` glob does not
 * collect it.
 *
 * Both seams here are **in-memory, not mocks**. The record store is a `Map`
 * that behaves exactly as the Dexie one does at its contract (`undefined` for
 * absent, whole-row replacement); the key sink is the real `VaultKeyHolder`,
 * including its non-extractable-AES-256-GCM check. What is faked is storage,
 * never crypto: every `createVault`/`unlockVault` below runs the shipping
 * Argon2id, AES-KW and HKDF.
 */

import { VaultKeyHolder } from '../../../app/db/vault-key';
import type {
  VaultOptions,
  VaultRecord,
  VaultRecordStore,
} from '../../../app/services/vault/types';
import { recordingKdfWorkerFactory } from '../../support/kdf-worker-port';

export interface MemoryRecordStore extends VaultRecordStore {
  /** Whatever is stored, without going through `read()`. */
  peek(): unknown | undefined;
  /** Stages a row the app never wrote — a corrupt or hostile `meta`. */
  poke(value: unknown): void;
  /** How many times `write` was called. */
  writes(): number;
}

export function memoryRecordStore(): MemoryRecordStore {
  let row: unknown | undefined;
  let writeCount = 0;
  return {
    read: async () => row,
    write: async (record: VaultRecord) => {
      writeCount += 1;
      row = record;
    },
    peek: () => row,
    poke: (value: unknown) => {
      row = value;
    },
    writes: () => writeCount,
  };
}

/** A fresh holder per case, so no case inherits another's unlocked vault. */
export function keySink(): VaultKeyHolder {
  return new VaultKeyHolder();
}

/**
 * The worker wiring every derivation needs in this project.
 *
 * Node 24 has `node:worker_threads`, not the DOM `Worker`, and CLAUDE.md
 * requires that nothing in the `unit` project need Playwright — so
 * `deriveMasterKey`'s injectable factory is filled with the in-process port
 * that runs the shipping worker body across a real `structuredClone` boundary.
 */
export function workerOptions(): VaultOptions {
  return { createWorker: recordingKdfWorkerFactory() };
}

/** Long enough to be realistic; not a secret, and never a real one. */
export const PASSWORD = 'un cavallo corretto batteria graffetta';
export const OTHER_PASSWORD = 'una password completamente diversa';
