/**
 * Argon2id policy: the cost parameters, their security bounds, the typed error
 * every rejected KDF input carries, and the input validation both sides of the
 * worker boundary run.
 *
 * Governed by `docs/architecture.md` §Crypto (Key hierarchy step 2) and D19.
 *
 * This module exists as a module because derivation moved into a Web Worker
 * (#61). `kdf.ts` (main thread) and `kdf-worker-body.ts` (worker) both need the
 * bounds and the error type, and only the worker side may reach `hash-wasm` —
 * so the shared policy cannot live in either of them. Splitting it out is what
 * lets `test/unit/crypto/kdf-worker-boundary.test.ts` assert that the main
 * thread's module graph reaches no Argon2id implementation at all.
 *
 * Pure TypeScript with no dependencies. Per the layer contract it imports
 * neither React nor Dexie, and it persists nothing.
 */

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
 * - `iterations: 3` — re-measured and deliberately kept by #29 (D23). Three
 *   passes at 64 MiB cost **103.8 ms of digest** in a real Chromium 151 worker
 *   on an Apple M4 (106.3 ms including worker spawn), and **102.7 ms** in Node
 *   24.14. Applied to {@link ARGON2ID_COST_MODEL} that predicts 519–830 ms on
 *   the target device, which is the architecture's ~500 ms band. It is also
 *   exactly RFC 9106 §4's *second recommended option* (t = 3, m = 64 MiB) and
 *   comfortably above every OWASP Argon2id minimum. **Do not move this number
 *   without a fresh measurement**: once a vault exists, changing it is a
 *   migration of every stored wrapped key, not a config edit.
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
 * The stated, falsifiable assumption behind {@link ARGON2ID_DEFAULT_PARAMS}
 * (D23).
 *
 * `docs/architecture.md` §Crypto asks for an unlock "tuned to roughly 500 ms on
 * the target device". Until #29 that sentence had no operable meaning, because
 * **the target device was never defined and has never been measured**. This
 * constant is that sentence turned into arithmetic anyone can refute with one
 * phone and one stopwatch.
 *
 * - **`referenceUsPerKibPass: 0.53`** — measured, not estimated. Argon2id's cost
 *   is linear in `memorySizeKib × iterations`, and hash-wasm 4.12.0 holds
 *   0.51–0.59 µs per KiB-pass across the whole admissible range on an Apple M4,
 *   in Node 24.14 and in a real Chromium 151 dedicated worker alike (64 MiB × 3
 *   = 103.8 ms, 64 MiB × 16 = 536.6 ms, 256 MiB × 4 = 572.1 ms; #29, and D19's
 *   table for the ceiling). Worker spawn is not part of this figure: it is a
 *   flat 2.5–3.7 ms once warm, and ~20 ms on a tab's *first* derivation, which
 *   pays the one-off Argon2 WebAssembly compile.
 * - **`targetDeviceSlowdown: 5–8`** — the assumption, and the only estimated
 *   number here. "The target device" is a **mid-range Android phone browser**,
 *   the device class this PWA is expected to be unlocked on most often. Nobody
 *   has run Argon2id on one yet. The range is the union of the two independent
 *   estimates this repo has already committed to in writing — D19 reasoned from
 *   ~5×, the Sprint 01 review of #29 from ~8× — and it brackets what a
 *   single-core score ratio (an M4 scores roughly 3–4× a mid-range 2024–2025
 *   SoC) predicts once memory bandwidth, which a memory-hard KDF is bound by far
 *   more than by ALU throughput, is taken into account. **This is the claim to
 *   attack**: measure a real phone with `test/e2e/kdf-worker.spec.ts`, which
 *   logs µs per KiB-pass for exactly this purpose, and divide (#78).
 * - **`unlockBudgetMs: 250–1000`** — "roughly 500 ms", read as within a factor
 *   of two either way. Since D22 the derivation runs on a worker thread, so the
 *   upper half of that band is a spinner rather than a frozen tab; the band is
 *   still a band because an unlock nobody waits for is a login people avoid,
 *   and one that returns instantly is one an attacker can grind. The budget is
 *   spent on the digest alone; the very first unlock in a tab additionally pays
 *   the WebAssembly compile above, which the same 5–8× turns into roughly
 *   100–160 ms — still inside the band, but it is the reason the band's top is
 *   1000 ms and not 830.
 *
 * The model is deliberately **not** consulted at runtime and derivation is never
 * auto-tuned from a live measurement: parameters that varied by device would
 * make the same password derive a different key on each of them, so a vault
 * created on a laptop could not be opened on a phone. It exists so that a
 * proposed change to the defaults can be argued against a number instead of an
 * intuition.
 */
export const ARGON2ID_COST_MODEL = Object.freeze({
  referenceUsPerKibPass: 0.53,
  targetDeviceSlowdown: Object.freeze({ min: 5, max: 8 }),
  unlockBudgetMs: Object.freeze({ min: 250, max: 1000 }),
});

/**
 * What {@link ARGON2ID_COST_MODEL} predicts one unlock costs on the target
 * device, as a millisecond range.
 *
 * Pure arithmetic over the model's constants — no clock is read, so the answer
 * is the same on every machine and in every run. That is what makes it usable
 * as an assertion: a parameter set that leaves
 * {@link ARGON2ID_COST_MODEL.unlockBudgetMs} does so identically in CI and on a
 * developer's laptop.
 */
export function predictedUnlockMs(params: Argon2idParams): {
  min: number;
  max: number;
} {
  const kibPasses = params.memorySizeKib * params.iterations;
  const referenceMs =
    (kibPasses * ARGON2ID_COST_MODEL.referenceUsPerKibPass) / 1000;
  return {
    min: referenceMs * ARGON2ID_COST_MODEL.targetDeviceSlowdown.min,
    max: referenceMs * ARGON2ID_COST_MODEL.targetDeviceSlowdown.max,
  };
}

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
 * Since #61 that worst case is spent on a worker thread rather than on the main
 * thread, so it is a long spinner rather than a frozen tab — but the ceiling is
 * unchanged and is still the bound that makes it finite. A worker does not make
 * unbounded work acceptable: it still burns the device's CPU and memory.
 *
 * **Headroom:** 5.3x the current default cost. #29 will likely raise the
 * iteration count; it should not need to touch this constant, because any
 * parameters costing more than 5x today's default already blow the
 * architecture's own ~500 ms budget long before they reach the ceiling. If a
 * future default genuinely needs more, raising this is a security decision with
 * a fresh measurement, not a tweak.
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
  | 'environment/no-web-crypto'
  | 'environment/no-worker'
  | 'worker/failed';

/**
 * Error thrown for every rejected KDF input.
 *
 * Messages are deliberately generic: they describe the *shape* of the problem
 * and never contain the password, the salt, or any derived material. That holds
 * across the worker boundary too — `kdf-worker-body.ts` sends back a code and a
 * message of its own making, never a serialized cause from Argon2id or Web
 * Crypto.
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
 * *algorithm*, not this app's policy — so the test-only vector helper in
 * `kdf-worker-body.ts` needs the ceiling without the strength floor. Every
 * production path goes through {@link assertArgon2idParams}, which is this plus
 * the floor.
 *
 * @internal Exported only for that vector helper.
 * @throws {KdfError} with code `params/invalid`.
 */
export function assertArgon2idCostBounds(
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

/**
 * Every check `deriveMasterKey` performs before Argon2id may run.
 *
 * **It runs on both sides of the worker boundary, deliberately.** On the main
 * thread it is what makes D19's bounds a denial-of-service defence: an absurd
 * `meta` row costs a thrown error in microseconds and does not even pay for a
 * worker to be spawned, let alone for the derivation. In the worker it runs
 * again because `kdf-worker.ts` is a separate entry point whose `onmessage`
 * accepts whatever the page sends it; a worker that trusted its input would be
 * one bad caller away from the 36.5 s burn S-4 measured, and a second
 * validation is free next to a memory-hard KDF.
 *
 * The order is fixed and asserted by `test/unit/crypto/kdf.test.ts`: password
 * shape, then salt, then parameters.
 *
 * @throws {KdfError} for an empty or absurdly long password, a salt that is not
 * exactly {@link SALT_LENGTH_BYTES} bytes, or out-of-bounds parameters. No
 * error carries key material.
 */
export function assertDeriveInputs(
  password: unknown,
  salt: unknown,
  params: unknown,
): asserts params is Argon2idParams {
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
 *
 * It happens in the worker, immediately before encoding, rather than on the
 * main thread: one call site, so the bytes fed to Argon2id are normalized
 * exactly once wherever the request came from.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}
