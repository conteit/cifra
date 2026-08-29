/**
 * The plaintext-leak test.
 *
 * `docs/architecture.md` §Table field allowlist: the allowlist "is asserted by a
 * plaintext-leak test that dumps raw IndexedDB after writes and fails if any
 * known plaintext value appears". CLAUDE.md: "The plaintext-leak test exists to
 * catch regressions — do not weaken or skip it."
 *
 * It is easy to write a version of this test that passes for the wrong reason:
 * a scanner that looks in the wrong place, or writes that never happened, both
 * produce a green "no plaintext found". Four guards stop that here:
 *
 * 1. **Round-trip first.** Every record is read back through Dexie and compared
 *    field by field, so the data provably reached storage before anything is
 *    scanned for it.
 * 2. **Structural assertions on the raw row.** The row must hold exactly the
 *    plaintext keys plus a `__enc` `Uint8Array` of at least an envelope's
 *    length — not an empty object.
 * 3. **Scanner liveness.** The same scan must *find* the plaintext-by-design
 *    values (`id`, `date`, `type`) in the very same rows. If the scanner were
 *    looking somewhere else, this fails.
 * 4. **A positive control.** The identical records written to a database with
 *    no middleware must leak every sentinel, in every encoding searched.
 */

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { MIN_ENVELOPE_LENGTH_BYTES } from '../../../app/crypto/record-cipher';
import type { CategoryRow, TransactionRow } from '../../../app/db/schema';
import { ENCRYPTED_BLOB_FIELD } from '../../../app/db/schema';
import {
  occurrences,
  openTestVault,
  rawDump,
  scan,
  type TestVault,
} from './support';

/**
 * Distinctive values that could only come from these records. Deliberately not
 * realistic Italian bank data — CLAUDE.md forbids real exports, and a canary is
 * more useful when it cannot collide with anything else in the file.
 */
const SENTINEL = {
  id: 'txn-CANARY-9f3c4e21',
  date: '2026-08-29',
  type: 'electronic',
  description: 'CANARY-descrizione-7b1a9d',
  category: 'CANARY-categoria-3e5f0c',
  notes: 'CANARY-nota-libera-6d2b84',
  /** Integer cents, and a digit run that appears nowhere else. */
  amount: -1234567,
  categoryId: 'cat-CANARY-11ff8802',
  categoryName: 'CANARY-nome-categoria-4a7e',
  /** Plaintext by design: the `meta` table. */
  metaValue: 'CANARY-meta-plaintext-5c9d',
} as const;

const TRANSACTION: TransactionRow = {
  id: SENTINEL.id,
  date: SENTINEL.date,
  type: 'electronic',
  amount: SENTINEL.amount,
  description: SENTINEL.description,
  category: SENTINEL.category,
  notes: SENTINEL.notes,
};

const CATEGORY: CategoryRow = {
  id: SENTINEL.categoryId,
  name: SENTINEL.categoryName,
};

/** The values that must never appear anywhere in raw IndexedDB. */
const SECRETS: readonly (string | number)[] = [
  SENTINEL.description,
  SENTINEL.category,
  SENTINEL.notes,
  SENTINEL.amount,
  SENTINEL.categoryName,
];

/** The values that are plaintext-indexed by design and must be findable. */
const STRUCTURAL: readonly string[] = [
  SENTINEL.id,
  SENTINEL.date,
  SENTINEL.type,
  SENTINEL.categoryId,
];

const openVaults: TestVault[] = [];
const openControls: Dexie[] = [];

afterEach(() => {
  for (const vault of openVaults.splice(0)) vault.close();
  for (const control of openControls.splice(0)) control.close();
});

async function writeThroughMiddleware(): Promise<TestVault> {
  const vault = await openTestVault();
  openVaults.push(vault);
  await vault.db.transactions.put(TRANSACTION);
  await vault.db.categories.put(CATEGORY);
  await vault.db.meta.put({ key: 'vault', hint: SENTINEL.metaValue });
  return vault;
}

/**
 * The same records, written to a database that has no encryption middleware.
 *
 * This is the control: if the scanner cannot find the sentinels *here*, then
 * finding nothing in the encrypted database proves nothing at all.
 */
async function writeWithoutEncryption(): Promise<string> {
  const name = `cifra-control-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const control = new Dexie(name);
  openControls.push(control);
  control.version(1).stores({
    meta: 'key',
    transactions: 'id, date, type',
    categories: 'id',
  });
  await control.open();
  await control.table('transactions').put(TRANSACTION);
  await control.table('categories').put(CATEGORY);
  await control.table('meta').put({ key: 'vault', hint: SENTINEL.metaValue });
  return name;
}

describe('plaintext leak', () => {
  it('round-trips every field through the middleware (guard: the writes happened)', async () => {
    const vault = await writeThroughMiddleware();

    await expect(vault.db.transactions.get(SENTINEL.id)).resolves.toEqual(
      TRANSACTION,
    );
    await expect(vault.db.categories.get(SENTINEL.categoryId)).resolves.toEqual(
      CATEGORY,
    );
  });

  it('stores exactly the plaintext keys plus one binary envelope', async () => {
    const vault = await writeThroughMiddleware();
    const dump = await rawDump(vault.name);

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
    expect(row[ENCRYPTED_BLOB_FIELD]).toBeInstanceOf(Uint8Array);
    expect(
      (row[ENCRYPTED_BLOB_FIELD] as Uint8Array).length,
    ).toBeGreaterThanOrEqual(MIN_ENVELOPE_LENGTH_BYTES);

    const categoryRow = dump.categories[0] as Record<string, unknown>;
    expect(Object.keys(categoryRow).sort()).toEqual([
      ENCRYPTED_BLOB_FIELD,
      'id',
    ]);
  });

  it('finds the structural plaintext values (guard: the scanner is live)', async () => {
    const vault = await writeThroughMiddleware();
    const scanned = scan(await rawDump(vault.name));

    for (const value of STRUCTURAL) {
      expect(
        occurrences(scanned, value),
        `structural value ${value} should be visible in raw IndexedDB — if it is not, the scanner is not reading the rows and every negative assertion below is vacuous`,
      ).not.toEqual([]);
    }
  });

  it('leaks no sensitive value into raw IndexedDB, in any encoding', async () => {
    const vault = await writeThroughMiddleware();
    const scanned = scan(await rawDump(vault.name));

    for (const secret of SECRETS) {
      expect(
        occurrences(scanned, secret),
        `sensitive value ${String(secret)} appeared in raw IndexedDB`,
      ).toEqual([]);
    }
  });

  it('leaks no sensitive value into the index keys either', async () => {
    const vault = await writeThroughMiddleware();
    const dump = await rawDump(vault.name);
    // getAll() returns records, not index entries, so scan the values that the
    // `date` and `type` indexes are built from explicitly: they are the only
    // things IndexedDB copies out of the record into an index.
    const row = dump.transactions[0] as Record<string, unknown>;
    expect(Object.values(row).filter((v) => typeof v === 'string')).toEqual([
      SENTINEL.id,
      SENTINEL.date,
      SENTINEL.type,
    ]);
  });

  describe('the meta table is plaintext by design', () => {
    it('is readable in the clear — the intended exception, not an accident', async () => {
      const vault = await writeThroughMiddleware();
      const scanned = scan((await rawDump(vault.name)).meta);

      // §Table field allowlist: "Plaintext by design: the `meta` table (wrapped
      // data key, salt, KDF params)." It must be readable before any key
      // exists, so encrypting it under that key would be circular. #32 tracks
      // authenticating the row against substitution.
      expect(occurrences(scanned, SENTINEL.metaValue)).not.toEqual([]);
    });

    it('holds no financial value all the same', async () => {
      const vault = await writeThroughMiddleware();
      const scanned = scan((await rawDump(vault.name)).meta);

      for (const secret of SECRETS) {
        expect(
          occurrences(scanned, secret),
          `sensitive value ${String(secret)} appeared in the plaintext meta table`,
        ).toEqual([]);
      }
    });
  });

  describe('positive control — the same scan against unencrypted writes', () => {
    it('finds every sentinel, so a green result above means something', async () => {
      const scanned = scan(await rawDump(await writeWithoutEncryption()));

      for (const secret of SECRETS) {
        expect(
          occurrences(scanned, secret),
          `the scanner failed to find ${String(secret)} in a deliberately unencrypted database, so it cannot be trusted to find a real leak`,
        ).not.toEqual([]);
      }
    });

    it('exercises every encoding the scanner searches', async () => {
      const scanned = scan(await rawDump(await writeWithoutEncryption()));

      // A string value, found as a string.
      expect(occurrences(scanned, SENTINEL.description)).toContainEqual(
        expect.stringContaining('string(s) containing'),
      );
      // A number value, found by exact numeric equality.
      expect(occurrences(scanned, SENTINEL.amount)).toContainEqual(
        expect.stringContaining('numeric value(s) equal to'),
      );
      // And the byte search finds UTF-8 in a buffer: prove it against a buffer
      // that really does contain the bytes, rather than assuming.
      const bytes = new TextEncoder().encode(`prefix ${SENTINEL.notes} suffix`);
      expect(occurrences(scan({ blob: bytes }), SENTINEL.notes)).toContainEqual(
        expect.stringContaining('binary buffer(s)'),
      );
    });
  });
});
