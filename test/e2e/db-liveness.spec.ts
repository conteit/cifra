import { expect, type Page, test } from '@playwright/test';

import { MIN_ENVELOPE_LENGTH_BYTES } from '../../app/crypto/record-cipher';
import type { CifraDatabase } from '../../app/db/database';
import type { DbTestApi } from '../../app/db/db-test-api';
import { DB_TEST_HANDLE } from '../../app/db/db-test-handle';
import type { CategoryRow, TransactionRow } from '../../app/db/schema';
import { ENCRYPTED_BLOB_FIELD } from '../../app/db/schema';
import type { VaultKeyHolder } from '../../app/db/vault-key';
import { occurrences, scan } from '../support/raw-scan';

/**
 * Issue #42 — **the encrypted database layer, executed in a real browser.**
 *
 * ## What was actually wrong
 *
 * The issue title says the `Dexie.waitFor` adapter is proven only against
 * `fake-indexeddb`. The Sprint 01 review found something broader: *nothing in
 * the application imports `app/db/` or `app/crypto/`.* No route, no store, no
 * story. The whole encrypted db layer had never run in a browser, in any test,
 * ever — only in Node, against a fake IndexedDB.
 *
 * That matters because of one specific hazard. `docs/architecture.md`
 * §Encryption middleware: an IndexedDB transaction is only *active* during the
 * task that created it and during its own request callbacks, and
 * `crypto.subtle.encrypt` resolves in a later task — so a bare `await` inside a
 * Dexie transaction lets the transaction commit underneath the middleware and
 * the next operation throws `InvalidStateError`. The middleware answers with
 * `Dexie.waitFor`, which keeps a dummy request outstanding while the promise is
 * pending. Whether that is *sufficient* depends entirely on the engine's
 * transaction-commit scheduling, and `fake-indexeddb`'s scheduler is not
 * Chromium's. If `waitFor` were not enough in a real browser, every write would
 * fail and `npm run verify` would stay green, because no test would run the
 * code.
 *
 * This spec closes that. Everything below is the real middleware, the real
 * Dexie, real IndexedDB and real Web Crypto, in the same Chromium the rest of
 * the e2e suite uses.
 *
 * ## What the mutation run found — read this before trusting the file
 *
 * Removing `Dexie.waitFor` from the middleware fails **26 Node tests and zero
 * tests here.** It is not load-bearing in this Chromium, and no browser test
 * would have caught its deletion. The last-but-one test in this file measures
 * why and pins it; `docs/architecture.md` D20 records the decision to keep
 * `waitFor` anyway. Every other mutation tried — unbinding `date` from the AAD,
 * storing `description` in the clear, reusing an envelope instead of
 * re-encrypting — is caught here.
 *
 * ## How it reaches the db layer
 *
 * Through `window[DB_TEST_HANDLE]`, published by `app/root.tsx` behind the same
 * build-time `import.meta.env.MODE` literal that gates the Auth emulator (#44),
 * and asserted out of the production bundle by the guard in `vite.config.ts`.
 * `app/db/db-test-handle.ts` carries the full argument and the deletion plan.
 * The handle hands over constructors only — `CifraDatabase`, `VaultKeyHolder`,
 * and the key-hierarchy functions — so what runs here is the shipping code, not
 * a test-shaped imitation of it.
 *
 * ## No identity is involved, deliberately
 *
 * `docs/architecture.md` §Crypto step 1: identity "never touches encryption
 * material". The vault key hierarchy starts at the master password, so this
 * spec signs nobody in and never touches the Auth emulator. (Playwright still
 * starts the emulator, because `playwright.config.ts` starts it for the whole
 * run; this file simply does not use it.) A spec that needed sign-in would be
 * slower, flakier, and would assert a coupling the architecture says is not
 * there.
 *
 * ## Cost
 *
 * One Argon2id derivation at the production parameters (64 MiB × 3) is the only
 * expensive thing here, so it happens **once** in `beforeAll` and every test
 * re-unwraps the same 40-byte AES-KW blob, which is free. That is also the
 * honest shape: a real session derives once, at unlock.
 */

// One page, one key derivation, shared state in page globals.
test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// The page-side harness
// ---------------------------------------------------------------------------

/** A failure carried back out of page context, since `Error` does not travel. */
interface Failure {
  readonly name: string;
  readonly code: string | null;
  readonly message: string;
}

type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Failure };

interface Vault {
  readonly name: string;
  readonly db: CifraDatabase;
  readonly keys: VaultKeyHolder;
}

/** Everything an object store holds, exactly as IndexedDB gave it back. */
type RawDump = Record<string, unknown[]>;

interface Harness {
  /** A freshly named database with its own unlocked key holder. */
  openVault(): Promise<Vault>;
  /** Re-unwraps the session data key into a holder that was locked. */
  unlock(keys: VaultKeyHolder): Promise<void>;
  /** Runs `fn`, returning either its value or a serializable description. */
  attempt<T>(fn: () => Promise<T> | T): Promise<Attempt<T>>;
  /** Every store of `name`, read through a plain IndexedDB connection. */
  rawDump(name: string): Promise<RawDump>;
  /** One row, through a plain IndexedDB connection. Page-side objects. */
  rawGet(name: string, store: string, key: string): Promise<unknown>;
  /** Writes one row behind Dexie's back — how a tamper case stages a hostile db. */
  rawPut(name: string, store: string, value: unknown): Promise<void>;
  /** Boxes `Uint8Array`s so a value survives the trip back to Node. */
  box(node: unknown): unknown;
}

/** Where the harness lives in the page. */
const HARNESS = '__cifraE2EHarness';

/** The single argument every `page.evaluate` below takes. */
interface Args<T> {
  readonly harness: string;
  readonly payload: T;
}

const args = <T>(payload: T): Args<T> => ({ harness: HARNESS, payload });

/**
 * Installs the harness and derives the vault key hierarchy — once per page.
 *
 * Steps 2 and 3 of `docs/architecture.md` §Crypto run for real here: a random
 * 16-byte salt, Argon2id at `ARGON2ID_DEFAULT_PARAMS` (64 MiB, 3 passes) into a
 * non-extractable AES-KW master key, which wraps a randomly generated
 * AES-256-GCM data key. Every vault opened below unwraps that same blob, so the
 * key each test holds is one that came out of `unwrapDataKey` —
 * non-extractable, `encrypt`/`decrypt` only — exactly as the unlock flow will
 * produce it.
 */
async function installHarness(target: Page): Promise<void> {
  await target.waitForFunction(
    (handle) => (globalThis as Record<string, unknown>)[handle] !== undefined,
    DB_TEST_HANDLE,
    { timeout: 30_000 },
  );

  await target.evaluate(
    async (input: { dbHandle: string; harnessKey: string }) => {
      const globals = globalThis as unknown as Record<string, unknown>;
      const api = globals[input.dbHandle] as DbTestApi;

      const salt = api.generateSalt();
      const masterKey = await api.deriveMasterKey(
        'cifra e2e — parola d’ordine lunga e distintiva',
        salt,
        api.ARGON2ID_DEFAULT_PARAMS,
      );
      const { wrappedDataKey } = await api.createWrappedDataKey(masterKey);
      let counter = 0;

      const box = (node: unknown): unknown => {
        if (node instanceof ArrayBuffer) {
          return { __u8: Array.from(new Uint8Array(node)) };
        }
        if (ArrayBuffer.isView(node)) {
          const view = node as ArrayBufferView;
          return {
            __u8: Array.from(
              new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
            ),
          };
        }
        if (Array.isArray(node)) return node.map(box);
        if (node !== null && typeof node === 'object') {
          const out: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(node)) {
            out[key] = box(value);
          }
          return out;
        }
        return node;
      };

      const connect = (name: string): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

      const harness: Harness = {
        async openVault() {
          const name = `cifra-e2e-${Date.now()}-${++counter}`;
          const keys = new api.VaultKeyHolder();
          keys.unlock(await api.unwrapDataKey(masterKey, wrappedDataKey));
          const db = new api.CifraDatabase(name, keys);
          await db.open();
          return { name, db, keys };
        },

        async unlock(keys) {
          keys.unlock(await api.unwrapDataKey(masterKey, wrappedDataKey));
        },

        async attempt(fn) {
          try {
            return { ok: true, value: await fn() };
          } catch (caught) {
            const error = caught as Partial<Error> & { code?: string };
            return {
              ok: false,
              error: {
                name: error?.name ?? 'unknown',
                code: error?.code ?? null,
                message: String(error?.message ?? caught),
              },
            };
          }
        },

        async rawDump(name) {
          const connection = await connect(name);
          const storeNames = [...connection.objectStoreNames];
          if (storeNames.length === 0) {
            connection.close();
            return {};
          }
          const collected = await new Promise<RawDump>((resolve, reject) => {
            const transaction = connection.transaction(storeNames, 'readonly');
            const dump: RawDump = {};
            for (const storeName of storeNames) {
              const getAll = transaction.objectStore(storeName).getAll();
              getAll.onsuccess = () => {
                dump[storeName] = getAll.result as unknown[];
              };
            }
            transaction.oncomplete = () => resolve(dump);
            transaction.onerror = () => reject(transaction.error);
          });
          connection.close();
          return box(collected) as RawDump;
        },

        async rawGet(name, store, key) {
          const connection = await connect(name);
          const row = await new Promise<unknown>((resolve, reject) => {
            const transaction = connection.transaction([store], 'readonly');
            const request = transaction.objectStore(store).get(key);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
          });
          connection.close();
          return row;
        },

        async rawPut(name, store, value) {
          const connection = await connect(name);
          await new Promise<void>((resolve, reject) => {
            const transaction = connection.transaction([store], 'readwrite');
            transaction.objectStore(store).put(value);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
          });
          connection.close();
        },

        box,
      };

      globals[input.harnessKey] = harness;
    },
    { dbHandle: DB_TEST_HANDLE, harnessKey: HARNESS },
  );
}

/**
 * Rebuilds the `Uint8Array`s the harness boxed for the trip out of the page.
 *
 * Binary buffers are the values most likely to arrive as `{}` across the CDP
 * boundary, and the envelope *is* the buffer the leak scan has to search — so
 * they are boxed explicitly rather than trusted, and the leak test's positive
 * control proves the round trip really preserved them.
 */
function unbox(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(unbox);
  const entries = Object.entries(node);
  const boxed = (node as { __u8?: unknown }).__u8;
  if (entries.length === 1 && Array.isArray(boxed)) {
    return Uint8Array.from(boxed as number[]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) out[key] = unbox(value);
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures — synthetic, per CLAUDE.md. Integer cents, never floats.
// ---------------------------------------------------------------------------

function txn(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 'txn-0001',
    date: '2026-08-01',
    type: 'electronic',
    amount: -4599,
    description: 'Spesa settimanale',
    ...overrides,
  };
}

/**
 * Distinctive values that could only come from these records — deliberately not
 * realistic bank data, so a canary cannot collide with anything else on the
 * page.
 */
const SENTINEL = {
  id: 'txn-CANARY-e2e-9f3c4e21',
  date: '2026-08-01',
  type: 'electronic',
  description: 'CANARY-e2e-descrizione-7b1a9d',
  category: 'CANARY-e2e-categoria-3e5f0c',
  notes: 'CANARY-e2e-nota-libera-6d2b84',
  amount: -1234567,
  categoryId: 'cat-CANARY-e2e-11ff8802',
  categoryName: 'CANARY-e2e-nome-categoria-4a7e',
  metaValue: 'CANARY-e2e-meta-plaintext-5c9d',
} as const;

const LEAK_TRANSACTION: TransactionRow = {
  id: SENTINEL.id,
  date: SENTINEL.date,
  type: 'electronic',
  amount: SENTINEL.amount,
  description: SENTINEL.description,
  category: SENTINEL.category,
  notes: SENTINEL.notes,
};

const LEAK_CATEGORY: CategoryRow = {
  id: SENTINEL.categoryId,
  name: SENTINEL.categoryName,
};

/** Must never appear anywhere in raw IndexedDB. */
const SECRETS: readonly (string | number)[] = [
  SENTINEL.description,
  SENTINEL.category,
  SENTINEL.notes,
  SENTINEL.amount,
  SENTINEL.categoryName,
];

/** Plaintext-indexed by design, so the scan must be able to *find* these. */
const STRUCTURAL: readonly string[] = [
  SENTINEL.id,
  SENTINEL.date,
  SENTINEL.type,
  SENTINEL.categoryId,
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let page: Page;

/**
 * Anything that escapes as an uncaught error or unhandled rejection.
 *
 * `InvalidStateError` from a committed transaction is exactly the kind of
 * failure that surfaces as an unhandled rejection rather than as a rejected
 * promise a test awaited, so it is collected and asserted on at the end of the
 * file instead of being lost to the console.
 */
const pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (error) => {
    pageErrors.push(`${error.name}: ${error.message}`);
  });
  await page.goto('/');
  await installHarness(page);
});

test.afterAll(async () => {
  await page.close();
});

test('a write/read cycle survives a real IndexedDB transaction', async () => {
  // The core of #42. Several sequential Web Crypto awaits inside ONE explicit
  // read-write transaction: three encrypts, one more for another table, then
  // decrypts on the way back out. Without `Dexie.waitFor` the transaction
  // commits after the first `subtle.encrypt` settles and everything after it
  // fails with `InvalidStateError` / `TransactionInactiveError`.
  const result = await page.evaluate(
    async (input: Args<{ rows: TransactionRow[]; category: CategoryRow }>) => {
      const h = (globalThis as unknown as Record<string, Harness>)[
        input.harness
      ];
      const { rows, category } = input.payload;
      const { db } = await h.openVault();

      const inside = await h.attempt(async () =>
        db.transaction('rw', db.transactions, db.categories, async () => {
          await db.transactions.bulkPut(rows);
          await db.categories.add(category);
          return {
            get: (await db.transactions.get(rows[0].id)) ?? null,
            ordered: (await db.transactions.orderBy('date').toArray()).map(
              (row) => row.id,
            ),
            amounts: (await db.transactions.toArray()).map((row) => row.amount),
            keys: await db.transactions.toCollection().primaryKeys(),
            count: await db.transactions.count(),
            categoryBack: (await db.categories.get(category.id)) ?? null,
          };
        }),
      );

      const outside = await h.attempt(async () => ({
        bulkGet: (
          await db.transactions.bulkGet([rows[0].id, 'missing', rows[2].id])
        ).map((row) => row ?? null),
        ranged: (
          await db.transactions
            .where('date')
            .between('2026-02-01', '2026-03-31')
            .toArray()
        ).map((row) => row.id),
        byType: (
          await db.transactions.where('type').equals('cash').toArray()
        ).map((row) => row.id),
        indexKeys: await db.transactions.where('type').equals('cash').keys(),
      }));

      return { inside, outside };
    },
    args({
      rows: [
        txn({ id: 'a', date: '2026-01-05', amount: -1 }),
        txn({ id: 'b', date: '2026-02-05', amount: -2 }),
        txn({ id: 'c', date: '2026-03-05', amount: -3, type: 'cash' }),
      ],
      category: { id: 'cat-0001', name: 'Alimentari' } as CategoryRow,
    }),
  );

  // Reported as "the transaction died", not as a mismatched array further down.
  expect(result.inside.ok ? null : result.inside.error).toBeNull();
  expect(result.outside.ok ? null : result.outside.error).toBeNull();
  if (!result.inside.ok || !result.outside.ok) return;

  const inside = result.inside.value;
  expect(inside.get).toEqual(txn({ id: 'a', date: '2026-01-05', amount: -1 }));
  expect(inside.ordered).toEqual(['a', 'b', 'c']);
  // Integer cents, exactly — nothing on this path divides by 100.
  expect(inside.amounts).toEqual([-1, -2, -3]);
  for (const amount of inside.amounts) {
    expect(Number.isSafeInteger(amount)).toBe(true);
  }
  expect(inside.keys).toEqual(['a', 'b', 'c']);
  expect(inside.count).toBe(3);
  expect(inside.categoryBack).toEqual({ id: 'cat-0001', name: 'Alimentari' });

  const outside = result.outside.value;
  expect(outside.bulkGet[0]).toEqual(
    txn({ id: 'a', date: '2026-01-05', amount: -1 }),
  );
  expect(outside.bulkGet[1]).toBeNull();
  expect(outside.bulkGet[2]).toEqual(
    txn({ id: 'c', date: '2026-03-05', amount: -3, type: 'cash' }),
  );
  expect(outside.ranged).toEqual(['b', 'c']);
  expect(outside.byType).toEqual(['c']);
  // `values: false` — index keys, never run through the cipher.
  expect(outside.indexKeys).toEqual(['cash']);
});

test('update() and modify() read-modify-write through the middleware', async () => {
  // These are the two paths #6 reproduced `InvalidStateError` on, and the whole
  // reason `Dexie.waitFor` is in the middleware: each is a decrypt (getMany)
  // followed by an encrypt (mutate) inside one transaction Dexie opened itself.
  const result = await page.evaluate(
    async (input: Args<TransactionRow[]>) => {
      const h = (globalThis as unknown as Record<string, Harness>)[
        input.harness
      ];
      const rows = input.payload;
      const { db } = await h.openVault();
      await db.transactions.bulkPut(rows);

      const updated = await h.attempt(() =>
        db.transactions.update(rows[0].id, {
          category: 'Trasporti',
          amount: -5000,
        }),
      );
      const afterUpdate = (await db.transactions.get(rows[0].id)) ?? null;

      const modified = await h.attempt(() =>
        db.transactions
          .where('type')
          .equals('electronic')
          .modify((row) => {
            row.notes = 'rivisto';
          }),
      );
      const afterModify = (await db.transactions.orderBy('id').toArray()).map(
        (row) => row.notes ?? null,
      );

      // Once more with both inside a single explicit transaction, where the
      // transaction has already survived two crypto awaits before `update()`
      // even starts.
      const nested = await h.attempt(async () =>
        db.transaction('rw', db.transactions, async () => {
          await db.transactions.update(rows[1].id, { amount: -777 });
          await db.transactions
            .where('id')
            .equals(rows[1].id)
            .modify((row) => {
              row.description = 'aggiornata in transazione';
            });
          return (await db.transactions.get(rows[1].id)) ?? null;
        }),
      );

      return { updated, afterUpdate, modified, afterModify, nested };
    },
    args([txn({ id: 'a' }), txn({ id: 'b', amount: -200 })]),
  );

  expect(result.updated.ok ? null : result.updated.error).toBeNull();
  expect(result.modified.ok ? null : result.modified.error).toBeNull();
  expect(result.nested.ok ? null : result.nested.error).toBeNull();

  // Read before modify() ran, so no notes yet.
  expect(result.afterUpdate).toEqual(
    txn({ id: 'a', category: 'Trasporti', amount: -5000 }),
  );
  expect(result.afterModify).toEqual(['rivisto', 'rivisto']);
  expect(result.nested.ok ? result.nested.value : null).toEqual(
    txn({
      id: 'b',
      amount: -777,
      description: 'aggiornata in transazione',
      notes: 'rivisto',
    }),
  );
});

test('a primary-key change re-encrypts rather than re-indexing', async () => {
  // `docs/architecture.md` §Crypto step 4: the record id is bound into the AAD,
  // so a row that merely moved would fail to authenticate. That the new row
  // *reads back* is the proof it was re-sealed under its new id.
  const result = await page.evaluate(
    async (input: Args<TransactionRow>) => {
      const h = (globalThis as unknown as Record<string, Harness>)[
        input.harness
      ];
      const record = input.payload;
      const { db, name } = await h.openVault();
      await db.transactions.put(record);
      const before = h.box(await h.rawGet(name, 'transactions', record.id));

      const moved = await h.attempt(() =>
        db.transactions
          .where('id')
          .equals(record.id)
          .modify((mutable) => {
            mutable.id = 'txn-moved-0002';
          }),
      );

      return {
        moved,
        before,
        after: h.box(await h.rawGet(name, 'transactions', 'txn-moved-0002')),
        atNewId: (await db.transactions.get('txn-moved-0002')) ?? null,
        atOldId: (await db.transactions.get(record.id)) ?? null,
      };
    },
    args(txn({ id: 'txn-original-0001' })),
  );

  expect(result.moved.ok ? null : result.moved.error).toBeNull();
  expect(result.atNewId).toEqual(txn({ id: 'txn-moved-0002' }));
  expect(result.atOldId).toBeNull();

  const before = unbox(result.before) as Record<string, unknown>;
  const after = unbox(result.after) as Record<string, unknown>;
  expect(after[ENCRYPTED_BLOB_FIELD]).toBeInstanceOf(Uint8Array);
  expect(after[ENCRYPTED_BLOB_FIELD]).not.toEqual(before[ENCRYPTED_BLOB_FIELD]);
});

test('a change to an AAD-bound column re-encrypts the record', async () => {
  // #51 / D18: `date` and `type` are plaintext-indexed but authenticated with
  // the record, so changing either has to re-emit the ciphertext. If a write
  // ever re-indexed without re-sealing, the very next read of that row would
  // fail `record/corrupt` — which is what makes these reads the assertion.
  const result = await page.evaluate(async (input: Args<TransactionRow>) => {
    const h = (globalThis as unknown as Record<string, Harness>)[input.harness];
    const record = input.payload;
    const { db, name } = await h.openVault();
    await db.transactions.put(record);
    const initial = h.box(await h.rawGet(name, 'transactions', record.id));

    const dateChanged = await h.attempt(() =>
      db.transactions.update(record.id, { date: '2026-09-15' }),
    );
    const afterDate = (await db.transactions.get(record.id)) ?? null;
    const rawAfterDate = h.box(await h.rawGet(name, 'transactions', record.id));

    const typeChanged = await h.attempt(() =>
      db.transactions
        .where('type')
        .equals('electronic')
        .modify((mutable) => {
          mutable.type = 'cash';
        }),
    );
    const afterType = (await db.transactions.get(record.id)) ?? null;
    const rawAfterType = h.box(await h.rawGet(name, 'transactions', record.id));

    return {
      dateChanged,
      typeChanged,
      afterDate,
      afterType,
      initial,
      rawAfterDate,
      rawAfterType,
    };
  }, args(txn()));

  expect(result.dateChanged.ok ? null : result.dateChanged.error).toBeNull();
  expect(result.typeChanged.ok ? null : result.typeChanged.error).toBeNull();
  expect(result.afterDate).toEqual(txn({ date: '2026-09-15' }));
  expect(result.afterType).toEqual(txn({ date: '2026-09-15', type: 'cash' }));

  const initial = unbox(result.initial) as Record<string, unknown>;
  const afterDate = unbox(result.rawAfterDate) as Record<string, unknown>;
  const afterType = unbox(result.rawAfterType) as Record<string, unknown>;
  expect(afterDate.date).toBe('2026-09-15');
  expect(afterType.type).toBe('cash');
  // Re-encrypted, not merely re-indexed: a fresh envelope both times.
  expect(afterDate[ENCRYPTED_BLOB_FIELD]).not.toEqual(
    initial[ENCRYPTED_BLOB_FIELD],
  );
  expect(afterType[ENCRYPTED_BLOB_FIELD]).not.toEqual(
    afterDate[ENCRYPTED_BLOB_FIELD],
  );
});

test('locking drops the data key and the table stops being readable', async () => {
  // §Session lifetime: "Locking drops the reference." Every encrypted path must
  // then fail `vault/locked` — never ciphertext, never an opaque Web Crypto
  // error — while the plaintext `meta` table stays reachable, which is what
  // lets the unlock flow read the wrapped key back.
  const result = await page.evaluate(async (input: Args<TransactionRow>) => {
    const h = (globalThis as unknown as Record<string, Harness>)[input.harness];
    const record = input.payload;
    const { db, keys } = await h.openVault();
    await db.transactions.put(record);
    await db.meta.put({ key: 'vault', hint: 'plaintext by design' });

    keys.lock();

    const lockedAttempts: Array<[string, Attempt<unknown>]> = [
      ['get', await h.attempt(() => db.transactions.get(record.id))],
      ['count', await h.attempt(() => db.transactions.count())],
      ['put', await h.attempt(() => db.transactions.put(record))],
      ['toArray', await h.attempt(() => db.transactions.toArray())],
      [
        'update',
        await h.attempt(() =>
          db.transactions.update(record.id, { amount: -1 }),
        ),
      ],
    ];
    const lockedMeta = await h.attempt(() => db.meta.get('vault'));
    const lockedIsUnlocked = keys.isUnlocked;

    await h.unlock(keys);
    return {
      lockedAttempts,
      lockedMeta,
      lockedIsUnlocked,
      isUnlocked: keys.isUnlocked,
      afterUnlock: (await db.transactions.get(record.id)) ?? null,
    };
  }, args(txn()));

  expect(result.lockedIsUnlocked).toBe(false);
  for (const [operation, attempt] of result.lockedAttempts) {
    expect(attempt.ok, `${operation} should fail while locked`).toBe(false);
    if (attempt.ok) continue;
    expect(attempt.error.name).toBe('DbEncryptionError');
    expect(attempt.error.code).toBe('vault/locked');
  }
  // The plaintext table is the deliberate exception, not an oversight.
  expect(result.lockedMeta.ok).toBe(true);

  expect(result.isUnlocked).toBe(true);
  expect(result.afterUnlock).toEqual(txn());
});

test('tamper detection survives the round trip in a real browser', async () => {
  // Four hostile edits made through a plain IndexedDB connection — the
  // DevTools-with-file-access threat model. Every one must surface as
  // `record/corrupt`, never as a partially trusted record.
  const result = await page.evaluate(async (input: Args<TransactionRow>) => {
    const h = (globalThis as unknown as Record<string, Harness>)[input.harness];
    const record = input.payload;
    const outcomes: Array<[string, Attempt<unknown>]> = [];
    const rawRow = async (name: string, key: string) =>
      (await h.rawGet(name, 'transactions', key)) as Record<string, unknown>;

    // 1. A flipped ciphertext byte.
    {
      const { db, name } = await h.openVault();
      await db.transactions.put(record);
      const stored = await rawRow(name, record.id);
      const envelope = stored.__enc as Uint8Array;
      envelope[envelope.length - 1] ^= 0x01;
      await h.rawPut(name, 'transactions', stored);
      outcomes.push([
        'flippedByte',
        await h.attempt(() => db.transactions.get(record.id)),
      ]);
    }

    // 2. A valid blob moved onto another row.
    {
      const { db, name } = await h.openVault();
      await db.transactions.bulkPut([
        record,
        { ...record, id: 'txn-other-0002', amount: -1 },
      ]);
      const source = await rawRow(name, record.id);
      const target = await rawRow(name, 'txn-other-0002');
      await h.rawPut(name, 'transactions', {
        ...target,
        __enc: source.__enc,
      });
      outcomes.push([
        'movedBlob',
        await h.attempt(() => db.transactions.get('txn-other-0002')),
      ]);
    }

    // 3. A rewritten `date` — an AAD-bound column (#51).
    {
      const { db, name } = await h.openVault();
      await db.transactions.put(record);
      const stored = await rawRow(name, record.id);
      await h.rawPut(name, 'transactions', {
        ...stored,
        date: '2026-12-31',
      });
      outcomes.push([
        'rewrittenDate',
        await h.attempt(() => db.transactions.get(record.id)),
      ]);
    }

    // 4. A flipped `type` — the other AAD-bound column.
    {
      const { db, name } = await h.openVault();
      await db.transactions.put(record);
      const stored = await rawRow(name, record.id);
      await h.rawPut(name, 'transactions', { ...stored, type: 'cash' });
      outcomes.push([
        'flippedType',
        await h.attempt(() => db.transactions.get(record.id)),
      ]);
    }

    return outcomes;
  }, args(txn()));

  expect(result.map(([name]) => name)).toEqual([
    'flippedByte',
    'movedBlob',
    'rewrittenDate',
    'flippedType',
  ]);
  for (const [name, attempt] of result) {
    expect(attempt.ok, `${name} should be rejected as corruption`).toBe(false);
    if (attempt.ok) continue;
    expect(attempt.error.name).toBe('DbEncryptionError');
    expect(attempt.error.code).toBe('record/corrupt');
  }
});

test('raw IndexedDB in a real browser holds no plaintext financial data', async () => {
  // The browser half of the permanent leak guard (CLAUDE.md; §Table field
  // allowlist: "dumps raw IndexedDB after writes and fails if any known
  // plaintext value appears"). The Node version keeps four anti-vacuity guards
  // and so does this one, in order:
  //
  //   1. round-trip first, so the writes provably happened;
  //   2. structural assertions on the raw row;
  //   3. scanner liveness — the same scan must FIND the plaintext-by-design
  //      values;
  //   4. a positive control — identical records with no middleware must leak
  //      every sentinel, in every encoding the scanner searches.
  //
  // Guard 4 carries extra weight here: the rows cross out of page context, so a
  // transport that dropped binary buffers would leave the `__enc` blob
  // unsearched and every negative assertion vacuous. The control's `bytes`
  // field is a real `Uint8Array` written to real IndexedDB, so finding the
  // sentinel inside it proves the buffer path is live end to end.
  const result = await page.evaluate(
    async (
      input: Args<{
        transaction: TransactionRow;
        category: CategoryRow;
        metaValue: string;
        notes: string;
      }>,
    ) => {
      const h = (globalThis as unknown as Record<string, Harness>)[
        input.harness
      ];
      const { transaction, category, metaValue, notes } = input.payload;

      const { db, name } = await h.openVault();
      await db.transactions.put(transaction);
      await db.categories.put(category);
      await db.meta.put({ key: 'vault', hint: metaValue });

      const roundTrip = {
        transaction: (await db.transactions.get(transaction.id)) ?? null,
        category: (await db.categories.get(category.id)) ?? null,
      };

      // The control: the identical records, with no middleware anywhere near
      // them, through a plain IndexedDB connection.
      const controlName = `cifra-e2e-control-${Date.now()}`;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(controlName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('transactions', { keyPath: 'id' });
          request.result.createObjectStore('categories', { keyPath: 'id' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
      await h.rawPut(controlName, 'transactions', {
        ...transaction,
        bytes: new TextEncoder().encode(`prefisso ${notes} suffisso`),
      });
      await h.rawPut(controlName, 'categories', category);

      return {
        roundTrip,
        dump: await h.rawDump(name),
        control: await h.rawDump(controlName),
      };
    },
    args({
      transaction: LEAK_TRANSACTION,
      category: LEAK_CATEGORY,
      metaValue: SENTINEL.metaValue,
      notes: SENTINEL.notes,
    }),
  );

  // Guard 1 — the writes reached storage and came back whole.
  expect(result.roundTrip.transaction).toEqual(LEAK_TRANSACTION);
  expect(result.roundTrip.category).toEqual(LEAK_CATEGORY);

  const dump = unbox(result.dump) as RawDump;
  const control = unbox(result.control) as RawDump;

  // Guard 2 — exactly the plaintext keys plus one binary envelope.
  expect(Object.keys(dump).sort()).toEqual([
    'categories',
    'meta',
    'transactions',
  ]);
  expect(dump.transactions).toHaveLength(1);
  const row = dump.transactions[0] as Record<string, unknown>;
  expect(Object.keys(row).sort()).toEqual([
    ENCRYPTED_BLOB_FIELD,
    'date',
    'id',
    'type',
  ]);
  const envelope = row[ENCRYPTED_BLOB_FIELD];
  expect(envelope).toBeInstanceOf(Uint8Array);
  expect((envelope as Uint8Array).length).toBeGreaterThanOrEqual(
    MIN_ENVELOPE_LENGTH_BYTES,
  );
  const categoryRow = dump.categories[0] as Record<string, unknown>;
  expect(Object.keys(categoryRow).sort()).toEqual([ENCRYPTED_BLOB_FIELD, 'id']);

  // Guard 3 — scanner liveness. If the structural values are not findable, the
  // scan is not reading the rows and every negative assertion below is vacuous.
  const scanned = scan(dump);
  for (const value of STRUCTURAL) {
    expect(
      occurrences(scanned, value),
      `structural value ${value} should be visible in raw IndexedDB — if it is not, the scanner is not reading the rows`,
    ).not.toEqual([]);
  }

  // The guarantee itself.
  for (const secret of SECRETS) {
    expect(
      occurrences(scanned, secret),
      `sensitive value ${String(secret)} appeared in raw IndexedDB`,
    ).toEqual([]);
  }

  // The `meta` table is plaintext by design — and still holds nothing financial.
  const metaScan = scan(dump.meta);
  expect(occurrences(metaScan, SENTINEL.metaValue)).not.toEqual([]);
  for (const secret of SECRETS) {
    expect(occurrences(metaScan, secret)).toEqual([]);
  }

  // Guard 4 — the positive control, including every encoding searched.
  const controlScan = scan(control);
  for (const secret of SECRETS) {
    expect(
      occurrences(controlScan, secret),
      `the scanner failed to find ${String(secret)} in a deliberately unencrypted database, so it cannot be trusted to find a real leak`,
    ).not.toEqual([]);
  }
  expect(occurrences(controlScan, SENTINEL.description)).toContainEqual(
    expect.stringContaining('string(s) containing'),
  );
  expect(occurrences(controlScan, SENTINEL.amount)).toContainEqual(
    expect.stringContaining('numeric value(s) equal to'),
  );
  // The binary path, proven against bytes that really made the round trip.
  expect(occurrences(controlScan, SENTINEL.notes)).toContainEqual(
    expect.stringContaining('binary buffer(s)'),
  );
});

test('this engine resolves Web Crypto in the same task, which is why waitFor is invisible here', async () => {
  /**
   * **The finding this file was written to produce, pinned as a test.**
   *
   * The mutation run for #42 removed `Dexie.waitFor` from the middleware. The
   * Node suite failed hard — 26 tests, `InvalidStateError` straight out of
   * `fake-indexeddb`. Every test above **still passed**. So `Dexie.waitFor` is
   * *not* load-bearing in this Chromium, and a browser test alone would not
   * have caught its removal.
   *
   * Why, precisely — both halves measured here rather than guessed:
   *
   *   · **The hazard is real in Chromium.** A plain IndexedDB transaction
   *     driven across a `setTimeout(…, 0)` boundary raises
   *     `TransactionInactiveError`, exactly as `docs/architecture.md`
   *     §Encryption middleware describes. Chromium is not lenient about
   *     transaction lifetime.
   *   · **The middleware never crosses that boundary.** Blink resolves
   *     `crypto.subtle.encrypt` within the *same task* — it settles before a
   *     `MessageChannel` message posted immediately after it, which is an
   *     unclamped macrotask — at 64 B, 64 KiB and 1 MiB alike. The
   *     continuation therefore runs in the same task that opened the
   *     transaction, and `waitFor` has nothing to keep alive.
   *
   * `Dexie.waitFor` stays, and stays required. It is an engine-independent
   * guarantee, and the second bullet is an implementation detail of one engine
   * that may change, that `fake-indexeddb` already does not share, and that
   * nothing promises for Firefox or Safari. What this test buys is that the
   * assumption is no longer invisible: if Blink ever moves SubtleCrypto onto a
   * thread hop, this fails, and the next reader learns — before the vault
   * does — that every write path above has started depending on `waitFor`.
   */
  const observed = await page.evaluate(async () => {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    const settlesBeforeATask = async (bytes: number): Promise<string> => {
      const order: string[] = [];
      const channel = new MessageChannel();
      const posted = new Promise<void>((resolve) => {
        channel.port1.onmessage = () => {
          order.push('task');
          resolve();
        };
      });
      const encrypted = crypto.subtle
        .encrypt(
          { name: 'AES-GCM', iv: new Uint8Array(12) },
          key,
          new Uint8Array(bytes),
        )
        .then(() => {
          order.push('crypto');
        });
      channel.port2.postMessage(null);
      await Promise.all([encrypted, posted]);
      return order[0];
    };

    // A plain IndexedDB transaction, asked to do something one task later.
    const transactionSurvivesATask = await new Promise<boolean>((resolve) => {
      const request = indexedDB.open(`cifra-e2e-lifetime-${Date.now()}`, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('probe', { keyPath: 'id' });
      request.onsuccess = () => {
        const connection = request.result;
        const transaction = connection.transaction(['probe'], 'readwrite');
        transaction.objectStore('probe').put({ id: 1 });
        setTimeout(() => {
          try {
            transaction.objectStore('probe').put({ id: 2 });
            resolve(true);
          } catch {
            resolve(false);
          } finally {
            connection.close();
          }
        }, 0);
      };
    });

    return {
      transactionSurvivesATask,
      firstToSettle: {
        small: await settlesBeforeATask(64),
        medium: await settlesBeforeATask(64 * 1024),
        large: await settlesBeforeATask(1024 * 1024),
      },
    };
  });

  // Half one: the hazard the middleware guards against is real here.
  expect(observed.transactionSurvivesATask).toBe(false);

  // Half two: but Web Crypto never makes the middleware cross a task boundary.
  expect(observed.firstToSettle).toEqual({
    small: 'crypto',
    medium: 'crypto',
    large: 'crypto',
  });
});

test('no transaction-lifetime error ever escaped into the page', async () => {
  // The issue's own acceptance bullet: "asserts no `InvalidStateError` /
  // `TransactionInactiveError` reaches the page". Those arrive as uncaught
  // errors rather than as rejections a test awaited, so they are collected
  // across the whole file and checked here, last.
  expect(pageErrors).toEqual([]);
});
