/**
 * The allowlist is the security contract, so it is asserted like one.
 *
 * Governed by `docs/architecture.md` §Table field allowlist.
 */

import { describe, expect, it } from 'vitest';
import { DbEncryptionError } from '../../../app/db/db-error';
import {
  assertValidAllowlist,
  ENCRYPTED_BLOB_FIELD,
  requireTableSpec,
  storesDeclaration,
  TABLE_ALLOWLIST,
  type TableAllowlist,
} from '../../../app/db/schema';

function expectSchemaError(build: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    build();
  } catch (caught) {
    thrown = caught;
  }
  expect(
    thrown,
    `expected a DbEncryptionError with code ${code}`,
  ).toBeInstanceOf(DbEncryptionError);
  expect((thrown as DbEncryptionError).code).toBe(code);
}

describe('the shipped allowlist', () => {
  it('is internally consistent', () => {
    expect(() => assertValidAllowlist(TABLE_ALLOWLIST)).not.toThrow();
  });

  it('matches the architecture table exactly', () => {
    // §Table field allowlist: id/date/type (and equivalent keys) plaintext;
    // amount/description/category/notes and any free text encrypted; `meta`
    // plaintext by design.
    expect(Object.keys(TABLE_ALLOWLIST).sort()).toEqual([
      'categories',
      'meta',
      'transactions',
    ]);

    const transactions = TABLE_ALLOWLIST.transactions;
    expect(transactions.kind).toBe('encrypted');
    expect([transactions.primaryKey, ...transactions.indexes]).toEqual([
      'id',
      'date',
      'type',
    ]);
    expect(Object.keys(transactions.encrypted).sort()).toEqual([
      'amount',
      'category',
      'description',
      'notes',
    ]);
    expect(transactions.encrypted.amount).toEqual({
      required: true,
      cents: true,
    });

    const categories = TABLE_ALLOWLIST.categories;
    expect(categories.kind).toBe('encrypted');
    expect(categories.indexes).toEqual([]);
    expect(Object.keys(categories.encrypted).sort()).toEqual([
      'color',
      'icon',
      'name',
    ]);

    expect(TABLE_ALLOWLIST.meta.kind).toBe('plaintext');
  });

  it('justifies every plaintext field as structural', () => {
    for (const spec of Object.values(TABLE_ALLOWLIST)) {
      if (spec.kind !== 'encrypted') continue;
      const rationale: Record<string, string | undefined> =
        spec.plaintextRationale;
      for (const field of [spec.primaryKey, ...spec.indexes] as string[]) {
        expect(rationale[field]?.length ?? 0).toBeGreaterThan(20);
      }
    }
  });

  it('derives the Dexie stores declaration from itself, so they cannot drift', () => {
    expect(storesDeclaration(TABLE_ALLOWLIST)).toEqual({
      meta: 'key',
      transactions: 'id, date, type',
      categories: 'id',
    });
  });

  it('never indexes the encrypted blob field', () => {
    for (const stores of Object.values(storesDeclaration(TABLE_ALLOWLIST))) {
      expect(stores).not.toContain(ENCRYPTED_BLOB_FIELD);
    }
  });
});

describe('construction-time validation', () => {
  const base = {
    kind: 'encrypted',
    primaryKey: 'id',
    indexes: ['date'],
    encrypted: { amount: { required: true, cents: true } },
    plaintextRationale: {
      id: 'opaque client-generated identifier, carries no content',
      date: 'calendar day, indexed for the date-sorted list and range queries',
    },
  } as const;

  it('rejects a field that is both indexed and encrypted', () => {
    // The contradiction the architecture forbids: an index stores its key in
    // plaintext, so an indexed field cannot also be encrypted.
    expectSchemaError(
      () =>
        assertValidAllowlist({
          t: {
            ...base,
            indexes: ['date', 'amount'],
            plaintextRationale: {
              ...base.plaintextRationale,
              amount: 'nope',
            },
          },
        } as unknown as TableAllowlist),
      'schema/index-conflict',
    );
  });

  it('rejects a primary key that is also an encrypted field', () => {
    expectSchemaError(
      () =>
        assertValidAllowlist({
          t: {
            ...base,
            encrypted: { id: { required: true } },
          },
        } as unknown as TableAllowlist),
      'schema/index-conflict',
    );
  });

  it('rejects an encrypted table that names no sensitive fields', () => {
    expectSchemaError(
      () =>
        assertValidAllowlist({
          t: { ...base, encrypted: {} },
        } as unknown as TableAllowlist),
      'schema/invalid-allowlist',
    );
  });

  it('rejects an unjustified plaintext field', () => {
    expectSchemaError(
      () =>
        assertValidAllowlist({
          t: {
            ...base,
            indexes: ['date', 'merchant'],
            encrypted: base.encrypted,
          },
        } as unknown as TableAllowlist),
      'schema/invalid-allowlist',
    );
  });

  it('rejects the reserved envelope field as a domain field', () => {
    expectSchemaError(
      () =>
        assertValidAllowlist({
          t: {
            ...base,
            encrypted: { [ENCRYPTED_BLOB_FIELD]: { required: true } },
          },
        } as unknown as TableAllowlist),
      'schema/invalid-allowlist',
    );
    expectSchemaError(
      () =>
        assertValidAllowlist({
          t: {
            ...base,
            indexes: [ENCRYPTED_BLOB_FIELD],
            plaintextRationale: base.plaintextRationale,
          },
        } as unknown as TableAllowlist),
      'schema/index-conflict',
    );
  });

  it('rejects an empty allowlist', () => {
    expectSchemaError(
      () => assertValidAllowlist({}),
      'schema/invalid-allowlist',
    );
  });
});

describe('lookups fail closed', () => {
  it('refuses an unknown table instead of defaulting to plaintext', () => {
    expectSchemaError(
      () => requireTableSpec(TABLE_ALLOWLIST, 'attachments'),
      'schema/unknown-table',
    );
  });
});
