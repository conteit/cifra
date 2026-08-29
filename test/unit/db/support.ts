/**
 * Shared fixtures for the db-layer suites.
 *
 * Not a `*.test.ts` file, so Vitest's `test/unit/**\/*.test.ts` glob does not
 * collect it.
 *
 * The plaintext-leak *scanner* used to live here too. It moved to
 * `test/support/raw-scan.ts` when #42 added a second leak test that runs in a
 * real browser: one scanner with two callers cannot drift into two different
 * definitions of "found", which is the cheapest way a negative assertion goes
 * quietly vacuous. What is left here is everything that needs an `indexedDB` —
 * in this project's `unit` suite, `fake-indexeddb`.
 */

import 'fake-indexeddb/auto';

import { createWrappedDataKey } from '../../../app/crypto/key-wrap';
import { CifraDatabase } from '../../../app/db/database';
import { VaultKeyHolder } from '../../../app/db/vault-key';

const subtle = globalThis.crypto.subtle;

/**
 * A data key with exactly the shape `unwrapDataKey` returns.
 *
 * The master key is generated directly rather than derived: a full Argon2id
 * derivation at the architecture's 64 MiB / 3 passes costs ~100 ms, and this
 * suite exercises the db layer, not the KDF (which has its own vectors in
 * `test/unit/crypto/kdf.test.ts`).
 */
export async function makeDataKey(): Promise<CryptoKey> {
  const masterKey = await subtle.generateKey(
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
  return (await createWrappedDataKey(masterKey)).dataKey;
}

let databaseCounter = 0;

export interface TestVault {
  readonly db: CifraDatabase;
  readonly name: string;
  readonly keys: VaultKeyHolder;
  close(): void;
}

/**
 * A freshly named database with its own key holder, already unlocked.
 *
 * One database per case: IndexedDB is process-global even under
 * `fake-indexeddb`, so sharing a name across cases makes them order-dependent.
 */
export async function openTestVault(
  options: { unlocked?: boolean; dataKey?: CryptoKey } = {},
): Promise<TestVault> {
  const name = `cifra-test-${++databaseCounter}-${Date.now()}`;
  const keys = new VaultKeyHolder();
  if (options.unlocked !== false) {
    keys.unlock(options.dataKey ?? (await makeDataKey()));
  }
  const db = new CifraDatabase(name, keys);
  await db.open();
  return {
    db,
    name,
    keys,
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------
// Raw IndexedDB inspection — deliberately bypasses Dexie and the middleware
// ---------------------------------------------------------------------------

/** Everything an object store holds, exactly as IndexedDB gave it back. */
export type RawDump = Record<string, unknown[]>;

/**
 * Opens a **second, plain IndexedDB connection** to `name` and reads every
 * store with `getAll()`.
 *
 * No Dexie, no middleware, no decryption: this is the DevTools view the
 * architecture's "unreadable via DevTools" success criterion is about.
 */
export function rawDump(name: string): Promise<RawDump> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const connection = request.result;
      const storeNames = [...connection.objectStoreNames];
      if (storeNames.length === 0) {
        connection.close();
        resolve({});
        return;
      }
      const transaction = connection.transaction(storeNames, 'readonly');
      const dump: RawDump = {};
      for (const storeName of storeNames) {
        const getAll = transaction.objectStore(storeName).getAll();
        getAll.onsuccess = () => {
          dump[storeName] = getAll.result as unknown[];
        };
      }
      transaction.oncomplete = () => {
        connection.close();
        resolve(dump);
      };
      transaction.onerror = () => {
        connection.close();
        reject(transaction.error);
      };
    };
  });
}

/**
 * Reads or writes one row through a plain IndexedDB connection, bypassing
 * Dexie and the middleware entirely.
 *
 * This is how the tamper-detection cases stage a hostile database: an attacker
 * with file access edits rows without going through the application, so the
 * tests must be able to as well.
 */
function rawTransaction<T>(
  name: string,
  store: string,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction([store], mode);
      const operation = run(transaction.objectStore(store));
      transaction.oncomplete = () => {
        connection.close();
        resolve(operation.result as T);
      };
      transaction.onerror = () => {
        connection.close();
        reject(transaction.error);
      };
    };
  });
}

export function rawGet(name: string, store: string, key: string) {
  return rawTransaction<unknown>(name, store, 'readonly', (objectStore) =>
    objectStore.get(key),
  );
}

export function rawPut(name: string, store: string, value: unknown) {
  return rawTransaction<unknown>(name, store, 'readwrite', (objectStore) =>
    objectStore.put(value),
  );
}
