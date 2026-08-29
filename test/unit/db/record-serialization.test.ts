/**
 * Serialization of a record's sensitive fields to bytes and back.
 *
 * The load-bearing property is CLAUDE.md's "Money is integer cents. No floats,
 * anywhere, ever." — asserted here at the boundary where cents become bytes.
 */

import { describe, expect, it } from 'vitest';
import { DbEncryptionError } from '../../../app/db/db-error';
import {
  assertKnownFields,
  decodeSensitiveFields,
  encodeSensitiveFields,
  plaintextProjection,
} from '../../../app/db/record-serialization';
import {
  ENCRYPTED_BLOB_FIELD,
  type EncryptedTableSpec,
  TABLE_ALLOWLIST,
} from '../../../app/db/schema';

const SPEC = TABLE_ALLOWLIST.transactions as EncryptedTableSpec;

function expectDbError(run: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (caught) {
    thrown = caught;
  }
  expect(
    thrown,
    `expected a DbEncryptionError with code ${code}`,
  ).toBeInstanceOf(DbEncryptionError);
  expect((thrown as DbEncryptionError).code).toBe(code);
}

const RECORD = {
  id: 'txn-1',
  date: '2026-08-01',
  type: 'electronic',
  amount: -4599,
  description: 'Spesa settimanale',
  category: 'Alimentari',
  notes: 'con sconto',
};

function roundTrip(record: Record<string, unknown>): Record<string, unknown> {
  return decodeSensitiveFields(
    'transactions',
    SPEC,
    encodeSensitiveFields('transactions', SPEC, record),
  );
}

describe('encoding', () => {
  it('carries only the encrypted fields — never the plaintext keys', () => {
    const bytes = encodeSensitiveFields('transactions', SPEC, RECORD);
    const json = new TextDecoder().decode(bytes);

    expect(JSON.parse(json)).toEqual({
      amount: -4599,
      description: 'Spesa settimanale',
      category: 'Alimentari',
      notes: 'con sconto',
    });
    // The envelope already binds the table and the id as AAD; repeating them
    // inside the payload would duplicate authenticated facts unauthenticated.
    expect(json).not.toContain('txn-1');
    expect(json).not.toContain('transactions');
  });

  it('emits fields in the order the allowlist declares them', () => {
    const json = new TextDecoder().decode(
      encodeSensitiveFields('transactions', SPEC, RECORD),
    );
    expect(Object.keys(JSON.parse(json))).toEqual([
      'amount',
      'description',
      'category',
      'notes',
    ]);
  });

  it('omits absent and undefined optional fields', () => {
    const json = new TextDecoder().decode(
      encodeSensitiveFields('transactions', SPEC, {
        ...RECORD,
        category: undefined,
        notes: undefined,
      }),
    );
    expect(Object.keys(JSON.parse(json))).toEqual(['amount', 'description']);
  });

  it('projects exactly the plaintext fields', () => {
    expect(plaintextProjection(SPEC, RECORD)).toEqual({
      id: 'txn-1',
      date: '2026-08-01',
      type: 'electronic',
    });
  });
});

describe('integer cents', () => {
  it('round-trips every cent value exactly, with no float contact', () => {
    const amounts = [
      0,
      -1,
      1,
      -1234,
      123456,
      999999999,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
    ];

    for (const amount of amounts) {
      const decoded = roundTrip({ ...RECORD, amount });
      expect(decoded.amount).toBe(amount);
      expect(Object.is(decoded.amount, amount)).toBe(true);
      expect(Number.isSafeInteger(decoded.amount as number)).toBe(true);
    }
  });

  it('writes cents as a bare integer literal — no decimal point, no exponent', () => {
    const json = new TextDecoder().decode(
      encodeSensitiveFields('transactions', SPEC, {
        ...RECORD,
        amount: -1234,
      }),
    );
    expect(json).toContain('"amount":-1234');
    expect(json).not.toMatch(/"amount":[^,}]*[.eE]/);
  });

  it('rejects anything that is not a safe integer, on write', () => {
    for (const amount of [
      45.99,
      -0.01,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e21,
      Number.MAX_SAFE_INTEGER + 2,
      '4599',
      null,
    ]) {
      expectDbError(
        () =>
          encodeSensitiveFields('transactions', SPEC, {
            ...RECORD,
            amount,
          }),
        'record/invalid-cents',
      );
    }
  });

  it('rejects a float that somehow reached storage, on read', () => {
    const tampered = new TextEncoder().encode(
      JSON.stringify({ amount: 45.99, description: 'x' }),
    );
    expectDbError(
      () => decodeSensitiveFields('transactions', SPEC, tampered),
      'record/invalid-cents',
    );
  });
});

describe('required fields', () => {
  it('rejects a write that omits a required field', () => {
    const { amount: _amount, ...withoutAmount } = RECORD;
    expectDbError(
      () => encodeSensitiveFields('transactions', SPEC, withoutAmount),
      'record/missing-required-field',
    );
  });

  it('rejects a stored payload that omits a required field', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ amount: -1 }));
    expectDbError(
      () => decodeSensitiveFields('transactions', SPEC, bytes),
      'record/corrupt',
    );
  });
});

describe('unknown fields fail closed', () => {
  it('rejects a field the allowlist does not name', () => {
    expectDbError(
      () =>
        assertKnownFields('transactions', SPEC, {
          ...RECORD,
          counterpartyIban: 'IT60X0542811101000000123456',
        }),
      'record/unknown-field',
    );
  });

  it('rejects the reserved envelope field', () => {
    expectDbError(
      () =>
        assertKnownFields('transactions', SPEC, {
          ...RECORD,
          [ENCRYPTED_BLOB_FIELD]: new Uint8Array(),
        }),
      'record/unknown-field',
    );
  });

  it('accepts exactly the allowlisted fields', () => {
    expect(() => assertKnownFields('transactions', SPEC, RECORD)).not.toThrow();
  });

  it('rejects an unexpected field inside a decrypted payload', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ amount: -1, description: 'x', iban: 'IT60' }),
    );
    expectDbError(
      () => decodeSensitiveFields('transactions', SPEC, bytes),
      'record/corrupt',
    );
  });

  it('rejects a __proto__ key smuggled through JSON rather than assigning it', () => {
    const bytes = new TextEncoder().encode(
      '{"amount":-1,"description":"x","__proto__":{"polluted":true}}',
    );
    expectDbError(
      () => decodeSensitiveFields('transactions', SPEC, bytes),
      'record/corrupt',
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('malformed payloads', () => {
  it('rejects bytes that are not UTF-8 JSON', () => {
    expectDbError(
      () =>
        decodeSensitiveFields(
          'transactions',
          SPEC,
          Uint8Array.from([0xff, 0xfe, 0x00]),
        ),
      'record/corrupt',
    );
  });

  it('rejects JSON that is not an object', () => {
    for (const json of ['[]', '"text"', '42', 'null']) {
      expectDbError(
        () =>
          decodeSensitiveFields(
            'transactions',
            SPEC,
            new TextEncoder().encode(json),
          ),
        'record/corrupt',
      );
    }
  });
});

describe('text fidelity', () => {
  it('round-trips accents, emoji and quotes untouched', () => {
    const description = 'Caffè “doppio” — 100% 🇮🇹 \\ " \n\t';
    const decoded = roundTrip({ ...RECORD, description, notes: description });
    expect(decoded.description).toBe(description);
    expect(decoded.notes).toBe(description);
  });
});
