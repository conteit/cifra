import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWrappedDataKey } from '../../../app/crypto/key-wrap';
import {
  decryptRecord,
  encryptRecord,
  GCM_TAG_LENGTH_BYTES,
  IV_LENGTH_BYTES,
  MAX_CONTEXT_FIELD_BYTES,
  MAX_PLAINTEXT_BYTES,
  MIN_ENVELOPE_LENGTH_BYTES,
  RECORD_ENVELOPE_VERSION,
  type RecordContext,
  RecordCipherError,
} from '../../../app/crypto/record-cipher';

const subtle = globalThis.crypto.subtle;

/**
 * Builds a master key with exactly the shape `deriveMasterKey` (issue #4,
 * PR #30) returns: non-extractable AES-KW, usages `['wrapKey', 'unwrapKey']`.
 * Constructed here rather than imported so this branch stands alone.
 */
async function makeMasterKey(): Promise<CryptoKey> {
  return await subtle.generateKey({ name: 'AES-KW', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
}

async function makeDataKey(): Promise<CryptoKey> {
  return (await createWrappedDataKey(await makeMasterKey())).dataKey;
}

const CONTEXT: RecordContext = {
  table: 'transactions',
  recordId: '018f3a2c-0000-7000-8000-000000000001',
};

const utf8 = (value: string) => new TextEncoder().encode(value);
const fromUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Returns a copy of `bytes` with bit 0 of `index` flipped. */
function flipByte(bytes: Uint8Array, index: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[index] ^= 0x01;
  return copy;
}

async function expectRecordCipherError(
  promise: Promise<unknown>,
  code: string,
): Promise<RecordCipherError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(
    error,
    `expected a RecordCipherError with code ${code}`,
  ).toBeInstanceOf(RecordCipherError);
  const typed = error as RecordCipherError;
  expect(typed.code).toBe(code);
  return typed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('record envelope format', () => {
  it('is version byte || 12-byte IV || AES-GCM ciphertext with 16-byte tag', async () => {
    const key = await makeDataKey();
    const plaintext = utf8('{"amount":-1234,"description":"Spesa"}');

    const envelope = await encryptRecord(key, plaintext, CONTEXT);

    expect(envelope).toBeInstanceOf(Uint8Array);
    expect(envelope.length).toBe(
      1 + IV_LENGTH_BYTES + plaintext.length + GCM_TAG_LENGTH_BYTES,
    );
    expect(envelope[0]).toBe(RECORD_ENVELOPE_VERSION);
    expect(MIN_ENVELOPE_LENGTH_BYTES).toBe(
      1 + IV_LENGTH_BYTES + GCM_TAG_LENGTH_BYTES,
    );
  });

  it('produces the minimum-length envelope for an empty payload', async () => {
    const key = await makeDataKey();

    const envelope = await encryptRecord(key, new Uint8Array(0), CONTEXT);

    expect(envelope.length).toBe(MIN_ENVELOPE_LENGTH_BYTES);
    expect(await decryptRecord(key, envelope, CONTEXT)).toEqual(
      new Uint8Array(0),
    );
  });

  it('never emits the plaintext into the envelope body', async () => {
    const key = await makeDataKey();
    const marker = 'CANARY-PLAINTEXT-MARKER';

    const envelope = await encryptRecord(key, utf8(marker), CONTEXT);

    expect(fromUtf8(envelope)).not.toContain(marker);
  });
});

describe('encrypt/decrypt round-trip', () => {
  it('round-trips a record payload', async () => {
    const key = await makeDataKey();
    const plaintext = utf8('{"amount":-1234,"notes":"caffè e cornetto"}');

    const decrypted = await decryptRecord(
      key,
      await encryptRecord(key, plaintext, CONTEXT),
      CONTEXT,
    );

    expect(decrypted).toEqual(plaintext);
    expect(fromUtf8(decrypted)).toBe(
      '{"amount":-1234,"notes":"caffè e cornetto"}',
    );
  });

  it('round-trips arbitrary binary payloads including a large one', async () => {
    const key = await makeDataKey();
    const plaintext = new Uint8Array(1024 * 1024);
    globalThis.crypto.getRandomValues(plaintext.subarray(0, 65536));

    const decrypted = await decryptRecord(
      key,
      await encryptRecord(key, plaintext, CONTEXT),
      CONTEXT,
    );

    expect(decrypted).toEqual(plaintext);
  });

  it('round-trips every byte value', async () => {
    const key = await makeDataKey();
    const plaintext = Uint8Array.from({ length: 256 }, (_, i) => i);

    expect(
      await decryptRecord(
        key,
        await encryptRecord(key, plaintext, CONTEXT),
        CONTEXT,
      ),
    ).toEqual(plaintext);
  });
});

describe('IV handling', () => {
  it('uses a fresh random 12-byte IV for every encryption', async () => {
    const key = await makeDataKey();
    const plaintext = utf8('identical payload');
    const ivs = new Set<string>();
    const ciphertexts = new Set<string>();

    for (let i = 0; i < 256; i += 1) {
      const envelope = await encryptRecord(key, plaintext, CONTEXT);
      const iv = envelope.subarray(1, 1 + IV_LENGTH_BYTES);
      expect(iv.length).toBe(12);
      ivs.add(iv.join(','));
      ciphertexts.add(envelope.subarray(1 + IV_LENGTH_BYTES).join(','));
    }

    expect(ivs.size).toBe(256);
    expect(ciphertexts.size).toBe(256);
  });

  it('draws the IV from the platform CSPRNG', async () => {
    const key = await makeDataKey();
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');

    await encryptRecord(key, utf8('x'), CONTEXT);

    expect(spy).toHaveBeenCalledTimes(1);
    const requested = spy.mock.calls[0]?.[0] as Uint8Array;
    expect(requested).toBeInstanceOf(Uint8Array);
    expect(requested.length).toBe(IV_LENGTH_BYTES);
  });

  it('exposes no way for a caller to supply an IV', () => {
    // Structural guard: `encryptRecord(dataKey, plaintext, context)` takes
    // exactly three parameters, so there is no seat for a caller-chosen IV.
    expect(encryptRecord.length).toBe(3);
  });
});

describe('key validation', () => {
  it('rejects an extractable data key', async () => {
    const extractable = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );

    await expectRecordCipherError(
      encryptRecord(extractable, utf8('x'), CONTEXT),
      'key/invalid',
    );
  });

  it('rejects a key for the wrong algorithm', async () => {
    const wrongAlgorithm = await makeMasterKey();

    await expectRecordCipherError(
      encryptRecord(wrongAlgorithm, utf8('x'), CONTEXT),
      'key/invalid',
    );
  });

  it('rejects a 128-bit AES-GCM key', async () => {
    const short = await subtle.generateKey(
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt', 'decrypt'],
    );

    await expectRecordCipherError(
      encryptRecord(short, utf8('x'), CONTEXT),
      'key/invalid',
    );
  });

  it('rejects a non-CryptoKey', async () => {
    await expectRecordCipherError(
      encryptRecord({} as CryptoKey, utf8('x'), CONTEXT),
      'key/invalid',
    );
  });

  it('fails to decrypt under a different data key', async () => {
    const envelope = await encryptRecord(
      await makeDataKey(),
      utf8('secret'),
      CONTEXT,
    );

    await expectRecordCipherError(
      decryptRecord(await makeDataKey(), envelope, CONTEXT),
      'decrypt/failed',
    );
  });
});

describe('tamper detection', () => {
  it('rejects a flipped ciphertext byte', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(
      key,
      utf8('a longer payload'),
      CONTEXT,
    );
    const ciphertextStart = 1 + IV_LENGTH_BYTES;

    await expectRecordCipherError(
      decryptRecord(key, flipByte(envelope, ciphertextStart), CONTEXT),
      'decrypt/failed',
    );
    await expectRecordCipherError(
      decryptRecord(
        key,
        flipByte(envelope, envelope.length - GCM_TAG_LENGTH_BYTES - 1),
        CONTEXT,
      ),
      'decrypt/failed',
    );
  });

  it('rejects a flipped auth-tag byte', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(
      key,
      utf8('a longer payload'),
      CONTEXT,
    );

    for (const offset of [GCM_TAG_LENGTH_BYTES, 1]) {
      await expectRecordCipherError(
        decryptRecord(
          key,
          flipByte(envelope, envelope.length - offset),
          CONTEXT,
        ),
        'decrypt/failed',
      );
    }
  });

  it('rejects a flipped IV byte', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(
      key,
      utf8('a longer payload'),
      CONTEXT,
    );

    for (let i = 1; i <= IV_LENGTH_BYTES; i += 1) {
      await expectRecordCipherError(
        decryptRecord(key, flipByte(envelope, i), CONTEXT),
        'decrypt/failed',
      );
    }
  });

  it('rejects a flipped version byte as an unsupported version', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(
      key,
      utf8('a longer payload'),
      CONTEXT,
    );

    await expectRecordCipherError(
      decryptRecord(key, flipByte(envelope, 0), CONTEXT),
      'envelope/unsupported-version',
    );
  });

  it('rejects a truncated envelope', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(
      key,
      utf8('a longer payload'),
      CONTEXT,
    );

    // One byte short: still structurally valid, fails authentication.
    await expectRecordCipherError(
      decryptRecord(key, envelope.slice(0, envelope.length - 1), CONTEXT),
      'decrypt/failed',
    );
    // Truncated past the header: rejected at the boundary.
    await expectRecordCipherError(
      decryptRecord(
        key,
        envelope.slice(0, MIN_ENVELOPE_LENGTH_BYTES - 1),
        CONTEXT,
      ),
      'envelope/too-short',
    );
    await expectRecordCipherError(
      decryptRecord(key, new Uint8Array(0), CONTEXT),
      'envelope/too-short',
    );
  });

  it('rejects an extended envelope', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(
      key,
      utf8('a longer payload'),
      CONTEXT,
    );
    const extended = new Uint8Array(envelope.length + 1);
    extended.set(envelope);

    await expectRecordCipherError(
      decryptRecord(key, extended, CONTEXT),
      'decrypt/failed',
    );
  });

  it('rejects an envelope that is not a byte array', async () => {
    const key = await makeDataKey();

    await expectRecordCipherError(
      decryptRecord(key, 'not bytes' as unknown as Uint8Array, CONTEXT),
      'envelope/invalid',
    );
  });
});

describe('additional authenticated data binds a record to its location', () => {
  it('refuses an envelope replayed into a different record id', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(key, utf8('12500 cents'), CONTEXT);

    await expectRecordCipherError(
      decryptRecord(key, envelope, { ...CONTEXT, recordId: 'other-id' }),
      'decrypt/failed',
    );
  });

  it('refuses an envelope replayed into a different table', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(key, utf8('12500 cents'), CONTEXT);

    await expectRecordCipherError(
      decryptRecord(key, envelope, { ...CONTEXT, table: 'cashEntries' }),
      'decrypt/failed',
    );
  });

  it('encodes the context unambiguously across the table/id boundary', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(key, utf8('x'), {
      table: 'ab',
      recordId: 'c',
    });

    await expectRecordCipherError(
      decryptRecord(key, envelope, { table: 'a', recordId: 'bc' }),
      'decrypt/failed',
    );
  });

  it('rejects an invalid context on both encrypt and decrypt', async () => {
    const key = await makeDataKey();
    const tooLong = 'x'.repeat(MAX_CONTEXT_FIELD_BYTES + 1);
    const invalid: RecordContext[] = [
      { table: '', recordId: 'id' },
      { table: 'transactions', recordId: '' },
      { table: tooLong, recordId: 'id' },
      { table: 'transactions', recordId: tooLong },
      { table: 42 as unknown as string, recordId: 'id' },
      { table: 'transactions', recordId: null as unknown as string },
      undefined as unknown as RecordContext,
    ];

    for (const context of invalid) {
      await expectRecordCipherError(
        encryptRecord(key, utf8('x'), context),
        'context/invalid',
      );
    }

    const envelope = await encryptRecord(key, utf8('x'), CONTEXT);
    await expectRecordCipherError(
      decryptRecord(key, envelope, { table: '', recordId: 'id' }),
      'context/invalid',
    );
  });
});

describe('plaintext validation', () => {
  it('rejects a plaintext that is not a byte array', async () => {
    const key = await makeDataKey();

    await expectRecordCipherError(
      encryptRecord(key, 'not bytes' as unknown as Uint8Array, CONTEXT),
      'plaintext/invalid',
    );
  });

  it('rejects an implausibly large plaintext', async () => {
    const key = await makeDataKey();

    await expectRecordCipherError(
      encryptRecord(key, new Uint8Array(MAX_PLAINTEXT_BYTES + 1), CONTEXT),
      'plaintext/too-large',
    );
  });
});

describe('error hygiene', () => {
  it('never puts plaintext or key material in an error or a log line', async () => {
    const marker = 'CANARY-PLAINTEXT-MARKER-9f3b';
    const key = await makeDataKey();
    const envelope = await encryptRecord(key, utf8(marker), CONTEXT);
    const spies = (
      ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    ).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

    const errors = [
      await expectRecordCipherError(
        decryptRecord(key, flipByte(envelope, envelope.length - 1), CONTEXT),
        'decrypt/failed',
      ),
      await expectRecordCipherError(
        decryptRecord(key, new Uint8Array(4), CONTEXT),
        'envelope/too-short',
      ),
      await expectRecordCipherError(
        encryptRecord(key, utf8(marker), { table: '', recordId: 'id' }),
        'context/invalid',
      ),
    ];

    for (const error of errors) {
      expect(error.message).not.toContain(marker);
      expect(error.stack ?? '').not.toContain(marker);
      expect(error.message.length).toBeLessThan(200);
    }
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('reports a decryption failure without distinguishing why it failed', async () => {
    const key = await makeDataKey();
    const envelope = await encryptRecord(key, utf8('payload'), CONTEXT);

    const badKey = await expectRecordCipherError(
      decryptRecord(await makeDataKey(), envelope, CONTEXT),
      'decrypt/failed',
    );
    const badContext = await expectRecordCipherError(
      decryptRecord(key, envelope, { ...CONTEXT, recordId: 'other' }),
      'decrypt/failed',
    );
    const badCiphertext = await expectRecordCipherError(
      decryptRecord(key, flipByte(envelope, 20), CONTEXT),
      'decrypt/failed',
    );

    expect(badContext.message).toBe(badKey.message);
    expect(badCiphertext.message).toBe(badKey.message);
  });
});
