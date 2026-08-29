import { describe, expect, it } from 'vitest';
import {
  ARGON2ID_DEFAULT_PARAMS,
  type Argon2idParams,
  argon2idDigestForVectorTests,
  assertArgon2idParams,
  deriveMasterKey,
  generateSalt,
  KdfError,
  MASTER_KEY_LENGTH_BYTES,
  SALT_LENGTH_BYTES,
} from '../../../app/crypto/kdf';

/**
 * Reduced-cost parameters for tests that only exercise plumbing (validation,
 * key shape, determinism). Real cost is covered by the production-parameter
 * test below and by the 64 MiB known-answer vectors.
 */
const CHEAP_PARAMS: Argon2idParams = {
  memorySizeKib: 256,
  iterations: 2,
  parallelism: 1,
};

const SALT_A = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
  0x0d, 0x0e, 0x0f,
]);
const SALT_B = new Uint8Array(16).fill(0xab);

/**
 * A fixed, extractable AES-GCM key used only as a probe: wrapping it with a
 * derived master key yields a deterministic byte string (AES-KW has no IV and
 * no randomness), so two master keys produce the same wrap output if and only
 * if they hold the same key material. This lets us assert key equality
 * *without* ever making the master key extractable.
 */
const PROBE_KEY_BYTES = new Uint8Array(32).fill(0x5a);

function toHex(bytes: Uint8Array | ArrayBuffer): string {
  return Array.from(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}

async function keyFingerprint(masterKey: CryptoKey): Promise<string> {
  const probe = await crypto.subtle.importKey(
    'raw',
    PROBE_KEY_BYTES,
    'AES-GCM',
    true,
    ['encrypt'],
  );
  return toHex(await crypto.subtle.wrapKey('raw', probe, masterKey, 'AES-KW'));
}

describe('generateSalt', () => {
  it('returns 16 random bytes', () => {
    const salt = generateSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt).toHaveLength(SALT_LENGTH_BYTES);
    expect(SALT_LENGTH_BYTES).toBe(16);
  });

  it('does not repeat across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      seen.add(toHex(generateSalt()));
    }
    expect(seen.size).toBe(32);
  });

  it('is not a constant or all-zero value', () => {
    const salt = generateSalt();
    expect(salt.every((b) => b === 0)).toBe(false);
  });
});

describe('ARGON2ID_DEFAULT_PARAMS', () => {
  it('matches the documented architecture parameters (64 MiB memory)', () => {
    expect(ARGON2ID_DEFAULT_PARAMS.memorySizeKib).toBe(65536);
    expect(ARGON2ID_DEFAULT_PARAMS.parallelism).toBe(1);
    expect(ARGON2ID_DEFAULT_PARAMS.iterations).toBeGreaterThanOrEqual(1);
  });

  it('derives a 256-bit key', () => {
    expect(MASTER_KEY_LENGTH_BYTES).toBe(32);
  });

  it('is frozen so a caller cannot mutate the shared default', () => {
    expect(Object.isFrozen(ARGON2ID_DEFAULT_PARAMS)).toBe(true);
  });
});

describe('assertArgon2idParams', () => {
  it('accepts the defaults', () => {
    expect(() => assertArgon2idParams(ARGON2ID_DEFAULT_PARAMS)).not.toThrow();
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'm=65536,t=3,p=1'],
    ['missing fields', { memorySizeKib: 65536 }],
    [
      'zero iterations',
      { memorySizeKib: 65536, iterations: 0, parallelism: 1 },
    ],
    [
      'fractional iterations',
      { memorySizeKib: 65536, iterations: 1.5, parallelism: 1 },
    ],
    [
      'absurd iterations',
      { memorySizeKib: 65536, iterations: 1_000_000, parallelism: 1 },
    ],
    [
      'zero parallelism',
      { memorySizeKib: 65536, iterations: 3, parallelism: 0 },
    ],
    [
      'absurd parallelism',
      { memorySizeKib: 65536, iterations: 3, parallelism: 4096 },
    ],
    ['memory below 8*p', { memorySizeKib: 8, iterations: 3, parallelism: 2 }],
    [
      'absurd memory',
      { memorySizeKib: 8_388_608, iterations: 3, parallelism: 1 },
    ],
    [
      'NaN memory',
      { memorySizeKib: Number.NaN, iterations: 3, parallelism: 1 },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => assertArgon2idParams(value)).toThrow(KdfError);
    try {
      assertArgon2idParams(value);
    } catch (error) {
      expect((error as KdfError).code).toBe('params/invalid');
    }
  });
});

describe('deriveMasterKey — input validation', () => {
  it('rejects an empty password', async () => {
    await expect(
      deriveMasterKey('', SALT_A, CHEAP_PARAMS),
    ).rejects.toMatchObject({ code: 'password/empty' });
  });

  it('rejects an absurdly long password', async () => {
    await expect(
      deriveMasterKey('x'.repeat(1025), SALT_A, CHEAP_PARAMS),
    ).rejects.toMatchObject({ code: 'password/too-long' });
  });

  it('never echoes the password in the error message', async () => {
    const secret = 'MARKER-do-not-leak-this-value';
    const password = secret.repeat(200);
    let message = '';
    let stack = '';
    try {
      await deriveMasterKey(password, SALT_A, CHEAP_PARAMS);
    } catch (error) {
      message = (error as Error).message;
      stack = (error as Error).stack ?? '';
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(secret);
    expect(stack).not.toContain(secret);
  });

  it.each([0, 8, 15, 17, 32])(
    'rejects a %i-byte salt (only 16 is valid)',
    async (length) => {
      await expect(
        deriveMasterKey('correct horse', new Uint8Array(length), CHEAP_PARAMS),
      ).rejects.toMatchObject({ code: 'salt/invalid-length' });
    },
  );

  it('rejects a non-Uint8Array salt', async () => {
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: deliberate wrong-type input
      deriveMasterKey('correct horse', 'somesalt16bytes!' as any, CHEAP_PARAMS),
    ).rejects.toMatchObject({ code: 'salt/invalid-length' });
  });

  it('rejects invalid params', async () => {
    await expect(
      deriveMasterKey('correct horse', SALT_A, {
        memorySizeKib: 65536,
        iterations: 0,
        parallelism: 1,
      }),
    ).rejects.toMatchObject({ code: 'params/invalid' });
  });

  it('does not mutate the caller-supplied salt', async () => {
    const salt = new Uint8Array(SALT_A);
    await deriveMasterKey('correct horse', salt, CHEAP_PARAMS);
    expect(Array.from(salt)).toEqual(Array.from(SALT_A));
  });
});

describe('deriveMasterKey — key shape', () => {
  it('returns a non-extractable AES-KW CryptoKey usable only for wrapping', async () => {
    const key = await deriveMasterKey('correct horse', SALT_A, CHEAP_PARAMS);

    expect(key.extractable).toBe(false);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-KW');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(
      MASTER_KEY_LENGTH_BYTES * 8,
    );
    expect([...key.usages].sort()).toEqual(['unwrapKey', 'wrapKey']);
  });

  it('refuses to export the derived key material', async () => {
    const key = await deriveMasterKey('correct horse', SALT_A, CHEAP_PARAMS);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('can wrap and unwrap a data key (the step-3 contract)', async () => {
    const master = await deriveMasterKey('correct horse', SALT_A, CHEAP_PARAMS);
    const dataKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const wrapped = await crypto.subtle.wrapKey(
      'raw',
      dataKey,
      master,
      'AES-KW',
    );
    // AES-KW adds an 8-byte integrity check block.
    expect(wrapped.byteLength).toBe(MASTER_KEY_LENGTH_BYTES + 8);

    const unwrapped = await crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      master,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    expect(toHex(await crypto.subtle.exportKey('raw', unwrapped))).toBe(
      toHex(await crypto.subtle.exportKey('raw', dataKey)),
    );
  });
});

describe('deriveMasterKey — determinism', () => {
  it('is deterministic for the same password, salt and params', async () => {
    const a = await deriveMasterKey('correct horse', SALT_A, CHEAP_PARAMS);
    const b = await deriveMasterKey('correct horse', SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).toBe(await keyFingerprint(b));
  });

  it('differs for a different password', async () => {
    const a = await deriveMasterKey('correct horse', SALT_A, CHEAP_PARAMS);
    const b = await deriveMasterKey('correct horsf', SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it('differs for a different salt', async () => {
    const a = await deriveMasterKey('correct horse', SALT_A, CHEAP_PARAMS);
    const b = await deriveMasterKey('correct horse', SALT_B, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it('differs for different params (so stored params are load-bearing)', async () => {
    const a = await deriveMasterKey('correct horse', SALT_A, CHEAP_PARAMS);
    const b = await deriveMasterKey('correct horse', SALT_A, {
      ...CHEAP_PARAMS,
      iterations: CHEAP_PARAMS.iterations + 1,
    });
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it('unlocks a vault created with older stored params', async () => {
    // A vault created under legacy params must still unlock when those params
    // are passed back in, even though the defaults have since moved on.
    const legacy: Argon2idParams = {
      memorySizeKib: 256,
      iterations: 1,
      parallelism: 1,
    };
    const atCreation = await deriveMasterKey('correct horse', SALT_A, legacy);
    const atUnlock = await deriveMasterKey('correct horse', SALT_A, legacy);
    expect(await keyFingerprint(atUnlock)).toBe(
      await keyFingerprint(atCreation),
    );
    const withDefaults = await deriveMasterKey(
      'correct horse',
      SALT_A,
      CHEAP_PARAMS,
    );
    expect(await keyFingerprint(withDefaults)).not.toBe(
      await keyFingerprint(atCreation),
    );
  });

  it('normalizes the password to NFC so equivalent typings unlock', async () => {
    const precomposed = 'perch\u00E9-Citt\u00E0'; // é, à as single code points
    const decomposed = 'perche\u0301-Citta\u0300'; // e + U+0301, a + U+0300
    expect(precomposed).not.toBe(decomposed);
    expect(precomposed.normalize('NFD')).toBe(decomposed.normalize('NFD'));

    const a = await deriveMasterKey(precomposed, SALT_A, CHEAP_PARAMS);
    const b = await deriveMasterKey(decomposed, SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).toBe(await keyFingerprint(b));
  });

  it('does not apply NFKC (visually distinct passwords stay distinct)', async () => {
    // NFKC would fold fullwidth U+FF41 onto ASCII 'a'; NFC does not.
    const ascii = 'abc';
    const fullwidth = '\uFF41bc';
    const a = await deriveMasterKey(ascii, SALT_A, CHEAP_PARAMS);
    const b = await deriveMasterKey(fullwidth, SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it('is deterministic at production parameters', async () => {
    const a = await deriveMasterKey('correct horse battery staple', SALT_A);
    const b = await deriveMasterKey(
      'correct horse battery staple',
      SALT_A,
      ARGON2ID_DEFAULT_PARAMS,
    );
    expect(await keyFingerprint(a)).toBe(await keyFingerprint(b));
    expect(a.extractable).toBe(false);
  }, 30_000);
});

/**
 * Known-answer tests.
 *
 * A non-extractable `CryptoKey` cannot be read back, by design, so the derived
 * key's *value* cannot be asserted through the public API. Instead the vectors
 * are asserted one layer down, against the raw Argon2id digest step that
 * `deriveMasterKey` itself calls — `argon2idDigestForVectorTests` is a thin
 * documented test-only wrapper over that exact internal function, so a
 * regression in the digest is caught here while the public API keeps its
 * non-extractability guarantee intact.
 *
 * Vectors are the Argon2 reference implementation's own test suite
 * (P-H-C/phc-winner-argon2, `src/test.c`, Argon2id block, version 0x13,
 * 32-byte tag, no secret and no associated data). RFC 9106 §5.3's single
 * Argon2id vector uses a secret key *and* associated data; hash-wasm exposes
 * no associated-data parameter, so that vector is not expressible here.
 */
describe('argon2idDigestForVectorTests — reference known-answer vectors', () => {
  const enc = new TextEncoder();
  const vectors: ReadonlyArray<{
    password: string;
    salt: string;
    params: Argon2idParams;
    expected: string;
  }> = [
    {
      password: 'password',
      salt: 'somesalt',
      params: { memorySizeKib: 256, iterations: 2, parallelism: 1 },
      expected:
        '9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe',
    },
    {
      password: 'password',
      salt: 'somesalt',
      params: { memorySizeKib: 256, iterations: 2, parallelism: 2 },
      expected:
        '6d093c501fd5999645e0ea3bf620d7b8be7fd2db59c20d9fff9539da2bf57037',
    },
    {
      password: 'password',
      salt: 'somesalt',
      params: { memorySizeKib: 65536, iterations: 1, parallelism: 1 },
      expected:
        'f6a5adc1ba723dddef9b5ac1d464e180fcd9dffc9d1cbf76cca2fed795d9ca98',
    },
    {
      password: 'password',
      salt: 'somesalt',
      params: { memorySizeKib: 65536, iterations: 2, parallelism: 1 },
      expected:
        '09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7',
    },
    {
      password: 'password',
      salt: 'somesalt',
      params: { memorySizeKib: 65536, iterations: 4, parallelism: 1 },
      expected:
        '9025d48e68ef7395cca9079da4c4ec3affb3c8911fe4f86d1a2520856f63172c',
    },
    {
      password: 'differentpassword',
      salt: 'somesalt',
      params: { memorySizeKib: 65536, iterations: 2, parallelism: 1 },
      expected:
        '0b84d652cf6b0c4beaef0dfe278ba6a80df6696281d7e0d2891b817d8c458fde',
    },
    {
      password: 'password',
      salt: 'diffsalt',
      params: { memorySizeKib: 65536, iterations: 2, parallelism: 1 },
      expected:
        'bdf32b05ccc42eb15d58fd19b1f856b113da1e9a5874fdcc544308565aa8141c',
    },
  ];

  it.each(vectors)(
    'm=$params.memorySizeKib t=$params.iterations p=$params.parallelism pw=$password salt=$salt',
    async ({ password, salt, params, expected }) => {
      const digest = await argon2idDigestForVectorTests(
        enc.encode(password),
        enc.encode(salt),
        params,
        MASTER_KEY_LENGTH_BYTES,
      );
      expect(digest).toBeInstanceOf(Uint8Array);
      expect(toHex(digest)).toBe(expected);
    },
    30_000,
  );
});
