/**
 * Behaviour of the DBCore encryption middleware.
 *
 * Governed by `docs/architecture.md` §Encryption middleware and §Table field
 * allowlist. The leak guarantee itself lives in `plaintext-leak.test.ts`; this
 * suite covers transparency, the DBCore method matrix, fail-closed rejections,
 * locked state, and tamper detection.
 */

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { CifraDatabase } from '../../../app/db/database';
import {
  DbEncryptionError,
  type DbEncryptionErrorCode,
} from '../../../app/db/db-error';
import { createEncryptionMiddleware } from '../../../app/db/encryption-middleware';
import {
  type CategoryRow,
  ENCRYPTED_BLOB_FIELD,
  storesDeclaration,
  TABLE_ALLOWLIST,
  type TransactionRow,
} from '../../../app/db/schema';
import { VaultKeyHolder } from '../../../app/db/vault-key';
import {
  makeDataKey,
  openTestVault,
  rawGet,
  rawPut,
  type TestVault,
} from './support';

const openVaults: TestVault[] = [];
const openDatabases: Dexie[] = [];

afterEach(() => {
  for (const vault of openVaults.splice(0)) vault.close();
  for (const db of openDatabases.splice(0)) db.close();
});

async function vault(
  options: Parameters<typeof openTestVault>[0] = {},
): Promise<TestVault> {
  const opened = await openTestVault(options);
  openVaults.push(opened);
  return opened;
}

async function expectDbError(
  promise: Promise<unknown>,
  code: DbEncryptionErrorCode,
): Promise<DbEncryptionError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(
    error,
    `expected a DbEncryptionError with code ${code}`,
  ).toBeInstanceOf(DbEncryptionError);
  expect((error as DbEncryptionError).code).toBe(code);
  return error as DbEncryptionError;
}

function transaction(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 'txn-0001',
    date: '2026-08-01',
    type: 'electronic',
    amount: -4599,
    description: 'Spesa settimanale',
    ...overrides,
  };
}

const CATEGORY: CategoryRow = { id: 'cat-0001', name: 'Alimentari' };

describe('transparency', () => {
  it('round-trips a record through put/get unchanged', async () => {
    const { db } = await vault();
    const row = transaction({ category: 'Alimentari', notes: 'con sconto' });

    await db.transactions.put(row);
    await expect(db.transactions.get(row.id)).resolves.toEqual(row);
  });

  it('omits optional fields that were never written', async () => {
    const { db } = await vault();
    await db.transactions.put(transaction());

    const stored = await db.transactions.get('txn-0001');
    expect(stored).toEqual(transaction());
    expect(Object.hasOwn(stored as object, 'category')).toBe(false);
    expect(Object.hasOwn(stored as object, 'notes')).toBe(false);
  });

  it('does not mutate the caller’s object', async () => {
    const { db } = await vault();
    const row = transaction({ notes: 'promemoria' });
    const snapshot = { ...row };

    await db.transactions.put(row);

    expect(row).toEqual(snapshot);
    expect(Object.hasOwn(row, ENCRYPTED_BLOB_FIELD)).toBe(false);
  });

  it('round-trips integer cents exactly, including the extremes', async () => {
    const { db } = await vault();
    const amounts = [
      0,
      -1,
      1,
      -1234,
      123456789,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
    ];

    await db.transactions.bulkPut(
      amounts.map((amount, index) =>
        transaction({ id: `txn-cents-${index}`, amount }),
      ),
    );

    const stored = await db.transactions.bulkGet(
      amounts.map((_, index) => `txn-cents-${index}`),
    );
    expect(stored.map((row) => row?.amount)).toEqual(amounts);
  });

  it('round-trips a second encrypted table with a different field set', async () => {
    const { db } = await vault();
    await db.categories.put(CATEGORY);
    await expect(db.categories.get(CATEGORY.id)).resolves.toEqual(CATEGORY);
  });
});

describe('DBCore method coverage', () => {
  it('getMany decrypts every hit and leaves misses undefined', async () => {
    const { db } = await vault();
    await db.transactions.bulkPut([
      transaction({ id: 'a' }),
      transaction({ id: 'b', amount: -100 }),
    ]);

    const rows = await db.transactions.bulkGet(['a', 'missing', 'b']);
    expect(rows[0]).toEqual(transaction({ id: 'a' }));
    expect(rows[1]).toBeUndefined();
    expect(rows[2]).toEqual(transaction({ id: 'b', amount: -100 }));
  });

  it('query with values decrypts — plain, ordered and ranged reads', async () => {
    const { db } = await vault();
    await db.transactions.bulkPut([
      transaction({ id: 'a', date: '2026-01-05', amount: -1 }),
      transaction({ id: 'b', date: '2026-02-05', amount: -2 }),
      transaction({ id: 'c', date: '2026-03-05', amount: -3, type: 'cash' }),
    ]);

    await expect(
      db.transactions.toArray().then((rows) => rows.map((r) => r.amount)),
    ).resolves.toEqual([-1, -2, -3]);

    await expect(
      db.transactions
        .orderBy('date')
        .reverse()
        .toArray()
        .then((rows) => rows.map((r) => r.id)),
    ).resolves.toEqual(['c', 'b', 'a']);

    await expect(
      db.transactions
        .where('date')
        .between('2026-02-01', '2026-03-31')
        .toArray()
        .then((rows) => rows.map((r) => r.description)),
    ).resolves.toEqual(['Spesa settimanale', 'Spesa settimanale']);

    await expect(
      db.transactions
        .where('type')
        .equals('cash')
        .toArray()
        .then((rows) => rows.map((r) => r.id)),
    ).resolves.toEqual(['c']);
  });

  it('query without values returns primary keys and never decrypts them', async () => {
    const { db } = await vault();
    await db.transactions.bulkPut([
      transaction({ id: 'a' }),
      transaction({ id: 'b' }),
    ]);

    // `Collection.primaryKeys()` issues query({ values: false }). A middleware
    // that decrypted this branch would try to authenticate a string key.
    await expect(db.transactions.toCollection().primaryKeys()).resolves.toEqual(
      ['a', 'b'],
    );
    await expect(
      db.transactions.where('date').equals('2026-08-01').primaryKeys(),
    ).resolves.toEqual(['a', 'b']);
  });

  it('count works without touching values', async () => {
    const { db } = await vault();
    await db.transactions.bulkPut([
      transaction({ id: 'a' }),
      transaction({ id: 'b', type: 'cash' }),
    ]);

    await expect(db.transactions.count()).resolves.toBe(2);
    await expect(
      db.transactions.where('type').equals('cash').count(),
    ).resolves.toBe(1);
  });

  it('mutate/delete removes a row without needing the payload', async () => {
    const { db } = await vault();
    await db.transactions.put(transaction());

    await db.transactions.delete('txn-0001');
    await expect(db.transactions.get('txn-0001')).resolves.toBeUndefined();
  });

  it('mutate/deleteRange clears a table and drops a key range', async () => {
    const { db } = await vault();
    await db.transactions.bulkPut([
      transaction({ id: 'a', date: '2026-01-05' }),
      transaction({ id: 'b', date: '2026-02-05' }),
      transaction({ id: 'c', date: '2026-03-05' }),
    ]);

    // `Table.clear()` is a deleteRange over the whole primary-key space.
    await db.categories.put(CATEGORY);
    await db.categories.clear();
    await expect(db.categories.count()).resolves.toBe(0);

    await db.transactions.where('date').below('2026-03-01').delete();
    await expect(db.transactions.toCollection().primaryKeys()).resolves.toEqual(
      ['c'],
    );
  });

  it('add rejects a duplicate id the ordinary way', async () => {
    const { db } = await vault();
    await db.transactions.add(transaction());
    await expect(db.transactions.add(transaction())).rejects.toBeInstanceOf(
      Error,
    );
  });
});

describe('partial updates', () => {
  it('rejects a put that omits a required encrypted field', async () => {
    const { db } = await vault();
    await db.transactions.put(transaction({ notes: 'nota' }));

    const partial = { id: 'txn-0001', date: '2026-08-01', type: 'electronic' };
    await expectDbError(
      db.transactions.put(partial as TransactionRow),
      'record/missing-required-field',
    );

    // And the stored record is untouched — a rejected write changes nothing.
    await expect(db.transactions.get('txn-0001')).resolves.toEqual(
      transaction({ notes: 'nota' }),
    );
  });

  it('supports real partial updates through update(), which read-modify-writes', async () => {
    const { db } = await vault();
    await db.transactions.put(
      transaction({ category: 'Alimentari', notes: 'nota' }),
    );

    await db.transactions.update('txn-0001', { category: 'Trasporti' });

    await expect(db.transactions.get('txn-0001')).resolves.toEqual(
      transaction({ category: 'Trasporti', notes: 'nota' }),
    );
  });

  it('supports modify(), which routes through getMany + a full-value put', async () => {
    const { db } = await vault();
    await db.transactions.bulkPut([
      transaction({ id: 'a', amount: -100 }),
      transaction({ id: 'b', amount: -200 }),
    ]);

    await db.transactions
      .where('date')
      .equals('2026-08-01')
      .modify((row) => {
        row.notes = 'rivisto';
      });

    const rows = await db.transactions.toArray();
    expect(rows.map((row) => row.notes)).toEqual(['rivisto', 'rivisto']);
    expect(rows.map((row) => row.amount)).toEqual([-100, -200]);
  });

  it('re-encrypts, not just re-indexes, when the primary key changes', async () => {
    const { db, name } = await vault();
    await db.transactions.put(transaction({ id: 'old-id' }));
    const before = (await rawGet(name, 'transactions', 'old-id')) as Record<
      string,
      unknown
    >;

    await db.transactions
      .where('id')
      .equals('old-id')
      .modify((row) => {
        row.id = 'new-id';
      });

    // The AAD binds the record id, so a row that merely moved would fail to
    // authenticate. That it reads back proves it was re-encrypted.
    await expect(db.transactions.get('new-id')).resolves.toEqual(
      transaction({ id: 'new-id' }),
    );
    await expect(db.transactions.get('old-id')).resolves.toBeUndefined();

    const after = (await rawGet(name, 'transactions', 'new-id')) as Record<
      string,
      unknown
    >;
    expect(after[ENCRYPTED_BLOB_FIELD]).not.toEqual(
      before[ENCRYPTED_BLOB_FIELD],
    );
  });
});

describe('fail closed', () => {
  it('rejects a field the allowlist does not name', async () => {
    const { db } = await vault();
    const row = { ...transaction(), iban: 'IT60X0542811101000000123456' };

    await expectDbError(
      db.transactions.put(row as TransactionRow),
      'record/unknown-field',
    );
  });

  it('rejects a caller-supplied envelope field', async () => {
    const { db } = await vault();
    const row = { ...transaction(), [ENCRYPTED_BLOB_FIELD]: new Uint8Array(1) };

    await expectDbError(
      db.transactions.put(row as TransactionRow),
      'record/unknown-field',
    );
  });

  it('rejects a non-string primary key', async () => {
    const { db } = await vault();

    await expectDbError(
      db.transactions.put(transaction({ id: 42 as unknown as string })),
      'record/invalid-primary-key',
    );
  });

  it('rejects a float amount on write', async () => {
    const { db } = await vault();

    await expectDbError(
      db.transactions.put(transaction({ amount: 45.99 })),
      'record/invalid-cents',
    );
    await expectDbError(
      db.transactions.put(transaction({ amount: Number.NaN })),
      'record/invalid-cents',
    );
    await expectDbError(
      db.transactions.put(transaction({ amount: 1e21 })),
      'record/invalid-cents',
    );
  });

  it('refuses to open a database with a table the allowlist does not cover', async () => {
    const keys = new VaultKeyHolder();
    keys.unlock(await makeDataKey());
    const db = new Dexie(`cifra-unknown-table-${Date.now()}`);
    openDatabases.push(db);
    db.use(
      createEncryptionMiddleware({
        allowlist: TABLE_ALLOWLIST,
        vaultKey: keys,
      }),
    );
    db.version(1).stores({
      ...storesDeclaration(TABLE_ALLOWLIST),
      secrets: 'id, value',
    });

    await expectDbError(db.open(), 'schema/unknown-table');
  });

  it('refuses to open a database that indexes an encrypted field', async () => {
    const keys = new VaultKeyHolder();
    keys.unlock(await makeDataKey());
    const db = new Dexie(`cifra-bad-index-${Date.now()}`);
    openDatabases.push(db);
    db.use(
      createEncryptionMiddleware({
        allowlist: TABLE_ALLOWLIST,
        vaultKey: keys,
      }),
    );
    db.version(1).stores({
      meta: 'key',
      transactions: 'id, date, type, amount',
      categories: 'id',
    });

    await expectDbError(db.open(), 'schema/index-conflict');
  });

  it('refuses to open a database with an auto-incrementing encrypted table', async () => {
    const keys = new VaultKeyHolder();
    keys.unlock(await makeDataKey());
    const db = new Dexie(`cifra-autoincrement-${Date.now()}`);
    openDatabases.push(db);
    db.use(
      createEncryptionMiddleware({
        allowlist: TABLE_ALLOWLIST,
        vaultKey: keys,
      }),
    );
    db.version(1).stores({
      meta: 'key',
      transactions: '++id, date, type',
      categories: 'id',
    });

    await expectDbError(db.open(), 'schema/invalid-primary-key');
  });

  it('rejects a value cursor on an encrypted table rather than yielding ciphertext', async () => {
    const { db } = await vault();
    await db.transactions.put(transaction());

    await expectDbError(
      db.transactions.filter(() => true).toArray(),
      'read/cursor-unsupported',
    );
    await expectDbError(
      db.transactions.each(() => undefined),
      'read/cursor-unsupported',
    );
    await expectDbError(
      db.transactions.offset(1).toArray(),
      'read/cursor-unsupported',
    );
  });

  it('still allows a keys-only cursor', async () => {
    const { db } = await vault();
    await db.transactions.bulkPut([
      transaction({ id: 'a', date: '2026-01-05' }),
      transaction({ id: 'b', date: '2026-02-05' }),
    ]);

    await expect(db.transactions.orderBy('date').keys()).resolves.toEqual([
      '2026-01-05',
      '2026-02-05',
    ]);
  });
});

describe('locked state', () => {
  it('fails every encrypted read and write with vault/locked', async () => {
    const { db } = await vault({ unlocked: false });

    await expectDbError(db.transactions.put(transaction()), 'vault/locked');
    await expectDbError(db.transactions.get('txn-0001'), 'vault/locked');
    await expectDbError(db.transactions.bulkGet(['txn-0001']), 'vault/locked');
    await expectDbError(db.transactions.toArray(), 'vault/locked');
    await expectDbError(db.transactions.count(), 'vault/locked');
    await expectDbError(db.transactions.delete('txn-0001'), 'vault/locked');
    await expectDbError(
      db.transactions.toCollection().primaryKeys(),
      'vault/locked',
    );
  });

  it('leaves the plaintext meta table reachable while locked', async () => {
    const { db } = await vault({ unlocked: false });

    // The unlock flow must read the wrapped data key and the salt before any
    // key exists, so `meta` deliberately bypasses the middleware.
    await db.meta.put({ key: 'vault', salt: new Uint8Array([1, 2, 3]) });
    await expect(db.meta.get('vault')).resolves.toMatchObject({ key: 'vault' });
  });

  it('stops serving records the moment the key reference is dropped', async () => {
    const { db, keys } = await vault();
    await db.transactions.put(transaction());
    await expect(db.transactions.get('txn-0001')).resolves.toBeDefined();

    keys.lock();

    expect(keys.isUnlocked).toBe(false);
    await expectDbError(db.transactions.get('txn-0001'), 'vault/locked');
  });

  it('serves the same records again after a re-unlock with the same key', async () => {
    const dataKey = await makeDataKey();
    const { db, keys } = await vault({ dataKey });
    await db.transactions.put(transaction());

    keys.lock();
    keys.unlock(dataKey);

    await expect(db.transactions.get('txn-0001')).resolves.toEqual(
      transaction(),
    );
  });
});

describe('tamper detection', () => {
  it('reports a flipped ciphertext byte as corruption', async () => {
    const { db, name } = await vault();
    await db.transactions.put(transaction());

    const row = (await rawGet(name, 'transactions', 'txn-0001')) as Record<
      string,
      unknown
    >;
    const envelope = Uint8Array.from(row[ENCRYPTED_BLOB_FIELD] as Uint8Array);
    envelope[envelope.length - 1] ^= 0x01;
    await rawPut(name, 'transactions', {
      ...row,
      [ENCRYPTED_BLOB_FIELD]: envelope,
    });

    await expectDbError(db.transactions.get('txn-0001'), 'record/corrupt');
  });

  it('reports a blob moved to another row as corruption', async () => {
    const { db, name } = await vault();
    await db.transactions.bulkPut([
      transaction({ id: 'a', amount: -100 }),
      transaction({ id: 'b', amount: -999999 }),
    ]);

    const donor = (await rawGet(name, 'transactions', 'b')) as Record<
      string,
      unknown
    >;
    const victim = (await rawGet(name, 'transactions', 'a')) as Record<
      string,
      unknown
    >;
    // Swap b's amount onto row a — the attack the AAD binding exists to stop.
    await rawPut(name, 'transactions', {
      ...victim,
      [ENCRYPTED_BLOB_FIELD]: donor[ENCRYPTED_BLOB_FIELD],
    });

    await expectDbError(db.transactions.get('a'), 'record/corrupt');
    // And the untouched row still reads.
    await expect(db.transactions.get('b')).resolves.toEqual(
      transaction({ id: 'b', amount: -999999 }),
    );
  });

  it('reports a blob moved to another table as corruption', async () => {
    const { db, name } = await vault();
    await db.transactions.put(transaction({ id: 'shared-id' }));
    await db.categories.put({ id: 'shared-id', name: 'Alimentari' });

    const donor = (await rawGet(name, 'transactions', 'shared-id')) as Record<
      string,
      unknown
    >;
    await rawPut(name, 'categories', {
      id: 'shared-id',
      [ENCRYPTED_BLOB_FIELD]: donor[ENCRYPTED_BLOB_FIELD],
    });

    await expectDbError(db.categories.get('shared-id'), 'record/corrupt');
  });

  it('reports a row with no envelope as corruption', async () => {
    const { db, name } = await vault();
    await db.transactions.put(transaction());
    await rawPut(name, 'transactions', {
      id: 'txn-0001',
      date: '2026-08-01',
      type: 'electronic',
    });

    await expectDbError(db.transactions.get('txn-0001'), 'record/corrupt');
  });

  it('reports another vault’s key as corruption rather than returning nothing', async () => {
    const first = await vault();
    await first.db.transactions.put(transaction());
    first.db.close();

    const keys = new VaultKeyHolder();
    keys.unlock(await makeDataKey());
    const reopened = new CifraDatabase(first.name, keys);
    openDatabases.push(reopened);

    await expectDbError(
      reopened.transactions.get('txn-0001'),
      'record/corrupt',
    );
  });
});
