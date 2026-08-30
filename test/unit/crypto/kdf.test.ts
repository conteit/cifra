import { describe, expect, it } from 'vitest';
import {
  ARGON2ID_DEFAULT_PARAMS,
  type Argon2idParams,
  assertArgon2idParams,
  deriveMasterKey,
  generateSalt,
  KdfError,
  MASTER_KEY_LENGTH_BYTES,
  SALT_LENGTH_BYTES,
} from '../../../app/crypto/kdf';
import { argon2idDigestForVectorTests } from '../../../app/crypto/kdf-worker-body';
import { recordingKdfWorkerFactory } from '../../support/kdf-worker-port';

/**
 * `deriveMasterKey` runs Argon2id in a Web Worker since #61, and this project
 * is the browser-free `unit` one — Node 24 has `node:worker_threads`, not the
 * DOM `Worker`. Every call below therefore injects the in-process port from
 * `test/support/kdf-worker-port.ts`, which routes the request through
 * `structuredClone` into the real `handleDeriveRequest`. What these tests
 * exercise is the shipping worker body across a real serialization boundary;
 * what they do not exercise is the `Worker` constructor, which
 * `test/e2e/kdf-worker.spec.ts` covers in Chromium.
 *
 * The boundary's own properties — that no bytes cross it, that the worker is
 * always terminated, that bad parameters never spawn one — are asserted in
 * `kdf-worker.test.ts`, not here.
 */
function derive(
  password: string,
  salt: Uint8Array,
  params?: Argon2idParams,
): Promise<CryptoKey> {
  return deriveMasterKey(password, salt, params, {
    createWorker: recordingKdfWorkerFactory(),
  });
}

/**
 * The cheapest parameters the production gate accepts — exactly the strength
 * floor (OWASP's weakest Argon2id configuration, m = 19 MiB, t = 2, p = 1),
 * ~20 ms per derivation on an M4. Used by every test that only exercises
 * plumbing (validation, key shape, determinism) so those tests still go through
 * the same gate production does. Real cost is covered by the
 * production-parameter test below and by the 64 MiB known-answer vectors.
 */
const CHEAP_PARAMS: Argon2idParams = {
  memorySizeKib: 19_456,
  iterations: 2,
  parallelism: 1,
};

/**
 * Parameters sitting exactly *on* each ceiling. Only ever handed to
 * `assertArgon2idParams`, never derived: at 1048576 KiB-passes each of these
 * costs ~0.6 s on an M4, which is the whole reason the ceiling is where it is.
 */
const ARGON2ID_MEMORY_CEILING_PARAMS: Argon2idParams = {
  memorySizeKib: 262_144,
  iterations: 1,
  parallelism: 1,
};
const ARGON2ID_COST_CEILING_PARAMS: Argon2idParams = {
  memorySizeKib: 65_536,
  iterations: 16,
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
    [
      'memory far below the strength floor',
      { memorySizeKib: 8, iterations: 3, parallelism: 2 },
    ],
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

/**
 * The security bounds, one uniquely-attributable case per bound.
 *
 * Each rejected case sits *one step* outside exactly one bound and comfortably
 * inside every other, so removing any single bound from `app/crypto/kdf-params.ts`
 * makes exactly the case named for it fail. The numbers are written out here
 * rather than imported from the module on purpose: importing the constant would
 * make the test move with the value it is supposed to pin.
 *
 * Bounds are security bounds, not tuning knobs — see the block comments on
 * `ARGON2ID_COST_CEILING_KIB_PASSES` and `ARGON2ID_STRENGTH_FLOOR`. Changing
 * one is a security decision that needs a fresh measurement.
 */
describe('assertArgon2idParams — security bounds', () => {
  it.each<[string, Argon2idParams]>([
    ['the strength floor itself (19 MiB x 2)', CHEAP_PARAMS],
    [
      'the OWASP alternative configuration (46 MiB x 1)',
      { memorySizeKib: 47_104, iterations: 1, parallelism: 1 },
    ],
    ['the memory ceiling at t=1', ARGON2ID_MEMORY_CEILING_PARAMS],
    ['the cost ceiling split as 64 MiB x 16', ARGON2ID_COST_CEILING_PARAMS],
    [
      'the cost ceiling split as 256 MiB x 4',
      { memorySizeKib: 262_144, iterations: 4, parallelism: 1 },
    ],
    [
      'a plausible post-#29 default (64 MiB x 8)',
      { memorySizeKib: 65_536, iterations: 8, parallelism: 1 },
    ],
    [
      'a plausible post-#29 default (128 MiB x 4)',
      { memorySizeKib: 131_072, iterations: 4, parallelism: 1 },
    ],
  ])('accepts %s', (_label, value) => {
    expect(() => assertArgon2idParams(value)).not.toThrow();
  });

  it.each<[string, Argon2idParams]>([
    // Only the memory ceiling rejects this: 262145 KiB-passes is far under the
    // cost ceiling and t/p are in range.
    [
      'memory one KiB over the 256 MiB ceiling',
      { memorySizeKib: 262_145, iterations: 1, parallelism: 1 },
    ],
    // Only the iteration ceiling rejects this: 330752 KiB-passes is far under
    // the cost ceiling and the memory is mid-range.
    [
      'iterations one pass over the 16-pass ceiling',
      { memorySizeKib: 19_456, iterations: 17, parallelism: 1 },
    ],
    // Only the cost ceiling rejects this: memory sits exactly *at* its ceiling
    // and iterations well under theirs, but 2097152 KiB-passes is 2x the cost
    // ceiling — ~1.1 s measured. This is the case per-parameter caps miss.
    [
      'memory at its ceiling combined with 8 passes',
      { memorySizeKib: 262_144, iterations: 8, parallelism: 1 },
    ],
    // Only the memory floor rejects this: 77820 KiB-passes clears the cost
    // floor twice over.
    [
      'memory one KiB under the 19 MiB floor',
      { memorySizeKib: 19_455, iterations: 4, parallelism: 1 },
    ],
    // Only the cost floor rejects this: 32 MiB clears the memory floor, but a
    // single pass over it is 32768 KiB-passes, under the 38912 floor.
    [
      'memory above the floor but a single pass under the cost floor',
      { memorySizeKib: 32_768, iterations: 1, parallelism: 1 },
    ],
    // The parameters from the Sprint 01 review finding (S-4): 36.5 s measured.
    [
      'the 1 GiB x 64-pass parameters the old bounds admitted',
      { memorySizeKib: 1_048_576, iterations: 64, parallelism: 1 },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => assertArgon2idParams(value)).toThrow(KdfError);
    try {
      assertArgon2idParams(value);
    } catch (error) {
      expect((error as KdfError).code).toBe('params/invalid');
    }
  });

  it('leaves headroom above the current default for #29 to raise iterations', () => {
    // The ceiling must not be a bound #29 immediately has to raise. Assert the
    // slack explicitly so shrinking the ceiling is a visible decision.
    const defaultCost =
      ARGON2ID_DEFAULT_PARAMS.memorySizeKib *
      ARGON2ID_DEFAULT_PARAMS.iterations;
    const ceilingCost =
      ARGON2ID_COST_CEILING_PARAMS.memorySizeKib *
      ARGON2ID_COST_CEILING_PARAMS.iterations;
    expect(ceilingCost / defaultCost).toBeGreaterThanOrEqual(5);

    // Raising only the iteration count, the parameter #29 is expected to move,
    // must stay inside the ceiling up to at least 5x today's value.
    expect(() =>
      assertArgon2idParams({
        ...ARGON2ID_DEFAULT_PARAMS,
        iterations: ARGON2ID_DEFAULT_PARAMS.iterations * 5,
      }),
    ).not.toThrow();
  });

  it('keeps the defaults comfortably inside every bound', () => {
    expect(() => assertArgon2idParams(ARGON2ID_DEFAULT_PARAMS)).not.toThrow();
    expect(ARGON2ID_DEFAULT_PARAMS.memorySizeKib).toBeGreaterThanOrEqual(
      19_456,
    );
    expect(ARGON2ID_DEFAULT_PARAMS.memorySizeKib).toBeLessThanOrEqual(262_144);
    expect(ARGON2ID_DEFAULT_PARAMS.iterations).toBeLessThanOrEqual(16);
  });
});

describe('deriveMasterKey — parameters are bounded before any derivation', () => {
  /**
   * The point of the ceiling is that rejection is *free*. Deriving these
   * parameters measures 36.5 s on an M4 (Sprint 01 finding S-4); rejecting them
   * must not begin that work at all.
   *
   * The companion test in `kdf-param-bounds.test.ts` asserts the same property
   * structurally, by proving hash-wasm's `argon2id` is never called. This one
   * asserts it observably, without a mock: if the ceiling were removed, or the
   * check moved after the digest, the elapsed time here would be five orders of
   * magnitude larger.
   */
  it('rejects 1 GiB x 64 passes in microseconds, not the 36 s it would cost', async () => {
    const start = performance.now();
    await expect(
      derive('correct horse', SALT_A, {
        memorySizeKib: 1_048_576,
        iterations: 64,
        parallelism: 1,
      }),
    ).rejects.toMatchObject({ code: 'params/invalid' });
    expect(performance.now() - start).toBeLessThan(250);
  });

  it('rejects params that are merely too weak just as cheaply', async () => {
    const start = performance.now();
    await expect(
      derive('correct horse', SALT_A, {
        memorySizeKib: 8,
        iterations: 1,
        parallelism: 1,
      }),
    ).rejects.toMatchObject({ code: 'params/invalid' });
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('deriveMasterKey — input validation', () => {
  it('rejects an empty password', async () => {
    await expect(derive('', SALT_A, CHEAP_PARAMS)).rejects.toMatchObject({
      code: 'password/empty',
    });
  });

  it('rejects an absurdly long password', async () => {
    await expect(
      derive('x'.repeat(1025), SALT_A, CHEAP_PARAMS),
    ).rejects.toMatchObject({ code: 'password/too-long' });
  });

  it('never echoes the password in the error message', async () => {
    const secret = 'MARKER-do-not-leak-this-value';
    const password = secret.repeat(200);
    let message = '';
    let stack = '';
    try {
      await derive(password, SALT_A, CHEAP_PARAMS);
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
        derive('correct horse', new Uint8Array(length), CHEAP_PARAMS),
      ).rejects.toMatchObject({ code: 'salt/invalid-length' });
    },
  );

  it('rejects a non-Uint8Array salt', async () => {
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: deliberate wrong-type input
      derive('correct horse', 'somesalt16bytes!' as any, CHEAP_PARAMS),
    ).rejects.toMatchObject({ code: 'salt/invalid-length' });
  });

  it('rejects invalid params', async () => {
    await expect(
      derive('correct horse', SALT_A, {
        memorySizeKib: 65536,
        iterations: 0,
        parallelism: 1,
      }),
    ).rejects.toMatchObject({ code: 'params/invalid' });
  });

  it('does not mutate the caller-supplied salt', async () => {
    const salt = new Uint8Array(SALT_A);
    await derive('correct horse', salt, CHEAP_PARAMS);
    expect(Array.from(salt)).toEqual(Array.from(SALT_A));
  });
});

describe('deriveMasterKey — key shape', () => {
  it('returns a non-extractable AES-KW CryptoKey usable only for wrapping', async () => {
    const key = await derive('correct horse', SALT_A, CHEAP_PARAMS);

    expect(key.extractable).toBe(false);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-KW');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(
      MASTER_KEY_LENGTH_BYTES * 8,
    );
    expect([...key.usages].sort()).toEqual(['unwrapKey', 'wrapKey']);
  });

  it('refuses to export the derived key material', async () => {
    const key = await derive('correct horse', SALT_A, CHEAP_PARAMS);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('can wrap and unwrap a data key (the step-3 contract)', async () => {
    const master = await derive('correct horse', SALT_A, CHEAP_PARAMS);
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
    const a = await derive('correct horse', SALT_A, CHEAP_PARAMS);
    const b = await derive('correct horse', SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).toBe(await keyFingerprint(b));
  });

  it('differs for a different password', async () => {
    const a = await derive('correct horse', SALT_A, CHEAP_PARAMS);
    const b = await derive('correct horsf', SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it('differs for a different salt', async () => {
    const a = await derive('correct horse', SALT_A, CHEAP_PARAMS);
    const b = await derive('correct horse', SALT_B, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it('differs for different params (so stored params are load-bearing)', async () => {
    const a = await derive('correct horse', SALT_A, CHEAP_PARAMS);
    const b = await derive('correct horse', SALT_A, {
      ...CHEAP_PARAMS,
      iterations: CHEAP_PARAMS.iterations + 1,
    });
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it('unlocks a vault created with older stored params', async () => {
    // A vault created under legacy params must still unlock when those params
    // are passed back in, even though the defaults have since moved on. Legacy
    // params must still clear the strength floor — which is exactly why the
    // floor was set now, before any vault exists.
    const legacy: Argon2idParams = {
      memorySizeKib: 19_456,
      iterations: 3,
      parallelism: 1,
    };
    const atCreation = await derive('correct horse', SALT_A, legacy);
    const atUnlock = await derive('correct horse', SALT_A, legacy);
    expect(await keyFingerprint(atUnlock)).toBe(
      await keyFingerprint(atCreation),
    );
    const withDefaults = await derive('correct horse', SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(withDefaults)).not.toBe(
      await keyFingerprint(atCreation),
    );
  });

  it('normalizes the password to NFC so equivalent typings unlock', async () => {
    const precomposed = 'perch\u00E9-Citt\u00E0'; // é, à as single code points
    const decomposed = 'perche\u0301-Citta\u0300'; // e + U+0301, a + U+0300
    expect(precomposed).not.toBe(decomposed);
    expect(precomposed.normalize('NFD')).toBe(decomposed.normalize('NFD'));

    const a = await derive(precomposed, SALT_A, CHEAP_PARAMS);
    const b = await derive(decomposed, SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).toBe(await keyFingerprint(b));
  });

  it('does not apply NFKC (visually distinct passwords stay distinct)', async () => {
    // NFKC would fold fullwidth U+FF41 onto ASCII 'a'; NFC does not.
    const ascii = 'abc';
    const fullwidth = '\uFF41bc';
    const a = await derive(ascii, SALT_A, CHEAP_PARAMS);
    const b = await derive(fullwidth, SALT_A, CHEAP_PARAMS);
    expect(await keyFingerprint(a)).not.toBe(await keyFingerprint(b));
  });

  it('is deterministic at production parameters', async () => {
    const a = await derive('correct horse battery staple', SALT_A);
    const b = await derive(
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
 * These vectors are deliberately weak (m = 256 KiB, t = 1) — they pin the
 * *algorithm*, not this app's policy — so `argon2idDigestForVectorTests`
 * bypasses the strength floor. It still applies the cost ceiling.
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
