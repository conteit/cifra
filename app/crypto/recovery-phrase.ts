/**
 * The recovery phrase — the second unlock method of the vault key hierarchy.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy step 3, which
 * leaves "room for additional unlock methods") and D26. This module owns the
 * *secret*: how it is generated, how it is written down, how it is read back,
 * and how it becomes a key-encryption key. `vault.ts` owns the lifecycle that
 * uses it.
 *
 * ## What it is, and what it is not
 *
 * A recovery phrase is **160 bits straight from `crypto.getRandomValues`**,
 * written as 32 Crockford base32 symbols in 8 hyphen-separated groups of 4:
 *
 * ```
 * 8ZQ4-K3TM-0RVX-2H7N-P5WD-6JYB-9CFA-1GES
 * ```
 *
 * It is never derived from anything the user supplies, never derived from the
 * master password, and never a second derivation path to the master key: it
 * derives an independent key-encryption key that wraps a **second copy of the
 * same data key** (§Crypto step 3). Losing the password therefore costs the
 * password, not the vault.
 *
 * ## Why 160 bits
 *
 * The phrase is a full-entropy random secret, so its strength is exactly its
 * entropy: an attacker holding a stolen `meta` row must try candidate phrases
 * against a 40-byte AES-KW blob, at 2^160 expected work. That is the reason no
 * password-hashing KDF is used on this path — Argon2id exists to buy work
 * factor for *low*-entropy secrets, and buying 2^20 of work on top of 2^160
 * would be theatre paid for in 500 ms and a second set of attacker-writable
 * cost parameters in the plaintext `meta` row (D19).
 *
 * The number itself is a transcription trade-off, taken deliberately between
 * two anchors:
 *
 * - **128 bits** is the conventional floor (BIP39's 12-word phrase, NIST's
 *   long-horizon symmetric target). It is also 25.6 base32 symbols — it does
 *   not tile a group.
 * - **256 bits** would match the data key, but 52 hand-copied symbols roughly
 *   doubles the transcription-error surface to defend a gap that does not
 *   exist: 2^160 is ~1.5x10^48 trials, and nothing that can search that can be
 *   stopped by searching 2^256 instead.
 *
 * 160 bits tiles exactly: 32 symbols, 8 groups of 4, no padding, no partial
 * group, and every 32-symbol string decodes — there is no unused-bit case that
 * would let two phrases mean the same 20 bytes. The recovery path's strength is
 * therefore stated plainly as **160-bit**, and that is a decision, not a
 * rounding.
 *
 * ## Why Crockford base32 and not a wordlist
 *
 * A BIP39-style wordlist reads better aloud, but it would put a 2048-word table
 * in the bundle and immediately raise the question this repo answers "both
 * locales, always" — an English wordlist shown to an Italian user is a
 * transcription hazard, and a second Italian list means two encodings of the
 * same secret and a way to lose data by pasting one into the other. Crockford
 * base32 is language-neutral: its alphabet excludes `I`, `L`, `O` and `U`, and
 * decoding folds the confusable characters (`I`/`l` -> `1`, `O` -> `0`) and
 * ignores case and separators, so most transcription slips still open the
 * vault instead of failing at the one moment the user has no other way in.
 *
 * There is deliberately **no checksum symbol**. AES-KW carries its own
 * integrity check, the recovery unlock costs one HKDF (microseconds, no
 * Argon2id), and a wrong phrase is therefore already reported immediately and
 * unambiguously. A checksum would only move the same "that is not the phrase"
 * message a few microseconds earlier, at the cost of an encoding rule that
 * must never drift.
 *
 * Pure TypeScript. Per the layer contract it imports neither React nor Dexie,
 * and — this is asserted, not merely intended, by
 * `test/unit/crypto/recovery-phrase-leak.test.ts` — it persists nothing, logs
 * nothing and transmits nothing.
 */

import { asPrivateBytes } from './bytes';

/** Entropy carried by a recovery phrase, in bits. */
export const RECOVERY_PHRASE_ENTROPY_BITS = 160;

/** Entropy carried by a recovery phrase, in bytes. */
export const RECOVERY_PHRASE_ENTROPY_BYTES = RECOVERY_PHRASE_ENTROPY_BITS / 8;

/**
 * Crockford base32 — RFC 4648's alphabet with `I`, `L`, `O` and `U` removed.
 * The first three are removed because they are confusable with `1`, `1` and
 * `0`; `U` is removed so that no phrase can spell an obscenity.
 */
export const RECOVERY_PHRASE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Symbols per hyphen-separated group in the written form. */
export const RECOVERY_PHRASE_GROUP_SIZE = 4;

/** Symbols in a whole phrase: 160 bits / 5 bits per symbol. */
export const RECOVERY_PHRASE_SYMBOL_COUNT = RECOVERY_PHRASE_ENTROPY_BITS / 5;

/** Groups in the written form. */
export const RECOVERY_PHRASE_GROUP_COUNT =
  RECOVERY_PHRASE_SYMBOL_COUNT / RECOVERY_PHRASE_GROUP_SIZE;

/**
 * Length of the per-vault HKDF salt for the recovery path, in bytes. Matches
 * the Argon2id salt length (§Decisions V1-2) for the same reason: it makes any
 * precomputation vault-specific.
 */
export const RECOVERY_SALT_LENGTH_BYTES = 16;

/**
 * HKDF `info` for the recovery key-encryption key. Domain-separates this
 * derivation from any other use of the same phrase bytes, and carries a version
 * so a future change to the derivation is a new label rather than a silent
 * incompatibility.
 */
export const RECOVERY_KEY_HKDF_INFO = 'cifra/recovery-key/v1';

/** Machine-readable reason a recovery-phrase input was rejected. */
export type RecoveryPhraseErrorCode =
  | 'phrase/empty'
  | 'phrase/invalid-symbol'
  | 'phrase/invalid-length'
  | 'salt/invalid-length'
  | 'environment/no-web-crypto';

/**
 * Error thrown for every rejected recovery-phrase input.
 *
 * Messages describe the *shape* of the problem only — how many symbols were
 * expected, that a symbol is not in the alphabet. They never echo the phrase,
 * any part of it, or any derived material, because an error message is exactly
 * the kind of string that ends up in a log or a bug report.
 */
export class RecoveryPhraseError extends Error {
  readonly code: RecoveryPhraseErrorCode;

  constructor(code: RecoveryPhraseErrorCode, message: string) {
    super(message);
    this.name = 'RecoveryPhraseError';
    this.code = code;
  }
}

/**
 * Crockford's decoding map: the alphabet itself, plus the confusable folds it
 * mandates. Built once from {@link RECOVERY_PHRASE_ALPHABET} so the two cannot
 * drift.
 */
const SYMBOL_VALUES: ReadonlyMap<string, number> = (() => {
  const values = new Map<string, number>();
  for (const [index, symbol] of [...RECOVERY_PHRASE_ALPHABET].entries()) {
    values.set(symbol, index);
  }
  values.set('O', 0);
  values.set('I', 1);
  values.set('L', 1);
  return values;
})();

function requireRandomValues(): Crypto {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues) {
    throw new RecoveryPhraseError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.getRandomValues) is unavailable in this environment',
    );
  }
  return webCrypto;
}

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new RecoveryPhraseError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.subtle) is unavailable in this environment',
    );
  }
  return subtle;
}

/**
 * Encodes exactly {@link RECOVERY_PHRASE_ENTROPY_BYTES} bytes as the written
 * phrase. 160 bits divide evenly into 32 five-bit symbols, so there is no
 * padding and no partial symbol to decide about.
 */
function encode(entropy: Uint8Array): string {
  const symbols: string[] = [];
  let bits = 0;
  let accumulator = 0;
  for (const byte of entropy) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      symbols.push(RECOVERY_PHRASE_ALPHABET[(accumulator >>> bits) & 0b11111]);
    }
  }
  const groups: string[] = [];
  for (let at = 0; at < symbols.length; at += RECOVERY_PHRASE_GROUP_SIZE) {
    groups.push(symbols.slice(at, at + RECOVERY_PHRASE_GROUP_SIZE).join(''));
  }
  return groups.join('-');
}

/**
 * Reads a phrase back to its 32 canonical symbols, applying Crockford's rules:
 * case is ignored, `O` folds to `0`, `I` and `L` fold to `1`, and hyphens and
 * whitespace are separators rather than content — so a phrase typed with
 * spaces, without groups, or in lower case still opens the vault.
 *
 * Everything else is rejected. In particular `U` is not in the alphabet and is
 * not folded onto anything: accepting it would mean two written phrases for one
 * secret.
 *
 * @throws {RecoveryPhraseError} `phrase/empty`, `phrase/invalid-symbol` or
 * `phrase/invalid-length`.
 */
function toSymbols(phrase: unknown): string {
  if (typeof phrase !== 'string' || phrase.trim().length === 0) {
    throw new RecoveryPhraseError(
      'phrase/empty',
      'Recovery phrase must not be empty',
    );
  }
  const symbols: string[] = [];
  for (const character of phrase.toUpperCase()) {
    if (character === '-' || /\s/.test(character)) continue;
    if (!SYMBOL_VALUES.has(character)) {
      throw new RecoveryPhraseError(
        'phrase/invalid-symbol',
        'Recovery phrase contains a character that is not part of the alphabet',
      );
    }
    symbols.push(
      RECOVERY_PHRASE_ALPHABET[SYMBOL_VALUES.get(character) as number],
    );
  }
  if (symbols.length === 0) {
    // Separators only ("----"): nothing was typed, whatever the string length
    // says.
    throw new RecoveryPhraseError(
      'phrase/empty',
      'Recovery phrase must not be empty',
    );
  }
  if (symbols.length !== RECOVERY_PHRASE_SYMBOL_COUNT) {
    throw new RecoveryPhraseError(
      'phrase/invalid-length',
      `Recovery phrase must hold exactly ${RECOVERY_PHRASE_SYMBOL_COUNT} symbols`,
    );
  }
  return symbols.join('');
}

/**
 * Generates a fresh recovery phrase: {@link RECOVERY_PHRASE_ENTROPY_BITS} bits
 * from the platform CSPRNG, in written form.
 *
 * The return value is the **only** copy of the secret that will ever exist. It
 * is not stored here, not stored by `vault.ts`, and there is no function
 * anywhere that reads it back out of a vault — recovering from a lost phrase
 * means regenerating one while the vault is unlocked
 * (`regenerateRecoveryPhrase`).
 *
 * @throws {RecoveryPhraseError} `environment/no-web-crypto`.
 */
export function generateRecoveryPhrase(): string {
  const entropy = new Uint8Array(RECOVERY_PHRASE_ENTROPY_BYTES);
  requireRandomValues().getRandomValues(entropy);
  return encode(entropy);
}

/**
 * Generates the per-vault HKDF salt for the recovery path. Public, not secret:
 * it belongs in the plaintext `meta` row beside the wrapped copy it salts.
 *
 * @throws {RecoveryPhraseError} `environment/no-web-crypto`.
 */
export function generateRecoverySalt(): Uint8Array<ArrayBuffer> {
  const salt = new Uint8Array(RECOVERY_SALT_LENGTH_BYTES);
  requireRandomValues().getRandomValues(salt);
  return salt;
}

/**
 * The canonical written form of `phrase` — uppercase, folded, regrouped.
 *
 * Useful to a setup screen that echoes back what the user typed, and to the
 * confirmation step; it is *not* a validity oracle for anything but the
 * encoding, since every well-formed phrase normalizes whether or not it is
 * this vault's.
 *
 * @throws {RecoveryPhraseError} for anything that is not a well-formed phrase.
 */
export function normalizeRecoveryPhrase(phrase: string): string {
  return encode(decodeRecoveryPhrase(phrase));
}

/**
 * Decodes a written phrase back to its {@link RECOVERY_PHRASE_ENTROPY_BYTES}
 * bytes of entropy.
 *
 * @throws {RecoveryPhraseError} `phrase/empty`, `phrase/invalid-symbol` or
 * `phrase/invalid-length`.
 */
export function decodeRecoveryPhrase(phrase: string): Uint8Array<ArrayBuffer> {
  const symbols = toSymbols(phrase);
  const entropy = new Uint8Array(RECOVERY_PHRASE_ENTROPY_BYTES);
  let bits = 0;
  let accumulator = 0;
  let at = 0;
  for (const symbol of symbols) {
    accumulator = (accumulator << 5) | (SYMBOL_VALUES.get(symbol) as number);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      entropy[at++] = (accumulator >>> bits) & 0xff;
    }
  }
  return entropy;
}

/**
 * Whether two written phrases denote the same secret — the check behind the
 * "type your recovery phrase back" step of vault setup (§Crypto step 3: the
 * phrase is shown once, so the acknowledgement has to happen while it is on
 * screen).
 *
 * Both sides are normalized first, so a user who retypes the phrase in lower
 * case, without hyphens, or with `O` for `0` is confirming rather than failing.
 * Anything malformed is simply `false`: this answers "did they copy it down
 * correctly", and a caller that wants the reason should decode instead.
 *
 * The comparison is **not** constant-time and does not need to be: both operands
 * are already in the caller's hands, so there is no secret here to leak by
 * timing.
 */
export function recoveryPhrasesMatch(
  expected: string,
  candidate: string,
): boolean {
  try {
    return (
      normalizeRecoveryPhrase(expected) === normalizeRecoveryPhrase(candidate)
    );
  } catch {
    return false;
  }
}

/**
 * Derives the recovery key-encryption key from a written phrase and the
 * vault's stored recovery salt.
 *
 * HKDF-SHA-256, not Argon2id — see the module comment: the phrase carries its
 * own {@link RECOVERY_PHRASE_ENTROPY_BITS} bits, so there is no low-entropy
 * secret to stretch, and this path deliberately stores no cost parameters that
 * an attacker with write access to the plaintext `meta` row could inflate
 * (D19). Derivation costs microseconds and stays on the calling thread, which
 * is why there is no worker here and why an unlock by recovery phrase never
 * posts anything to one.
 *
 * The result has exactly the shape `deriveMasterKey` produces — a
 * **non-extractable** 256-bit `AES-KW` key with usages `wrapKey` and
 * `unwrapKey` — so `key-wrap.ts` accepts it wherever it accepts a master key,
 * and the two unlock methods converge on one wrapping primitive rather than
 * two.
 *
 * @throws {RecoveryPhraseError} for a malformed phrase, a salt that is not
 * exactly {@link RECOVERY_SALT_LENGTH_BYTES} bytes, or a missing Web Crypto
 * implementation.
 */
export async function deriveRecoveryKey(
  phrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const subtle = requireSubtleCrypto();
  if (
    !(salt instanceof Uint8Array) ||
    salt.length !== RECOVERY_SALT_LENGTH_BYTES
  ) {
    throw new RecoveryPhraseError(
      'salt/invalid-length',
      `Recovery salt must be exactly ${RECOVERY_SALT_LENGTH_BYTES} bytes`,
    );
  }
  const entropy = decodeRecoveryPhrase(phrase);

  // HKDF input keying material is always imported non-extractable — Web Crypto
  // refuses `extractable: true` for HKDF — so the phrase's bytes cannot be read
  // back off this handle.
  const material = await subtle.importKey('raw', entropy, 'HKDF', false, [
    'deriveKey',
  ]);
  return await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asPrivateBytes(salt),
      info: new TextEncoder().encode(RECOVERY_KEY_HKDF_INFO),
    },
    material,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}
