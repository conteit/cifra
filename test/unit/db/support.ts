/**
 * Shared fixtures for the db-layer suites.
 *
 * Not a `*.test.ts` file, so Vitest's `test/unit/**\/*.test.ts` glob does not
 * collect it.
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

/** Every scalar and every binary buffer reachable in a raw dump. */
export interface RawScan {
  readonly strings: string[];
  readonly numbers: number[];
  readonly buffers: Uint8Array[];
}

function walk(node: unknown, scan: RawScan, seen: Set<object>): void {
  if (typeof node === 'string') {
    scan.strings.push(node);
    return;
  }
  if (typeof node === 'number') {
    scan.numbers.push(node);
    return;
  }
  if (typeof node === 'bigint') {
    scan.strings.push(node.toString());
    return;
  }
  if (node instanceof ArrayBuffer) {
    scan.buffers.push(new Uint8Array(node));
    return;
  }
  if (ArrayBuffer.isView(node)) {
    const view = node as ArrayBufferView;
    scan.buffers.push(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, scan, seen);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    // Property *names* are part of the stored representation too: a leaked
    // field would show up as a key long before its value did.
    scan.strings.push(key);
    walk(value, scan, seen);
  }
}

/** Flattens anything — a whole dump, one store, one row — into scannable parts. */
export function scan(node: unknown): RawScan {
  const collected: RawScan = { strings: [], numbers: [], buffers: [] };
  walk(node, collected, new Set());
  return collected;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Every way `sentinel` shows up in a scan, described in words.
 *
 * A value can plausibly survive into storage in three shapes, so all three are
 * searched:
 *
 * 1. as a JavaScript string (or as a property name);
 * 2. as a number, both by exact numeric equality and by its decimal digits
 *    appearing inside a string;
 * 3. as UTF-8 bytes inside any binary buffer — which is what a "blob" that is
 *    not actually encrypted would look like.
 *
 * An empty result means the sentinel is nowhere in the dump. A non-empty result
 * is a leak (or, for the positive control, proof the scanner works).
 */
export function occurrences(
  scanned: RawScan,
  sentinel: string | number,
): string[] {
  const text = typeof sentinel === 'number' ? String(sentinel) : sentinel;
  const needle = new TextEncoder().encode(text);
  const hits: string[] = [];

  if (typeof sentinel === 'number') {
    const exact = scanned.numbers.filter((value) => value === sentinel).length;
    if (exact > 0) hits.push(`${exact} numeric value(s) equal to ${text}`);
  }
  const inStrings = scanned.strings.filter((value) =>
    value.includes(text),
  ).length;
  if (inStrings > 0) hits.push(`${inStrings} string(s) containing "${text}"`);

  const inBuffers = scanned.buffers.filter(
    (buffer) => indexOfBytes(buffer, needle) !== -1,
  ).length;
  if (inBuffers > 0) {
    hits.push(`${inBuffers} binary buffer(s) containing the UTF-8 bytes`);
  }
  return hits;
}
