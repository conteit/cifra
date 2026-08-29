/**
 * Argon2id key derivation — step 2 of the vault key hierarchy.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy) and FOUN-02 /
 * FOUN-03. Turns a master password plus a per-user random 16-byte salt into a
 * 256-bit master key, imported as a **non-extractable** `CryptoKey`.
 *
 * The master key exists only to wrap and unwrap the randomly generated data key
 * (step 3, AES-KW). It is therefore imported with `algorithm: 'AES-KW'`,
 * `usages: ['wrapKey', 'unwrapKey']` and `extractable: false`: the raw bytes
 * never re-enter JavaScript once the key is imported, and the only operations
 * the key can perform are the two the hierarchy needs.
 *
 * This module is pure TypeScript. Per the layer contract it imports neither
 * React nor Dexie, and it persists nothing — callers own the salt and the
 * parameters, which live in the plaintext `meta` table.
 */

import { argon2id } from 'hash-wasm';

/** Length of the derived master key, in bytes (256 bits). */
export const MASTER_KEY_LENGTH_BYTES = 32;

/** Length of the per-user random KDF salt, in bytes. */
export const SALT_LENGTH_BYTES = 16;

/**
 * Longest accepted master password, in UTF-16 code units. Argon2id's cost is
 * dominated by the memory parameter, so a long password is not expensive — this
 * bound exists to reject absurd input (a pasted file, a runaway buffer) at the
 * boundary rather than to constrain real passwords.
 */
export const MAX_PASSWORD_LENGTH = 1024;

/** Argon2id cost parameters. Stored per vault alongside the salt. */
export interface Argon2idParams {
  /** Memory cost in kibibytes (1024 bytes). */
  readonly memorySizeKib: number;
  /** Time cost — number of passes over the memory. */
  readonly iterations: number;
  /** Number of lanes. */
  readonly parallelism: number;
}

/**
 * Default Argon2id parameters for newly created vaults.
 *
 * - `memorySizeKib: 65536` — 64 MiB, mandated by `docs/architecture.md` §Crypto
 *   and comfortably above the OWASP Argon2id minimum (46 MiB at t=1).
 * - `iterations: 3` — chosen against a measured benchmark. `hash-wasm`'s
 *   Argon2id costs ~35 ms per pass at 64 MiB on an Apple M4 under Node 24, so
 *   three passes are ~104 ms there and land in the architecture's ~500 ms band
 *   on the slower mid-range mobile browsers that are the actual target device.
 * - `parallelism: 1` — `hash-wasm` runs Argon2id single-threaded in WebAssembly,
 *   so lanes above 1 cost the same wall-clock time while splitting the memory
 *   into smaller, more cache-friendly slices. One lane keeps the memory-hardness
 *   undivided.
 *
 * These are **defaults for new vaults only**. Derivation always uses the
 * parameters it is handed, so a vault created under older parameters still
 * unlocks after this constant changes — the parameters stored in the plaintext
 * `meta` table are what make derivation reproducible, not this constant.
 * Deliberately there is no runtime auto-tuning: tuning per device would make
 * the same password derive different keys on different devices.
 */
export const ARGON2ID_DEFAULT_PARAMS: Argon2idParams = Object.freeze({
  memorySizeKib: 65536,
  iterations: 3,
  parallelism: 1,
});

/**
 * Per-parameter bounds. The minima are Argon2's own structural limits; the
 * maxima are **security bounds** — see {@link ARGON2ID_COST_CEILING_KIB_PASSES}.
 */
const PARAM_BOUNDS = {
  /**
   * Max 262144 KiB = 256 MiB. This bounds the *peak allocation* independently
   * of the cost ceiling below, which the ceiling alone does not: 1 GiB at
   * `iterations: 1` costs 1048576 KiB-passes — exactly at the ceiling, 625 ms
   * on an M4 — yet asking a mid-range phone browser for a 1 GiB Argon2 block
   * array is an out-of-memory crash whatever the wall time says. 256 MiB is 4x
   * the 64 MiB the architecture mandates for the default (§Key hierarchy step
   * 2), which is headroom no plausible future default needs.
   */
  memorySizeKib: { min: 8, max: 262_144 },
  /**
   * Max 16 passes. Not the bound that limits wall time — the cost ceiling is —
   * but a sanity bound on a parameter that has no legitimate reason to be
   * large. 16 is exactly the ceiling divided by the mandated 64 MiB, so a
   * 16-pass vault is only expressible at or below the architecture's memory
   * figure, and it is 5.3x the current default of 3.
   */
  iterations: { min: 1, max: 16 },
  parallelism: { min: 1, max: 16 },
} as const;

/**
 * The cost ceiling, in KiB-passes (`memorySizeKib * iterations`).
 *
 * **This is a security bound, not a performance tuning knob.** Parameters reach
 * derivation from the plaintext, unauthenticated `meta` table (§Key hierarchy
 * step 3), so anyone who can write that row chooses the cost of the next
 * unlock. Without a ceiling that is a trivial denial of service: the previous
 * bounds admitted 1 GiB x 64 passes, **measured at 36.5 s** of frozen main
 * thread on an Apple M4 under Node 24 (Sprint 01 security review, S-4).
 *
 * The ceiling is on the *product* rather than on each parameter alone because
 * per-parameter caps multiply — a 256 MiB cap and a 16-pass cap together still
 * admit 4 GiB-passes. Argon2id's cost is linear in `m * t`, which is what makes
 * a single product bound both sufficient and tight. Measured on an M4, hash-wasm
 * costs 0.51-0.60 us per KiB-pass and the split does not matter:
 *
 * | m x t                 | KiB-passes | measured |
 * |-----------------------|-----------:|---------:|
 * | 64 MiB x 3 (default)  |    196 608 |    100 ms |
 * | 64 MiB x 16           |  1 048 576 |    531 ms |
 * | 128 MiB x 8           |  1 048 576 |    547 ms |
 * | 256 MiB x 4           |  1 048 576 |    560 ms |
 * | 1 GiB x 1             |  1 048 576 |    625 ms |
 * | 1 GiB x 64 (old cap)  | 67 108 864 | 36 494 ms |
 *
 * 1048576 KiB-passes is therefore ~0.6 s worst case on this machine. The
 * architecture puts the *default* at roughly 500 ms on the target mid-range
 * mobile browser, where it measures 100 ms here — so that device is ~5x slower
 * and the ceiling's worst case there is ~3 s. Bad, but survivable, and bounded.
 *
 * **Headroom:** 5.3x the current default cost. #29 will likely raise the
 * iteration count and #61 moves derivation into a Web Worker; neither should
 * ever need to touch this constant, because any parameters costing more than 5x
 * today's default already blow the architecture's own ~500 ms budget long
 * before they reach the ceiling. If a future default genuinely needs more,
 * raising this is a security decision with a fresh measurement, not a tweak.
 */
const ARGON2ID_COST_CEILING_KIB_PASSES = 1_048_576;

/**
 * The strength floor, applied to parameters production will actually derive
 * with.
 *
 * A *weak* stored parameter set is not a decryption risk: weak params derive a
 * different master key, so `unwrapDataKey` fails with `unwrap/failed` and no
 * data comes out. The floor is here for the path that does bite — anything that
 * *creates* or *re-wraps* a vault. Vault setup (#9) must always use
 * {@link ARGON2ID_DEFAULT_PARAMS} and never read parameters back from `meta`;
 * this floor is the backstop that turns a future mistake there into a loud
 * `params/invalid` instead of a silently weak vault.
 *
 * The values are OWASP's weakest acceptable Argon2id configuration — m = 19 MiB,
 * t = 2, p = 1 — expressed as a memory minimum plus a cost minimum rather than
 * a minimum on each parameter. A minimum on `iterations` alone would reject
 * m = 64 MiB, t = 1, which is *stronger* than the floor it would fail; the
 * memory minimum is separate because it guards memory-hardness specifically,
 * which a cost minimum cannot (8 KiB x 4864 passes buys the same block work
 * with none of the resistance to parallel hardware that is the point of
 * Argon2).
 *
 * **The moment to set a floor is now.** Stored parameters exist so a vault
 * created under old settings still unlocks after the defaults move; a floor
 * introduced *after* vaults exist could permanently lock out any vault below
 * it — the exact data destruction this bound exists to prevent. No vault exists
 * yet (Phase 1 has no user-facing write path; see D18), and the only default
 * ever defined is 64 MiB x 3, well above the floor. It is free today and would
 * not be later.
 */
const ARGON2ID_STRENGTH_FLOOR = {
  memorySizeKib: 19_456,
  costKibPasses: 38_912,
} as const;

/** Machine-readable reason a KDF call was rejected. */
export type KdfErrorCode =
  | 'password/empty'
  | 'password/too-long'
  | 'salt/invalid-length'
  | 'params/invalid'
  | 'environment/no-web-crypto';

/**
 * Error thrown for every rejected KDF input.
 *
 * Messages are deliberately generic: they describe the *shape* of the problem
 * and never contain the password, the salt, or any derived material.
 */
export class KdfError extends Error {
  readonly code: KdfErrorCode;

  constructor(code: KdfErrorCode, message: string) {
    super(message);
    this.name = 'KdfError';
    this.code = code;
  }
}

function isPositiveIntegerWithin(
  value: unknown,
  bounds: { min: number; max: number },
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= bounds.min &&
    value <= bounds.max
  );
}

/**
 * Structural validity plus the cost ceiling: the parameters describe a real
 * Argon2id configuration, and one this app is willing to spend time on.
 *
 * Kept separate from {@link assertArgon2idParams} because the published
 * reference test vectors are deliberately weak — they exist to pin the
 * *algorithm*, not this app's policy — so the test-only vector helper needs the
 * ceiling without the strength floor. Every production path goes through
 * {@link assertArgon2idParams}, which is this plus the floor.
 *
 * @throws {KdfError} with code `params/invalid`.
 */
function assertArgon2idCostBounds(
  params: unknown,
): asserts params is Argon2idParams {
  if (typeof params !== 'object' || params === null) {
    throw new KdfError(
      'params/invalid',
      'Argon2id parameters must be an object',
    );
  }

  const { memorySizeKib, iterations, parallelism } = params as Record<
    keyof Argon2idParams,
    unknown
  >;

  if (!isPositiveIntegerWithin(parallelism, PARAM_BOUNDS.parallelism)) {
    throw new KdfError(
      'params/invalid',
      `Argon2id parallelism must be an integer in [${PARAM_BOUNDS.parallelism.min}, ${PARAM_BOUNDS.parallelism.max}]`,
    );
  }
  if (!isPositiveIntegerWithin(iterations, PARAM_BOUNDS.iterations)) {
    throw new KdfError(
      'params/invalid',
      `Argon2id iterations must be an integer in [${PARAM_BOUNDS.iterations.min}, ${PARAM_BOUNDS.iterations.max}]`,
    );
  }
  if (!isPositiveIntegerWithin(memorySizeKib, PARAM_BOUNDS.memorySizeKib)) {
    throw new KdfError(
      'params/invalid',
      `Argon2id memory must be an integer number of KiB in [${PARAM_BOUNDS.memorySizeKib.min}, ${PARAM_BOUNDS.memorySizeKib.max}]`,
    );
  }
  // Argon2 requires m >= 8 * p (each lane needs at least four slices of two blocks).
  if (memorySizeKib < 8 * parallelism) {
    throw new KdfError(
      'params/invalid',
      'Argon2id memory must be at least 8 KiB per lane',
    );
  }
  // The bound that actually caps wall-clock time. Both operands are already
  // known to be integers within the per-parameter bounds, so the product can
  // neither overflow nor be NaN.
  if (memorySizeKib * iterations > ARGON2ID_COST_CEILING_KIB_PASSES) {
    throw new KdfError(
      'params/invalid',
      `Argon2id cost (memory KiB x iterations) must be at most ${ARGON2ID_COST_CEILING_KIB_PASSES}`,
    );
  }
}

/**
 * The production gate for Argon2id parameters, whether they come from
 * {@link ARGON2ID_DEFAULT_PARAMS} or are read back from the plaintext `meta`
 * table.
 *
 * Reading parameters from storage is an untrusted path — `meta` is plaintext
 * *and* unauthenticated by design (§Key hierarchy step 3; authenticating the
 * row is tracked as #32). The realistic consequence of a rewritten row is
 * **denial of service and data destruction**, not disclosure: substituted
 * parameters derive a *different* master key, so `unwrapDataKey` fails and
 * nothing decrypts. What is left to defend against is cost — the ceiling — and,
 * for any path that creates or re-wraps a vault, weakness — the floor.
 *
 * Both bounds are checked here, before {@link deriveMasterKey} touches
 * Argon2id, so absurd parameters cost a thrown error rather than a frozen tab.
 *
 * @throws {KdfError} with code `params/invalid`.
 */
export function assertArgon2idParams(
  params: unknown,
): asserts params is Argon2idParams {
  assertArgon2idCostBounds(params);

  if (params.memorySizeKib < ARGON2ID_STRENGTH_FLOOR.memorySizeKib) {
    throw new KdfError(
      'params/invalid',
      `Argon2id memory must be at least ${ARGON2ID_STRENGTH_FLOOR.memorySizeKib} KiB`,
    );
  }
  if (
    params.memorySizeKib * params.iterations <
    ARGON2ID_STRENGTH_FLOOR.costKibPasses
  ) {
    throw new KdfError(
      'params/invalid',
      `Argon2id cost (memory KiB x iterations) must be at least ${ARGON2ID_STRENGTH_FLOOR.costKibPasses}`,
    );
  }
}

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new KdfError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.subtle) is unavailable in this environment',
    );
  }
  return subtle;
}

/**
 * Generates a fresh per-user salt: {@link SALT_LENGTH_BYTES} bytes straight from
 * the platform CSPRNG. A salt is never derived from the user id, the email, or
 * any other predictable value (see §Decisions V1-2) — that is what stops a
 * single precomputed table from covering more than one vault.
 */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH_BYTES);
  if (!globalThis.crypto?.getRandomValues) {
    throw new KdfError(
      'environment/no-web-crypto',
      'Web Crypto (crypto.getRandomValues) is unavailable in this environment',
    );
  }
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

/**
 * Normalizes a master password before it is encoded and hashed.
 *
 * NFC only, per RFC 8265 §4.2 (the PRECIS `OpaqueString` profile, which is the
 * profile for passwords). The same accented character can arrive precomposed
 * (`é` = U+00E9) from one keyboard or IME and decomposed (`e` + U+0301) from
 * another; without normalization the same typed password would fail to unlock a
 * vault created on the other device. NFKC is deliberately *not* used: its
 * compatibility mappings fold visually distinct characters together (fullwidth
 * onto ASCII, ligatures apart) which silently discards password entropy and
 * makes distinct passwords collide.
 */
function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/**
 * The raw Argon2id digest step, shared by {@link deriveMasterKey} and by the
 * known-answer vector tests. Takes already-encoded bytes so that the exact
 * input fed to Argon2id is visible and testable.
 */
async function argon2idDigest(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  params: Argon2idParams,
  hashLength: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await argon2id({
    password: passwordBytes,
    salt: saltBytes,
    iterations: params.iterations,
    parallelism: params.parallelism,
    memorySize: params.memorySizeKib,
    hashLength,
    outputType: 'binary',
  });
  // hash-wasm types its output as `Uint8Array<ArrayBufferLike>`, which Web
  // Crypto's `BufferSource` will not accept under TS 5.9. Copy into a view that
  // is statically known to sit on a plain `ArrayBuffer`, then clear hash-wasm's
  // copy so only one buffer holds the material.
  const out = new Uint8Array(new ArrayBuffer(digest.length));
  out.set(digest);
  digest.fill(0);
  return out;
}

/**
 * Test-only access to the raw Argon2id digest step.
 *
 * @internal Not part of the public crypto API. It exists solely so the
 * reference known-answer vectors can be asserted against the same digest
 * function {@link deriveMasterKey} calls. Production code must use
 * {@link deriveMasterKey}, which never returns key material — exposing the raw
 * digest anywhere else would defeat the non-extractable `CryptoKey` guarantee.
 * It deliberately bypasses the 16-byte-salt rule because the published vectors
 * use 8-byte salts, and the strength floor because those vectors are
 * deliberately weak (m = 256 KiB, t = 1) — they pin the algorithm, not this
 * app's policy. The **cost ceiling still applies**: nothing in this codebase,
 * test paths included, gets to burn unbounded time on Argon2id.
 */
export async function argon2idDigestForVectorTests(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  params: Argon2idParams,
  hashLength: number,
): Promise<Uint8Array<ArrayBuffer>> {
  assertArgon2idCostBounds(params);
  return await argon2idDigest(passwordBytes, saltBytes, params, hashLength);
}

/**
 * Derives the 256-bit vault master key from a master password and the vault's
 * per-user salt.
 *
 * The returned `CryptoKey` is **non-extractable** and scoped to `AES-KW`
 * `wrapKey` / `unwrapKey`: it can only wrap and unwrap the data key (step 3 of
 * the hierarchy), never encrypt records directly and never be exported.
 *
 * `params` must be the parameters stored with the vault. Omit them only when
 * creating a new vault, in which case {@link ARGON2ID_DEFAULT_PARAMS} is used
 * and the caller must persist them alongside the salt.
 *
 * @throws {KdfError} for an empty or absurdly long password, a salt that is not
 * exactly {@link SALT_LENGTH_BYTES} bytes, out-of-bounds parameters, or a
 * missing Web Crypto implementation. No error carries key material.
 */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: Argon2idParams = ARGON2ID_DEFAULT_PARAMS,
): Promise<CryptoKey> {
  const subtle = requireSubtleCrypto();

  if (typeof password !== 'string' || password.length === 0) {
    throw new KdfError('password/empty', 'Master password must not be empty');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new KdfError(
      'password/too-long',
      `Master password must be at most ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
  if (!(salt instanceof Uint8Array) || salt.length !== SALT_LENGTH_BYTES) {
    throw new KdfError(
      'salt/invalid-length',
      `Salt must be exactly ${SALT_LENGTH_BYTES} bytes`,
    );
  }
  assertArgon2idParams(params);

  const passwordBytes = new TextEncoder().encode(normalizePassword(password));
  let keyBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    keyBytes = await argon2idDigest(
      passwordBytes,
      salt,
      params,
      MASTER_KEY_LENGTH_BYTES,
    );
    return await subtle.importKey('raw', keyBytes, 'AES-KW', false, [
      'wrapKey',
      'unwrapKey',
    ]);
  } finally {
    // Best-effort hygiene: drop the intermediate plaintext material as soon as
    // the key is imported, so it is not left sitting in a live buffer for the
    // rest of the session.
    //
    // Honest limits: JavaScript offers no guarantee here. The `password` string
    // itself is immutable and stays in the V8 heap until it is collected; the
    // engine and hash-wasm's WebAssembly linear memory may both hold copies
    // this code cannot reach; and a moving garbage collector can leave stale
    // copies behind. Treat this as reducing the window, not closing it.
    passwordBytes.fill(0);
    keyBytes?.fill(0);
  }
}
