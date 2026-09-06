import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeRecoveryPhrase,
  deriveRecoveryKey,
  generateRecoveryPhrase,
  generateRecoverySalt,
  normalizeRecoveryPhrase,
  RECOVERY_PHRASE_ALPHABET,
  RECOVERY_PHRASE_ENTROPY_BITS,
  RECOVERY_PHRASE_ENTROPY_BYTES,
  RECOVERY_PHRASE_GROUP_COUNT,
  RECOVERY_PHRASE_GROUP_SIZE,
  RECOVERY_PHRASE_SYMBOL_COUNT,
  RECOVERY_SALT_LENGTH_BYTES,
  RecoveryPhraseError,
  type RecoveryPhraseErrorCode,
  recoveryPhrasesMatch,
} from '../../../app/crypto/recovery-phrase';

/**
 * The recovery phrase is the *only* thing standing between a forgotten master
 * password and permanent data loss (#68), so three properties are load-bearing
 * and each is asserted rather than described:
 *
 * 1. **Entropy** — 160 bits, from `crypto.getRandomValues` and nothing else.
 * 2. **The encoding is a bijection** — a phrase that decodes to different bytes
 *    than it was encoded from is a vault that cannot be opened by the piece of
 *    paper in the user's drawer, and nothing would notice until it mattered.
 * 3. **Reading it back is forgiving in exactly the ways Crockford defines and
 *    unforgiving everywhere else** — `O` for `0` must work; a 31-symbol phrase
 *    must not be padded into "close enough".
 */

const salt = () => new Uint8Array(RECOVERY_SALT_LENGTH_BYTES).fill(0x5a);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectPhraseError(
  run: () => unknown,
  code: RecoveryPhraseErrorCode,
): RecoveryPhraseError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(
    caught,
    `expected a RecoveryPhraseError with code ${code}`,
  ).toBeInstanceOf(RecoveryPhraseError);
  const typed = caught as RecoveryPhraseError;
  expect(typed.code).toBe(code);
  return typed;
}

async function expectAsyncPhraseError(
  promise: Promise<unknown>,
  code: RecoveryPhraseErrorCode,
): Promise<RecoveryPhraseError> {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(
    caught,
    `expected a RecoveryPhraseError with code ${code}`,
  ).toBeInstanceOf(RecoveryPhraseError);
  const typed = caught as RecoveryPhraseError;
  expect(typed.code).toBe(code);
  return typed;
}

/**
 * An independent encoder, written from the definition rather than from the
 * implementation: read the 160 bits as one big-endian integer and peel five
 * bits at a time off the top. `recovery-phrase.ts` accumulates bytes in a
 * shifting register instead, so a bug in either shows up as a disagreement.
 */
function encodeIndependently(entropy: Uint8Array): string {
  let value = 0n;
  for (const byte of entropy) value = (value << 8n) | BigInt(byte);
  const symbols: string[] = [];
  for (let index = RECOVERY_PHRASE_SYMBOL_COUNT - 1; index >= 0; index--) {
    const chunk = Number((value >> BigInt(index * 5)) & 0b11111n);
    symbols.push(RECOVERY_PHRASE_ALPHABET[chunk]);
  }
  const groups: string[] = [];
  for (let at = 0; at < symbols.length; at += RECOVERY_PHRASE_GROUP_SIZE) {
    groups.push(symbols.slice(at, at + RECOVERY_PHRASE_GROUP_SIZE).join(''));
  }
  return groups.join('-');
}

/** Makes `crypto.getRandomValues` fill with a known pattern. */
function stubRandomBytes(bytes: Uint8Array): void {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((<
    T extends ArrayBufferView | null,
  >(
    buffer: T,
  ): T => {
    const view = buffer as unknown as ArrayBufferView;
    const target = new Uint8Array(
      view.buffer,
      view.byteOffset,
      view.byteLength,
    );
    target.set(bytes.subarray(0, target.length));
    return buffer;
  }) as typeof globalThis.crypto.getRandomValues);
}

describe('the phrase carries the entropy the decision claims', () => {
  it('is 160 bits, which is 20 bytes and 32 five-bit symbols', () => {
    expect(RECOVERY_PHRASE_ENTROPY_BITS).toBe(160);
    expect(RECOVERY_PHRASE_ENTROPY_BYTES).toBe(20);
    expect(RECOVERY_PHRASE_SYMBOL_COUNT).toBe(32);
    expect(RECOVERY_PHRASE_GROUP_COUNT).toBe(8);
    // 32 symbols x 5 bits is exactly 160: no padding, no partial symbol, and
    // therefore no two written phrases that mean the same 20 bytes.
    expect(RECOVERY_PHRASE_SYMBOL_COUNT * 5).toBe(RECOVERY_PHRASE_ENTROPY_BITS);
  });

  it('uses an alphabet of 32 unambiguous symbols', () => {
    expect(RECOVERY_PHRASE_ALPHABET).toHaveLength(32);
    expect(new Set(RECOVERY_PHRASE_ALPHABET).size).toBe(32);
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(RECOVERY_PHRASE_ALPHABET).not.toContain(excluded);
    }
  });

  it('takes every bit from crypto.getRandomValues', () => {
    const entropy = new Uint8Array(RECOVERY_PHRASE_ENTROPY_BYTES);
    for (let i = 0; i < entropy.length; i++) entropy[i] = i * 11;
    stubRandomBytes(entropy);

    const phrase = generateRecoveryPhrase();

    expect(globalThis.crypto.getRandomValues).toHaveBeenCalledTimes(1);
    const [requested] = vi.mocked(globalThis.crypto.getRandomValues).mock
      .calls[0] as unknown as [Uint8Array];
    expect(requested.byteLength).toBe(RECOVERY_PHRASE_ENTROPY_BYTES);
    expect(phrase).toBe(encodeIndependently(entropy));
    expect(decodeRecoveryPhrase(phrase)).toEqual(entropy);
  });

  it('reports a missing CSPRNG rather than inventing entropy', () => {
    vi.stubGlobal('crypto', undefined);
    expectPhraseError(
      () => generateRecoveryPhrase(),
      'environment/no-web-crypto',
    );
    expectPhraseError(
      () => generateRecoverySalt(),
      'environment/no-web-crypto',
    );
  });

  it('does not repeat itself', () => {
    const phrases = new Set(
      Array.from({ length: 64 }, () => generateRecoveryPhrase()),
    );
    expect(phrases.size).toBe(64);
  });
});

describe('the written form is what a person can copy down', () => {
  it('is 8 groups of 4 symbols from the alphabet', () => {
    const phrase = generateRecoveryPhrase();
    const groups = phrase.split('-');
    expect(groups).toHaveLength(RECOVERY_PHRASE_GROUP_COUNT);
    for (const group of groups) {
      expect(group).toHaveLength(RECOVERY_PHRASE_GROUP_SIZE);
    }
    for (const symbol of phrase.replaceAll('-', '')) {
      expect(RECOVERY_PHRASE_ALPHABET).toContain(symbol);
    }
  });

  it('encodes the two extreme values as the two extreme phrases', () => {
    const zeros = new Uint8Array(RECOVERY_PHRASE_ENTROPY_BYTES);
    const ones = new Uint8Array(RECOVERY_PHRASE_ENTROPY_BYTES).fill(0xff);
    expect(normalizeRecoveryPhrase('0'.repeat(32))).toBe(
      '0000-0000-0000-0000-0000-0000-0000-0000',
    );
    expect(
      decodeRecoveryPhrase('0000-0000-0000-0000-0000-0000-0000-0000'),
    ).toEqual(zeros);
    expect(
      decodeRecoveryPhrase('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ'),
    ).toEqual(ones);
  });

  it('round-trips every random value it can produce', () => {
    for (let trial = 0; trial < 200; trial++) {
      const entropy = new Uint8Array(RECOVERY_PHRASE_ENTROPY_BYTES);
      globalThis.crypto.getRandomValues(entropy);
      stubRandomBytes(entropy);
      const phrase = generateRecoveryPhrase();
      vi.restoreAllMocks();

      expect(phrase).toBe(encodeIndependently(entropy));
      expect(decodeRecoveryPhrase(phrase)).toEqual(entropy);
    }
  });
});

describe('reading a phrase back forgives what Crockford forgives', () => {
  const phrase = 'A1B2-C3D4-E5F6-G7H8-J9K0-MNPQ-RSTV-WXYZ';
  const expected = decodeRecoveryPhrase(phrase);

  it('ignores case', () => {
    expect(decodeRecoveryPhrase(phrase.toLowerCase())).toEqual(expected);
  });

  it('ignores grouping, hyphens and whitespace', () => {
    expect(decodeRecoveryPhrase(phrase.replaceAll('-', ''))).toEqual(expected);
    expect(decodeRecoveryPhrase(phrase.replaceAll('-', ' '))).toEqual(expected);
    expect(
      decodeRecoveryPhrase(`\n  ${phrase.replaceAll('-', '\t')}  `),
    ).toEqual(expected);
  });

  it('folds the confusable characters onto their digits', () => {
    // Someone reading `0` as `O` and `1` as `I` or `l` still gets in.
    const misread = 'AIB2-C3D4-E5F6-G7H8-J9KO-MNPQ-RSTV-WXYZ';
    expect(decodeRecoveryPhrase(misread)).toEqual(expected);
    expect(recoveryPhrasesMatch(phrase, misread)).toBe(true);
    expect(normalizeRecoveryPhrase(misread)).toBe(phrase);
  });

  it('rejects a symbol that is not in the alphabet, including U', () => {
    for (const bad of ['U', '@', 'É']) {
      const mangled = `${bad}1B2-C3D4-E5F6-G7H8-J9K0-MNPQ-RSTV-WXYZ`;
      expectPhraseError(
        () => decodeRecoveryPhrase(mangled),
        'phrase/invalid-symbol',
      );
    }
  });

  it('rejects a phrase of the wrong length rather than padding it', () => {
    expectPhraseError(
      () => decodeRecoveryPhrase(phrase.slice(0, -1)),
      'phrase/invalid-length',
    );
    expectPhraseError(
      () => decodeRecoveryPhrase(`${phrase}Z`),
      'phrase/invalid-length',
    );
  });

  it('rejects an empty or non-string phrase', () => {
    for (const empty of ['', '   ', '----', undefined, null, 42]) {
      expectPhraseError(
        () => decodeRecoveryPhrase(empty as unknown as string),
        'phrase/empty',
      );
    }
  });

  it('never echoes the phrase in an error message', () => {
    const secret = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZU';
    const error = expectPhraseError(
      () => decodeRecoveryPhrase(secret),
      'phrase/invalid-symbol',
    );
    expect(error.message).not.toContain('ZZZ');
  });

  it('answers "did they copy it down" without throwing', () => {
    expect(recoveryPhrasesMatch(phrase, phrase)).toBe(true);
    expect(recoveryPhrasesMatch(phrase, generateRecoveryPhrase())).toBe(false);
    expect(recoveryPhrasesMatch(phrase, 'not a phrase')).toBe(false);
    expect(recoveryPhrasesMatch(phrase, '')).toBe(false);
  });
});

describe('the recovery key-encryption key', () => {
  /**
   * AES-KW is deterministic and has no IV, so wrapping one fixed probe key is a
   * complete fingerprint of the key-encryption key: two derivations agree if
   * and only if the wraps are byte-identical.
   */
  async function fingerprint(key: CryptoKey): Promise<string> {
    const probe = await globalThis.crypto.subtle.importKey(
      'raw',
      new Uint8Array(32).fill(0x2c),
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const wrapped = new Uint8Array(
      await globalThis.crypto.subtle.wrapKey('raw', probe, key, 'AES-KW'),
    );
    return [...wrapped]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  it('has exactly the shape key-wrap.ts demands of a master key', async () => {
    const key = await deriveRecoveryKey(generateRecoveryPhrase(), salt());
    expect(key.algorithm).toEqual({ name: 'AES-KW', length: 256 });
    expect(key.extractable).toBe(false);
    expect([...key.usages].sort()).toEqual(['unwrapKey', 'wrapKey']);
  });

  it('is a function of the phrase and the salt, and of nothing else', async () => {
    const phrase = generateRecoveryPhrase();
    const first = await fingerprint(await deriveRecoveryKey(phrase, salt()));
    expect(await fingerprint(await deriveRecoveryKey(phrase, salt()))).toBe(
      first,
    );

    // The same secret written differently is the same key: a user retyping in
    // lower case without hyphens must not be locked out.
    const rewritten = phrase.toLowerCase().replaceAll('-', ' ');
    expect(await fingerprint(await deriveRecoveryKey(rewritten, salt()))).toBe(
      first,
    );

    const otherSalt = new Uint8Array(RECOVERY_SALT_LENGTH_BYTES).fill(0x5b);
    expect(
      await fingerprint(await deriveRecoveryKey(phrase, otherSalt)),
    ).not.toBe(first);
    expect(
      await fingerprint(
        await deriveRecoveryKey(generateRecoveryPhrase(), salt()),
      ),
    ).not.toBe(first);
  });

  it('rejects a salt of the wrong length', async () => {
    const phrase = generateRecoveryPhrase();
    await expectAsyncPhraseError(
      deriveRecoveryKey(phrase, new Uint8Array(RECOVERY_SALT_LENGTH_BYTES - 1)),
      'salt/invalid-length',
    );
    await expectAsyncPhraseError(
      deriveRecoveryKey(phrase, undefined as unknown as Uint8Array),
      'salt/invalid-length',
    );
  });

  it('rejects a malformed phrase before deriving anything', async () => {
    await expectAsyncPhraseError(
      deriveRecoveryKey('nope', salt()),
      'phrase/invalid-length',
    );
  });

  it('mints a 16-byte salt from the CSPRNG', () => {
    const first = generateRecoverySalt();
    expect(first).toHaveLength(RECOVERY_SALT_LENGTH_BYTES);
    expect(generateRecoverySalt()).not.toEqual(first);
  });
});
