import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWrappedDataKey,
  DATA_KEY_ALGORITHM_NAME,
  DATA_KEY_LENGTH_BITS,
  KeyWrapError,
  rewrapDataKey,
  unwrapDataKey,
  WRAPPED_DATA_KEY_LENGTH_BYTES,
} from '../../../app/crypto/key-wrap';
import {
  decryptRecord,
  encryptRecord,
  type RecordContext,
} from '../../../app/crypto/record-cipher';

const subtle = globalThis.crypto.subtle;

/**
 * Builds a master key with exactly the shape `deriveMasterKey` (issue #4,
 * PR #30) returns: non-extractable AES-KW, usages `['wrapKey', 'unwrapKey']`.
 * Constructed here rather than imported so this branch stands alone; if #4's
 * contract ever changes, these tests are where the mismatch surfaces.
 */
async function makeMasterKey(): Promise<CryptoKey> {
  return await subtle.generateKey({ name: 'AES-KW', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
}

const CONTEXT: RecordContext = {
  table: 'transactions',
  recordId: 'rec-1',
  boundFields: [],
};
const utf8 = (value: string) => new TextEncoder().encode(value);

async function expectKeyWrapError(
  promise: Promise<unknown>,
  code: string,
): Promise<KeyWrapError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error, `expected a KeyWrapError with code ${code}`).toBeInstanceOf(
    KeyWrapError,
  );
  const typed = error as KeyWrapError;
  expect(typed.code).toBe(code);
  return typed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWrappedDataKey', () => {
  it('mints a non-extractable AES-256-GCM data key alongside its wrapped form', async () => {
    const masterKey = await makeMasterKey();

    const { dataKey, wrappedDataKey } = await createWrappedDataKey(masterKey);

    expect(dataKey.type).toBe('secret');
    expect(dataKey.extractable).toBe(false);
    expect(dataKey.algorithm.name).toBe(DATA_KEY_ALGORITHM_NAME);
    expect((dataKey.algorithm as AesKeyAlgorithm).length).toBe(
      DATA_KEY_LENGTH_BITS,
    );
    expect([...dataKey.usages].sort()).toEqual(['decrypt', 'encrypt']);
    expect(wrappedDataKey).toBeInstanceOf(Uint8Array);
    expect(wrappedDataKey.length).toBe(WRAPPED_DATA_KEY_LENGTH_BYTES);
  });

  it('mints a different data key on every call', async () => {
    const masterKey = await makeMasterKey();

    const first = await createWrappedDataKey(masterKey);
    const second = await createWrappedDataKey(masterKey);

    expect(first.wrappedDataKey).not.toEqual(second.wrappedDataKey);
    const envelope = await encryptRecord(first.dataKey, utf8('x'), CONTEXT);
    await expect(
      decryptRecord(second.dataKey, envelope, CONTEXT),
    ).rejects.toBeInstanceOf(Error);
  });

  it('returns a data key that cannot be exported or re-wrapped', async () => {
    const masterKey = await makeMasterKey();

    const { dataKey } = await createWrappedDataKey(masterKey);

    await expect(subtle.exportKey('raw', dataKey)).rejects.toBeTruthy();
    await expect(
      subtle.wrapKey('raw', dataKey, masterKey, 'AES-KW'),
    ).rejects.toBeTruthy();
  });
});

describe('wrap/unwrap round-trip', () => {
  it('unwraps to a data key that decrypts what the original encrypted', async () => {
    const masterKey = await makeMasterKey();
    const { dataKey, wrappedDataKey } = await createWrappedDataKey(masterKey);
    const plaintext = utf8('{"amount":-4500}');
    const envelope = await encryptRecord(dataKey, plaintext, CONTEXT);

    const unwrapped = await unwrapDataKey(masterKey, wrappedDataKey);

    expect(unwrapped.extractable).toBe(false);
    expect(unwrapped.algorithm.name).toBe(DATA_KEY_ALGORITHM_NAME);
    expect([...unwrapped.usages].sort()).toEqual(['decrypt', 'encrypt']);
    expect(await decryptRecord(unwrapped, envelope, CONTEXT)).toEqual(
      plaintext,
    );
    // ...and in the other direction, so both halves of the key are equal.
    expect(
      await decryptRecord(
        dataKey,
        await encryptRecord(unwrapped, plaintext, CONTEXT),
        CONTEXT,
      ),
    ).toEqual(plaintext);
  });

  it('survives repeated unwraps of the same stored blob', async () => {
    const masterKey = await makeMasterKey();
    const { wrappedDataKey } = await createWrappedDataKey(masterKey);
    const plaintext = utf8('stable');

    const a = await unwrapDataKey(masterKey, wrappedDataKey);
    const b = await unwrapDataKey(masterKey, wrappedDataKey);

    expect(
      await decryptRecord(
        b,
        await encryptRecord(a, plaintext, CONTEXT),
        CONTEXT,
      ),
    ).toEqual(plaintext);
  });

  it('refuses to unwrap under the wrong master key', async () => {
    const { wrappedDataKey } = await createWrappedDataKey(
      await makeMasterKey(),
    );

    await expectKeyWrapError(
      unwrapDataKey(await makeMasterKey(), wrappedDataKey),
      'unwrap/failed',
    );
  });

  it('refuses a tampered wrapped data key', async () => {
    const masterKey = await makeMasterKey();
    const { wrappedDataKey } = await createWrappedDataKey(masterKey);

    for (const index of [0, 7, 8, 19, WRAPPED_DATA_KEY_LENGTH_BYTES - 1]) {
      const tampered = Uint8Array.from(wrappedDataKey);
      tampered[index] ^= 0x01;
      await expectKeyWrapError(
        unwrapDataKey(masterKey, tampered),
        'unwrap/failed',
      );
    }
  });

  it('refuses a wrapped data key of the wrong length or type', async () => {
    const masterKey = await makeMasterKey();
    const { wrappedDataKey } = await createWrappedDataKey(masterKey);

    await expectKeyWrapError(
      unwrapDataKey(masterKey, wrappedDataKey.slice(0, -1)),
      'wrapped-key/invalid-length',
    );
    await expectKeyWrapError(
      unwrapDataKey(masterKey, new Uint8Array(0)),
      'wrapped-key/invalid-length',
    );
    await expectKeyWrapError(
      unwrapDataKey(masterKey, 'nope' as unknown as Uint8Array),
      'wrapped-key/invalid',
    );
  });
});

describe('master key validation', () => {
  it('accepts exactly the key shape deriveMasterKey produces', async () => {
    const masterKey = await makeMasterKey();

    expect(masterKey.algorithm.name).toBe('AES-KW');
    expect([...masterKey.usages].sort()).toEqual(['unwrapKey', 'wrapKey']);
    expect(masterKey.extractable).toBe(false);
    await expect(createWrappedDataKey(masterKey)).resolves.toBeTruthy();
  });

  it('rejects a master key of the wrong algorithm', async () => {
    const wrongAlgorithm = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    await expectKeyWrapError(
      createWrappedDataKey(wrongAlgorithm),
      'master-key/invalid',
    );
    await expectKeyWrapError(
      unwrapDataKey(
        wrongAlgorithm,
        new Uint8Array(WRAPPED_DATA_KEY_LENGTH_BYTES),
      ),
      'master-key/invalid',
    );
  });

  it('rejects an extractable master key', async () => {
    const extractable = await subtle.generateKey(
      { name: 'AES-KW', length: 256 },
      true,
      ['wrapKey', 'unwrapKey'],
    );

    await expectKeyWrapError(
      createWrappedDataKey(extractable),
      'master-key/invalid',
    );
  });

  it('rejects a master key missing a wrapping usage', async () => {
    const unwrapOnly = await subtle.generateKey(
      { name: 'AES-KW', length: 256 },
      false,
      ['unwrapKey'],
    );

    await expectKeyWrapError(
      createWrappedDataKey(unwrapOnly),
      'master-key/invalid',
    );
  });

  it('rejects a 128-bit master key', async () => {
    const short = await subtle.generateKey(
      { name: 'AES-KW', length: 128 },
      false,
      ['wrapKey', 'unwrapKey'],
    );

    await expectKeyWrapError(createWrappedDataKey(short), 'master-key/invalid');
  });

  it('rejects a non-CryptoKey', async () => {
    await expectKeyWrapError(
      createWrappedDataKey({} as CryptoKey),
      'master-key/invalid',
    );
  });
});

describe('rewrapDataKey (password change)', () => {
  it('re-wraps under a new master key without touching record ciphertext', async () => {
    const oldMasterKey = await makeMasterKey();
    const newMasterKey = await makeMasterKey();
    const { dataKey, wrappedDataKey } =
      await createWrappedDataKey(oldMasterKey);
    const plaintext = utf8('{"amount":999}');
    const envelope = await encryptRecord(dataKey, plaintext, CONTEXT);

    const rewrapped = await rewrapDataKey(
      oldMasterKey,
      newMasterKey,
      wrappedDataKey,
    );

    expect(rewrapped.length).toBe(WRAPPED_DATA_KEY_LENGTH_BYTES);
    expect(rewrapped).not.toEqual(wrappedDataKey);
    const afterChange = await unwrapDataKey(newMasterKey, rewrapped);
    expect(await decryptRecord(afterChange, envelope, CONTEXT)).toEqual(
      plaintext,
    );
  });

  it('leaves the old master key unable to open the new blob', async () => {
    const oldMasterKey = await makeMasterKey();
    const newMasterKey = await makeMasterKey();
    const { wrappedDataKey } = await createWrappedDataKey(oldMasterKey);

    const rewrapped = await rewrapDataKey(
      oldMasterKey,
      newMasterKey,
      wrappedDataKey,
    );

    await expectKeyWrapError(
      unwrapDataKey(oldMasterKey, rewrapped),
      'unwrap/failed',
    );
  });

  it('validates both master keys and the blob', async () => {
    const masterKey = await makeMasterKey();
    const { wrappedDataKey } = await createWrappedDataKey(masterKey);
    const notAMaster = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    await expectKeyWrapError(
      rewrapDataKey(notAMaster, masterKey, wrappedDataKey),
      'master-key/invalid',
    );
    await expectKeyWrapError(
      rewrapDataKey(masterKey, notAMaster, wrappedDataKey),
      'master-key/invalid',
    );
    await expectKeyWrapError(
      rewrapDataKey(masterKey, masterKey, wrappedDataKey.slice(0, 8)),
      'wrapped-key/invalid-length',
    );
    await expectKeyWrapError(
      rewrapDataKey(await makeMasterKey(), masterKey, wrappedDataKey),
      'unwrap/failed',
    );
  });
});

describe('error hygiene', () => {
  it('never puts key material in an error or a log line', async () => {
    const masterKey = await makeMasterKey();
    const { wrappedDataKey } = await createWrappedDataKey(masterKey);
    const spies = (
      ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    ).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

    const errors = [
      await expectKeyWrapError(
        unwrapDataKey(await makeMasterKey(), wrappedDataKey),
        'unwrap/failed',
      ),
      await expectKeyWrapError(
        unwrapDataKey(masterKey, wrappedDataKey.slice(0, 8)),
        'wrapped-key/invalid-length',
      ),
    ];
    const wrappedHex = [...wrappedDataKey]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    for (const error of errors) {
      const text = `${error.message}${error.stack ?? ''}`;
      expect(text).not.toContain(wrappedHex);
      expect(text).not.toContain(wrappedDataKey.join(','));
      expect(error.message.length).toBeLessThan(200);
    }
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
